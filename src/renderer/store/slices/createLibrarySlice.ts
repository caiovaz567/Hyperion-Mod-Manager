import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { ModMetadata, IpcResult, PurgeModsResult, ConflictInfo, ModUpdateStatus, ModUpdateCheckResult, ModUpdateCheckInput, NxmLinkPayload, NexusValidateResult } from '../../../shared/types'
import { IpcService } from '../../services/IpcService'
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
  scanMods: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean }) => Promise<ModMetadata[]>
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
  checkModUpdates: (options?: { force?: boolean; notify?: boolean; full?: boolean }) => Promise<void>
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
    const result = await IpcService.invoke<IpcResult<ModMetadata[]>>(IPC.SCAN_MODS)
    if (result.ok && result.data) {
      const currentModIds = new Set(result.data.map((mod) => mod.uuid))
      set((state) => ({
        mods: result.data,
        modUpdates: Object.fromEntries(
          Object.entries(state.modUpdates).filter(([uuid]) => currentModIds.has(uuid))
        ),
      }))
      // Refresh Nexus update status whenever the library changes (install/reinstall/delete).
      // Background scans stay lightweight; the toolbar button performs a full check.
      if (options?.refreshModUpdates !== false) {
        void get().checkModUpdates({ force: true })
      }
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
  checkModUpdates: async (options) => {
    if (get().checkingModUpdates) return
    const force = options?.force === true
    const full = options?.full === true
    const announce = options?.notify === true
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
      set({ modUpdates: {}, modUpdatesCheckedAt: new Date().toISOString() })
      if (announce) notify('No Nexus-sourced mods to check.', 'info')
      return
    }
    set({ checkingModUpdates: true })
    try {
      const result = await IpcService.invoke<IpcResult<ModUpdateCheckResult>>(
        IPC.NEXUS_CHECK_MOD_UPDATES,
        { mods: inputs, force, full }
      )
      if (result.ok && result.data) {
        const previousUpdates = get().modUpdates
        const map: Record<string, ModUpdateStatus> = {}
        for (const status of result.data.statuses) {
          const previous = previousUpdates[status.uuid]
          map[status.uuid] = !full && previous?.state === 'update-available' && status.state === 'up-to-date'
            ? previous
            : status
        }
        set({ modUpdates: map, modUpdatesCheckedAt: result.data.checkedAt })

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
          if (result.data.skippedReason === 'no-api-key') {
            notify('Add a Nexus API key in Settings to check for updates.', 'warning')
          } else {
            const count = result.data.statuses.filter((status) => status.state === 'update-available').length
            notify(
              count > 0
                ? `${count} mod update${count === 1 ? '' : 's'} available.`
                : 'All Nexus mods are up to date.',
              count > 0 ? 'info' : 'success'
            )
          }
        }
      } else if (announce) {
        notify(result.error || 'Could not check for mod updates.', 'error')
      }
    } finally {
      set({ checkingModUpdates: false })
    }
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
      ext.addToast?.('Opened on Nexus — use "Mod Manager Download" to update this mod.', 'info', 3600)
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
