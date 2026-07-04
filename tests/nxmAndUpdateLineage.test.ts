import { describe, expect, it } from 'vitest'
import { parseNxmUrl } from '../src/shared/nxm'
import {
  findLatestFileIdInLineage,
  isSupersededCategory,
  pickLatestPrimaryFile,
  pickLatestSameNameFile,
} from '../src/main/ipc/nexusDownloader'

describe('parseNxmUrl', () => {
  it('parses a standard Nexus download link', () => {
    const payload = parseNxmUrl(
      'nxm://cyberpunk2077/mods/1234/files/5678?key=abc123&expires=1719999999&user_id=42',
    )
    expect(payload).toMatchObject({ modId: 1234, fileId: 5678, key: 'abc123', expires: 1719999999, userId: 42 })
  })

  it('accepts surrounding quotes and whitespace (shell-forwarded links)', () => {
    const payload = parseNxmUrl('  "nxm://cyberpunk2077/mods/1/files/2?key=k"  ')
    expect(payload).toMatchObject({ modId: 1, fileId: 2, key: 'k' })
  })

  it('rejects other games, other protocols and malformed links', () => {
    expect(parseNxmUrl('nxm://skyrimspecialedition/mods/1/files/2?key=k')).toBeNull()
    expect(parseNxmUrl('https://cyberpunk2077/mods/1/files/2')).toBeNull()
    expect(parseNxmUrl('nxm://cyberpunk2077/mods/abc/files/2')).toBeNull()
    expect(parseNxmUrl('nxm://cyberpunk2077/mods/0/files/2')).toBeNull()
    expect(parseNxmUrl('nxm://cyberpunk2077/mods/1/notfiles/2')).toBeNull()
    expect(parseNxmUrl('nxm://cyberpunk2077/mods/1')).toBeNull()
    expect(parseNxmUrl('total garbage')).toBeNull()
    expect(parseNxmUrl('')).toBeNull()
  })

  it('defaults missing key/expires/userId instead of failing', () => {
    const payload = parseNxmUrl('nxm://cyberpunk2077/mods/10/files/20')
    expect(payload).toMatchObject({ modId: 10, fileId: 20, key: '', expires: 0, userId: 0 })
  })
})

describe('findLatestFileIdInLineage', () => {
  it('follows the old_file_id -> new_file_id chain to the newest successor', () => {
    const updates = [
      { old_file_id: 100, new_file_id: 200 },
      { old_file_id: 200, new_file_id: 300 },
      { old_file_id: 900, new_file_id: 901 }, // unrelated lineage
    ]
    expect(findLatestFileIdInLineage(updates, 100)).toBe(300)
    expect(findLatestFileIdInLineage(updates, 200)).toBe(300)
  })

  it('returns the same id when the chain has no link', () => {
    expect(findLatestFileIdInLineage([], 100)).toBe(100)
    expect(findLatestFileIdInLineage([{ old_file_id: 1, new_file_id: 2 }], 100)).toBe(100)
  })

  it('survives a cyclic chain instead of hanging', () => {
    const updates = [
      { old_file_id: 1, new_file_id: 2 },
      { old_file_id: 2, new_file_id: 1 },
    ]
    expect(findLatestFileIdInLineage(updates, 1)).toBe(2)
  })
})

describe('pickLatestSameNameFile', () => {
  const installed = { file_id: 1, name: 'Nova LUT Pack', version: '1.4', uploaded_timestamp: 100 }

  it('matches by display name and picks the newest non-superseded upload', () => {
    const files = [
      installed,
      { file_id: 2, name: 'Nova LUT Pack', version: '1.5', uploaded_timestamp: 200 },
      { file_id: 3, name: 'nova lut pack', version: '1.6', uploaded_timestamp: 300 },
      { file_id: 4, name: 'Core', version: '2.5', category_name: 'MAIN', uploaded_timestamp: 999 },
    ]
    // Case-insensitive name lineage; the unrelated MAIN "Core" must never win.
    expect(pickLatestSameNameFile(files, installed)?.file_id).toBe(3)
  })

  it('ignores OLD_VERSION/ARCHIVED/DELETED uploads and empty names', () => {
    const files = [
      installed,
      { file_id: 2, name: 'Nova LUT Pack', category_name: 'OLD_VERSION', uploaded_timestamp: 500 },
    ]
    expect(pickLatestSameNameFile(files, installed)?.file_id).toBe(1)
    expect(pickLatestSameNameFile(files, { file_id: 9, name: '' })).toBeNull()
  })
})

describe('pickLatestPrimaryFile', () => {
  it('prefers the newest MAIN file and skips superseded categories', () => {
    const files = [
      { file_id: 1, name: 'Old', category_name: 'MAIN', uploaded_timestamp: 100 },
      { file_id: 2, name: 'New', category_name: 'MAIN', uploaded_timestamp: 300 },
      { file_id: 3, name: 'Newest but optional', category_name: 'OPTIONAL', uploaded_timestamp: 400 },
      { file_id: 4, name: 'Ancient', category_name: 'OLD_VERSION', uploaded_timestamp: 999 },
    ]
    expect(pickLatestPrimaryFile(files)?.file_id).toBe(2)
  })

  it('falls back to the newest usable file when no MAIN exists, and null for empty lists', () => {
    const files = [
      { file_id: 1, name: 'A', category_name: 'OPTIONAL', uploaded_timestamp: 100 },
      { file_id: 2, name: 'B', category_name: 'OPTIONAL', uploaded_timestamp: 200 },
    ]
    expect(pickLatestPrimaryFile(files)?.file_id).toBe(2)
    expect(pickLatestPrimaryFile([])).toBeNull()
  })
})

describe('isSupersededCategory', () => {
  it('flags OLD_VERSION/ARCHIVED/DELETED in any casing, everything else is live', () => {
    expect(isSupersededCategory({ file_id: 1, category_name: 'OLD_VERSION' })).toBe(true)
    expect(isSupersededCategory({ file_id: 1, category_name: 'archived' })).toBe(true)
    expect(isSupersededCategory({ file_id: 1, category_name: 'Deleted' })).toBe(true)
    expect(isSupersededCategory({ file_id: 1, category_name: 'MAIN' })).toBe(false)
    expect(isSupersededCategory({ file_id: 1 })).toBe(false)
    expect(isSupersededCategory(null)).toBe(false)
  })
})
