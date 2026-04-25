import fs from 'fs'
import path from 'path'
import type { ModType } from '../../shared/types'

const RDAR_MAGIC = 0x52414452
const RED4_MAGIC = 0x34444552
const ARCHIVE_HEADER_SIZE = 44
const FILE_LIST_HEADER_SIZE = 28
const FILE_RECORD_SIZE = 56

interface ArchiveFileEntry {
  hash: bigint
}

function normalizeForDetection(filePath: string): string {
  return filePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
    .toLowerCase()
}

function isRedscriptRuntimePayload(files: string[]): boolean {
  return files.some((file) => (
    file === 'engine/config/base/scripts.ini' ||
    file === 'config/base/scripts.ini' ||
    file === 'engine/tools/scc.exe' ||
    file === 'tools/scc.exe' ||
    file === 'r6/config/cybercmd/scc.toml' ||
    file === 'config/cybercmd/scc.toml'
  ))
}

function looksLikeRootlessEnginePayload(files: string[]): boolean {
  return files.some((file) => (
    file.startsWith('tools/') ||
    file.startsWith('config/base/') ||
    file.startsWith('config/platform/')
  ))
}

function looksLikeRootlessR6Payload(files: string[]): boolean {
  return files.some((file) => (
    file.startsWith('scripts/') ||
    file.startsWith('tweaks/') ||
    file.startsWith('cache/') ||
    file.startsWith('config/cybercmd/')
  ))
}

/**
 * Parses a RED4 .archive file and extracts FNV1a64 hashes of contained resources.
 */
export function parseRed4Archive(
  archivePath: string
): ArchiveFileEntry[] | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(archivePath, 'r')
    const archiveSize = fs.fstatSync(fd).size

    if (archiveSize < ARCHIVE_HEADER_SIZE + FILE_LIST_HEADER_SIZE) return null

    const header = Buffer.alloc(ARCHIVE_HEADER_SIZE)
    fs.readSync(fd, header, 0, ARCHIVE_HEADER_SIZE, 0)

    const magic = header.readUInt32LE(0)
    if (magic !== RDAR_MAGIC && magic !== RED4_MAGIC) return null

    const indexPos = Number(header.readBigUInt64LE(8))
    const indexSize = header.readUInt32LE(16)
    if (
      indexPos <= 0 ||
      indexSize < FILE_LIST_HEADER_SIZE ||
      indexPos + indexSize > archiveSize
    ) {
      return null
    }

    const indexHeader = Buffer.alloc(FILE_LIST_HEADER_SIZE)
    fs.readSync(fd, indexHeader, 0, FILE_LIST_HEADER_SIZE, indexPos)

    const fileCount = indexHeader.readUInt32LE(16)
    if (fileCount === 0 || fileCount > 500_000) return null

    const recordsSize = fileCount * FILE_RECORD_SIZE
    if (FILE_LIST_HEADER_SIZE + recordsSize > indexSize) return null

    const entriesBuf = Buffer.alloc(recordsSize)
    fs.readSync(fd, entriesBuf, 0, recordsSize, indexPos + FILE_LIST_HEADER_SIZE)

    const entries: ArchiveFileEntry[] = []
    for (let i = 0; i < fileCount; i++) {
      const off = i * FILE_RECORD_SIZE
      const hash = entriesBuf.readBigUInt64LE(off)
      entries.push({ hash })
    }

    return entries
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
  }
}

/**
 * Detects the mod type by inspecting the folder structure.
 */
export function detectModType(modDir: string): ModType {
  if (!fs.existsSync(modDir)) return 'unknown'

  const files = getAllFiles(modDir)
  const relativeFiles = files.map((filePath) => normalizeForDetection(path.relative(modDir, filePath)))
  const dirs = getTopLevelDirs(modDir)

  // archive mod: has .archive files in archive/pc/mod or root
  if (relativeFiles.some((f) => f.endsWith('.archive'))) {
    // Check if it also contains mod.json (redmod)
    if (relativeFiles.some((f) => path.basename(f) === 'info.json') && dirs.includes('archives')) {
      return 'redmod'
    }
    return 'archive'
  }

  // redmod: contains info.json + archives/ folder
  if (
    relativeFiles.some((f) => path.basename(f) === 'info.json') &&
    dirs.includes('archives')
  ) {
    return 'redmod'
  }

  // CET: contains init.lua or .lua files in a root folder
  if (relativeFiles.some((f) => f.endsWith('.lua'))) {
    return 'cet'
  }

  // redscript: contains .reds files
  if (relativeFiles.some((f) => f.endsWith('.reds'))) {
    return 'redscript'
  }

  // redscript runtime/framework: ships engine + r6 glue without .reds sources
  if (isRedscriptRuntimePayload(relativeFiles)) {
    return 'redscript'
  }

  // tweakxl: contains .yaml or .yml tweaks
  if (
    relativeFiles.some((f) => f.endsWith('.yaml') || f.endsWith('.yml')) &&
    (modDir.includes('tweaks') || relativeFiles.some((f) => f.includes('tweaks')))
  ) {
    return 'tweakxl'
  }

  // red4ext: contains .dll files and red4ext folder
  if (relativeFiles.some((f) => f.endsWith('.dll')) && dirs.includes('red4ext')) {
    return 'red4ext'
  }

  // bin: contains dlls in bin/x64
  if (relativeFiles.some((f) => f.endsWith('.dll'))) {
    return 'bin'
  }

  // r6: scripts, tweaks, config
  if (dirs.includes('r6') || looksLikeRootlessR6Payload(relativeFiles)) {
    return 'r6'
  }

  // engine
  if (dirs.includes('engine') || looksLikeRootlessEnginePayload(relativeFiles)) {
    return 'engine'
  }

  return 'unknown'
}

function getAllFiles(dir: string, depth = 0): string[] {
  if (depth > 5) return []
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...getAllFiles(full, depth + 1))
      } else {
        results.push(full)
      }
    }
  } catch { /* ignore */ }
  return results
}

function getTopLevelDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name.toLowerCase())
  } catch {
    return []
  }
}
