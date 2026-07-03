import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export interface NexusDownloadRecord {
  modId: number
  fileId: number
  filePath: string
  fileName: string
  createdAt: string
  version?: string
  categoryId?: number
  categoryName?: string
  // Human-readable Nexus mod/page name, used so installed mods get the same
  // library name Nexus shows instead of the raw archive upload name.
  displayName?: string
}

interface NexusDownloadRegistryShape {
  records: NexusDownloadRecord[]
}

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), 'nexus-downloads.json')
}

// The registry is cached in memory with a lazily-built path index. Lookups used to
// re-read + re-parse the JSON from disk AND existsSync-check every record on every
// call — and the Downloads refresh performs one lookup per archive file, so a large
// folder (4000 files × 4000 records) turned one refresh into millions of stat calls.
// All writes go through this module, so the in-memory copy is authoritative.
let cachedRegistry: NexusDownloadRegistryShape | null = null
let recordsByPath: Map<string, NexusDownloadRecord> | null = null

function normalizePathKey(filePath: string): string {
  return path.normalize(filePath).toLowerCase()
}

function loadRegistryFromDisk(): NexusDownloadRegistryShape {
  const registryPath = getRegistryPath()
  try {
    if (!fs.existsSync(registryPath)) {
      return { records: [] }
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as NexusDownloadRegistryShape
    if (!Array.isArray(parsed.records)) {
      return { records: [] }
    }
    return {
      records: parsed.records.filter((record) =>
        typeof record?.modId === 'number' &&
        typeof record?.fileId === 'number' &&
        typeof record?.filePath === 'string' &&
        typeof record?.fileName === 'string'
      ),
    }
  } catch {
    return { records: [] }
  }
}

function getRegistry(): NexusDownloadRegistryShape {
  if (!cachedRegistry) {
    cachedRegistry = loadRegistryFromDisk()
  }
  return cachedRegistry
}

function getRecordsByPath(): Map<string, NexusDownloadRecord> {
  if (!recordsByPath) {
    recordsByPath = new Map()
    // Later records never shadow earlier ones (upsert unshifts the newest first).
    for (const record of getRegistry().records) {
      const key = normalizePathKey(record.filePath)
      if (!recordsByPath.has(key)) recordsByPath.set(key, record)
    }
  }
  return recordsByPath
}

function persistRegistry(records: NexusDownloadRecord[]): void {
  cachedRegistry = { records }
  recordsByPath = null
  const registryPath = getRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(cachedRegistry, null, 2), 'utf-8')
}

export function findNexusDownloadRecord(modId: number, fileId: number): NexusDownloadRecord | null {
  const records = getRegistry().records
  // Validate only the matched record's file (one stat), not the whole registry —
  // a hit whose archive was deleted outside the app must not count as a duplicate.
  const deadPaths = new Set<string>()
  let match: NexusDownloadRecord | null = null
  for (const record of records) {
    if (record.modId !== modId || record.fileId !== fileId) continue
    if (fs.existsSync(record.filePath)) {
      match = record
      break
    }
    deadPaths.add(normalizePathKey(record.filePath))
  }
  if (deadPaths.size > 0) {
    persistRegistry(records.filter((record) => !deadPaths.has(normalizePathKey(record.filePath))))
  }
  return match
}

export function findNexusDownloadRecordByPath(filePath: string): NexusDownloadRecord | null {
  // Callers pass paths of files they just enumerated/are installing, so no
  // existence pruning is needed on this path — it's the per-file hot lookup.
  return getRecordsByPath().get(normalizePathKey(filePath)) ?? null
}

export function upsertNexusDownloadRecord(record: NexusDownloadRecord): void {
  const recordKey = normalizePathKey(record.filePath)
  // A completed download is a natural (and rare) point to sweep dead records.
  const filtered = getRegistry().records.filter(
    (entry) => normalizePathKey(entry.filePath) !== recordKey && fs.existsSync(entry.filePath)
  )
  filtered.unshift(record)
  persistRegistry(filtered)
}

export function removeNexusDownloadRecordByPath(filePath: string): void {
  const normalizedPath = normalizePathKey(filePath)
  const records = getRegistry().records
  const nextRecords = records.filter(
    (record) => normalizePathKey(record.filePath) !== normalizedPath
  )
  if (nextRecords.length !== records.length) {
    persistRegistry(nextRecords)
  }
}
