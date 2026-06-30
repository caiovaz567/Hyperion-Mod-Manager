import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { ModMetadata, IpcResult, PurgeModsResult, ConflictInfo, ModUpdateStatus, ModUpdateCheckResult, ModUpdateCheckInput, ModUpdateCache, NxmLinkPayload, NexusValidateResult } from '../../../shared/types'
import { IpcService } from '../../services/IpcService'
import { translate, translateN } from '../../i18n/translate'
import { recomputeConflictStateFromExistingConflicts } from '../../utils/modConflictState'
import { applyConflictState, scheduleConflictRefresh } from './libraryConflictRefresh'
import {
  appendAndSortLibraryEntry,
  enabledLibraryModCount,
  filterLibraryMods,
  hasConflictSensitiveMetadataUpdate,
  markPurgedModsDisabled,
  removeLibraryEntry,
  reorderLibraryEntries,
  setModEnabled,
  setModsEnabled,
  totalLibraryModCount,
} from './librarySliceHelpers'

export type LibraryStatusFilter = 'all' | 'enabled' | 'disabled'

// Persist Nexus update statuses across sessions so the app doesn't re-query every
// installed mod on every launch. The cache lives in the main process (userData) so it
// survives restarts in both dev and packaged builds — renderer localStorage would be
// wiped on every dev restart (sessionData is namespaced per process id in dev). The
// store hydrates from it asynchronously on boot via hydrateModUpdates().
function persistModUpdates(statuses: Record<string, ModUpdateStatus>, checkedAt: string | null): void {
  void IpcService.invoke(IPC.MOD_UPDATE_CACHE_SET, { statuses, checkedAt }).catch(() => undefined)
}

// Pick the `updated.json` window for a bulk check based on how long since the last
// check, so it always covers the gap (mirrors how MO2 adapts its query period).
function pickUpdatedPeriod(lastCheckedAt: string | null): '1d' | '1w' | '1m' {
  if (!lastCheckedAt) return '1m'
  const elapsedMs = Date.now() - Date.parse(lastCheckedAt)
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '1m'
  const DAY = 86_400_000
  if (elapsedMs <= DAY) return '1d'
  if (elapsedMs <= 7 * DAY) return '1w'
  return '1m'
}

// Per-session guards for lazy archive-name resolution (see resolveArchiveNames): at most
// one in-flight request per mod, and never re-attempt a mod whose names were already
// resolved (or proven unresolvable) this session — the external tooling is expensive.
const archiveNamesResolveInFlight = new Set<string>()
const archiveNamesResolvedThisSession = new Set<string>()

export interface LibrarySlice {
  mods: ModMetadata[]
  conflicts: ConflictInfo[]
  filter: string
  typeFilter: string
  selectedModId: string | null
  libraryStatusFilter: LibraryStatusFilter
  libraryDeleteAllRequestedAt: number | null
  modUpdates: Record<string, ModUpdateStatus>
  modUpdatesCheckedAt: string | null
  checkingModUpdates: boolean

  // Actions
  scanMods: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean; refreshFileMetadata?: boolean }) => Promise<ModMetadata[]>
  restoreEnabledMods: (modsToRestore?: ModMetadata[]) => Promise<IpcResult<ModMetadata[]>[]>
  enableMod: (id: string) => Promise<IpcResult>
  disableMod: (id: string) => Promise<IpcResult>
  enableMods: (ids: string[]) => Promise<IpcResult<{ processed: string[]; failed: string[] }>>
  disableMods: (ids: string[]) => Promise<IpcResult<{ processed: string[]; failed: string[] }>>
  purgeMods: () => Promise<IpcResult<PurgeModsResult>>
  deleteMod: (id: string) => Promise<IpcResult>
  createSeparator: (name?: string) => Promise<ModMetadata | null>
  reorderMods: (orderedIds: string[]) => Promise<void>
  updateModMetadata: (id: string, updates: Partial<ModMetadata>) => Promise<void>
  refreshConflicts: (options?: { immediate?: boolean }) => Promise<void>
  resolveArchiveNames: (uuid: string) => Promise<void>
  refreshModFiles: (uuid: string) => Promise<void>
  checkModUpdates: (options?: { force?: boolean; notify?: boolean; full?: boolean; modIds?: string[]; staleAfterMs?: number }) => Promise<void>
  hydrateModUpdates: () => Promise<void>
  clearModUpdate: (uuid: string) => void
  updateMod: (uuid: string) => Promise<void>
  setFilter: (filter: string) => void
  setTypeFilter: (type: string) => void
  setLibraryStatusFilter: (filter: LibraryStatusFilter) => void
  requestLibraryDeleteAll: () => void
  clearLibraryDeleteAllRequest: () => void
  selectMod: (id: string | null) => void

  // Derived (computed inline)
  filteredMods: () => ModMetadata[]
  enabledCount: () => number
  totalCount: () => number
}

