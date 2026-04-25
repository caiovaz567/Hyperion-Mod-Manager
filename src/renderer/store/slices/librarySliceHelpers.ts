import type { ModMetadata } from '../../../shared/types'

export const sortModsByOrder = (mods: ModMetadata[]): ModMetadata[] =>
  [...mods].sort((left, right) => left.order - right.order)

export const setModEnabled = (
  mods: ModMetadata[],
  id: string,
  enabled: boolean
): ModMetadata[] =>
  mods.map((mod) => (mod.uuid === id ? { ...mod, enabled } : mod))

export const setModsEnabled = (
  mods: ModMetadata[],
  ids: string[],
  enabled: boolean
): ModMetadata[] => {
  const idSet = new Set(ids)
  return mods.map((mod) => (idSet.has(mod.uuid) ? { ...mod, enabled } : mod))
}

export const markPurgedModsDisabled = (mods: ModMetadata[]): ModMetadata[] =>
  mods.map((mod) =>
    mod.kind === 'mod' && mod.enabled
      ? { ...mod, enabled: false, deployedPaths: [] }
      : mod
  )

export const removeLibraryEntry = (mods: ModMetadata[], id: string): ModMetadata[] =>
  mods.filter((mod) => mod.uuid !== id)

export const appendAndSortLibraryEntry = (
  mods: ModMetadata[],
  entry: ModMetadata
): ModMetadata[] => sortModsByOrder([...mods, entry])

export const reorderLibraryEntries = (
  mods: ModMetadata[],
  orderedIds: string[]
): ModMetadata[] => {
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  return sortModsByOrder(
    mods.map((mod) => ({
      ...mod,
      order: orderMap.get(mod.uuid) ?? mod.order,
    }))
  )
}

export const hasConflictSensitiveMetadataUpdate = (updates: Partial<ModMetadata>): boolean =>
  'enabled' in updates ||
  'order' in updates ||
  'files' in updates ||
  'emptyDirs' in updates ||
  'hashes' in updates ||
  'deployedPaths' in updates ||
  'kind' in updates

export const filterLibraryMods = (
  mods: ModMetadata[],
  filter: string,
  typeFilter: string
): ModMetadata[] => {
  let list = mods

  if (filter) {
    const lower = filter.toLowerCase()
    list = list.filter(
      (mod) =>
        mod.name.toLowerCase().includes(lower) ||
        mod.author?.toLowerCase().includes(lower)
    )
  }

  if (typeFilter) {
    list = list.filter((mod) => mod.type === typeFilter)
  }

  return list
}

export const enabledLibraryModCount = (mods: ModMetadata[]): number =>
  mods.filter((mod) => mod.enabled && mod.kind === 'mod').length

export const totalLibraryModCount = (mods: ModMetadata[]): number =>
  mods.filter((mod) => mod.kind === 'mod').length
