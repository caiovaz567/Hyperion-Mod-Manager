import { useEffect } from 'react'
import type { ConflictInfo, ModMetadata } from '@shared/types'
import { getModConflictRelations, hasConflictRelations } from './conflictUtils'

interface UseLibraryConflictHighlightOptions {
  selectedIds: string[]
  mods: ModMetadata[]
  conflicts: ConflictInfo[]
  setConflictHighlight: (focusModId: string, wins: string[], losses: string[]) => void
  clearConflictHighlight: () => void
}

export function useLibraryConflictHighlight({
  selectedIds,
  mods,
  conflicts,
  setConflictHighlight,
  clearConflictHighlight,
}: UseLibraryConflictHighlightOptions) {
  useEffect(() => {
    if (selectedIds.length !== 1) {
      clearConflictHighlight()
      return
    }

    const focusId = selectedIds[0]
    const focusMod = mods.find((mod) => mod.uuid === focusId)
    if (!focusMod || focusMod.kind !== 'mod') {
      clearConflictHighlight()
      return
    }

    const relations = getModConflictRelations(conflicts, focusId)
    if (!hasConflictRelations(relations)) {
      clearConflictHighlight()
      return
    }

    setConflictHighlight(focusId, relations.wins, relations.losses)
  }, [clearConflictHighlight, conflicts, mods, selectedIds, setConflictHighlight])
}
