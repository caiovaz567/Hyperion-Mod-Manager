import type { ArchiveResourceEntry, ConflictInfo, ModConflictSummary, ModMetadata } from '@shared/types'
import { getDeployRelativePath, normalizeRelativePath } from '../features/library/detailFileTreeUtils'

export interface ConflictStateSnapshot {
  conflicts: ConflictInfo[]
  summaries: ModConflictSummary[]
}

const ARCHIVE_HASH_PATTERN = /^(?:0x)?[0-9a-f]{1,16}$/i
const ARCHIVE_MOD_DEPLOY_DIR = 'archive/pc/mod'
const LOAD_ORDERED_ARCHIVE_EXTENSION = '.archive'

function isLoadOrderedArchiveDeployPath(relativeDeployPath: string): boolean {
  const normalized = normalizeRelativePath(relativeDeployPath).toLowerCase()
  return (
    normalized.endsWith(LOAD_ORDERED_ARCHIVE_EXTENSION) &&
    normalized.startsWith(`${ARCHIVE_MOD_DEPLOY_DIR}/`)
  )
}

function normalizeArchiveHash(value?: string): string | null {
  const normalized = value?.trim().replace(/^0x/i, '').toLowerCase()
  if (!normalized || !ARCHIVE_HASH_PATTERN.test(normalized)) return null
  return normalized.padStart(16, '0')
}

function normalizeArchiveResourcePath(value?: string): string | null {
  const normalized = value
    ?.trim()
    .split(/[\\/]+/)
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .join('/')

  return normalized || null
}

function getTrackedDeploymentPaths(mod: ModMetadata): string[] {
  if (Array.isArray(mod.deployedPaths) && mod.deployedPaths.length > 0) {
    return mod.deployedPaths
  }

  if (!Array.isArray(mod.files)) return []
  return mod.files
    .filter((relFile) => relFile !== '_metadata.json')
    .map((relFile) => getDeployRelativePath(mod, relFile))
}

function getArchiveResourceSummaryKey(resource: ArchiveResourceEntry): string | null {
  const hash = normalizeArchiveHash(resource.hash)
  if (hash) return `archive:${hash}`

  const resourcePath = normalizeArchiveResourcePath(resource.resourcePath)
  if (resourcePath) return `archive:${resourcePath}`

  return null
}

function getArchiveResourceSummaryKeys(mod: ModMetadata): Set<string> {
  const keys = new Set<string>()

  if (Array.isArray(mod.archiveResources)) {
    for (const resource of mod.archiveResources) {
      const key = getArchiveResourceSummaryKey(resource)
      if (key) keys.add(key)
    }
  }

  if (Array.isArray(mod.hashes)) {
    for (const value of mod.hashes) {
      const hash = normalizeArchiveHash(value)
      const key = hash
        ? `archive:${hash}`
        : getArchiveResourceSummaryKey({ resourcePath: value })
      if (key) keys.add(key)
    }
  }

  return keys
}

function getModResourceSummaryKeys(mod: ModMetadata): Set<string> {
  const keys = new Set<string>()
  if (mod.kind !== 'mod' || !mod.enabled) return keys

  for (const rel of getTrackedDeploymentPaths(mod)) {
    const normalized = normalizeRelativePath(rel)
    if (!normalized) continue
    if (isLoadOrderedArchiveDeployPath(normalized)) continue
    keys.add(`overwrite:${normalized}`)
  }

  for (const key of getArchiveResourceSummaryKeys(mod)) {
    keys.add(key)
  }

  return keys
}

// The redundant denominator. Bulk-scanned mods arrive slimmed (no files /
// archiveResources) with a main-computed `trackedResourceCount`; mods that still
// carry their arrays (single-mod IPC results) fall back to deriving the keys
// locally, exactly as before.
function getModResourceBaseCount(mod: ModMetadata, localKeys: Set<string>): number {
  if (mod.kind !== 'mod' || !mod.enabled) return 0
  if (typeof mod.trackedResourceCount === 'number') {
    return Math.max(mod.trackedResourceCount, localKeys.size)
  }
  return localKeys.size
}

