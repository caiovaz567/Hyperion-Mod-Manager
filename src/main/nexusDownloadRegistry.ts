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
}

interface NexusDownloadRegistryShape {
  records: NexusDownloadRecord[]
}

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), 'nexus-downloads.json')
}

function loadRegistry(): NexusDownloadRegistryShape {
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

function saveRegistry(registry: NexusDownloadRegistryShape): void {
  const registryPath = getRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8')
}

function pruneMissingRecords(records: NexusDownloadRecord[]): NexusDownloadRecord[] {
  return records.filter((record) => fs.existsSync(record.filePath))
}

function writePrunedRegistry(registry: NexusDownloadRegistryShape): NexusDownloadRegistryShape {
  const pruned = { records: pruneMissingRecords(registry.records) }
  if (pruned.records.length !== registry.records.length) {
    saveRegistry(pruned)
  }
  return pruned
}

export function findNexusDownloadRecord(modId: number, fileId: number): NexusDownloadRecord | null {
  const registry = writePrunedRegistry(loadRegistry())
  return registry.records.find((record) => record.modId === modId && record.fileId === fileId) ?? null
}

export function findNexusDownloadRecordByPath(filePath: string): NexusDownloadRecord | null {
  const normalizedPath = path.normalize(filePath).toLowerCase()
  const registry = writePrunedRegistry(loadRegistry())
  return registry.records.find((record) => path.normalize(record.filePath).toLowerCase() === normalizedPath) ?? null
}

export function upsertNexusDownloadRecord(record: NexusDownloadRecord): void {
  const registry = writePrunedRegistry(loadRegistry())
  const filtered = registry.records.filter(
    (entry) => path.normalize(entry.filePath).toLowerCase() !== path.normalize(record.filePath).toLowerCase()
  )
  filtered.unshift(record)
  saveRegistry({ records: filtered })
}

export function removeNexusDownloadRecordByPath(filePath: string): void {
  const normalizedPath = path.normalize(filePath).toLowerCase()
  const registry = loadRegistry()
  const nextRecords = registry.records.filter(
    (record) => path.normalize(record.filePath).toLowerCase() !== normalizedPath
  )
  if (nextRecords.length !== registry.records.length) {
    saveRegistry({ records: nextRecords })
  }
}
