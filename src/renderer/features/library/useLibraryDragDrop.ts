import { useCallback, useMemo, useRef, useState } from 'react'
import type { DragEvent, MutableRefObject } from 'react'
import type { ModMetadata } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { translate } from '../../i18n/translate'
import type { LibrarySortKey } from './LibraryTableHeader'

const INTERNAL_MOD_DRAG_TYPE = 'application/x-hyperion-mod-ids'
const SUPPORTED_ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])

type ToastSeverity = 'info' | 'success' | 'warning' | 'error'
type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void
type RowDropPosition = 'before' | 'after'

interface UseLibraryDragDropOptions {
  orderedEntries: ModMetadata[]
  sortKey: LibrarySortKey | null
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  selectedIdsRef: MutableRefObject<string[]>
  expandSelectionWithSeparatorBlocks: (ids: string[]) => string[]
  getSeparatorBlockIds: (separatorId: string) => string[]
  setSelection: (nextIds: string[], anchorId?: string | null) => void
  selectMod: (modId: string | null) => void
  addToast: AddToast
  moveModsToSeparator: (modIds: string[], separatorId: string, options?: { reveal?: boolean }) => Promise<void>
  moveModsToTopLevel: (modIds: string[]) => Promise<void>
  installDroppedFile: (filePath: string) => Promise<void>
}

function hasFileTransfer(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

function isSupportedArchive(file: File): boolean {
  return SUPPORTED_ARCHIVE_EXTENSIONS.has(getFileExtension(file.name))
}

export function useLibraryDragDrop({
  orderedEntries,
  sortKey,
  scrollContainerRef,
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

  const maybeAutoScroll = useCallback((event: DragEvent) => {
    const container = scrollContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const threshold = Math.min(120, Math.max(72, rect.height * 0.14))
    let delta = 0

    if (event.clientY < rect.top + threshold) {
      delta = -Math.ceil((1 - ((event.clientY - rect.top) / threshold)) * 28)
    } else if (event.clientY > rect.bottom - threshold) {
      delta = Math.ceil((1 - ((rect.bottom - event.clientY) / threshold)) * 28)
    }

    if (delta !== 0) {
      container.scrollTop += delta
    }
  }, [scrollContainerRef])

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
      addToast(translate('library.toast.returnToCustomOrderReorder'), 'warning')
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
    maybeAutoScroll(event)

    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    const position: RowDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    if (!rowDropTarget || rowDropTarget.targetId !== targetMod.uuid || rowDropTarget.position !== position) {
      setRowDropTarget({ targetId: targetMod.uuid, position })
    }
    if (dropSeparatorId !== null) setDropSeparatorId(null)
    if (topLevelDropActive) setTopLevelDropActive(false)
  }, [dropSeparatorId, getDraggedIdsFromEvent, maybeAutoScroll, rowDropTarget, sortKey, topLevelDropActive])

  const handleModRowDragLeave = useCallback((event: DragEvent, targetMod: ModMetadata) => {
    if (!rowDropTarget || rowDropTarget.targetId !== targetMod.uuid) return
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setRowDropTarget(null)
    }
  }, [rowDropTarget])

  const handleModRowDrop = useCallback(async (event: DragEvent, targetMod: ModMetadata) => {
    if (targetMod.kind !== 'mod') return
    if (hasFileTransfer(event)) return

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
    maybeAutoScroll(event)

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
  }, [dropSeparatorId, getDraggedIdsFromEvent, maybeAutoScroll, orderedEntries, rowDropTarget, sortKey, topLevelDropActive])

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
    if (hasFileTransfer(event)) return

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
    maybeAutoScroll(event)
    if (!topLevelDropActive) setTopLevelDropActive(true)
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (dropSeparatorId !== null) setDropSeparatorId(null)
  }, [dropSeparatorId, getDraggedIdsFromEvent, maybeAutoScroll, rowDropTarget, sortKey, topLevelDropActive])

  const handleTopLevelDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTopLevelDropActive(false)
    }
  }, [])

  const handleTopLevelDrop = useCallback(async (event: DragEvent) => {
    if (hasFileTransfer(event)) return

    event.preventDefault()
    event.stopPropagation()

    const movingIds = getDraggedIdsFromEvent(event)
    await moveModsToTopLevel(movingIds)
    clearInternalDragState()
  }, [clearInternalDragState, getDraggedIdsFromEvent, moveModsToTopLevel])

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!hasFileTransfer(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }, [isDragging])

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!hasFileTransfer(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (event: DragEvent) => {
    if (!hasFileTransfer(event)) {
      setDropSeparatorId(null)
      setDraggedModIds([])
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const files = Array.from(event.dataTransfer.files)
    const archiveFile = files.find(isSupportedArchive)
    if (!archiveFile) {
      addToast(translate('library.toast.dropArchiveToInstall'), 'warning')
      return
    }

    const filePath = IpcService.getPathForFile(archiveFile)
    if (!filePath) {
      addToast(translate('library.toast.dropPathUnreadable'), 'error')
      return
    }

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
    maybeAutoScroll(event)
    if (!topLevelDropActive) setTopLevelDropActive(true)
    if (rowDropTarget !== null) setRowDropTarget(null)
    if (dropSeparatorId !== null) setDropSeparatorId(null)
  }, [dropSeparatorId, getDraggedIdsFromEvent, maybeAutoScroll, rowDropTarget, sortKey, topLevelDropActive])

  const handleListRowsDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTopLevelDropActive(false)
    }
  }, [])

  const handleListRowsDrop = useCallback(async (event: DragEvent) => {
    if (hasFileTransfer(event)) return

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
