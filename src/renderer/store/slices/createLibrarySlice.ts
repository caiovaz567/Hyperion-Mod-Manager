import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { ModMetadata, IpcResult, PurgeModsResult } from '../../../shared/types'
import { IpcService } from '../../services/IpcService'

export type LibraryStatusFilter = 'all' | 'enabled' | 'disabled'

export interface LibrarySlice {
  mods: ModMetadata[]
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
  purgeMods: () => Promise<IpcResult<PurgeModsResult>>
  deleteMod: (id: string) => Promise<IpcResult>
  createSeparator: (name?: string) => Promise<ModMetadata | null>
  reorderMods: (orderedIds: string[]) => Promise<void>
  updateModMetadata: (id: string, updates: Partial<ModMetadata>) => Promise<void>
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
  filter: '',
  typeFilter: '',
  selectedModId: null,
  libraryStatusFilter: 'all',
  libraryDeleteAllRequestedAt: null,

  scanMods: async () => {
    const result = await IpcService.invoke<IpcResult<ModMetadata[]>>(IPC.SCAN_MODS)
    if (result.ok && result.data) {
      set({ mods: result.data })
      return result.data
    }
    return []
  },

  restoreEnabledMods: async (modsToRestore) => {
    const sourceMods = modsToRestore ?? get().mods
    const enabledMods = sourceMods.filter((mod) => mod.kind === 'mod' && mod.enabled)
    const results: IpcResult[] = []

    for (const mod of enabledMods) {
      const result = await IpcService.invoke<IpcResult>(IPC.ENABLE_MOD, mod.uuid)
      results.push(result)
    }

    if (enabledMods.length > 0) {
      set((state) => ({
        mods: state.mods.map((mod) =>
          enabledMods.some((enabledMod) => enabledMod.uuid === mod.uuid)
            ? { ...mod, enabled: true }
            : mod
        )
      }))
    }

    return results
  },

  enableMod: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.ENABLE_MOD, id)
    if (result.ok) {
      set((state) => ({
        mods: state.mods.map((m) =>
          m.uuid === id ? { ...m, enabled: true } : m
        )
      }))
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
    await IpcService.invoke(IPC.REORDER_MODS, orderedIds)
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
