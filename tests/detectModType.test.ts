import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectModType } from '../src/main/ipc/archiveParser'

// detectModType inspects a real folder; each case builds a throwaway fixture tree.
const created: string[] = []

function makeFixture(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperion-modtype-'))
  created.push(dir)
  for (const rel of files) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'x')
  }
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('detectModType - REDmod layouts', () => {
  it('detects a flat REDmod (top-level info.json + archives/)', () => {
    expect(detectModType(makeFixture(['info.json', 'archives/cool.archive']))).toBe('redmod')
  })

  it('detects payload-dir variants: scripts-only, tweaks-only, sounds-only', () => {
    expect(detectModType(makeFixture(['info.json', 'scripts/exec/x.script']))).toBe('redmod')
    expect(detectModType(makeFixture(['info.json', 'tweaks/base/x.tweak']))).toBe('redmod')
    expect(detectModType(makeFixture(['info.json', 'sounds/x.wav']))).toBe('redmod')
  })

  it('detects a nested REDmod (every top-level dir has its own info.json)', () => {
    expect(
      detectModType(makeFixture(['InfiniteWeight/info.json', 'InfiniteWeight/tweaks/base/w.tweak'])),
    ).toBe('redmod')
    expect(
      detectModType(
        makeFixture(['ModA/info.json', 'ModA/archives/a.archive', 'ModB/info.json', 'ModB/scripts/b.script']),
      ),
    ).toBe('redmod')
  })

  it('does NOT treat a hybrid archive (REDmod dir + game-root dir) as nested REDmod', () => {
    const dir = makeFixture(['MyRedmod/info.json', 'MyRedmod/archives/a.archive', 'r6/scripts/x.reds'])
    expect(detectModType(dir)).not.toBe('redmod')
  })

  it('is NOT tripped by the nested info.json every CET mod carries', () => {
    const dir = makeFixture([
      'bin/x64/plugins/cyber_engine_tweaks/mods/coolmod/info.json',
      'bin/x64/plugins/cyber_engine_tweaks/mods/coolmod/init.lua',
    ])
    expect(detectModType(dir)).toBe('cet')
  })
})

describe('detectModType - other types', () => {
  it('detects plain archive mods (with or without the full tree)', () => {
    expect(detectModType(makeFixture(['foo.archive']))).toBe('archive')
    expect(detectModType(makeFixture(['archive/pc/mod/foo.archive']))).toBe('archive')
  })

  it('detects CET, redscript and tweakxl payloads', () => {
    expect(detectModType(makeFixture(['coolmod/init.lua']))).toBe('cet')
    expect(detectModType(makeFixture(['scripts/main.reds']))).toBe('redscript')
    expect(detectModType(makeFixture(['r6/tweaks/mymod/x.yaml']))).toBe('tweakxl')
  })

  it('detects red4ext (dll + red4ext dir) vs generic bin (loose dll)', () => {
    expect(detectModType(makeFixture(['red4ext/plugins/Thing/thing.dll']))).toBe('red4ext')
    expect(detectModType(makeFixture(['bin/x64/tool.dll']))).toBe('bin')
  })

  it('detects r6 and engine root payloads', () => {
    expect(detectModType(makeFixture(['r6/config/x.xml']))).toBe('r6')
    expect(detectModType(makeFixture(['engine/config/base/x.ini']))).toBe('engine')
  })

  it('returns unknown for empty or missing folders instead of throwing', () => {
    expect(detectModType(makeFixture([]))).toBe('unknown')
    expect(detectModType(path.join(os.tmpdir(), 'hyperion-does-not-exist-xyz'))).toBe('unknown')
  })
})
