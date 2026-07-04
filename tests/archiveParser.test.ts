import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseRed4Archive } from '../src/main/ipc/archiveParser'

// RED4 .archive layout used by the parser: 44-byte header (magic u32 @0,
// indexPos u64 @8, indexSize u32 @16), then a 28-byte index header
// (fileCount u32 @16) followed by 56-byte records (hash u64 @0).
const HEADER_SIZE = 44
const INDEX_HEADER_SIZE = 28
const RECORD_SIZE = 56
const RDAR_MAGIC = 0x52414452

const created: string[] = []

function writeArchive(bytes: Buffer): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-archive-')), 'test.archive')
  created.push(path.dirname(file))
  fs.writeFileSync(file, bytes)
  return file
}

function buildValidArchive(hashes: bigint[]): Buffer {
  const indexPos = HEADER_SIZE
  const indexSize = INDEX_HEADER_SIZE + hashes.length * RECORD_SIZE
  const buffer = Buffer.alloc(indexPos + indexSize)
  buffer.writeUInt32LE(RDAR_MAGIC, 0)
  buffer.writeBigUInt64LE(BigInt(indexPos), 8)
  buffer.writeUInt32LE(indexSize, 16)
  buffer.writeUInt32LE(hashes.length, indexPos + 16)
  hashes.forEach((hash, index) => {
    buffer.writeBigUInt64LE(hash, indexPos + INDEX_HEADER_SIZE + index * RECORD_SIZE)
  })
  return buffer
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseRed4Archive', () => {
  it('extracts the resource hashes from a well-formed archive', () => {
    const file = writeArchive(buildValidArchive([0x1122334455667788n, 0xdeadbeefcafef00dn]))
    const entries = parseRed4Archive(file)
    expect(entries?.map((entry) => entry.hash)).toEqual([0x1122334455667788n, 0xdeadbeefcafef00dn])
  })

  it('returns null (never throws) for corrupt or hostile inputs', () => {
    const cases: Buffer[] = [
      Buffer.alloc(0), // empty file
      Buffer.from('not an archive at all'), // tiny garbage
      Buffer.alloc(HEADER_SIZE + INDEX_HEADER_SIZE), // right size, wrong magic
      (() => {
        // Valid magic but index points past the end of the file (truncated download).
        const buffer = Buffer.alloc(HEADER_SIZE + INDEX_HEADER_SIZE)
        buffer.writeUInt32LE(RDAR_MAGIC, 0)
        buffer.writeBigUInt64LE(BigInt(999_999), 8)
        buffer.writeUInt32LE(INDEX_HEADER_SIZE, 16)
        return buffer
      })(),
      (() => {
        // Hostile file count (500k+ entries claimed in a tiny index).
        const buffer = buildValidArchive([1n])
        buffer.writeUInt32LE(600_000, HEADER_SIZE + 16)
        return buffer
      })(),
      (() => {
        // File count larger than the declared index can hold.
        const buffer = buildValidArchive([1n])
        buffer.writeUInt32LE(5, HEADER_SIZE + 16)
        return buffer
      })(),
      buildValidArchive([1n]).subarray(0, HEADER_SIZE + 10), // truncated mid-index
      (() => {
        // Zero entries.
        const buffer = buildValidArchive([1n])
        buffer.writeUInt32LE(0, HEADER_SIZE + 16)
        return buffer
      })(),
    ]

    for (const bytes of cases) {
      const file = writeArchive(bytes)
      expect(() => parseRed4Archive(file)).not.toThrow()
      expect(parseRed4Archive(file)).toBeNull()
    }
  })

  it('returns null for a missing file instead of throwing', () => {
    expect(parseRed4Archive(path.join(os.tmpdir(), 'hyperion-nope', 'missing.archive'))).toBeNull()
  })
})
