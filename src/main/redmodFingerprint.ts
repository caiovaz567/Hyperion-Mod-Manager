import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ModMetadata } from '@shared/types'

// Files a game patch replaces and nothing at runtime writes to. Their size and
// modified time identify the installed build without knowing any version number,
// so a patch (or a rollback) is picked up with no Hyperion update.
const GAME_BUILD_FILES = [
  path.join('bin', 'x64', 'Cyberpunk2077.exe'),
  path.join('tools', 'redmod', 'bin', 'redMod.exe'),
]

export function readGameBuildIdentity(gameRoot: string): string {
  return GAME_BUILD_FILES.map((relPath) => {
    try {
      const stat = fs.statSync(path.join(gameRoot, relPath))
      return `${stat.size}:${stat.mtimeMs}`
    } catch {
      return 'missing'
    }
  }).join('|')
}

// Identity of a REDmod deploy: the game build it compiled against, which mods,
// whether their payload changed (size/count/source timestamps), and the resolved
// `-mod=` load order - a patch or a pure reorder must trigger a redeploy because
// the compiled output depends on them.
export function computeRedmodFingerprint(
  enabledRedmods: ModMetadata[],
  orderedModNames: string[],
  gameBuild: string
): string {
  const identity = {
    gameBuild,
    mods: enabledRedmods
      .map((mod) => ({
        folder: (mod.folderName ?? mod.uuid).toLowerCase(),
        size: mod.fileSize ?? 0,
        count: Array.isArray(mod.files) ? mod.files.length : 0,
        stamp: mod.sourceModifiedAt ?? mod.installedAt ?? '',
      }))
      .sort((left, right) => left.folder.localeCompare(right.folder)),
    order: orderedModNames.map((name) => name.toLowerCase()),
  }
  return crypto.createHash('sha1').update(JSON.stringify(identity)).digest('hex')
}
