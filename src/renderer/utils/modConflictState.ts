import type { ConflictInfo, ModConflictSummary, ModMetadata } from '@shared/types'

export interface ConflictStateSnapshot {
  conflicts: ConflictInfo[]
  summaries: ModConflictSummary[]
}

export const recomputeConflictStateFromExistingConflicts = (
  mods: ModMetadata[],
  existingConflicts: ConflictInfo[]
): ConflictStateSnapshot => {
  const modMap = new Map(
    mods
      .filter((mod) => mod.kind === 'mod')
      .map((mod) => [mod.uuid, mod] as const)
  )

  const summaryMap = new Map<string, { overwrites: number; overwrittenBy: number }>()
  for (const mod of mods) {
    summaryMap.set(mod.uuid, { overwrites: 0, overwrittenBy: 0 })
  }

  const resourceOwners = new Map<string, Map<string, { modId: string; name: string }>>()

  for (const conflict of existingConflicts) {
    if (conflict.kind !== 'overwrite') continue

    const owners = resourceOwners.get(conflict.resourcePath) ?? new Map<string, { modId: string; name: string }>()
    owners.set(conflict.existingModId, {
      modId: conflict.existingModId,
      name: modMap.get(conflict.existingModId)?.name ?? conflict.existingModName,
    })

    if (conflict.incomingModId) {
      owners.set(conflict.incomingModId, {
        modId: conflict.incomingModId,
        name: modMap.get(conflict.incomingModId)?.name ?? conflict.incomingModName,
      })
    }

    resourceOwners.set(conflict.resourcePath, owners)
  }

  const recomputedConflicts: ConflictInfo[] = []

  for (const [resourcePath, owners] of resourceOwners.entries()) {
    const orderedOwners = Array.from(owners.values())
      .map((owner) => {
        const mod = modMap.get(owner.modId)
        if (!mod) return null
        return {
          modId: owner.modId,
          name: mod.name,
          order: mod.order,
        }
      })
      .filter((owner): owner is { modId: string; name: string; order: number } => Boolean(owner))
      .sort((left, right) => left.order - right.order)

    if (orderedOwners.length <= 1) continue

    const winner = orderedOwners[orderedOwners.length - 1]

    for (const owner of orderedOwners) {
      if (owner.modId === winner.modId) continue

      recomputedConflicts.push({
        kind: 'overwrite',
        resourcePath,
        existingModId: owner.modId,
        existingModName: owner.name,
        incomingModId: winner.modId,
        incomingModName: winner.name,
        existingOrder: owner.order,
        incomingOrder: winner.order,
        incomingWins: winner.order > owner.order,
      })

      const winnerSummary = summaryMap.get(winner.modId)
      if (winnerSummary) winnerSummary.overwrites += 1

      const ownerSummary = summaryMap.get(owner.modId)
      if (ownerSummary) ownerSummary.overwrittenBy += 1
    }
  }

  return {
    conflicts: recomputedConflicts,
    summaries: Array.from(summaryMap.entries()).map(([modId, summary]) => ({
      modId,
      overwrites: summary.overwrites,
      overwrittenBy: summary.overwrittenBy,
    })),
  }
}
