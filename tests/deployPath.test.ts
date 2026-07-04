import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  getDeployRelativePath,
  getRedmodFolderNames,
  modHasRedmodContent,
  normalizeRelativePath,
} from '../src/main/ipc/modManager'
import type { ModMetadata } from '../src/shared/types'

// Deploy paths use the platform separator internally; compare in forward-slash
// form so the suite passes on both Windows and CI Linux.
const fwd = (value: string) => value.split(path.sep).join('/')
const deploy = (mod: ModMetadata, relFile: string) => fwd(getDeployRelativePath(mod, relFile))

function makeMod(overrides: Partial<ModMetadata> = {}): ModMetadata {
  return {
    uuid: 'test-uuid',
    kind: 'mod',
    name: 'Test Mod',
    folderName: 'TestMod',
    type: 'archive',
    enabled: true,
    order: 1,
    files: [],
    ...overrides,
  } as ModMetadata
}

describe('normalizeRelativePath', () => {
  it('collapses separators and strips . and .. segments', () => {
    expect(fwd(normalizeRelativePath('a\\\\b//c'))).toBe('a/b/c')
    expect(fwd(normalizeRelativePath('./a/../b'))).toBe('a/b')
    expect(fwd(normalizeRelativePath('..\\..\\evil.dll'))).toBe('evil.dll')
    expect(normalizeRelativePath('')).toBe('')
  })
})

describe('getDeployRelativePath - game-root passthrough', () => {
  it('keeps known game-root trees verbatim', () => {
    const mod = makeMod()
    expect(deploy(mod, 'archive/pc/mod/foo.archive')).toBe('archive/pc/mod/foo.archive')
    expect(deploy(mod, 'r6/scripts/foo.reds')).toBe('r6/scripts/foo.reds')
    expect(deploy(mod, 'red4ext/plugins/MyPlugin/mod.dll')).toBe('red4ext/plugins/MyPlugin/mod.dll')
  })

  it('strips wrapper folders above a game-root dir', () => {
    const mod = makeMod()
    expect(deploy(mod, 'SomeWrapper/archive/pc/mod/foo.archive')).toBe('archive/pc/mod/foo.archive')
    expect(deploy(mod, 'v2.1/r6/tweaks/foo.yaml')).toBe('r6/tweaks/foo.yaml')
  })

  it('anchors on bin/x64 wherever it appears', () => {
    const mod = makeMod({ type: 'bin' })
    expect(deploy(mod, 'bin/x64/version.dll')).toBe('bin/x64/version.dll')
    expect(deploy(mod, 'Wrapper/bin/x64/global.ini')).toBe('bin/x64/global.ini')
  })

  it('re-roots cyber_engine_tweaks/mods trees under bin/x64/plugins', () => {
    const mod = makeMod({ type: 'cet' })
    expect(deploy(mod, 'cyber_engine_tweaks/mods/coolmod/init.lua')).toBe(
      'bin/x64/plugins/cyber_engine_tweaks/mods/coolmod/init.lua',
    )
  })

  it('re-roots a bare plugins/ tree under bin/x64 (red4ext parent stays put)', () => {
    const mod = makeMod({ type: 'archive' })
    expect(deploy(mod, 'plugins/tool.asi')).toBe('bin/x64/plugins/tool.asi')
    expect(deploy(mod, 'Wrapper/red4ext/plugins/Thing/thing.dll')).toBe('red4ext/plugins/Thing/thing.dll')
  })
})

