import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const symlinkAsync = promisify(fs.symlink)
const unlinkAsync = promisify(fs.unlink)
const rmdirAsync = promisify(fs.rmdir)
const mkdirAsync = promisify(fs.mkdir)

/**
 * Creates a file symlink from src to dest, working across drives.
 * On Windows, requires Developer Mode or elevated privileges (EPERM otherwise).
 */
export async function createSymlink(src: string, dest: string): Promise<void> {
  await ensureRealDirectory(path.dirname(dest))
  try {
    fs.lstatSync(dest)
    await unlinkAsync(dest)
  } catch {
    // dest does not exist
  }
  await symlinkAsync(src, dest, 'file')
}

export async function ensureRealDirectory(dirPath: string): Promise<void> {
  try {
    const stat = fs.lstatSync(dirPath)
    if (stat.isSymbolicLink()) {
      await safeRemoveLink(dirPath)
    } else if (stat.isDirectory()) {
      return
    }
  } catch {
    // Path does not exist yet.
  }

  await mkdirAsync(dirPath, { recursive: true })
}

/**
 * Removes a symlink (unlink for files, rmdir for directory-type links from legacy junctions).
 */
export async function safeRemoveLink(linkPath: string): Promise<void> {
  try {
    const stat = fs.lstatSync(linkPath)
    if (stat.isDirectory()) {
      // On Windows junctions are directories
      await rmdirAsync(linkPath)
    } else {
      await unlinkAsync(linkPath)
    }
  } catch {
    // Already gone
  }
}


export function getPathSizeSafe(targetPath: string): number {
  try {
    const stat = fs.lstatSync(targetPath)
    if (stat.isSymbolicLink()) return 0
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0

    let total = 0
    const entries = fs.readdirSync(targetPath, { withFileTypes: true })
    for (const entry of entries) {
      total += getPathSizeSafe(path.join(targetPath, entry.name))
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Recursively lists all files in a directory, returning relative paths.
 */
export function listFilesRecursive(dir: string, baseDir?: string): string[] {
  const base = baseDir ?? dir
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(fullPath)
    } catch {
      continue
    }

    if (stat.isSymbolicLink()) {
      continue
    }

    if (stat.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, base))
    } else {
      results.push(path.relative(base, fullPath))
    }
  }
  return results
}

/**
 * Removes a directory and all its contents.
 */
export function removeDirSync(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Returns true if the given path is a symlink.
 */
export function isLink(p: string): boolean {
  try {
    const stat = fs.lstatSync(p)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

