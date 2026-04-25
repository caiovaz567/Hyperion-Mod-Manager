import { useCallback } from 'react'
import type { Dispatch, MouseEvent, MutableRefObject, SetStateAction } from 'react'
import type { ModMetadata } from '@shared/types'

interface UseLibraryRowSelectionOptions {
  collapsedSeparatorSet: Set<string>
  displayedModsRef: MutableRefObject<ModMetadata[]>
  selectedIdsRef: MutableRefObject<string[]>
  selectionAnchorIdRef: MutableRefObject<string | null>
  revealSeparator: (separatorId: string) => void
  selectMod: (modId: string | null) => void
  setCollapsedSeparatorIds: Dispatch<SetStateAction<string[]>>
  setSelectedIds: Dispatch<SetStateAction<string[]>>
  setSelectionAnchorId: Dispatch<SetStateAction<string | null>>
  setSelection: (nextIds: string[], anchorId?: string | null) => void
}

export function useLibraryRowSelection({
  collapsedSeparatorSet,
  displayedModsRef,
  selectedIdsRef,
  selectionAnchorIdRef,
  revealSeparator,
  selectMod,
  setCollapsedSeparatorIds,
  setSelectedIds,
  setSelectionAnchorId,
  setSelection,
}: UseLibraryRowSelectionOptions) {
  const handleRowSelect = useCallback((event: MouseEvent, mod: ModMetadata, index: number) => {
    const currentDisplayedMods = displayedModsRef.current
    const currentSelectedIds = selectedIdsRef.current
    const currentSelectionAnchorId = selectionAnchorIdRef.current
    const resolvedAnchorId = currentSelectionAnchorId ?? currentSelectedIds[0] ?? null
    const anchorIndex = resolvedAnchorId
      ? currentDisplayedMods.findIndex((item) => item.uuid === resolvedAnchorId)
      : -1

    if (mod.kind === 'separator' && !(event.shiftKey || event.ctrlKey || event.metaKey)) {
      if (collapsedSeparatorSet.has(mod.uuid)) {
        revealSeparator(mod.uuid)
      } else {
        setCollapsedSeparatorIds((current) => [...current, mod.uuid])
      }
      setSelection([mod.uuid], mod.uuid)
      selectMod(mod.uuid)
      return
    }

    if (event.shiftKey && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      const rangeIds = currentDisplayedMods
        .slice(start, end + 1)
        .map((item) => item.uuid)

      selectedIdsRef.current = rangeIds
      setSelectedIds(rangeIds)
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) => {
        const next = current.includes(mod.uuid)
          ? current.filter((id) => id !== mod.uuid)
          : [...current, mod.uuid]
        selectedIdsRef.current = next
        return next
      })
      if (!currentSelectionAnchorId && currentSelectedIds.length === 0) {
        selectionAnchorIdRef.current = mod.uuid
        setSelectionAnchorId(mod.uuid)
      }
    } else {
      setSelection([mod.uuid], mod.uuid)
    }

    selectMod(mod.uuid)
  }, [
    collapsedSeparatorSet,
    displayedModsRef,
    revealSeparator,
    selectMod,
    selectedIdsRef,
    selectionAnchorIdRef,
    setCollapsedSeparatorIds,
    setSelectedIds,
    setSelection,
    setSelectionAnchorId,
  ])

  return { handleRowSelect }
}
