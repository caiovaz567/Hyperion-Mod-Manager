import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModMetadata } from '../src/shared/types'
import { computeRedmodFingerprint, readGameBuildIdentity } from '../src/main/redmodFingerprint'

const created: string[] = []

function makeGame(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-redmodfp-'))
  created.push(root)
  fs.mkdirSync(path.join(root, 'bin', 'x64'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tools', 'redmod', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(root, 'bin', 'x64', 'Cyberpunk2077.exe'), 'game')
  fs.writeFileSync(path.join(root, 'tools', 'redmod', 'bin', 'redMod.exe'), 'tool')
  return root
}

const mod = { uuid: 'u1', folderName: 'Mod', fileSize: 10, files: ['a'], installedAt: 't' } as unknown as ModMetadata

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('readGameBuildIdentity', () => {
  it('stays the same when the game files are untouched', () => {
    const root = makeGame()
    expect(readGameBuildIdentity(root)).toBe(readGameBuildIdentity(root))
  })

  it('changes when a patch replaces the game exe', () => {
    const root = makeGame()
    const before = readGameBuildIdentity(root)
    fs.writeFileSync(path.join(root, 'bin', 'x64', 'Cyberpunk2077.exe'), 'patched game')
    expect(readGameBuildIdentity(root)).not.toBe(before)
  })

  it('changes when a patch replaces only the REDmod tool', () => {
    const root = makeGame()
    const before = readGameBuildIdentity(root)
    fs.writeFileSync(path.join(root, 'tools', 'redmod', 'bin', 'redMod.exe'), 'patched tool')
    expect(readGameBuildIdentity(root)).not.toBe(before)
  })

  it('does not throw when the REDmod tool is missing', () => {
    const root = makeGame()
    fs.rmSync(path.join(root, 'tools'), { recursive: true })
    expect(readGameBuildIdentity(root)).toContain('missing')
  })
})

describe('computeRedmodFingerprint', () => {
  it('is stable for the same mods, order and game build', () => {
    expect(computeRedmodFingerprint([mod], ['Mod'], 'b1')).toBe(computeRedmodFingerprint([mod], ['Mod'], 'b1'))
  })

  it('changes when the game build changes, with the mods untouched', () => {
    expect(computeRedmodFingerprint([mod], ['Mod'], 'b2')).not.toBe(computeRedmodFingerprint([mod], ['Mod'], 'b1'))
  })

  it('changes on a pure load-order change', () => {
    expect(computeRedmodFingerprint([mod], ['A', 'B'], 'b1')).not.toBe(computeRedmodFingerprint([mod], ['B', 'A'], 'b1'))
  })
})
