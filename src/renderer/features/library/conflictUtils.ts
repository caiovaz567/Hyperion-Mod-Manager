import type { ConflictInfo } from '@shared/types'

export interface ModConflictRelations {
  wins: string[]
  losses: string[]
}

export const getModConflictRelations = (
  conflicts: ConflictInfo[],
  modId: string
): ModConflictRelations => {
  const wins = new Set<string>()
  const losses = new Set<string>()

  for (const conflict of conflicts) {
    if (conflict.incomingModId === modId) {
      wins.add(conflict.existingModId)
    }

    if (conflict.existingModId === modId && conflict.incomingModId) {
      losses.add(conflict.incomingModId)
    }
  }

  return {
    wins: Array.from(wins),
    losses: Array.from(losses),
  }
}

export const hasConflictRelations = ({ wins, losses }: ModConflictRelations): boolean =>
  wins.length > 0 || losses.length > 0
