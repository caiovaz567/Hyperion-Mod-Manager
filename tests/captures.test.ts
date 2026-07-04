import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureOwnerFolder, sweepOrphanCaptures } from '../src/main/vfsOverwriteCleanup'

describe('captureOwnerFolder - attribution is deliberately narrow', () => {
  it('attributes files inside the strict per-mod slots', () => {
    expect(captureOwnerFolder('bin/x64/plugins/cyber_engine_tweaks/mods/MyMod/db.sqlite3')).toBe(
      'bin/x64/plugins/cyber_engine_tweaks/mods/mymod',
    )
    expect(captureOwnerFolder('red4ext/plugins/Codeware/Persistent/state.json')).toBe(
      'red4ext/plugins/codeware',
    )
  })

  it('folds separators and casing so deploy paths and capture paths meet on one key', () => {
    expect(captureOwnerFolder('bin\\x64\\plugins\\cyber_engine_tweaks\\mods\\MyMod\\settings.json')).toBe(
      'bin/x64/plugins/cyber_engine_tweaks/mods/mymod',
    )
    expect(captureOwnerFolder('RED4EXT/PLUGINS/MyMod/log.txt')).toBe('red4ext/plugins/mymod')
  })

  it('NEVER attributes shared/framework locations to a single mod', () => {
    // Framework root files - many mods write here.
    expect(captureOwnerFolder('bin/x64/plugins/cyber_engine_tweaks/config.json')).toBeNull()
    // A file sitting directly in the mods container has no per-mod slot.
    expect(captureOwnerFolder('bin/x64/plugins/cyber_engine_tweaks/mods/loose.txt')).toBeNull()
    expect(captureOwnerFolder('red4ext/plugins/loose.dll')).toBeNull()
    // Anything outside the recognized roots is unowned.
    expect(captureOwnerFolder('r6/storages/RedscriptConfigFramework/config.json')).toBeNull()
    expect(captureOwnerFolder('r6/logs/redscript.log')).toBeNull()
    expect(captureOwnerFolder('archive/pc/mod/foo.archive')).toBeNull()
  })
})

describe('sweepOrphanCaptures - can only ever delete a deleted mod\'s private folder', () => {
  const created: string[] = []

  function makeOverwrite(files: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-overwrite-'))
    created.push(dir)
    for (const rel of files) {
      const full = path.join(dir, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, 'captured')
    }
    return dir
  }

  afterEach(() => {
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('removes only orphan slot files, keeps live owners and unattributed captures', () => {
    const overwrite = makeOverwrite([
      'bin/x64/plugins/cyber_engine_tweaks/mods/DeletedMod/db.sqlite3',
      'bin/x64/plugins/cyber_engine_tweaks/mods/LiveMod/settings.json',
      'bin/x64/plugins/cyber_engine_tweaks/config.json',
      'r6/logs/game.log',
    ])
    const liveOwners = new Set(['bin/x64/plugins/cyber_engine_tweaks/mods/livemod'])

    const result = sweepOrphanCaptures(overwrite, liveOwners)

    expect(result.removedFiles).toBe(1)
    expect(result.removedOwners).toEqual(['bin/x64/plugins/cyber_engine_tweaks/mods/deletedmod'])
    expect(result.errors).toEqual([])
    // The orphan slot is gone, everything else survives untouched.
    expect(fs.existsSync(path.join(overwrite, 'bin/x64/plugins/cyber_engine_tweaks/mods/DeletedMod'))).toBe(false)
    expect(fs.existsSync(path.join(overwrite, 'bin/x64/plugins/cyber_engine_tweaks/mods/LiveMod/settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(overwrite, 'bin/x64/plugins/cyber_engine_tweaks/config.json'))).toBe(true)
    expect(fs.existsSync(path.join(overwrite, 'r6/logs/game.log'))).toBe(true)
  })

  it('prunes emptied parents but never removes the Overwrite root itself', () => {
    const overwrite = makeOverwrite(['red4ext/plugins/GoneMod/state/deep/x.json'])

    sweepOrphanCaptures(overwrite, new Set())

    expect(fs.existsSync(overwrite)).toBe(true)
    expect(fs.readdirSync(overwrite)).toEqual([])
  })

  it('with no live owners still touches nothing outside per-mod slots', () => {
    const overwrite = makeOverwrite([
      'bin/x64/plugins/cyber_engine_tweaks/mods/loose.txt',
      'r6/storages/Framework/config.json',
      'root-file.ini',
    ])

    const result = sweepOrphanCaptures(overwrite, new Set())

    expect(result.removedFiles).toBe(0)
    expect(fs.existsSync(path.join(overwrite, 'bin/x64/plugins/cyber_engine_tweaks/mods/loose.txt'))).toBe(true)
    expect(fs.existsSync(path.join(overwrite, 'r6/storages/Framework/config.json'))).toBe(true)
    expect(fs.existsSync(path.join(overwrite, 'root-file.ini'))).toBe(true)
  })

  it('handles a missing overwrite folder without throwing', () => {
    const result = sweepOrphanCaptures(path.join(os.tmpdir(), 'hyperion-missing-overwrite'), new Set())
    expect(result).toEqual({ removedFiles: 0, removedBytes: 0, removedOwners: [], errors: [] })
  })
})
