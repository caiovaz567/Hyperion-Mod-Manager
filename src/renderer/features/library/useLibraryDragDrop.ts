import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

// A dragged separator always lands at a whole-section boundary, never between a
// header and its mods. 'top' = before the target section's header; 'bottom' =
// after the target section's entire block; 'local' = a plain before/after on an
// ungrouped (top-level) row.
type SeparatorBoundary =
  | { kind: 'top'; headerId: string }
  | { kind: 'bottom'; headerId: string }
  | { kind: 'local'; targetId: string; position: RowDropPosition }

interface UseLibraryDragDropOptions {
  orderedEntries: ModMetadata[]
  displayedMods: ModMetadata[]
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
  displayedMods,
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

  // While an internal mod/separator drag is active, mark the WHOLE document a
  // valid drop target. The browser paints the "no-drop" block cursor on any
  // dragenter/dragover that isn't cancelled. The KEY culprit behind the constant
  // flicker is `dragenter`: it fires every time the cursor crosses into a new
  // element (and a row is full of small ones - cells, icons, spans), so leaving
  // it uncancelled flashes the block cursor on every micro-movement, even though
  // `dragover` is cancelled a moment later. Per MDN, allowing a drop requires
  // cancelling BOTH events. We do it once at the document level so every element
  // is covered without wiring handlers onto each one, giving a steady "move"
  // cursor for the whole drag.
  const isInternalDragging = draggedModIds.length > 0
  useEffect(() => {
    if (!isInternalDragging) return
    const allowDrop = (event: DocumentEventMap['dragover']) => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }
    document.addEventListener('dragenter', allowDrop)
    document.addEventListener('dragover', allowDrop)
    return () => {
      document.removeEventListener('dragenter', allowDrop)
      document.removeEventListener('dragover', allowDrop)
    }
  }, [isInternalDragging])

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

  // Visible grouping derived from what is actually rendered (respects collapsed
  // separators and active filters). For each visible row it records the section
  // it belongs to, its index among that section's visible mods, the section's
  // visible-mod count, and the section's last visible mod - everything needed to
  // snap a dragged separator to a whole-section boundary.
  const visibleGroups = useMemo(() => {
    const sections: { headerId: string | null; childIds: string[] }[] = [{ headerId: null, childIds: [] }]
    for (const entry of displayedMods) {
      if (entry.kind === 'separator') {
        sections.push({ headerId: entry.uuid, childIds: [] })
      } else {
        sections[sections.length - 1].childIds.push(entry.uuid)
      }
    }

    const info = new Map<string, {
      headerId: string | null
      childIndex: number
      visibleChildCount: number
      lastVisibleChildId: string | null
    }>()
    for (const section of sections) {
      const lastVisibleChildId = section.childIds.at(-1) ?? null
      if (section.headerId) {
        info.set(section.headerId, { headerId: section.headerId, childIndex: -1, visibleChildCount: section.childIds.length, lastVisibleChildId })
      }
      section.childIds.forEach((id, idx) => {
        info.set(id, { headerId: section.headerId, childIndex: idx, visibleChildCount: section.childIds.length, lastVisibleChildId })
      })
    }
    return info
  }, [displayedMods])

  // Resolve where a dragged separator should land relative to the row under the
  // cursor. The decision flips ONCE at the section's mid-point (monotonic), so
  // the indicator never flickers, and it always resolves to a whole-section
  // boundary (top = before the header, bottom = after the whole block) so a
  // separator never nests inside another or steals its mods. Ungrouped rows fall
  // back to a plain local before/after.
  const resolveSeparatorBoundary = useCallback((
    hoveredId: string,
    cursorInBottomHalf: boolean
  ): SeparatorBoundary => {
    const grp = visibleGroups.get(hoveredId)
    if (!grp || grp.headerId === null) {
      return { kind: 'local', targetId: hoveredId, position: cursorInBottomHalf ? 'after' : 'before' }
    }

    const count = grp.visibleChildCount
    if (grp.childIndex === -1) {
      // Hovering the section header. With visible mods the header is the top edge
      // (before). A collapsed/empty section behaves like a single row (before/after).
      if (count === 0) return { kind: cursorInBottomHalf ? 'bottom' : 'top', headerId: grp.headerId }
      return { kind: 'top', headerId: grp.headerId }
    }

    // Hovering a mod: continuous position within the section's visible mods.
    const continuous = grp.childIndex + (cursorInBottomHalf ? 0.5 : 0)
    return continuous < count / 2
      ? { kind: 'top', headerId: grp.headerId }
      : { kind: 'bottom', headerId: grp.headerId }
  }, [visibleGroups])

  // Visual indicator target for a resolved boundary (lands on a rendered row).
  const boundaryToRowDropTarget = useCallback((
    boundary: SeparatorBoundary
  ): { targetId: string; position: RowDropPosition } => {
    if (boundary.kind === 'local') return { targetId: boundary.targetId, position: boundary.position }
    if (boundary.kind === 'top') return { targetId: boundary.headerId, position: 'before' }
    const lastVisible = visibleGroups.get(boundary.headerId)?.lastVisibleChildId ?? null
    return lastVisible
      ? { targetId: lastVisible, position: 'after' }
      : { targetId: boundary.headerId, position: 'after' }
  }, [visibleGroups])

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

  // Commit a dragged separator at a resolved section boundary. 'bottom' inserts
  // after the section's LAST child in the real (full) order via getSeparatorBlockIds,
  // which correctly handles collapsed sections whose mods aren't in displayedMods.
  const applySeparatorBoundaryDrop = useCallback(async (
    movingIds: string[],
    boundary: SeparatorBoundary
  ) => {
    if (boundary.kind === 'local') {
      await reorderModsAroundTarget(movingIds, boundary.targetId, boundary.position)
      return
    }
    if (boundary.kind === 'top') {
      await reorderModsAroundTarget(movingIds, boundary.headerId, 'before')
      return
    }
    const lastBlockChild = getSeparatorBlockIds(boundary.headerId).at(-1) ?? boundary.headerId
    await reorderModsAroundTarget(movingIds, lastBlockChild, 'after')
  }, [getSeparatorBlockIds, reorderModsAroundTarget])

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
    if (movingIds.length === 0) return

    // Any internal drag over a row is a valid drop zone - preventDefault here so
    // the cursor stays "move" instead of the browser's no-drop icon. This must
    // run BEFORE the own-row check below, otherwise hovering the dragged
    // separator's own (dimmed) child mods would skip preventDefault and flicker
    // to the block cursor.
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    maybeAutoScroll(event)

    // Don't move the indicator when hovering one of the rows being dragged.
    if (movingIds.includes(targetMod.uuid)) return

    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cursorInBottomHalf = event.clientY >= rect.top + rect.height / 2

    // When dragging a separator, snap the indicator to a whole-section boundary
    // (single flip at the section mid-point → no flicker, no nesting). For plain
    // mod drags keep a local before/after on the hovered row.
    const draggingSeparator = movingIds.some(
      (id) => orderedEntries.find((entry) => entry.uuid === id)?.kind === 'separator'
    )
    const next = draggingSeparator
      ? boundaryToRowDropTarget(resolveSeparatorBoundary(targetMod.uuid, cursorInBottomHalf))
      : { targetId: targetMod.uuid, position: (cursorInBottomHalf ? 'after' : 'before') as RowDropPosition }

    if (!rowDropTarget || rowDropTarget.targetId !== next.targetId || rowDropTarget.position !== next.position) {
      setRowDropTarget(next)
    }
    if (dropSeparatorId !== null) setDropSeparatorId(null)
    if (topLevelDropActive) setTopLevelDropActive(false)
  }, [boundaryToRowDropTarget, dropSeparatorId, getDraggedIdsFromEvent, maybeAutoScroll, orderedEntries, resolveSeparatorBoundary, rowDropTarget, sortKey, topLevelDropActive])

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
    const cursorInBottomHalf = event.clientY >= rect.top + rect.height / 2

    const draggingSeparator = movingIds.some(
      (id) => orderedEntries.find((entry) => entry.uuid === id)?.kind === 'separator'
    )
    if (draggingSeparator) {
      await applySeparatorBoundaryDrop(movingIds, resolveSeparatorBoundary(targetMod.uuid, cursorInBottomHalf))
    } else {
      await reorderModsAroundTarget(movingIds, targetMod.uuid, cursorInBottomHalf ? 'after' : 'before')
    }
    clearInternalDragState()
  }, [applySeparatorBoundaryDrop, clearInternalDragState, getDraggedIdsFromEvent, orderedEntries, reorderModsAroundTarget, resolveSeparatorBoundary])

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
      const cursorInBottomHalf = event.clientY >= rect.top + rect.height / 2

      // Snap to the section boundary so the bar reads as "above this section"
      // (top half) or "below this whole section" (bottom half) - concise, and
      // consistent with where the drop will land.
      const next = boundaryToRowDropTarget(resolveSeparatorBoundary(separator.uuid, cursorInBottomHalf))
      if (!rowDropTarget || rowDropTarget.targetId !== next.targetId || rowDropTarget.position !== next.position) {
        setRowDropTarget(next)
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
  }, [boundaryToRowDropTarget, dropSeparatorId, getDraggedIdsFromEvent, maybeAutoScroll, orderedEntries, resolveSeparatorBoundary, rowDropTarget, sortKey, topLevelDropActive])

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
      const cursorInBottomHalf = event.clientY >= rect.top + rect.height / 2
      await applySeparatorBoundaryDrop(parsedIds, resolveSeparatorBoundary(separator.uuid, cursorInBottomHalf))
    } else {
      await moveModsToSeparator(parsedIds, separator.uuid)
    }
    clearInternalDragState()
  }, [applySeparatorBoundaryDrop, clearInternalDragState, getDraggedIdsFromEvent, moveModsToSeparator, orderedEntries, resolveSeparatorBoundary])

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
    if (hasFileTransfer(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      if (!isDragging) setIsDragging(true)
      return
    }

    // Catch-all for internal mod/separator drags: this outer container is the
    // ancestor of every row, so any dragover the more specific row/separator/
    // top-level handlers didn't claim (e.g. over a dragged row, row gaps, the
    // toolbar/header, or panel padding) bubbles here. We gate on our own drag
    // ref rather than dataTransfer.types because the protected drag-data store
    // doesn't reliably expose custom types during dragover - so the type check
    // could miss and leave the area marked invalid (the browser's no-drop block
    // cursor). Marking it a valid drop target keeps the cursor "move" throughout.
    if (draggedModIdsRef.current.length > 0) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
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
