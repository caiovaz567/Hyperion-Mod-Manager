import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneEmptyDirTree, pruneEmptyModFrameworkDirs } from '../src/main/vfsFrameworkCleanup'

const created: string[] = []

function makeGame(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-fwclean-'))
  created.push(root)
  // Vanilla-ish game file so we can prove the exe is never touched.
  fs.mkdirSync(path.join(root, 'bin', 'x64'), { recursive: true })
  fs.writeFileSync(path.join(root, 'bin', 'x64', 'Cyberpunk2077.exe'), 'exe')
  for (const rel of files) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'x')
  }
  return root
}

function makeEmptyDirs(root: string, dirs: string[]): void {
  for (const rel of dirs) fs.mkdirSync(path.join(root, rel), { recursive: true })
}

const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel))

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('pruneEmptyModFrameworkDirs', () => {
  it('removes an emptied framework tree (the reported cyber_engine_tweaks/mods leftover)', () => {
    const game = makeGame([])
    makeEmptyDirs(game, ['bin/x64/plugins/cyber_engine_tweaks/mods/SomeMod'])

    pruneEmptyModFrameworkDirs(game)

    // The whole empty tree - including bin/x64/plugins - is gone...
    expect(exists(game, 'bin/x64/plugins')).toBe(false)
    // ...but the game itself is untouched.
    expect(exists(game, 'bin/x64/Cyberpunk2077.exe')).toBe(true)
    expect(exists(game, 'bin/x64')).toBe(true)
  })

  it('NEVER removes a framework dir that still holds files (e.g. a non-Hyperion tool)', () => {
    const game = makeGame([
      'bin/x64/plugins/OtherLoader/keep.dll',
      'red4ext/plugins/SomePlugin/state.bin',
    ])
    makeEmptyDirs(game, ['bin/x64/plugins/cyber_engine_tweaks/mods/GoneMod'])

    pruneEmptyModFrameworkDirs(game)

    // Empty subtree pruned, but the dirs with real content survive intact.
    expect(exists(game, 'bin/x64/plugins/cyber_engine_tweaks')).toBe(false)
    expect(exists(game, 'bin/x64/plugins/OtherLoader/keep.dll')).toBe(true)
    expect(exists(game, 'red4ext/plugins/SomePlugin/state.bin')).toBe(true)
  })

  it('prunes empty red4ext trees too, and tolerates missing roots', () => {
    const game = makeGame([])
    makeEmptyDirs(game, ['red4ext/plugins/A', 'red4ext/logs'])

    expect(() => pruneEmptyModFrameworkDirs(game)).not.toThrow()
    expect(exists(game, 'red4ext')).toBe(false)

    // A game with no framework folders at all is a no-op, never throws.
    const vanilla = makeGame([])
    expect(() => pruneEmptyModFrameworkDirs(vanilla)).not.toThrow()
    expect(exists(vanilla, 'bin/x64/Cyberpunk2077.exe')).toBe(true)
  })

  it('is a no-op for an empty game root string', () => {
    expect(() => pruneEmptyModFrameworkDirs('')).not.toThrow()
  })

  it('pruneEmptyDirTree keeps a partially-full tree, prunes only the empty branch', () => {
    const game = makeGame(['bin/x64/plugins/Keep/file.txt'])
    makeEmptyDirs(game, ['bin/x64/plugins/EmptyBranch/deep/deeper'])

    pruneEmptyDirTree(path.join(game, 'bin', 'x64', 'plugins'))

    expect(exists(game, 'bin/x64/plugins/EmptyBranch')).toBe(false)
    expect(exists(game, 'bin/x64/plugins/Keep/file.txt')).toBe(true)
  })
})