export const createLibrarySlice: StateCreator<LibrarySlice, [], [], LibrarySlice> = (
  set,
  get
) => ({
  mods: [],
  conflicts: [],
  filter: '',
  typeFilter: '',
  selectedModId: null,
  libraryStatusFilter: 'all',
  libraryDeleteAllRequestedAt: null,
  modUpdates: {},
  modUpdatesCheckedAt: null,
  checkingModUpdates: false,

  scanMods: async (options) => {
    const result = await IpcService.invoke<IpcResult<ModMetadata[]>>(IPC.SCAN_MODS, { refreshFileMetadata: options?.refreshFileMetadata === true })
    if (result.ok && result.data) {
      const currentModIds = new Set(result.data.map((mod) => mod.uuid))
      const previousModUpdates = get().modUpdates
      const keptEntries = Object.entries(previousModUpdates).filter(([uuid]) => currentModIds.has(uuid))
      const removedSome = keptEntries.length !== Object.keys(previousModUpdates).length
      // Only rebuild + re-persist the cache when a mod actually went away (e.g. delete);
      // a plain enable/disable/reorder scan shouldn't trigger a cache write.
      const prunedModUpdates = removedSome ? Object.fromEntries(keptEntries) : previousModUpdates
      // conflictSummary is renderer-only derived state — SCAN_MODS reads from disk and never
      // carries it, so a plain replace would blank every conflict badge until the async refresh
      // lands. The refresh can be delayed (it serializes behind a slow first-run deep archive
      // pass), which is why reinstalling a mod made its badges vanish "for a while". Carry the
      // previous summary over by uuid (reinstall/replace preserves the uuid) so badges stay
      // stable; the scheduled refresh below still corrects them when it runs.
      const previousSummaries = new Map(get().mods.map((mod) => [mod.uuid, mod.conflictSummary] as const))
      const mergedMods = result.data.map((mod) => {
        const summary = previousSummaries.get(mod.uuid)
        return summary ? { ...mod, conflictSummary: summary } : mod
      })
      set({ mods: mergedMods, modUpdates: prunedModUpdates })
      if (removedSome) persistModUpdates(prunedModUpdates, get().modUpdatesCheckedAt)
      // Update status is never fetched automatically — not on scan, install, or delete.
      // Cached indicators persist and refreshing is fully user-driven via per-mod
      // "Check for Update" or the "Check Updates" toolbar button.
      if (options?.refreshConflicts !== false) {
        void scheduleConflictRefresh(set, options?.immediateConflicts ?? true)
      }

      return result.data
    }
    return []
  },

  restoreEnabledMods: async (modsToRestore) => {
    const sourceMods = modsToRestore ?? get().mods
    const enabledMods = sourceMods.filter((mod) => mod.kind === 'mod' && mod.enabled)
    if (enabledMods.length === 0) {
      return []
    }

    const result = await IpcService.invoke<IpcResult<ModMetadata[]>>(IPC.RESTORE_ENABLED_MODS)
    if (result.ok && result.data) {
      set({ mods: result.data })
      await scheduleConflictRefresh(set, true)
    }

    return [result]
  },

  enableMod: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.ENABLE_MOD, id)
    if (result.ok) {
      set((state) => ({
        mods: setModEnabled(state.mods, id, true)
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  enableMods: async (ids) => {
    const result = await IpcService.invoke<IpcResult<{ processed: string[]; failed: string[] }>>(IPC.ENABLE_MODS, ids)
    if (result.ok || result.data) {
      const processed = result.data?.processed ?? ids.filter(Boolean)
      set((state) => ({
        mods: setModsEnabled(state.mods, processed, true)
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  disableMod: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.DISABLE_MOD, id)
    if (result.ok) {
      set((state) => ({
        mods: setModEnabled(state.mods, id, false)
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  disableMods: async (ids) => {
    const result = await IpcService.invoke<IpcResult<{ processed: string[]; failed: string[] }>>(IPC.DISABLE_MODS, ids)
    if (result.ok || result.data) {
      const processed = result.data?.processed ?? ids.filter(Boolean)
      set((state) => ({
        mods: setModsEnabled(state.mods, processed, false)
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  purgeMods: async () => {
    const result = await IpcService.invoke<IpcResult<PurgeModsResult>>(IPC.PURGE_MODS)
    if (result.data && result.data.purged > 0) {
      set((state) => ({
        mods: markPurgedModsDisabled(state.mods)
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  deleteMod: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.DELETE_MOD, id)
    if (result.ok) {
      set((state) => ({
        mods: removeLibraryEntry(state.mods, id),
        selectedModId:
          state.selectedModId === id ? null : state.selectedModId
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  createSeparator: async (name = 'New Separator') => {
    const result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.CREATE_SEPARATOR, name)
    if (result.ok && result.data) {
      set((state) => ({
        mods: appendAndSortLibraryEntry(state.mods, result.data!)
      }))
      return result.data
    }
    return null
  },

  reorderMods: async (orderedIds) => {
    set((state) => {
      return { mods: reorderLibraryEntries(state.mods, orderedIds) }
    })

    const { mods, conflicts } = get()
    const optimisticConflictState = recomputeConflictStateFromExistingConflicts(mods, conflicts)
    applyConflictState(set, optimisticConflictState.summaries, optimisticConflictState.conflicts)

    void scheduleConflictRefresh(set)

    const result = await IpcService.invoke<IpcResult>(IPC.REORDER_MODS, orderedIds)
    if (!result.ok) {
      await get().scanMods()
    }
  },

  updateModMetadata: async (id, updates) => {
    const result = await IpcService.invoke<IpcResult<ModMetadata>>(
      IPC.UPDATE_MOD_METADATA,
      id,
      updates
    )
    if (result.ok && result.data) {
      set((state) => ({
        mods: state.mods.map((m) => (m.uuid === id ? result.data! : m))
      }))

      if (hasConflictSensitiveMetadataUpdate(updates)) {
        void scheduleConflictRefresh(set)
      }
    }
  },
  refreshConflicts: async (options) => {
    await scheduleConflictRefresh(set, options?.immediate ?? false)
  },
  refreshModFiles: async (uuid) => {
    // Re-read this mod's on-disk file list (Files tab). Routine scans reuse the stored list,
    // so this is how files added/removed directly in the mod folder become visible.
    if (!uuid) return
    const result = await IpcService.invoke<IpcResult<ModMetadata>>(IPC.REFRESH_MOD_FILES, uuid)
    if (result.ok && result.data) {
      const updated = result.data
      set((state) => ({
        // Keep the renderer-derived conflictSummary; only the on-disk fields changed.
        mods: state.mods.map((m) => (m.uuid === uuid ? { ...updated, conflictSummary: m.conflictSummary } : m)),
      }))
    }
  },
  resolveArchiveNames: async (uuid) => {
    // Lazy display-name resolution: only runs the slow external tooling (LXRS + kark) for
    // a single mod, on demand, when its conflict inspector is opened with unresolved hashes.
    if (!uuid || archiveNamesResolveInFlight.has(uuid) || archiveNamesResolvedThisSession.has(uuid)) return
    archiveNamesResolveInFlight.add(uuid)
    try {
      const result = await IpcService.invoke<IpcResult<{ resolved: number }>>(IPC.RESOLVE_MOD_ARCHIVE_NAMES, uuid)
      // Mark attempted regardless of outcome so a genuinely-unresolvable mod (hashes not in
      // the DB/LXRS/kark) doesn't re-trigger the slow tooling every time it's reopened.
      archiveNamesResolvedThisSession.add(uuid)
      if (result.ok && result.data && result.data.resolved > 0) {
        // The sidecar now carries resolved names — recompute so the inspector shows them.
        await scheduleConflictRefresh(set, true)
      }
    } catch {
      // Name resolution is best-effort display sugar; never surface an error for it.
    } finally {
      archiveNamesResolveInFlight.delete(uuid)
    }
  },
  checkModUpdates: async (options) => {
    if (get().checkingModUpdates) return
    // Recency gate (launch path): skip the request entirely when the cache was
    // refreshed within `staleAfterMs`. The hydrated cache already shows current
    // indicators, so quick relaunches don't each hit Nexus. Manual "Check
    // Updates" and per-mod checks omit this option, so they always run.
    const staleAfterMs = options?.staleAfterMs
    if (typeof staleAfterMs === 'number' && staleAfterMs > 0) {
      const last = get().modUpdatesCheckedAt
      if (last) {
        const elapsed = Date.now() - Date.parse(last)
        if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < staleAfterMs) return
      }
    }
    const force = options?.force === true
    const full = options?.full === true
    const announce = options?.notify === true
    // Scoped check: only refresh these mod uuids and merge into the cached statuses
    // (used after installing a mod, so we don't re-scan the whole library).
    const modIds = options?.modIds && options.modIds.length > 0 ? options.modIds : undefined
    const notify = (message: string, severity: 'info' | 'success' | 'warning' | 'error' = 'info') => {
      const ext = get() as LibrarySlice & {
        addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      }
      ext.addToast?.(message, severity, 3200)
    }
    const inputs: ModUpdateCheckInput[] = get().mods
      .filter((mod) => mod.kind === 'mod' && typeof mod.nexusModId === 'number')
      .map((mod) => ({
        uuid: mod.uuid,
        nexusModId: mod.nexusModId as number,
        nexusFileId: mod.nexusFileId,
        version: mod.version,
        installedAt: mod.installedAt,
        nexusCategoryName: mod.nexusCategoryName,
      }))
    if (inputs.length === 0) {
      // No Nexus mods at all — clear the cache (but never from a scoped check).
      if (!modIds) {
        const clearedAt = new Date().toISOString()
        set({ modUpdates: {}, modUpdatesCheckedAt: clearedAt })
        persistModUpdates({}, clearedAt)
      }
      if (announce) notify(translate('library.toast.noNexusMods'), 'info')
      return
    }
    // A bulk "check all" derives its window from the last check; full and scoped
    // checks don't use the window.
    const period = !full && !modIds ? pickUpdatedPeriod(get().modUpdatesCheckedAt) : undefined
    set({ checkingModUpdates: true })
    try {
      const result = await IpcService.invoke<IpcResult<ModUpdateCheckResult>>(
        IPC.NEXUS_CHECK_MOD_UPDATES,
        { mods: inputs, force, full, modIds, period }
      )
      if (result.ok && result.data) {
        // No API key means no check actually ran — don't advance the cache or its
        // last-checked timestamp (doing so would make the launch recency gate skip
        // real checks once a key is added). Just nudge the user if asked.
        if (result.data.skippedReason === 'no-api-key') {
          if (announce) notify(translate('library.toast.addApiKey'), 'warning')
          return
        }
        const previousUpdates = get().modUpdates
        // A full pass inspects every mod and replaces the cache. Bulk and scoped checks
        // only return the mods they actually deep-checked, so they merge into the cache
        // (untouched mods keep their known status — no per-mod request needed).
        const replace = full && !modIds
        const map: Record<string, ModUpdateStatus> = replace ? {} : { ...previousUpdates }
        for (const status of result.data.statuses) {
          map[status.uuid] = status
        }
        set({ modUpdates: map, modUpdatesCheckedAt: result.data.checkedAt })
        persistModUpdates(map, result.data.checkedAt)

        // Patch categories in the store for mods that received Nexus category data
        const withCategory = result.data.statuses.filter((s) => s.nexusCategoryName)
        if (withCategory.length > 0) {
          const categoryMap = new Map(withCategory.map((s) => [s.uuid, s]))
          set((state) => ({
            mods: state.mods.map((mod) => {
              const status = categoryMap.get(mod.uuid)
              if (!status?.nexusCategoryName) return mod
              return { ...mod, nexusCategoryId: status.nexusCategoryId, nexusCategoryName: status.nexusCategoryName }
            }),
          }))
        }
        if (announce) {
          if (modIds && modIds.length === 1) {
            const single = result.data.statuses.some((status) => status.state === 'update-available')
            notify(
              single ? translate('library.toast.updateAvailableSingle') : translate('library.toast.modUpToDate'),
              single ? 'info' : 'success'
            )
          } else {
            // Count across the whole (merged) cache — a bulk check only returns the
            // mods that changed, so counting just the response would undercount.
            const count = Object.values(map).filter((status) => status.state === 'update-available').length
            notify(
              count > 0
                ? translateN('library.toast.updatesAvailable', count)
                : translate('library.toast.allUpToDate'),
              count > 0 ? 'info' : 'success'
            )
          }
        }
      } else if (announce) {
        notify(result.error || translate('library.toast.checkUpdatesError'), 'error')
      }
    } finally {
      set({ checkingModUpdates: false })
    }
  },
  hydrateModUpdates: async () => {
    // Load the persisted update cache from the main process into the store on boot,
    // so cached indicators show with zero Nexus requests and the adaptive check
    // window has the real last-check timestamp.
    const cache = await IpcService.invoke<ModUpdateCache>(IPC.MOD_UPDATE_CACHE_GET).catch(() => null)
    if (!cache) return
    set({
      modUpdates: cache.statuses && typeof cache.statuses === 'object' ? cache.statuses : {},
      modUpdatesCheckedAt: typeof cache.checkedAt === 'string' ? cache.checkedAt : null,
    })
  },
  clearModUpdate: (uuid) => {
    // Locally drop a mod's update flag without any Nexus request — used right after
    // updating a mod in place, since we just installed its latest file.
    const current = get().modUpdates
    if (!current[uuid]) return
    const next = { ...current }
    delete next[uuid]
    set({ modUpdates: next })
    persistModUpdates(next, get().modUpdatesCheckedAt)
  },
  updateMod: async (uuid) => {
    const status = get().modUpdates[uuid]
    const mod = get().mods.find((item) => item.uuid === uuid)
    if (!mod || mod.nexusModId == null || !status || status.state !== 'update-available') return
    const nexusModId = mod.nexusModId

    const ext = get() as LibrarySlice & {
      settings?: { nexusApiKey?: string } | null
      addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      startNxmDownload?: (
        payload: NxmLinkPayload,
        options?: {
          allowDuplicate?: boolean
          navigateToDownloads?: boolean
          intent?: {
            kind: 'mod-update'
            targetModId: string
            targetModName: string
            currentVersion?: string
            latestVersion?: string
          }
        }
      ) => Promise<void>
      queueNxmUpdateIntent?: (
        modId: number,
        fileId: number,
        intent: {
          kind: 'mod-update'
          targetModId: string
          targetModName: string
          currentVersion?: string
          latestVersion?: string
        }
      ) => void
    }
    const apiKey = ext.settings?.nexusApiKey

    let isPremium = false
    if (apiKey) {
      const validate = await IpcService.invoke<IpcResult<NexusValidateResult>>(IPC.NEXUS_VALIDATE_KEY, apiKey)
      isPremium = !!(validate.ok && validate.data?.isPremium)
    }

    const updateIntent = {
      kind: 'mod-update' as const,
      targetModId: mod.uuid,
      targetModName: mod.name,
      currentVersion: status.currentVersion ?? mod.version,
      latestVersion: status.latestVersion,
    }

    if (isPremium && status.latestFileId && ext.startNxmDownload) {
      // Premium can resolve a download link straight from mod+file ids, so reuse the
      // normal Nexus pipeline (duplicate handling, Downloads UI, version-aware install).
      await ext.startNxmDownload({
        modId: nexusModId,
        fileId: status.latestFileId,
        key: '',
        expires: 0,
        userId: 0,
        raw: '',
      }, {
        navigateToDownloads: false,
        intent: updateIntent,
      })
    } else {
      // Free accounts can't mint a download link from the API; bounce to the Nexus
      // files page so the user triggers the nxm:// flow the app already handles.
      if (status.latestFileId) {
        ext.queueNxmUpdateIntent?.(nexusModId, status.latestFileId, updateIntent)
      }
      const url = `${status.modPageUrl ?? `https://www.nexusmods.com/cyberpunk2077/mods/${nexusModId}`}?tab=files`
      await IpcService.invoke(IPC.OPEN_EXTERNAL, url)
      ext.addToast?.(translate('library.toast.openedOnNexus'), 'info', 3600)
    }
  },
  setFilter: (filter) => set({ filter }),
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setLibraryStatusFilter: (libraryStatusFilter) => set({ libraryStatusFilter }),
  requestLibraryDeleteAll: () => set({ libraryDeleteAllRequestedAt: Date.now() }),
  clearLibraryDeleteAllRequest: () => set({ libraryDeleteAllRequestedAt: null }),
  selectMod: (selectedModId) => set({ selectedModId }),

  filteredMods: () => {
    const { mods, filter, typeFilter } = get()
    return filterLibraryMods(mods, filter, typeFilter)
  },

  enabledCount: () => enabledLibraryModCount(get().mods),
  totalCount: () => totalLibraryModCount(get().mods)
})