describe('getDeployRelativePath - extension fallbacks', () => {
  it('routes loose files by extension', () => {
    const mod = makeMod({ type: 'archive', folderName: 'MyMod' })
    expect(deploy(mod, 'foo.archive')).toBe('archive/pc/mod/foo.archive')
    expect(deploy(mod, 'foo.xl')).toBe('archive/pc/mod/foo.xl')
    expect(deploy(makeMod({ type: 'redscript' }), 'foo.reds')).toBe('r6/scripts/foo.reds')
    // For a typed 'bin' mod the legacy re-root wins over the .asi plugins fallback.
    expect(deploy(makeMod({ type: 'bin' }), 'loader.asi')).toBe('bin/x64/loader.asi')
    expect(deploy(makeMod({ type: 'archive' }), 'plugin.asi')).toBe('bin/x64/plugins/plugin.asi')
    expect(deploy(makeMod({ type: 'bin' }), 'input.dll')).toBe('bin/x64/input.dll')
  })

  it('routes .lua into the mod\'s own CET slot', () => {
    const mod = makeMod({ type: 'cet', folderName: 'CoolMod' })
    expect(deploy(mod, 'init.lua')).toBe('bin/x64/plugins/cyber_engine_tweaks/mods/CoolMod/init.lua')
  })

  it('re-roots red4ext-typed payloads under red4ext/', () => {
    const mod = makeMod({ type: 'red4ext', folderName: 'MyPlugin' })
    // Realistic red4ext mods ship a plugins/ tree (detectModType requires the
    // red4ext dir); the legacy re-root prefixes it with the missing root.
    expect(deploy(mod, 'plugins/MyPlugin/myplugin.dll')).toBe('red4ext/plugins/MyPlugin/myplugin.dll')
    expect(deploy(mod, 'myplugin.dll')).toBe('red4ext/myplugin.dll')
  })

  it('never lets .. survive into a deploy path', () => {
    const mod = makeMod({ type: 'bin' })
    const result = deploy(mod, '../../bin/x64/evil.dll')
    expect(result).not.toContain('..')
    expect(result).toBe('bin/x64/evil.dll')
  })
})

describe('getDeployRelativePath - legacy flattened layouts', () => {
  it('re-roots engine/r6/red4ext payloads shipped without their root', () => {
    expect(deploy(makeMod({ type: 'engine' }), 'config/base/general.ini')).toBe('engine/config/base/general.ini')
    expect(deploy(makeMod({ type: 'redscript' }), 'scripts/mod/main.reds')).toBe('r6/scripts/mod/main.reds')
    expect(deploy(makeMod({ type: 'redscript' }), 'tools/redscript/x.dat')).toBe('engine/tools/redscript/x.dat')
    expect(deploy(makeMod({ type: 'bin' }), 'x64/tool.exe')).toBe('bin/x64/tool.exe')
  })
})

describe('getDeployRelativePath - REDmod', () => {
  it('wraps a flat REDmod (top-level info.json + payload dirs) in its library folder', () => {
    const mod = makeMod({
      type: 'redmod',
      folderName: 'CoolRedmod',
      files: ['info.json', 'archives/cool.archive', 'scripts/exec/cool.script'],
    })
    expect(deploy(mod, 'info.json')).toBe('mods/CoolRedmod/info.json')
    expect(deploy(mod, 'archives/cool.archive')).toBe('mods/CoolRedmod/archives/cool.archive')
    expect(deploy(mod, 'scripts/exec/cool.script')).toBe('mods/CoolRedmod/scripts/exec/cool.script')
  })

  it('preserves the author folder for a nested REDmod (<Dir>/info.json present)', () => {
    const mod = makeMod({
      type: 'redmod',
      folderName: 'InfiniteWeight-Wrapper',
      files: ['InfiniteWeight/info.json', 'InfiniteWeight/tweaks/base/weight.tweak'],
    })
    // The author's mod id must survive: redMod only reads mods/<x>/info.json.
    expect(deploy(mod, 'InfiniteWeight/info.json')).toBe('mods/InfiniteWeight/info.json')
    expect(deploy(mod, 'InfiniteWeight/tweaks/base/weight.tweak')).toBe(
      'mods/InfiniteWeight/tweaks/base/weight.tweak',
    )
  })

  it('keeps an explicit mods/ tree verbatim', () => {
    const mod = makeMod({ type: 'redmod', folderName: 'Any' })
    expect(deploy(mod, 'mods/AuthorMod/info.json')).toBe('mods/AuthorMod/info.json')
  })
})

describe('REDmod helpers', () => {
  it('modHasRedmodContent keys off deployed mods/ paths', () => {
    const redmod = makeMod({ type: 'redmod', folderName: 'R', files: ['info.json', 'archives/a.archive'] })
    const plain = makeMod({ type: 'archive', files: ['foo.archive'] })
    expect(modHasRedmodContent(redmod)).toBe(true)
    expect(modHasRedmodContent(plain)).toBe(false)
  })

  it('getRedmodFolderNames lists unique first-level mods/ folders in file order', () => {
    const mod = makeMod({
      type: 'redmod',
      folderName: 'Wrapper',
      files: [
        'ModB/info.json',
        'ModB/archives/b.archive',
        'ModA/info.json',
        'moda/archives/dup-case.archive',
      ],
    })
    expect(getRedmodFolderNames(mod)).toEqual(['ModB', 'ModA'])
  })
})
