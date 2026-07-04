import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findNexusDownloadRecord,
  findNexusDownloadRecordByPath,
  removeNexusDownloadRecordByPath,
  upsertNexusDownloadRecord,
  type NexusDownloadRecord,
} from '../src/main/nexusDownloadRegistry'

// The registry persists to the electron-stub userData dir and caches in memory.
// Tests share that store, so every test uses its own temp archive dir and unique
// mod/file ids - lookups can never collide across tests or runs.
let nextId = Date.now() % 1_000_000_000

const created: string[] = []

function makeArchive(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-registry-'))
  created.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, 'archive-bytes')
  return file
}

function makeRecord(filePath: string, overrides: Partial<NexusDownloadRecord> = {}): NexusDownloadRecord {
  nextId += 1
  return {
    modId: nextId,
    fileId: nextId * 10,
    filePath,
    fileName: path.basename(filePath),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('nexusDownloadRegistry', () => {
  it('upserts and finds records by id pair and by path (case/separator-insensitive)', () => {
    const file = makeArchive('Cool Mod-1-2-0.zip')
    const record = makeRecord(file, { version: '1.2.0', displayName: 'Cool Mod' })

    upsertNexusDownloadRecord(record)

    expect(findNexusDownloadRecord(record.modId, record.fileId)).toMatchObject({
      filePath: file,
      version: '1.2.0',
      displayName: 'Cool Mod',
    })
    expect(findNexusDownloadRecordByPath(file.toUpperCase())?.modId).toBe(record.modId)
    expect(findNexusDownloadRecordByPath(path.join(os.tmpdir(), 'other.zip'))).toBeNull()
  })

  it('re-upserting the same path replaces the record instead of duplicating it', () => {
    const file = makeArchive('mod.zip')
    const first = makeRecord(file, { version: '1.0' })
    upsertNexusDownloadRecord(first)
    const second = makeRecord(file, { version: '2.0' })
    upsertNexusDownloadRecord(second)

    expect(findNexusDownloadRecordByPath(file)?.version).toBe('2.0')
    expect(findNexusDownloadRecord(first.modId, first.fileId)).toBeNull()
  })

  it('an id lookup skips records whose archive was deleted outside the app', () => {
    const file = makeArchive('deleted-later.zip')
    const record = makeRecord(file)
    upsertNexusDownloadRecord(record)

    fs.rmSync(file)

    // The dead record must not count as an existing duplicate download.
    expect(findNexusDownloadRecord(record.modId, record.fileId)).toBeNull()
  })

  it('removing by path forgets the record', () => {
    const file = makeArchive('to-remove.zip')
    const record = makeRecord(file)
    upsertNexusDownloadRecord(record)

    removeNexusDownloadRecordByPath(file)

    expect(findNexusDownloadRecordByPath(file)).toBeNull()
    expect(findNexusDownloadRecord(record.modId, record.fileId)).toBeNull()
  })

  it('keeps distinct versions of the same mod at different paths', () => {
    const fileA = makeArchive('mod-v1.zip')
    const fileB = makeArchive('mod-v2.zip')
    nextId += 1
    const modId = nextId
    upsertNexusDownloadRecord(makeRecord(fileA, { modId, fileId: 1001, version: '1.0' }))
    upsertNexusDownloadRecord(makeRecord(fileB, { modId, fileId: 1002, version: '2.0' }))

    expect(findNexusDownloadRecordByPath(fileA)?.version).toBe('1.0')
    expect(findNexusDownloadRecordByPath(fileB)?.version).toBe('2.0')
  })
})
