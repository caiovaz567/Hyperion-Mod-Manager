import type { ConflictInfo, ModConflictSummary, ModMetadata } from '@shared/types'

export interface ConflictStateSnapshot {
  conflicts: ConflictInfo[]
  summaries: ModConflictSummary[]
}

export const recomputeConflictStateFromExistingConflicts = (
  mods: ModMetadata[],
  existingConflicts: ConflictInfo[]
): ConflictStateSnapshot => {
  type ResourceOwner = { modId: string; name: string }
  type ResourceGroup = {
    kind: ConflictInfo['kind']
    resourcePath: string
    hash?: string
    owners: Map<string, ResourceOwner>
  }

  const modMap = new Map(
    mods
      .filter((mod) => mod.kind === 'mod')
      .map((mod) => [mod.uuid, mod] as const)
  )

  const summaryMap = new Map<string, { overwrites: number; overwrittenBy: number }>()
  for (const mod of mods) {
    summaryMap.set(mod.uuid, { overwrites: 0, overwrittenBy: 0 })
  }

  const resourceGroups = new Map<string, ResourceGroup>()

  for (const conflict of existingConflicts) {
    const resourceKey = conflict.kind === 'archive-resource'
      ? `archive:${conflict.hash ?? conflict.resourcePath}`
      : `overwrite:${conflict.resourcePath}`
    const resourceGroup = resourceGroups.get(resourceKey) ?? {
      kind: conflict.kind,
      resourcePath: conflict.resourcePath,
      hash: conflict.hash,
      owners: new Map<string, ResourceOwner>(),
    }

    resourceGroup.owners.set(conflict.existingModId, {
      modId: conflict.existingModId,
      name: modMap.get(conflict.existingModId)?.name ?? conflict.existingModName,
    })

    if (conflict.incomingModId) {
      resourceGroup.owners.set(conflict.incomingModId, {
        modId: conflict.incomingModId,
        name: modMap.get(conflict.incomingModId)?.name ?? conflict.incomingModName,
      })
    }

    resourceGroups.set(resourceKey, resourceGroup)
  }

  const recomputedConflicts: ConflictInfo[] = []

  for (const resourceGroup of resourceGroups.values()) {
    const orderedOwners = Array.from(resourceGroup.owners.values())
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
        kind: resourceGroup.kind,
        resourcePath: resourceGroup.resourcePath,
        hash: resourceGroup.hash,
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
