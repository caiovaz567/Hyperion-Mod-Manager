import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModMetadata } from '@shared/types'

interface UseLibrarySelectionOptions {
  displayedMods: ModMetadata[]
  orderedEntries: ModMetadata[]
  orderedEntryIds: Set<string>
  selectMod: (modId: string | null) => void
}

export function useLibrarySelection({
  displayedMods,
  orderedEntries,
  orderedEntryIds,
  selectMod,
}: UseLibrarySelectionOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const selectedIdsRef = useRef<string[]>([])
  const selectionAnchorIdRef = useRef<string | null>(null)
  const displayedModsRef = useRef<ModMetadata[]>([])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedEntries = useMemo(
    () => orderedEntries.filter((entry) => selectedIds.includes(entry.uuid)),
    [orderedEntries, selectedIds]
  )
  const selectedMods = useMemo(
    () => selectedEntries.filter((entry) => entry.kind === 'mod'),
    [selectedEntries]
  )
  const selectedModIds = useMemo(
    () => selectedMods.map((entry) => entry.uuid),
    [selectedMods]
  )
  const selectedModCount = selectedModIds.length
  const bulkSelectionActive = selectedModCount > 1

  selectedIdsRef.current = selectedIds
  selectionAnchorIdRef.current = selectionAnchorId
  displayedModsRef.current = displayedMods

  const setSelection = useCallback((nextIds: string[], anchorId: string | null = nextIds[0] ?? null) => {
    selectedIdsRef.current = nextIds
    selectionAnchorIdRef.current = anchorId
    setSelectedIds(nextIds)
    setSelectionAnchorId(anchorId)
  }, [])

  const resetSelection = useCallback(() => {
    setSelection([], null)
  }, [setSelection])

  const clearSelection = useCallback(() => {
    resetSelection()
    selectMod(null)
  }, [resetSelection, selectMod])

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => orderedEntryIds.has(id)))
  }, [orderedEntryIds])

  useEffect(() => {
      const handlePointerDown = (event: MouseEvent) => {
      if (event.button !== 0 || selectedIds.length === 0) return

      const target = event.target as HTMLElement | null
      if (target?.closest('[data-mod-row="true"]')) return
      if (target?.closest('[data-bulk-actions="true"]')) return
      if (target?.closest('[data-action-prompt="true"]')) return

        clearSelection()
      }

      window.addEventListener('mousedown', handlePointerDown)
      return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [clearSelection, selectedIds.length])

  useEffect(() => {
    const handleSelectAll = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditable = Boolean(
        target?.closest('input, textarea, [contenteditable="true"]')
      )

      if (isEditable) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return

      event.preventDefault()
      const visibleIds = displayedMods.filter((mod) => mod.kind === 'mod').map((mod) => mod.uuid)
      setSelection(visibleIds)
    }

    window.addEventListener('keydown', handleSelectAll)
    return () => window.removeEventListener('keydown', handleSelectAll)
  }, [displayedMods, setSelection])

  return {
    selectedIds,
    setSelectedIds,
    selectionAnchorId,
    setSelectionAnchorId,
    setSelection,
    resetSelection,
    clearSelection,
    selectedIdsRef,
    selectionAnchorIdRef,
    displayedModsRef,
    selectedSet,
    selectedEntries,
    selectedMods,
    selectedModIds,
    selectedModCount,
    bulkSelectionActive,
  }
}
