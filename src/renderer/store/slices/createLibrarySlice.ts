import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { ModMetadata, IpcResult, PurgeModsResult, ConflictInfo, ModConflictSummary } from '../../../shared/types'
import { IpcService } from '../../services/IpcService'
import { recomputeConflictStateFromExistingConflicts } from '../../utils/modConflictState'

export type LibraryStatusFilter = 'all' | 'enabled' | 'disabled'

export interface LibrarySlice {
  mods: ModMetadata[]
  conflicts: ConflictInfo[]
  filter: string
  typeFilter: string
  selectedModId: string | null
  libraryStatusFilter: LibraryStatusFilter
  libraryDeleteAllRequestedAt: number | null

  // Actions
  scanMods: () => Promise<ModMetadata[]>
  restoreEnabledMods: (modsToRestore?: ModMetadata[]) => Promise<IpcResult[]>
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

type ConflictCalculationResult = {
  summaries: ModConflictSummary[]
  conflicts: ConflictInfo[]
}

let conflictRefreshTimer: ReturnType<typeof setTimeout> | null = null
let scheduledConflictRefresh: Promise<void> | null = null
let resolveScheduledConflictRefresh: (() => void) | null = null
let activeConflictRefresh: Promise<void> | null = null

const applyConflictState = (
  set: Parameters<StateCreator<LibrarySlice, [], [], LibrarySlice>>[0],
  summaries: ModConflictSummary[],
  conflicts: ConflictInfo[]
) => {
  const summaryMap = new Map(summaries.map((summary) => [summary.modId, summary]))

  set((state) => ({
    mods: state.mods.map((mod) => ({
      ...mod,
      conflictSummary: summaryMap.get(mod.uuid)
        ? {
            overwrites: summaryMap.get(mod.uuid)!.overwrites,
            overwrittenBy: summaryMap.get(mod.uuid)!.overwrittenBy,
          }
        : { overwrites: 0, overwrittenBy: 0 },
    })),
    conflicts,
  }))
}

const clearConflictState = (
  set: Parameters<StateCreator<LibrarySlice, [], [], LibrarySlice>>[0]
) => {
  set((state) => ({
    mods: state.mods.map((mod) => ({
      ...mod,
      conflictSummary: { overwrites: 0, overwrittenBy: 0 },
    })),
    conflicts: [],
  }))
}

const runConflictRefresh = async (
  set: Parameters<StateCreator<LibrarySlice, [], [], LibrarySlice>>[0]
): Promise<void> => {
  try {
    const conflictResult = await IpcService.invoke<IpcResult<ConflictCalculationResult>>(IPC.CALCULATE_MOD_CONFLICTS)
    if (conflictResult.ok && conflictResult.data) {
      applyConflictState(set, conflictResult.data.summaries ?? [], conflictResult.data.conflicts ?? [])
      return
    }
  } catch {
    // Fall through to clear stale state.
  }

  clearConflictState(set)
}

const scheduleConflictRefresh = (
  set: Parameters<StateCreator<LibrarySlice, [], [], LibrarySlice>>[0],
  immediate = false
): Promise<void> => {
  const delay = immediate ? 0 : 80

  if (conflictRefreshTimer !== null) {
    clearTimeout(conflictRefreshTimer)
    conflictRefreshTimer = null
  }

  if (!scheduledConflictRefresh) {
    scheduledConflictRefresh = new Promise<void>((resolve) => {
      resolveScheduledConflictRefresh = resolve
    })
  }

  conflictRefreshTimer = setTimeout(() => {
    conflictRefreshTimer = null
    const finalize = resolveScheduledConflictRefresh
    resolveScheduledConflictRefresh = null
    const currentScheduled = scheduledConflictRefresh
    scheduledConflictRefresh = null

    const execute = async () => {
      if (activeConflictRefresh) {
        await activeConflictRefresh
      }

      activeConflictRefresh = runConflictRefresh(set)
      try {
        await activeConflictRefresh
      } finally {
        activeConflictRefresh = null
        finalize?.()
      }
    }

    void execute()
    void currentScheduled
  }, delay)

  return scheduledConflictRefresh
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

  scanMods: async () => {
    const result = await IpcService.invoke<IpcResult<ModMetadata[]>>(IPC.SCAN_MODS)
    if (result.ok && result.data) {
      set({ mods: result.data })
      await scheduleConflictRefresh(set, true)

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
        mods: state.mods.map((m) =>
          m.uuid === id ? { ...m, enabled: true } : m
        )
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  enableMods: async (ids) => {
    const result = await IpcService.invoke<IpcResult<{ processed: string[]; failed: string[] }>>(IPC.ENABLE_MODS, ids)
    if (result.ok || result.data) {
      const processed = result.data?.processed ?? ids.filter(Boolean)
      const processedSet = new Set(processed)
      set((state) => ({
        mods: state.mods.map((m) => (processedSet.has(m.uuid) ? { ...m, enabled: true } : m))
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  disableMod: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.DISABLE_MOD, id)
    if (result.ok) {
      set((state) => ({
        mods: state.mods.map((m) =>
          m.uuid === id ? { ...m, enabled: false } : m
        )
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  disableMods: async (ids) => {
    const result = await IpcService.invoke<IpcResult<{ processed: string[]; failed: string[] }>>(IPC.DISABLE_MODS, ids)
    if (result.ok || result.data) {
      const processed = result.data?.processed ?? ids.filter(Boolean)
      const processedSet = new Set(processed)
      set((state) => ({
        mods: state.mods.map((m) => (processedSet.has(m.uuid) ? { ...m, enabled: false } : m))
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  purgeMods: async () => {
    const result = await IpcService.invoke<IpcResult<PurgeModsResult>>(IPC.PURGE_MODS)
    if (result.data && result.data.purged > 0) {
      set((state) => ({
        mods: state.mods.map((mod) =>
          mod.kind === 'mod' && mod.enabled
            ? { ...mod, enabled: false, deployedPaths: [] }
            : mod
        )
      }))
      void scheduleConflictRefresh(set)
    }
    return result
  },

  deleteMod: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.DELETE_MOD, id)
    if (result.ok) {
      set((state) => ({
        mods: state.mods.filter((m) => m.uuid !== id),
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
        mods: [...state.mods, result.data!].sort((left, right) => left.order - right.order)
      }))
      return result.data
    }
    return null
  },

  reorderMods: async (orderedIds) => {
    set((state) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]))
      const reordered = state.mods
        .map((mod) => ({
          ...mod,
          order: orderMap.get(mod.uuid) ?? mod.order,
        }))
        .sort((a, b) => a.order - b.order)
      return { mods: reordered }
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

      if (
        'enabled' in updates ||
        'order' in updates ||
        'files' in updates ||
        'emptyDirs' in updates ||
        'hashes' in updates ||
        'deployedPaths' in updates ||
        'kind' in updates
      ) {
        void scheduleConflictRefresh(set)
      }
    }
  },
  refreshConflicts: async (options) => {
    await scheduleConflictRefresh(set, options?.immediate ?? false)
  },
  setFilter: (filter) => set({ filter }),
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setLibraryStatusFilter: (libraryStatusFilter) => set({ libraryStatusFilter }),
  requestLibraryDeleteAll: () => set({ libraryDeleteAllRequestedAt: Date.now() }),
  clearLibraryDeleteAllRequest: () => set({ libraryDeleteAllRequestedAt: null }),
  selectMod: (selectedModId) => set({ selectedModId }),

  filteredMods: () => {
    const { mods, filter, typeFilter } = get()
    let list = mods
    if (filter) {
      const lower = filter.toLowerCase()
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(lower) ||
          m.author?.toLowerCase().includes(lower)
      )
    }
    if (typeFilter) {
      list = list.filter((m) => m.type === typeFilter)
    }
    return list
  },

  enabledCount: () => get().mods.filter((m) => m.enabled && m.kind === 'mod').length,
  totalCount: () => get().mods.filter((m) => m.kind === 'mod').length
})
