import fs from 'fs'
import path from 'path'

// Mirrors VFS_OVERWRITE_DIR_NAME in index.ts. The Runtime Captures folder is the
// "Overwrite" sibling beside the Mod Library, holding files mod tools wrote into
// the game at runtime (CET settings, red4ext plugin state, etc.). Like MO2's
// Overwrite, it is a single always-mounted catch-all — Hyperion never moves captures
// around based on enable/disable state. The ONLY automatic cleanup is removing a
// deleted mod's own leftovers (below), and even that is limited to the mod's private
// per-mod folder so it can never disturb another mod's data.
export const VFS_OVERWRITE_DIR_NAME = 'Overwrite'

// Roots under which each immediate child folder is a single mod's private namespace
// (one-folder-per-mod convention). A capture inside `<root>/<folder>/…` belongs to
// whatever mod deploys `<root>/<folder>`. Deliberately NARROW and limited to these
// strict per-mod slots — a framework's own root folder (e.g. `cyber_engine_tweaks`
// itself) is intentionally NOT attributed to any single mod, because many mods write
// shared files there. Anything outside a per-mod slot is left untouched.
const PER_MOD_SLOT_ROOTS = [
  'bin/x64/plugins/cyber_engine_tweaks/mods',
  'red4ext/plugins',
]

function normalizeForwardLower(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

// The per-mod slot folder for a deploy/capture relative path, or null when the path
// is not inside a recognized per-mod slot (those are never attributed to a single
// mod and are always kept). Keys are lowercased + forward-slashed so a deploy path
// and a capture path for the same mod fold to the same key on the case-insensitive
// Windows filesystem.
export function captureOwnerFolder(relPath: string): string | null {
  const norm = normalizeForwardLower(relPath)
  for (const root of PER_MOD_SLOT_ROOTS) {
    const prefix = `${root}/`
    if (!norm.startsWith(prefix)) continue
    const rest = norm.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) return null // a file sitting directly in the container has no per-mod slot
    return `${root}/${rest.slice(0, slash)}`
  }
  return null
}

export interface OverwriteSweepResult {
  removedFiles: number
  removedBytes: number
  removedOwners: string[]
  errors: string[]
}

// Removes captured runtime files whose per-mod slot folder is NOT in liveOwners (no
// installed mod owns it). Files outside any recognized per-mod slot are always kept
// — including everything at the root of a framework folder — so this can only ever
// delete leftovers in a deleted mod's own private folder. liveOwners keys must come
// from captureOwnerFolder() so casing and separators line up.
export function sweepOrphanCaptures(overwritePath: string, liveOwners: Set<string>): OverwriteSweepResult {
  const result: OverwriteSweepResult = { removedFiles: 0, removedBytes: 0, removedOwners: [], errors: [] }
  if (!overwritePath || !fs.existsSync(overwritePath)) return result

  const resolvedRoot = path.resolve(overwritePath)
  const removedOwners = new Set<string>()

  for (const filePath of collectFilesRecursive(resolvedRoot)) {
    const relFile = path.relative(resolvedRoot, filePath)
    const owner = captureOwnerFolder(relFile)
    if (!owner || liveOwners.has(owner)) continue

    try {
      const stat = fs.statSync(filePath)
      fs.rmSync(filePath, { force: true })
      result.removedFiles += 1
      result.removedBytes += stat.size
      removedOwners.add(owner)
      removeEmptyParentDirs(path.dirname(filePath), resolvedRoot)
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  result.removedOwners = [...removedOwners]
  return result
}

// libraryPath -> the Overwrite folder beside the Mod Library (its sibling under the
// Hyperion managed root). Returns null for an empty libraryPath so callers skip
// cleanup instead of touching the wrong folder. MUST stay in sync with
// getVfsOverwritePath in index.ts.
export function getOverwritePathForLibrary(libraryPath: string): string | null {
  const normalized = libraryPath?.trim() ? path.normalize(libraryPath.trim()) : ''
  if (!normalized) return null
  const parent = path.dirname(normalized)
  if (!parent || parent === normalized) return null
  return path.join(parent, VFS_OVERWRITE_DIR_NAME)
}

// ─── Local fs helpers (self-contained to avoid cross-module coupling) ──────────

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function collectFilesRecursive(rootDir: string): string[] {
  const files: string[] = []

  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.isFile()) {
        files.push(entryPath)
      }
    }
  }

  walk(rootDir)
  return files
}

// Prunes now-empty folders from startDir upward, stopping before stopRoot so the
// Overwrite root itself is never removed (it must persist for the next launch).
function removeEmptyParentDirs(startDir: string, stopRoot: string): void {
  let current = path.resolve(startDir)
  const stop = path.resolve(stopRoot)

  while (current !== stop && isInsidePath(current, stop)) {
    try {
      fs.rmdirSync(current)
    } catch {
      break
    }
    current = path.dirname(current)
  }
}
