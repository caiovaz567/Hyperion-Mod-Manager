import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { ModMetadata, IpcResult, PurgeModsResult, ConflictInfo } from '../../../shared/types'
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

  // Actions
  scanMods: () => Promise<ModMetadata[]>
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
