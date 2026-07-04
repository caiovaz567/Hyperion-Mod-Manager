import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractVersionFromName,
  normalizeModName,
  parseMetaIniNexusInfo,
  sanitizeFolderName,
  shouldPreserveArchiveRootFolder,
  uniqueDisplayName,
  uniqueFolderName,
} from '../src/main/ipc/installer'
import type { ModMetadata } from '../src/shared/types'

describe('sanitizeFolderName', () => {
  it('strips only filesystem-invalid characters, preserving spaces and hyphens', () => {
    expect(sanitizeFolderName('Cool Mod - HD Textures')).toBe('Cool Mod - HD Textures')
    expect(sanitizeFolderName('Mod: The "Best" <One>?')).toBe('Mod The Best One')
    expect(sanitizeFolderName('a/b\\c|d*e')).toBe('abcde')
  })

  it('never returns an empty or dot-trailing name (both break Windows folders)', () => {
    expect(sanitizeFolderName('')).toBe('mod')
    expect(sanitizeFolderName('???')).toBe('mod')
    expect(sanitizeFolderName('Mod v2...')).toBe('Mod v2')
  })

  it('caps length at 80 characters', () => {
    expect(sanitizeFolderName('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})

describe('uniqueFolderName / uniqueDisplayName', () => {
  const created: string[] = []
  afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('suffixes the folder name until it does not collide on disk', () => {
    const library = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-lib-'))
    created.push(library)
    fs.mkdirSync(path.join(library, 'Cool Mod'))
    fs.mkdirSync(path.join(library, 'Cool Mod_1'))

    expect(uniqueFolderName(library, 'Cool Mod')).toBe('Cool Mod_2')
    expect(uniqueFolderName(library, 'Fresh Mod')).toBe('Fresh Mod')
  })

  it('suffixes display names case-insensitively with Copy counters', () => {
    const mods = [{ name: 'Cool Mod' }, { name: 'cool mod copy' }] as ModMetadata[]
    expect(uniqueDisplayName(mods, 'Cool Mod')).toBe('Cool Mod Copy 2')
    expect(uniqueDisplayName(mods, 'Other Mod')).toBe('Other Mod')
  })
})

describe('shouldPreserveArchiveRootFolder', () => {
  it('protects real game-root folders from being flattened during extraction', () => {
    for (const dir of ['archive', 'Archives', 'bin', 'engine', 'mods', 'r6', 'RED4ext', ' r6 ']) {
      expect(shouldPreserveArchiveRootFolder(dir)).toBe(true)
    }
    expect(shouldPreserveArchiveRootFolder('MyWrapperFolder')).toBe(false)
    expect(shouldPreserveArchiveRootFolder('fomod')).toBe(false)
  })
})

describe('extractVersionFromName / normalizeModName', () => {
  it('pulls trailing version tokens out of archive names', () => {
    expect(extractVersionFromName('Cool Mod-2-1-0')).toBe('2.1.0')
    expect(extractVersionFromName('Cool Mod v1.5')).toBe('1.5')
    expect(extractVersionFromName('Cool Mod')).toBeUndefined()
  })

  it('normalizes underscores and bracketed noise in mod names', () => {
    expect(normalizeModName('Cool_Mod_HD [4K] (from Nexus)')).toContain('Cool Mod HD')
  })

  it('strips the Nexus manual-download id/version/hash tail', () => {
    expect(normalizeModName('Rosemary Winters - Hair Pack 31149 1.0 n1B61wYbu')).toBe('Rosemary Winters - Hair Pack')
    expect(normalizeModName('Better Housing Buffs 6181 0.3 aB12cD34')).toBe('Better Housing Buffs')
    // A real name that merely ends in a number must NOT be clipped.
    expect(normalizeModName('Cyberpunk 2077 HD Reworked Project')).toBe('Cyberpunk 2077 HD Reworked Project')
    expect(normalizeModName('E3 Window')).toBe('E3 Window')
  })
})

describe('parseMetaIniNexusInfo', () => {
  it('reads modid/fileid/version from a typical MO2-style meta.ini', () => {
    const ini = [
      '[General]',
      'modid=3993',
      'version="2.16.1"',
      'repository=Nexus',
      '[installedFiles]',
      '1\\modid=3993',
      '1\\fileid=12345',
    ].join('\r\n')
    expect(parseMetaIniNexusInfo(ini)).toEqual({ modId: 3993, fileId: 12345, version: '2.16.1' })
  })

  it('requires a usable mod id and tolerates comments/garbage without throwing', () => {
    expect(parseMetaIniNexusInfo('[General]\nrepository=Nexus\nversion=1.0')).toBeNull()
    expect(parseMetaIniNexusInfo('modid=abc\nfileid=-5')).toBeNull()
    expect(parseMetaIniNexusInfo('; just a comment\n\n===garbage===')).toBeNull()
    expect(parseMetaIniNexusInfo('')).toBeNull()
  })

  it('strips a leading v from versions and keeps the first ids seen', () => {
    const ini = 'modid=10\nversion=v3.2\n1\\modid=99\nfileid=7'
    expect(parseMetaIniNexusInfo(ini)).toEqual({ modId: 10, fileId: 7, version: '3.2' })
  })
})
