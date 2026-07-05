import fs from 'fs'
import path from 'path'

// Cyberpunk is vanilla-clean without a `bin/x64/plugins` or `red4ext` folder -
// mod frameworks (CET, RED4ext, ASI loaders) create them. Once a session's files
// are migrated out / removed, an EMPTY framework tree can linger (e.g. an empty
// `cyber_engine_tweaks/mods`) and makes the game folder still look "modded" - a
// stray framework dir can also trip up a vanilla launch. `rmdirSync` only removes
// EMPTY directories, so this can never delete a folder that still holds content
// (a mod the user installed OUTSIDE Hyperion, real files present, is untouched).
export function pruneEmptyDirTree(dir: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // missing or unreadable - nothing to prune
  }
  for (const entry of entries) {
    if (entry.isDirectory()) pruneEmptyDirTree(path.join(dir, entry.name))
  }
  try {
    fs.rmdirSync(dir) // succeeds only if empty after pruning children
  } catch {
    // Still has content, or already gone - leave it be.
  }
}

// The mod-framework roots under the game that should not persist as empty trees.
export function pruneEmptyModFrameworkDirs(gameRoot: string): void {
  if (!gameRoot) return
  for (const relRoot of [path.join('bin', 'x64', 'plugins'), 'red4ext']) {
    pruneEmptyDirTree(path.join(gameRoot, relRoot))
  }
}
