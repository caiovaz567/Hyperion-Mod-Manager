import { useCallback, useMemo } from 'react'
import type { ModMetadata } from '@shared/types'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import type { LibrarySortKey, SortDirection } from './LibraryTableHeader'

interface UseLibraryEntriesOptions {
  mods: ModMetadata[]
  filter: string
  typeFilter: string
  libraryStatusFilter: LibraryStatusFilter
  collapsedSeparatorIds: string[]
  sortKey: LibrarySortKey | null
  sortDirection: SortDirection
}

export function useLibraryEntries({
  mods,
  filter,
  typeFilter,
  libraryStatusFilter,
  collapsedSeparatorIds,
  sortKey,
  sortDirection,
}: UseLibraryEntriesOptions) {
  const orderedEntries = useMemo(
    () => [...mods].sort((left, right) => left.order - right.order),
    [mods]
  )

  const allMods = useMemo(
    () => orderedEntries.filter((entry) => entry.kind === 'mod'),
    [orderedEntries]
  )

  const allSeparators = useMemo(
    () => orderedEntries.filter((entry) => entry.kind === 'separator'),
    [orderedEntries]
  )

  const allSeparatorIds = useMemo(
    () => allSeparators.map((separator) => separator.uuid),
    [allSeparators]
  )

  const enabledCount = useMemo(
    () => allMods.filter((mod) => mod.enabled).length,
    [allMods]
  )

  const totalCount = allMods.length

  const filteredBySearchAndType = useMemo(() => {
    let list = allMods

    if (filter) {
      const lower = filter.toLowerCase()
      list = list.filter((mod) =>
        mod.name.toLowerCase().includes(lower) ||
        mod.author?.toLowerCase().includes(lower)
      )
    }

    if (typeFilter) {
      list = list.filter((mod) => mod.type === typeFilter)
    }

    return list
  }, [allMods, filter, typeFilter])

  const filteredModsByStatus = useMemo(() => {
    if (libraryStatusFilter === 'enabled') return filteredBySearchAndType.filter((mod) => mod.enabled)
    if (libraryStatusFilter === 'disabled') return filteredBySearchAndType.filter((mod) => !mod.enabled)
    return filteredBySearchAndType
  }, [filteredBySearchAndType, libraryStatusFilter])

  const visibleFilteredIds = useMemo(
    () => new Set(filteredModsByStatus.map((mod) => mod.uuid)),
    [filteredModsByStatus]
  )

  const collapsedSeparatorSet = useMemo(
    () => new Set(collapsedSeparatorIds),
    [collapsedSeparatorIds]
  )

  const hasActiveLibraryFilter = Boolean(filter || typeFilter || libraryStatusFilter !== 'all')

  const enabledVisibleCount = useMemo(
    () => filteredModsByStatus.filter((mod) => mod.enabled).length,
    [filteredModsByStatus]
  )

  const disabledVisibleCount = useMemo(
    () => filteredModsByStatus.filter((mod) => !mod.enabled).length,
    [filteredModsByStatus]
  )

  const separatorSummary = useMemo(() => {
    const total = new Map<string, number>()
    const visible = new Map<string, number>()
    let currentSeparatorId: string | null = null

    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        currentSeparatorId = entry.uuid
        total.set(entry.uuid, 0)
        visible.set(entry.uuid, 0)
        continue
      }

      if (!currentSeparatorId) continue

      total.set(currentSeparatorId, (total.get(currentSeparatorId) ?? 0) + 1)
      if (visibleFilteredIds.has(entry.uuid)) {
        visible.set(currentSeparatorId, (visible.get(currentSeparatorId) ?? 0) + 1)
      }
    }

    return { total, visible }
  }, [orderedEntries, visibleFilteredIds])

  const customOrderEntries = useMemo(() => {
    const rows: ModMetadata[] = []
    let pendingSeparator: ModMetadata | null = null
    let pendingChildren: ModMetadata[] = []

    const flushPendingGroup = () => {
      if (!pendingSeparator) {
        rows.push(...pendingChildren)
        pendingChildren = []
        return
      }

      const visibleChildCount = separatorSummary.visible.get(pendingSeparator.uuid) ?? 0
      if (!hasActiveLibraryFilter || visibleChildCount > 0) {
        rows.push(pendingSeparator)
        if (!collapsedSeparatorSet.has(pendingSeparator.uuid)) {
          rows.push(...pendingChildren)
        }
      }

      pendingSeparator = null
      pendingChildren = []
    }

    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        flushPendingGroup()
        pendingSeparator = entry
        continue
      }

      if (!visibleFilteredIds.has(entry.uuid)) continue
      pendingChildren.push(entry)
    }

    flushPendingGroup()
    return rows
  }, [collapsedSeparatorSet, hasActiveLibraryFilter, orderedEntries, separatorSummary.visible, visibleFilteredIds])

  const displayedMods = useMemo(() => {
    if (sortKey === null) return customOrderEntries

    const sorted = [...filteredModsByStatus].sort((left, right) => {
      if (sortKey === 'name') {
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      }

      if (sortKey === 'type') {
        return left.type.localeCompare(right.type, undefined, { sensitivity: 'base' })
      }

      const leftTime = left.installedAt ? new Date(left.installedAt).getTime() : 0
      const rightTime = right.installedAt ? new Date(right.installedAt).getTime() : 0
      return leftTime - rightTime
    })

    return sortDirection === 'asc' ? sorted : sorted.reverse()
  }, [customOrderEntries, filteredModsByStatus, sortDirection, sortKey])

  const nestedModIds = useMemo(() => {
    if (sortKey !== null) return new Set<string>()

    const nestedIds = new Set<string>()
    let insideSeparator = false

    for (const entry of displayedMods) {
      if (entry.kind === 'separator') {
        insideSeparator = true
        continue
      }

      if (insideSeparator) {
        nestedIds.add(entry.uuid)
      }
    }

    return nestedIds
  }, [displayedMods, sortKey])

  const separatorParentByModId = useMemo(() => {
    const parentMap = new Map<string, string>()
    let currentSeparatorId: string | null = null

    for (const entry of orderedEntries) {
      if (entry.kind === 'separator') {
        currentSeparatorId = entry.uuid
        continue
      }

      if (currentSeparatorId) {
        parentMap.set(entry.uuid, currentSeparatorId)
      }
    }

    return parentMap
  }, [orderedEntries])

  const orderedEntryIds = useMemo(
    () => new Set(orderedEntries.map((entry) => entry.uuid)),
    [orderedEntries]
  )

  const getSeparatorBlockIds = useCallback((separatorId: string) => {
    const separatorIndex = orderedEntries.findIndex((entry) => entry.uuid === separatorId)
    if (separatorIndex < 0) return []

    const blockIds = [separatorId]
    for (let index = separatorIndex + 1; index < orderedEntries.length; index += 1) {
      const entry = orderedEntries[index]
      if (entry.kind === 'separator') break
      blockIds.push(entry.uuid)
    }

    return blockIds
  }, [orderedEntries])

  const expandSelectionWithSeparatorBlocks = useCallback((ids: string[]) => {
    const expandedSet = new Set<string>()

    for (const id of ids) {
      const entry = orderedEntries.find((candidate) => candidate.uuid === id)
      if (!entry) continue

      if (entry.kind === 'separator') {
        for (const blockId of getSeparatorBlockIds(entry.uuid)) {
          expandedSet.add(blockId)
        }
        continue
      }

      expandedSet.add(entry.uuid)
    }

    return orderedEntries
      .filter((entry) => expandedSet.has(entry.uuid))
      .map((entry) => entry.uuid)
  }, [getSeparatorBlockIds, orderedEntries])

  const loadOrderMap = useMemo(() => {
    const map = new Map<string, number>()
    allMods.forEach((mod, index) => map.set(mod.uuid, index + 1))
    return map
  }, [allMods])

  const visibleModIds = useMemo(
    () => filteredModsByStatus.map((mod) => mod.uuid),
    [filteredModsByStatus]
  )

  const visibleEnabledCount = enabledVisibleCount
  const allVisibleEnabled = visibleModIds.length > 0 && visibleEnabledCount === visibleModIds.length

  return {
    orderedEntries,
    allMods,
    allSeparators,
    allSeparatorIds,
    enabledCount,
    totalCount,
    enabledVisibleCount,
    disabledVisibleCount,
    collapsedSeparatorSet,
    separatorSummary,
    displayedMods,
    nestedModIds,
    separatorParentByModId,
    orderedEntryIds,
    getSeparatorBlockIds,
    expandSelectionWithSeparatorBlocks,
    loadOrderMap,
    visibleModIds,
    visibleEnabledCount,
    allVisibleEnabled,
  }
}
