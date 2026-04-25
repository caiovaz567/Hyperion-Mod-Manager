import type { ConflictInfo } from '@shared/types'

const ARCHIVE_HASH_PATTERN = /^(?:0x)?[0-9a-f]{16}$/i

function normalizeArchiveHash(value?: string): string | null {
  const normalized = value?.trim().replace(/^0x/i, '').toLowerCase()
  if (!normalized || !ARCHIVE_HASH_PATTERN.test(normalized)) return null
  return normalized.padStart(16, '0')
}

export function getArchiveConflictHash(conflict: ConflictInfo): string | null {
  if (conflict.kind !== 'archive-resource') return null
  return normalizeArchiveHash(conflict.hash) ?? normalizeArchiveHash(conflict.resourcePath)
}

export function isUnresolvedArchiveConflict(conflict: ConflictInfo): boolean {
  if (conflict.kind !== 'archive-resource') return false
  const hash = getArchiveConflictHash(conflict)
  return Boolean(hash && normalizeArchiveHash(conflict.resourcePath) === hash)
}
