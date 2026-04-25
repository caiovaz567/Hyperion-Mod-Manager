import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ModMetadata, ToastSeverity } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import type { LibrarySortKey } from './LibraryTableHeader'

type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void

export interface SeparatorDialogState {
  mode: 'create' | 'rename'
  separatorId?: string
  value: string
  insertIndex?: number
}

interface UseLibrarySeparatorActionsOptions {
  collapsedSeparatorIds: string[]
  setCollapsedSeparatorIds: Dispatch<SetStateAction<string[]>>
  allMods: ModMetadata[]
  allSeparators: ModMetadata[]
  allSeparatorIds: string[]
  orderedEntries: ModMetadata[]
  displayedMods: ModMetadata[]
  selectedModIds: string[]
  selectedModCount: number
  sortKey: LibrarySortKey | null
  resetToCustomOrder: () => void
  addToast: AddToast
  createSeparator: (name?: string) => Promise<ModMetadata | null>
  scanMods: () => Promise<ModMetadata[]>
  selectMod: (modId: string | null) => void
  updateModMetadata: (id: string, updates: Partial<ModMetadata>) => Promise<void>
  resetSelection: () => void
  closeContextMenu: () => void
}

export function useLibrarySeparatorActions({
  collapsedSeparatorIds,
  setCollapsedSeparatorIds,
  allMods,
  allSeparators,
  allSeparatorIds,
  orderedEntries,
  displayedMods,
  selectedModIds,
  selectedModCount,
  sortKey,
  resetToCustomOrder,
  addToast,
  createSeparator,
  scanMods,
  selectMod,
  updateModMetadata,
  resetSelection,
  closeContextMenu,
}: UseLibrarySeparatorActionsOptions) {
  const separatorRevealTimeoutRef = useRef<number | null>(null)
  const moveSeparatorMenuRef = useRef<HTMLDivElement>(null)
  const [recentlyRevealedSeparatorId, setRecentlyRevealedSeparatorId] = useState<string | null>(null)
  const [separatorDialog, setSeparatorDialog] = useState<SeparatorDialogState | null>(null)
  const [separatorDialogSubmitting, setSeparatorDialogSubmitting] = useState(false)
  const [moveSeparatorMenuOpen, setMoveSeparatorMenuOpen] = useState(false)
  const hasCollapsedSeparators = collapsedSeparatorIds.length > 0

  useEffect(() => {
    if (!moveSeparatorMenuOpen) return

    const close = (event: MouseEvent) => {
      if (!moveSeparatorMenuRef.current?.contains(event.target as Node)) {
        setMoveSeparatorMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [moveSeparatorMenuOpen])

  useEffect(() => {
    if (selectedModCount === 0 || sortKey !== null) {
      setMoveSeparatorMenuOpen(false)
    }
  }, [selectedModCount, sortKey])

  useEffect(() => {
    const validSeparatorIds = new Set(allSeparators.map((separator) => separator.uuid))
    setCollapsedSeparatorIds((current) => current.filter((id) => validSeparatorIds.has(id)))
  }, [allSeparators, setCollapsedSeparatorIds])

  useEffect(() => () => {
    if (separatorRevealTimeoutRef.current !== null) {
      window.clearTimeout(separatorRevealTimeoutRef.current)
    }
  }, [])

  const revealSeparator = useCallback((separatorId: string) => {
    setCollapsedSeparatorIds((current) => current.filter((id) => id !== separatorId))
    setRecentlyRevealedSeparatorId(separatorId)

    if (separatorRevealTimeoutRef.current !== null) {
      window.clearTimeout(separatorRevealTimeoutRef.current)
    }

    separatorRevealTimeoutRef.current = window.setTimeout(() => {
      setRecentlyRevealedSeparatorId((current) => (current === separatorId ? null : current))
      separatorRevealTimeoutRef.current = null
    }, 220)
  }, [setCollapsedSeparatorIds])

  const insertSeparatorAtDisplayIndex = useCallback(async (separatorId: string, displayIndex?: number) => {
    const currentEntries = [...useAppStore.getState().mods].sort((left, right) => left.order - right.order)
    const nextEntries = [...currentEntries.filter((entry) => entry.uuid !== separatorId)]
    const separator = currentEntries.find((entry) => entry.uuid === separatorId)

    if (!separator) return

    if (displayIndex === undefined || displayedMods.length === 0) {
      nextEntries.push(separator)
      await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
      return
    }

    const clampedIndex = Math.max(0, Math.min(displayIndex, displayedMods.length))
    const anchorBefore = clampedIndex < displayedMods.length ? displayedMods[clampedIndex] : null
    const anchorAfter = clampedIndex > 0 ? displayedMods[clampedIndex - 1] : null

    if (anchorBefore) {
      const insertAt = nextEntries.findIndex((entry) => entry.uuid === anchorBefore.uuid)
      if (insertAt >= 0) {
        nextEntries.splice(insertAt, 0, separator)
        await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
        return
      }
    }

    if (anchorAfter) {
      const insertAt = nextEntries.findIndex((entry) => entry.uuid === anchorAfter.uuid)
      if (insertAt >= 0) {
        nextEntries.splice(insertAt + 1, 0, separator)
        await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
        return
      }
    }

    nextEntries.unshift(separator)
    await useAppStore.getState().reorderMods(nextEntries.map((entry) => entry.uuid))
  }, [displayedMods])

  const moveModsToSeparator = useCallback(async (modIds: string[], separatorId: string) => {
    if (sortKey !== null) {
      addToast('Return to Custom Order to move mods between separators', 'warning')
      return
    }

    const movingIds = modIds.filter((id, index, list) =>
      list.indexOf(id) === index && allMods.some((mod) => mod.uuid === id)
    )
    if (movingIds.length === 0) return

    const movingSet = new Set(movingIds)
    const movingEntries = orderedEntries.filter((entry) => movingSet.has(entry.uuid))
    const remainingEntries = orderedEntries.filter((entry) => !movingSet.has(entry.uuid))
    const separatorIndex = remainingEntries.findIndex((entry) => entry.uuid === separatorId && entry.kind === 'separator')

    if (separatorIndex < 0) return

    let insertIndex = separatorIndex + 1
    while (insertIndex < remainingEntries.length && remainingEntries[insertIndex].kind !== 'separator') {
      insertIndex += 1
    }

    const reordered = [
      ...remainingEntries.slice(0, insertIndex),
      ...movingEntries,
      ...remainingEntries.slice(insertIndex),
    ]

    await useAppStore.getState().reorderMods(reordered.map((entry) => entry.uuid))
    revealSeparator(separatorId)
    addToast(
      `${movingIds.length} mod${movingIds.length === 1 ? '' : 's'} moved into ${orderedEntries.find((entry) => entry.uuid === separatorId)?.name ?? 'separator'}`,
      'success',
      1800
    )
  }, [addToast, allMods, orderedEntries, revealSeparator, sortKey])

  const moveModsToTopLevel = useCallback(async (modIds: string[]) => {
    if (sortKey !== null) {
      addToast('Return to Custom Order to move mods out of separators', 'warning')
      return
    }

    const movingIds = modIds.filter((id, index, list) =>
      list.indexOf(id) === index && allMods.some((mod) => mod.uuid === id)
    )
    if (movingIds.length === 0) return

    const movingSet = new Set(movingIds)
    const movingEntries = orderedEntries.filter((entry) => movingSet.has(entry.uuid))
    const remainingEntries = orderedEntries.filter((entry) => !movingSet.has(entry.uuid))
    const firstSeparatorIndex = remainingEntries.findIndex((entry) => entry.kind === 'separator')
    const insertIndex = firstSeparatorIndex >= 0 ? firstSeparatorIndex : remainingEntries.length

    const reordered = [
      ...remainingEntries.slice(0, insertIndex),
      ...movingEntries,
      ...remainingEntries.slice(insertIndex),
    ]

    await useAppStore.getState().reorderMods(reordered.map((entry) => entry.uuid))
    addToast(
      `${movingIds.length} mod${movingIds.length === 1 ? '' : 's'} moved back to top level`,
      'success',
      1800
    )
  }, [addToast, allMods, orderedEntries, sortKey])

  const handleMoveSelectedToSeparator = useCallback(async (separatorId: string) => {
    await moveModsToSeparator(selectedModIds, separatorId)
    setMoveSeparatorMenuOpen(false)
  }, [moveModsToSeparator, selectedModIds])

  const handleMoveSelectedToTopLevel = useCallback(async () => {
    if (selectedModIds.length === 0) return
    await moveModsToTopLevel(selectedModIds)
    closeContextMenu()
  }, [closeContextMenu, moveModsToTopLevel, selectedModIds])

  const handleCreateSeparator = useCallback((insertIndex?: number) => {
    const allowIndexedInsert = sortKey === null

    if (sortKey !== null) {
      resetToCustomOrder()
    }

    setSeparatorDialogSubmitting(false)
    setSeparatorDialog({
      mode: 'create',
      value: '',
      insertIndex: allowIndexedInsert ? insertIndex : undefined,
    })
  }, [resetToCustomOrder, sortKey])

  const handleSubmitSeparatorDialog = useCallback(async () => {
    if (!separatorDialog) return

    const trimmed = separatorDialog.value.trim()
    if (!trimmed) {
      addToast('Separator name cannot be empty', 'warning')
      return
    }

    setSeparatorDialogSubmitting(true)

    if (separatorDialog.mode === 'create') {
      const created = await createSeparator(trimmed)
      if (!created) {
        setSeparatorDialogSubmitting(false)
        addToast('Could not create separator', 'error')
        return
      }

      await scanMods()
      await insertSeparatorAtDisplayIndex(created.uuid, separatorDialog.insertIndex)
      setSeparatorDialogSubmitting(false)
      setSeparatorDialog(null)
      resetSelection()
      selectMod(created.uuid)
      addToast('Separator created', 'success', 1600)
      return
    }

    if (!separatorDialog.separatorId) {
      setSeparatorDialogSubmitting(false)
      return
    }

    await updateModMetadata(separatorDialog.separatorId, { name: trimmed })
    setSeparatorDialogSubmitting(false)
    setSeparatorDialog(null)
    addToast('Separator name updated', 'success', 1600)
  }, [
    addToast,
    createSeparator,
    insertSeparatorAtDisplayIndex,
    resetSelection,
    scanMods,
    selectMod,
    separatorDialog,
    updateModMetadata,
  ])

  const handleToggleAllSeparators = useCallback(() => {
    if (allSeparatorIds.length === 0) return

    setCollapsedSeparatorIds(hasCollapsedSeparators ? [] : allSeparatorIds)
    closeContextMenu()
  }, [allSeparatorIds, closeContextMenu, hasCollapsedSeparators, setCollapsedSeparatorIds])

  const handleSeparatorDialogValueChange = useCallback((value: string) => {
    setSeparatorDialog((current) => current ? { ...current, value } : current)
  }, [])

  const handleCancelSeparatorDialog = useCallback(() => {
    if (separatorDialogSubmitting) return
    setSeparatorDialogSubmitting(false)
    setSeparatorDialog(null)
  }, [separatorDialogSubmitting])

  const toggleMoveSeparatorMenu = useCallback(() => {
    setMoveSeparatorMenuOpen((current) => !current)
  }, [])

  return {
    hasCollapsedSeparators,
    recentlyRevealedSeparatorId,
    separatorDialog,
    separatorDialogSubmitting,
    moveSeparatorMenuOpen,
    moveSeparatorMenuRef,
    revealSeparator,
    moveModsToSeparator,
    moveModsToTopLevel,
    handleMoveSelectedToSeparator,
    handleMoveSelectedToTopLevel,
    handleCreateSeparator,
    handleSubmitSeparatorDialog,
    handleToggleAllSeparators,
    handleSeparatorDialogValueChange,
    handleCancelSeparatorDialog,
    toggleMoveSeparatorMenu,
  }
}