export const recomputeConflictStateFromExistingConflicts = (
  mods: ModMetadata[],
  existingConflicts: ConflictInfo[]
): ConflictStateSnapshot => {
  type ResourceOwner = { modId: string; name: string }
  type ResourceGroup = {
    kind: ConflictInfo['kind']
    resourcePath: string
    summaryKey: string
    hash?: string
    owners: Map<string, ResourceOwner>
  }

  const modMap = new Map(
    mods
      .filter((mod) => mod.kind === 'mod' && mod.enabled)
      .map((mod) => [mod.uuid, mod] as const)
  )

  const summaryMap = new Map<string, { overwrites: Set<string>; overwrittenBy: Set<string> }>()
  const resourceKeysByMod = new Map<string, Set<string>>()
  const baseCountByMod = new Map<string, number>()
  for (const mod of mods) {
    summaryMap.set(mod.uuid, { overwrites: new Set<string>(), overwrittenBy: new Set<string>() })
    const localKeys = getModResourceSummaryKeys(mod)
    resourceKeysByMod.set(mod.uuid, localKeys)
    baseCountByMod.set(mod.uuid, getModResourceBaseCount(mod, localKeys))
  }

  const resourceGroups = new Map<string, ResourceGroup>()

  for (const conflict of existingConflicts) {
    const resourceKey = conflict.kind === 'archive-resource'
      ? `archive:${conflict.hash ?? conflict.resourcePath}`
      : `overwrite:${conflict.resourcePath}`
    const resourceGroup = resourceGroups.get(resourceKey) ?? {
      kind: conflict.kind,
      resourcePath: conflict.resourcePath,
      summaryKey: resourceKey,
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

  const addSummaryByLoadOrder = (
    owners: Array<{ modId: string; name: string; order: number }>,
    summaryKey: string
  ) => {
    owners.forEach((owner, index) => {
      const summary = summaryMap.get(owner.modId)
      if (!summary) return
      if (index > 0) summary.overwrites.add(summaryKey)
      if (index < owners.length - 1) summary.overwrittenBy.add(summaryKey)
    })
  }

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

    for (const owner of orderedOwners) {
      resourceKeysByMod.get(owner.modId)?.add(resourceGroup.summaryKey)
    }
    addSummaryByLoadOrder(orderedOwners, resourceGroup.summaryKey)

    for (let lowerIndex = 0; lowerIndex < orderedOwners.length - 1; lowerIndex += 1) {
      const lowerOwner = orderedOwners[lowerIndex]
      for (let higherIndex = lowerIndex + 1; higherIndex < orderedOwners.length; higherIndex += 1) {
        const higherOwner = orderedOwners[higherIndex]
        recomputedConflicts.push({
          kind: resourceGroup.kind,
          resourcePath: resourceGroup.resourcePath,
          hash: resourceGroup.hash,
          existingModId: lowerOwner.modId,
          existingModName: lowerOwner.name,
          incomingModId: higherOwner.modId,
          incomingModName: higherOwner.name,
          existingOrder: lowerOwner.order,
          incomingOrder: higherOwner.order,
          incomingWins: higherOwner.order > lowerOwner.order,
        })
      }
    }
  }

  return {
    conflicts: recomputedConflicts,
    summaries: Array.from(summaryMap.entries()).map(([modId, summary]) => {
      // Denominator: the main-computed tracked count when the mod arrived slimmed,
      // widened by any conflict-derived keys observed locally (belt and braces -
      // a mod can never be "fully redundant" against fewer resources than the
      // conflicts we can actually see).
      const resourceCount = Math.max(
        baseCountByMod.get(modId) ?? 0,
        resourceKeysByMod.get(modId)?.size ?? 0
      )
      return {
        modId,
        overwrites: summary.overwrites.size,
        overwrittenBy: summary.overwrittenBy.size,
        redundant: resourceCount > 0 && summary.overwrittenBy.size >= resourceCount,
      }
    }),
  }
}
