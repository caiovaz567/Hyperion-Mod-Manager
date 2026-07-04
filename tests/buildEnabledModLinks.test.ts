import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildEnabledModLinks } from '../src/main/ipc/modManager'
import type { ModMetadata } from '../src/shared/types'

// buildEnabledModLinks is the deployment contract: the ordered VFS mounts that
// realize "higher load order wins". It stats real files, so fixtures live on disk.
const created: string[] = []

function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

function writeModFiles(libraryPath: string, folderName: string, files: string[]): void {
  for (const rel of files) {
    const full = path.join(libraryPath, folderName, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'payload')
  }
}

function makeMod(overrides: Partial<ModMetadata>): ModMetadata {
  return {
    uuid: `uuid-${overrides.folderName}`,
    kind: 'mod',
    name: overrides.folderName,
    type: 'archive',
    enabled: true,
    order: 1,
    files: [],
    ...overrides,
  } as ModMetadata
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('buildEnabledModLinks', () => {
  it('builds ordered mounts for enabled mods only, skipping bookkeeping and missing files', async () => {
    const library = makeDir('hyperion-vfslib-')
    const game = makeDir('hyperion-vfsgame-')

    writeModFiles(library, 'Mod A', ['r6/scripts/shared.reds', '_metadata.json'])
    writeModFiles(library, 'Mod B', ['r6/scripts/other.reds'])
    writeModFiles(library, 'Mod C', ['r6/scripts/shared.reds'])

    const mods = [
      makeMod({ folderName: 'Mod A', order: 1, type: 'redscript', files: ['r6/scripts/shared.reds', '_metadata.json', 'ghost.reds'] }),
      makeMod({ folderName: 'Mod B', order: 2, type: 'redscript', enabled: false, files: ['r6/scripts/other.reds'] }),
      makeMod({ folderName: 'Mod C', order: 3, type: 'redscript', files: ['r6/scripts/shared.reds'] }),
    ]

    const links = await buildEnabledModLinks(game, library, mods)

    // One recursive dir mount per enabled mod: modDir/r6 -> game/r6.
    const dirMounts = links.filter((link) => link.dir)
    expect(dirMounts).toEqual([
      { source: path.join(library, 'Mod A', 'r6'), dest: path.join(game, 'r6'), dir: true },
      { source: path.join(library, 'Mod C', 'r6'), dest: path.join(game, 'r6'), dir: true },
    ])

    // Load order: Mod C (higher #) mounts AFTER Mod A so it wins on shared paths.
    expect(dirMounts[1].source).toContain('Mod C')

    // Disabled Mod B contributes nothing; bookkeeping/missing files never link.
    expect(links.some((link) => link.source.includes('Mod B'))).toBe(false)
    expect(links.some((link) => link.source.includes('_metadata.json'))).toBe(false)
    expect(links.some((link) => link.source.includes('ghost'))).toBe(false)
  })

  it('gives load-ordered virtual names to root .archive files (higher order sorts first)', async () => {
    const library = makeDir('hyperion-vfslib-')
    const game = makeDir('hyperion-vfsgame-')

    writeModFiles(library, 'Low Mod', ['low.archive'])
    writeModFiles(library, 'High Mod', ['high.archive'])

    const mods = [
      makeMod({ folderName: 'Low Mod', order: 1, files: ['low.archive'] }),
      makeMod({ folderName: 'High Mod', order: 7, files: ['high.archive'] }),
    ]

    const links = await buildEnabledModLinks(game, library, mods)

    const fileLinks = links.filter((link) => !link.dir)
    expect(fileLinks).toHaveLength(2)

    const lowName = path.basename(fileLinks.find((link) => link.source.includes('Low Mod'))!.dest)
    const highName = path.basename(fileLinks.find((link) => link.source.includes('High Mod'))!.dest)

    // Cyberpunk resolves same-resource archives by filename order (earlier wins),
    // so the higher-# mod must receive the alphabetically earlier virtual name.
    expect(lowName.startsWith('!')).toBe(true)
    expect(highName.startsWith('!')).toBe(true)
    expect(highName < lowName).toBe(true)
    expect(lowName.endsWith('.archive')).toBe(true)

    // Both destinations land in archive/pc/mod, whose parent dir is materialized
    // exactly once from the shared empty dir (usvfs fails repeated identical links).
    for (const link of fileLinks) {
      expect(path.dirname(link.dest)).toBe(path.join(game, 'archive', 'pc', 'mod'))
    }
    const materializations = links.filter(
      (link) => link.dir && link.dest === path.join(game, 'archive', 'pc', 'mod'),
    )
    expect(materializations).toHaveLength(1)
  })

  it('returns an empty plan when the game path is not set', async () => {
    const library = makeDir('hyperion-vfslib-')
    expect(await buildEnabledModLinks('', library, [])).toEqual([])
  })
})
