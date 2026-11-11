import { describe, expect, it } from 'vitest'
import { isHyperionStagedEntry, mergeStagedBootstrapEntries, type BootstrapStageEntry } from '../src/main/bootstrapStaging'

function entry(dest: string, status: BootstrapStageEntry['status']): BootstrapStageEntry {
  return { source: `lib\\${dest}`, dest: `C:\\Game\\${dest}`, deployPath: dest, status }
}

describe('isHyperionStagedEntry', () => {
  it('treats copied and already-present loaders as Hyperion\'s own', () => {
    expect(isHyperionStagedEntry(entry('bin\\x64\\version.dll', 'copied'))).toBe(true)
    expect(isHyperionStagedEntry(entry('bin\\x64\\version.dll', 'already-present'))).toBe(true)
  })

  it('never claims a file the user owns or one that failed to stage', () => {
    expect(isHyperionStagedEntry(entry('bin\\x64\\version.dll', 'existing-kept'))).toBe(false)
    expect(isHyperionStagedEntry(entry('bin\\x64\\version.dll', 'error'))).toBe(false)
    expect(isHyperionStagedEntry(undefined)).toBe(false)
  })
})

describe('mergeStagedBootstrapEntries', () => {
  it('keeps already-present loaders so they are removed on game exit', () => {
    const merged = mergeStagedBootstrapEntries(undefined, [
      entry('bin\\x64\\plugins\\cyber_engine_tweaks.asi', 'already-present'),
      entry('bin\\x64\\version.dll', 'copied'),
    ])
    expect(merged.map((item) => item.status).sort()).toEqual(['already-present', 'copied'])
  })

  it('drops files the user owns and failed entries', () => {
    const merged = mergeStagedBootstrapEntries(undefined, [
      entry('bin\\x64\\winmm.dll', 'existing-kept'),
      entry('bin\\x64\\global.ini', 'error'),
    ])
    expect(merged).toEqual([])
  })

  it('folds a leftover manifest in, one entry per destination', () => {
    const merged = mergeStagedBootstrapEntries(
      [entry('bin\\x64\\version.dll', 'copied'), entry('red4ext\\RED4ext.dll', 'copied')],
      [entry('BIN\\X64\\VERSION.DLL', 'already-present')],
    )
    expect(merged).toHaveLength(2)
    expect(merged.find((item) => item.deployPath.toLowerCase() === 'bin\\x64\\version.dll')?.status).toBe('already-present')
  })
})
