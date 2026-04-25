import { useCallback, useMemo, useRef, useState } from 'react'
import type { DragEvent, MutableRefObject } from 'react'
import type { ModMetadata } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import type { LibrarySortKey } from './LibraryTableHeader'

const INTERNAL_MOD_DRAG_TYPE = 'application/x-hyperion-mod-ids'

type ToastSeverity = 'info' | 'success' | 'warning' | 'error'
type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void
type RowDropPosition = 'before' | 'after'

interface UseLibraryDragDropOptions {
  orderedEntries: ModMetadata[]
  sortKey: LibrarySortKey | null
  selectedIdsRef: MutableRefObject<string[]>
  expandSelectionWithSeparatorBlocks: (ids: string[]) => string[]
  getSeparatorBlockIds: (separatorId: string) => string[]
  setSelection: (nextIds: string[], anchorId?: string | null) => void
  selectMod: (modId: string | null) => void
  addToast: AddToast
  moveModsToSeparator: (modIds: string[], separatorId: string) => Promise<void>
  moveModsToTopLevel: (modIds: string[]) => Promise<void>
  installDroppedFile: (filePath: string) => Promise<void>
}

export function useLibraryDragDrop({
  orderedEntries,
  sortKey,
  selectedIdsRef,
  expandSelectionWithSeparatorBlocks,
  getSeparatorBlockIds,
  setSelection,
  selectMod,
  addToast,
  moveModsToSeparator,
  moveModsToTopLevel,
  installDroppedFile,
}: UseLibraryDragDropOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const [draggedModIds, setDraggedModIds] = useState<string[]>([])
  const [rowDropTarget, setRowDropTarget] = useState<{ targetId: string; position: RowDropPosition } | null>(null)
  const [dropSeparatorId, setDropSeparatorId] = useState<string | null>(null)
  const [topLevelDropActive, setTopLevelDropActive] = useState(false)
  const draggedModIdsRef = useRef<string[]>([])

  const draggedModCount = useMemo(
    () => orderedEntries.filter((entry) => entry.kind === 'mod' && draggedModIds.includes(entry.uuid)).length,
    [draggedModIds, orderedEntries]
  )

  const clearInternalDragState = useCallback(() => {
    draggedModIdsRef.current = []
    setDraggedModIds([])
    setRowDropTarget(null)
    setDropSeparatorId(null)
    setTopLevelDropActive(false)
  }, [])

  const getDraggedIdsFromEvent = useCallback((event: DragEvent): string[] => {
    const rawIds = event.dataTransfer.getData(INTERNAL_MOD_DRAG_TYPE)
    if (rawIds) {
      try {
        const parsed = JSON.parse(rawIds) as string[]
        if (Array.isArray(parsed)) return parsed
      } catch {
        // Fall back to the local drag state when browser data transfer is unavailable.
      }
    }

    return draggedModIdsRef.current
  }, [])

  const reorderModsAroundTarget = useCallback(async (
    modIds: string[],
    targetId: string,
    position: RowDropPosition
  ) => {
    if (sortKey !== null) {
      addToast('Return to Custom Order to reorder mods manually', 'warning')
      return
    }

    const movingIds = modIds.filter((id, index, list) =>
      list.indexOf(id) === index && orderedEntries.some((entry) => entry.uuid === id)
    )
    if (movingIds.length === 0 || movingIds.includes(targetId)) return

    const movingSet = new Set(movingIds)
    const movingEntries = orderedEntries.filter((entry) => movingSet.has(entry.uuid))
    const remainingEntries = orderedEntries.filter((entry) => !movingSet.has(entry.uuid))
    const targetIndex = remainingEntries.findIndex((entry) => entry.uuid === targetId)
    if (targetIndex < 0) return

    const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
    const reordered = [
      ...remainingEntries.slice(0, insertIndex),
      ...movingEntries,
      ...remainingEntries.slice(insertIndex),
    ]

    await useAppStore.getState().reorderMods(reordered.map((entry) => entry.uuid))
  }, [addToast, orderedEntries, sortKey])

  const handleRowDragStart = useCallback((event: DragEvent, mod: ModMetadata) => {
    if (sortKey !== null) {
      event.preventDefault()
      return
    }

    const nextIds = selectedIdsRef.current.includes(mod.uuid)
      ? expandSelectionWithSeparatorBlocks(selectedIdsRef.current)
      : mod.kind === 'separator'
        ? getSeparatorBlockIds(mod.uuid)
        : [mod.uuid]

    setSelection(nextIds)
    selectMod(mod.uuid)
    draggedModIdsRef.current = nextIds
    setDraggedModIds(nextIds)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(INTERNAL_MOD_DRAG_TYPE, JSON.stringify(nextIds))
    event.dataTransfer.setData('text/plain', nextIds.join(','))
  }, [expandSelectionWithSeparatorBlocks, getSeparatorBlockIds, selectMod, selectedIdsRef, setSelection, sortKey])

  const handleRowDragEnd = useCallback(() => {
    clearInternalDragState()
  }, [clearInternalDragState])

  const handleModRowDragOver = useCallback((event: DragEvent, targetMod: ModMetadata) => {
    if (targetMod.kind !== 'mod' || sortKey !== null) return

    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0 || movingIds.includes(targetMod.uuid)) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    const position: RowDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    if (!rowDropTarget || rowDropTarget.targetId !== targetMod.uuid || rowDropTarget.position !== position) {
      setRowDropTarget({ targetId: targetMod.uuid, position })
    }
    if (dropSeparatorId !== null) setDropSeparatorId(null)
    if (topLevelDropActive) setTopLevelDropActive(false)
  }, [dropSeparatorId, getDraggedIdsFromEvent, rowDropTarget, sortKey, topLevelDropActive])

  const handleModRowDragLeave = useCallback((event: DragEvent, targetMod: ModMetadata) => {
    if (!rowDropTarget || rowDropTarget.targetId !== targetMod.uuid) return
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setRowDropTarget(null)
    }
  }, [rowDropTarget])

  const handleModRowDrop = useCallback(async (event: DragEvent, targetMod: ModMetadata) => {
    if (targetMod.kind !== 'mod') return

    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    const position: RowDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    await reorderModsAroundTarget(movingIds, targetMod.uuid, position)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, reorderModsAroundTarget])

  const handleSeparatorDragOver = useCallback((event: DragEvent, separator: ModMetadata) => {
    if (separator.kind !== 'separator' || sortKey !== null) return
    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0) return

    const draggingSeparatorBlock = movingIds.some((id) => {
      const entry = orderedEntries.find((candidate) => candidate.uuid === id)
      return entry?.kind === 'separator'
    })

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    if (draggingSeparatorBlock) {
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
      const position: RowDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

      if (!rowDropTarget || rowDropTarget.targetId !== separator.uuid || rowDropTarget.position !== position) {
        setRowDropTarget({ targetId: separator.uuid, position })
      }
      if (dropSeparatorId !== null) setDropSeparatorId(null)
      if (topLevelDropActive) setTopLevelDropActive(false)
      return
    }

    if (dropSeparatorId !== separator.uuid) {
      setDropSeparatorId(separator.uuid)
    }
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (topLevelDropActive) setTopLevelDropActive(false)
  }, [dropSeparatorId, getDraggedIdsFromEvent, orderedEntries, rowDropTarget, sortKey, topLevelDropActive])

  const handleSeparatorDragLeave = useCallback((event: DragEvent, separator: ModMetadata) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      if (dropSeparatorId === separator.uuid) {
        setDropSeparatorId(null)
      }
      if (rowDropTarget?.targetId === separator.uuid) {
        setRowDropTarget(null)
      }
    }
  }, [dropSeparatorId, rowDropTarget])

  const handleSeparatorDrop = useCallback(async (event: DragEvent, separator: ModMetadata) => {
    event.preventDefault()
    event.stopPropagation()

    const parsedIds = getDraggedIdsFromEvent(event)
    const draggingSeparatorBlock = parsedIds.some((id) => {
      const entry = orderedEntries.find((candidate) => candidate.uuid === id)
      return entry?.kind === 'separator'
    })

    if (draggingSeparatorBlock) {
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
      const position: RowDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      await reorderModsAroundTarget(parsedIds, separator.uuid, position)
    } else {
      await moveModsToSeparator(parsedIds, separator.uuid)
    }
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToSeparator, orderedEntries, reorderModsAroundTarget])

  const handleTopLevelDragOver = useCallback((event: DragEvent) => {
    if (sortKey !== null) return

    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (!topLevelDropActive) setTopLevelDropActive(true)
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (dropSeparatorId !== null) setDropSeparatorId(null)
  }, [dropSeparatorId, getDraggedIdsFromEvent, rowDropTarget, sortKey, topLevelDropActive])

  const handleTopLevelDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTopLevelDropActive(false)
    }
  }, [])

  const handleTopLevelDrop = useCallback(async (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    await moveModsToTopLevel(movingIds)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToTopLevel])

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }, [isDragging])

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) {
      setDropSeparatorId(null)
      setDraggedModIds([])
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const files = Array.from(event.dataTransfer.files)
    const zipFile = files.find((file) => file.name.toLowerCase().endsWith('.zip'))
    if (!zipFile) {
      addToast('Drop a .zip mod archive to install', 'warning')
      return
    }

    const filePath = (zipFile as unknown as { path: string }).path
    await installDroppedFile(filePath)
  }, [addToast, installDroppedFile])

  const handleListRowsDragOver = useCallback((event: DragEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-mod-row="true"]')) return
    if (sortKey !== null) return

    const movingIds = getDraggedIdsFromEvent(event)
    if (movingIds.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (!topLevelDropActive) setTopLevelDropActive(true)
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (dropSeparatorId !== null) setDropSeparatorId(null)
  }, [dropSeparatorId, getDraggedIdsFromEvent, rowDropTarget, sortKey, topLevelDropActive])

  const handleListRowsDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTopLevelDropActive(false)
    }
  }, [])

  const handleListRowsDrop = useCallback(async (event: DragEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-mod-row="true"]')) return
    if (sortKey !== null) return

    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    await moveModsToTopLevel(movingIds)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToTopLevel, sortKey])

  return {
    isDragging,
    draggedModIds,
    draggedModCount,
    rowDropTarget,
    dropSeparatorId,
    topLevelDropActive,
    handleRowDragStart,
    handleRowDragEnd,
    handleModRowDragOver,
    handleModRowDragLeave,
    handleModRowDrop,
    handleSeparatorDragOver,
    handleSeparatorDragLeave,
    handleSeparatorDrop,
    handleTopLevelDragOver,
    handleTopLevelDragLeave,
    handleTopLevelDrop,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleListRowsDragOver,
    handleListRowsDragLeave,
    handleListRowsDrop,
  }
}
