import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type { ModMetadata, IpcResult, PurgeModsResult } from '../../shared/types'
import { pushGeneralLog } from '../logStore'
import { loadSettings } from '../settings'
import { detectModType } from './archiveParser'
import {
  listFilesRecursive,
  getPathSizeSafe,
  ensureRealDirectory,
  safeRemoveLink,
  isLink,
} from '../fileUtils'

function normalizeModName(rawName: string): string {
  const cleaned = rawName
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*nexus[^)]*\)/gi, ' ')
    .replace(/[_]+/g, ' ')
    .trim()

  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  if (dashParts.length > 1) {
    for (let index = 1; index < dashParts.length; index += 1) {
      const trailing = dashParts.slice(index)
      const versionLike = trailing.every((part) => /^v?\d+[a-z0-9.]*$/i.test(part))
      if (versionLike) {
        return dashParts.slice(0, index).join(' - ').trim()
      }
    }
  }

  return cleaned
    .replace(/[-_]?v?\d+(?:[._-]\d+)+(?:[._-]\d+)*$/i, '')
    .replace(/[-_ ]+$/g, '')
    .trim() || rawName
}

function getSourceModifiedAt(sourcePath?: string): string | undefined {
  if (!sourcePath || !fs.existsSync(sourcePath)) return undefined

  try {
    return fs.statSync(sourcePath).mtime.toISOString()
  } catch {
    return undefined
  }
}

function getModFolderKey(mod: ModMetadata): string {
  const folderName = mod.folderName?.trim()
  if (folderName) return folderName
  return mod.uuid
}

function normalizeRelativePath(relPath: string): string {
  return relPath
    .split(/[\\/]+/)
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .join(path.sep)
}

function splitSegments(relPath: string): string[] {
  const normalized = normalizeRelativePath(relPath)
  return normalized ? normalized.split(path.sep).filter(Boolean) : []
}

function removeEmptyParents(startPath: string, stopPath: string): void {
  let currentPath = path.dirname(startPath)
  const resolvedStopPath = path.resolve(stopPath)

  while (currentPath.startsWith(resolvedStopPath) && currentPath !== resolvedStopPath) {
    try {
      if (!fs.existsSync(currentPath)) break
      if (fs.readdirSync(currentPath).length > 0) break
      fs.rmdirSync(currentPath)
      currentPath = path.dirname(currentPath)
    } catch {
      break
    }
  }
}

function removeDeployedFile(targetPath: string, baseGameDir: string): void {
  try {
    if (!fs.existsSync(targetPath)) return
    fs.rmSync(targetPath, { recursive: true, force: true })
    removeEmptyParents(targetPath, baseGameDir)
  } catch {
    // Ignore cleanup failures on missing or locked files.
  }
}

function prepareBaseGameDir(baseGameDir: string): Promise<void> {
  return ensureRealDirectory(baseGameDir)
}

const GAME_ROOT_DIRS = new Set(['archive', 'bin', 'engine', 'mods', 'r6', 'red4ext'])
const ARCHIVE_EXTENSIONS = new Set(['.archive', '.xl'])

function findSequenceIndex(parts: string[], sequence: string[]): number {
  const lowerParts = parts.map((part) => part.toLowerCase())
  const lowerSequence = sequence.map((segment) => segment.toLowerCase())

  for (let index = 0; index <= lowerParts.length - lowerSequence.length; index += 1) {
    if (lowerSequence.every((segment, offset) => lowerParts[index + offset] === segment)) {
      return index
    }
  }

  return -1
}

function getLegacyLinkPath(gamePath: string, mod: ModMetadata): string | null {
  const modFolderKey = getModFolderKey(mod)

  switch (mod.type) {
    case 'redmod':
      return path.join(gamePath, 'mods', modFolderKey)
    case 'cet':
      return path.join(gamePath, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', modFolderKey)
    case 'redscript':
      return path.join(gamePath, 'r6', 'scripts', modFolderKey)
    case 'tweakxl':
      return path.join(gamePath, 'r6', 'tweaks', modFolderKey)
    case 'red4ext':
      return path.join(gamePath, 'red4ext', 'plugins', modFolderKey)
    default:
      return null
  }
}

async function removeLegacyFolderLink(gamePath: string, mod: ModMetadata): Promise<void> {
  const legacyLinkDest = getLegacyLinkPath(gamePath, mod)
  if (legacyLinkDest && isLink(legacyLinkDest)) {
    await safeRemoveLink(legacyLinkDest)
  }
}

function resolveDeploymentTarget(gamePath: string, relativeDeployPath: string): string | null {
  const resolvedGamePath = path.resolve(gamePath)
  const resolvedTarget = path.resolve(gamePath, relativeDeployPath)
  if (resolvedTarget === resolvedGamePath || resolvedTarget.startsWith(`${resolvedGamePath}${path.sep}`)) {
    return resolvedTarget
  }
  return null
}

function isRedmodContent(mod: ModMetadata, relFile: string): boolean {
  const modFolderKey = getModFolderKey(mod)
  const normalized = normalizeRelativePath(relFile)
  const lowerNormalized = normalized.toLowerCase()
  return (
    mod.type === 'redmod' ||
    lowerNormalized === 'info.json' ||
    lowerNormalized.startsWith(`archives${path.sep}`) ||
    lowerNormalized.startsWith(`${modFolderKey.toLowerCase()}${path.sep}archives${path.sep}`)
  )
}

function hasKnownGameRootPrefix(parts: string[]): boolean {
  const first = parts[0]?.toLowerCase()
  return Boolean(first) && GAME_ROOT_DIRS.has(first)
}

function inferLegacyRedscriptRootPath(normalized: string, parts: string[]): string | null {
  const first = parts[0]?.toLowerCase()
  const second = parts[1]?.toLowerCase()

  if (!first) return null

  if (first === 'tools') {
    return path.join('engine', normalized)
  }

  if (first === 'config' && (second === 'base' || second === 'platform')) {
    return path.join('engine', normalized)
  }

  if (
    first === 'scripts' ||
    first === 'tweaks' ||
    first === 'cache' ||
    (first === 'config' && second === 'cybercmd')
  ) {
    return path.join('r6', normalized)
  }

  return null
}

function inferLegacyFlattenedDeployPath(mod: ModMetadata, normalized: string, parts: string[]): string | null {
  if (!normalized || hasKnownGameRootPrefix(parts)) return null

  const modFolderKey = getModFolderKey(mod)

  switch (mod.type) {
    case 'engine':
      return path.join('engine', normalized)
    case 'r6':
      return path.join('r6', normalized)
    case 'redscript':
      return inferLegacyRedscriptRootPath(normalized, parts)
    case 'red4ext':
      return path.join('red4ext', normalized)
    case 'bin':
      return parts[0]?.toLowerCase() === 'x64'
        ? path.join('bin', normalized)
        : path.join('bin', 'x64', normalized)
    case 'cet':
      return path.join('bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', modFolderKey, normalized)
    default:
      return null
  }
}

function getDeployRelativePath(mod: ModMetadata, relFile: string): string {
  const normalized = normalizeRelativePath(relFile)
  const parts = splitSegments(normalized)
  const modFolderKey = getModFolderKey(mod)
  const extension = path.extname(normalized).toLowerCase()
  const fileName = path.basename(normalized)

  const binX64Index = findSequenceIndex(parts, ['bin', 'x64'])
  if (binX64Index >= 0) {
    return path.join(...parts.slice(binX64Index))
  }

  const cetIndex = findSequenceIndex(parts, ['cyber_engine_tweaks', 'mods'])
  if (cetIndex >= 0) {
    return path.join('bin', 'x64', 'plugins', ...parts.slice(cetIndex))
  }

  const legacyFlattenedPath = inferLegacyFlattenedDeployPath(mod, normalized, parts)
  if (legacyFlattenedPath) {
    return legacyFlattenedPath
  }

  const pluginsIndex = findSequenceIndex(parts, ['plugins'])
  if (pluginsIndex >= 0) {
    const priorSegment = parts[pluginsIndex - 1]?.toLowerCase()
    if (priorSegment === 'red4ext') {
      return path.join(...parts.slice(pluginsIndex - 1))
    }
    return path.join('bin', 'x64', ...parts.slice(pluginsIndex))
  }

  const gameRootIndex = parts.findIndex((segment) => GAME_ROOT_DIRS.has(segment.toLowerCase()))
  if (gameRootIndex >= 0) {
    return path.join(...parts.slice(gameRootIndex))
  }

  if (isRedmodContent(mod, normalized)) {
    return path.join('mods', modFolderKey, normalized)
  }

  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return path.join('archive', 'pc', 'mod', fileName)
  }

  if (extension === '.reds') {
    return path.join('r6', 'scripts', normalized)
  }

  if (extension === '.yaml' || extension === '.yml') {
    return path.join('r6', 'tweaks', normalized)
  }

  if (extension === '.lua') {
    return path.join('bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', modFolderKey, normalized)
  }

  if (extension === '.asi') {
    return path.join('bin', 'x64', 'plugins', fileName)
  }

  if (extension === '.dll') {
    if (mod.type === 'red4ext') {
      return path.join('red4ext', 'plugins', modFolderKey, normalized)
    }
    return path.join('bin', 'x64', normalized)
  }

  return normalized
}

function getTrackedDeploymentPaths(mod: ModMetadata): string[] {
  if (Array.isArray(mod.deployedPaths) && mod.deployedPaths.length > 0) {
    return mod.deployedPaths
  }

  if (!Array.isArray(mod.files)) return []
  return mod.files
    .filter((relFile) => relFile !== '_metadata.json')
    .map((relFile) => getDeployRelativePath(mod, relFile))
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

function readMetadata(modDir: string): ModMetadata | null {
  const metaPath = path.join(modDir, '_metadata.json')
  try {
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    }
  } catch {
    // corrupt metadata
  }
  return null
}

function writeMetadata(modDir: string, meta: ModMetadata): void {
  fs.writeFileSync(
    path.join(modDir, '_metadata.json'),
    JSON.stringify(meta, null, 2),
    'utf-8'
  )
}

// ─── Core Functions ──────────────────────────────────────────────────────────

// Finds the actual directory of a mod by scanning for its UUID in metadata
export function findModDir(libraryPath: string, uuid: string): { mod: ModMetadata; dir: string } | null {
  if (!fs.existsSync(libraryPath)) return null
  const entries = fs.readdirSync(libraryPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(libraryPath, entry.name)
    const meta = readMetadata(dir)
    if (meta && meta.uuid === uuid) return { mod: meta, dir }
  }
  return null
}

export async function scanMods(libraryPath: string): Promise<ModMetadata[]> {
  if (!fs.existsSync(libraryPath)) return []

  const entries = fs.readdirSync(libraryPath, { withFileTypes: true })
  const mods: ModMetadata[] = []
  const seenUuids = new Set<string>()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const modDir = path.join(libraryPath, entry.name)
    try {
      const meta = readMetadata(modDir)
      if (meta) {
        let shouldWrite = false

        const normalizedUuid = meta.uuid?.trim()
        if (!normalizedUuid || seenUuids.has(normalizedUuid)) {
          meta.uuid = uuidv4()
          shouldWrite = true
        }
        seenUuids.add(meta.uuid)

        if (meta.folderName !== entry.name) {
          meta.folderName = entry.name
          shouldWrite = true
        }

        if (meta.kind === 'mod') {
          const normalizedFiles = Array.isArray(meta.files) ? meta.files : listFilesRecursive(modDir)
          if (!Array.isArray(meta.files) || meta.files.length !== normalizedFiles.length || meta.files.some((file, index) => file !== normalizedFiles[index])) {
            meta.files = normalizedFiles
            shouldWrite = true
          }

          if (meta.deployedPaths && !Array.isArray(meta.deployedPaths)) {
            delete meta.deployedPaths
            shouldWrite = true
          }

          const normalizedName = normalizeModName(meta.name)
          if (normalizedName !== meta.name) {
            meta.name = normalizedName
            shouldWrite = true
          }

          const detectedType = detectModType(modDir)
          if (detectedType !== 'unknown' && meta.type !== detectedType) {
            meta.type = detectedType
            shouldWrite = true
          }

          const computedFileSize = getPathSizeSafe(modDir)
          if (meta.fileSize !== computedFileSize) {
            meta.fileSize = computedFileSize
            shouldWrite = true
          }

          const sourceModifiedAt = getSourceModifiedAt(meta.sourcePath)
          if (sourceModifiedAt && meta.sourceModifiedAt !== sourceModifiedAt) {
            meta.sourceModifiedAt = sourceModifiedAt
            shouldWrite = true
          }
        }

        if (shouldWrite) writeMetadata(modDir, meta)
        mods.push(meta)
      }
    } catch (error) {
      console.warn(`Skipping mod directory during scan: ${modDir}`, error)
    }
  }

  // Sort by order field
  mods.sort((a, b) => a.order - b.order)
  return mods
}

export async function enableMod(
  mod: ModMetadata,
  gamePath: string,
  libraryPath: string
): Promise<IpcResult> {
  if (!gamePath) return { ok: false, error: 'Game path not set' }

  const resolvedMod = findModDir(libraryPath, mod.uuid)
  const metadata = resolvedMod?.mod ?? mod
  const modFolderKey = getModFolderKey(metadata)
  const modDir = resolvedMod?.dir ?? path.join(libraryPath, modFolderKey)
  const modFiles = Array.isArray(metadata.files) ? metadata.files : []

  try {
    await prepareBaseGameDir(gamePath)
    await removeLegacyFolderLink(gamePath, metadata)

    for (const deployedRelativePath of getTrackedDeploymentPaths(metadata)) {
      removeDeployedFile(path.join(gamePath, deployedRelativePath), gamePath)
    }

    const deployedPaths: string[] = []

    for (const relFile of modFiles) {
      if (relFile === '_metadata.json') continue

      const normalizedRelativePath = normalizeRelativePath(relFile)
      const src = path.join(modDir, normalizedRelativePath)
      if (!fs.existsSync(src)) continue

      const relativeDeployPath = getDeployRelativePath(metadata, normalizedRelativePath)
      const dest = resolveDeploymentTarget(gamePath, relativeDeployPath)
      if (!dest) continue

      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      deployedPaths.push(normalizeRelativePath(path.relative(gamePath, dest)))
    }

    metadata.enabled = true
    metadata.enabledAt = new Date().toISOString()
    metadata.deployedPaths = deployedPaths
    writeMetadata(modDir, metadata)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
}

export async function disableMod(
  mod: ModMetadata,
  gamePath: string,
  libraryPath: string
): Promise<IpcResult> {
  if (!gamePath) return { ok: false, error: 'Game path not set' }

  const resolvedMod = findModDir(libraryPath, mod.uuid)
  const metadata = resolvedMod?.mod ?? mod
  const modFolderKey = getModFolderKey(metadata)
  const modDir = resolvedMod?.dir ?? path.join(libraryPath, modFolderKey)

  try {
    await removeLegacyFolderLink(gamePath, metadata)

    for (const deployedRelativePath of getTrackedDeploymentPaths(metadata)) {
      removeDeployedFile(path.join(gamePath, deployedRelativePath), gamePath)
    }

    metadata.enabled = false
    metadata.deployedPaths = []
    writeMetadata(modDir, metadata)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
}

export async function purgeMods(
  gamePath: string,
  libraryPath: string
): Promise<IpcResult<PurgeModsResult>> {
  if (!gamePath) return { ok: false, error: 'Game path not set' }
  if (!libraryPath) return { ok: false, error: 'Library path not set' }

  const mods = await scanMods(libraryPath)
  const enabledMods = mods.filter((mod) => mod.kind === 'mod' && mod.enabled)
  let purged = 0
  let failed = 0

  for (const mod of enabledMods) {
    const result = await disableMod(mod, gamePath, libraryPath)
    if (result.ok) {
      purged += 1
    } else {
      failed += 1
    }
  }

  return { ok: failed === 0, data: { purged, failed }, error: failed > 0 ? `${failed} mod(s) could not be purged` : undefined }
}

// ─── Handler Registration ─────────────────────────────────────────────────────

export function registerModManagerHandlers(getMainWindow?: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.SCAN_MODS, async (): Promise<IpcResult<ModMetadata[]>> => {
    try {
      const settings = loadSettings()
      const mods = await scanMods(settings.libraryPath)
      return { ok: true, data: mods }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not scan mod library'
      }
    }
  })

  ipcMain.handle(
    IPC.ENABLE_MOD,
    async (_event, modId: string): Promise<IpcResult> => {
      const settings = loadSettings()
      const mods = await scanMods(settings.libraryPath)
      const mod = mods.find((m) => m.uuid === modId)
      if (!mod) return { ok: false, error: 'Mod not found' }
      const result = await enableMod(mod, settings.gamePath, settings.libraryPath)
      if (!result.ok) {
        pushGeneralLog(getMainWindow?.() ?? null, {
          level: 'error',
          source: 'mods',
          message: `Enable mod failed: ${mod.name}`,
          details: { modId: mod.uuid, modName: mod.name, error: result.error },
        })
      }
      return result
    }
  )

  ipcMain.handle(
    IPC.DISABLE_MOD,
    async (_event, modId: string): Promise<IpcResult> => {
      const settings = loadSettings()
      const mods = await scanMods(settings.libraryPath)
      const mod = mods.find((m) => m.uuid === modId)
      if (!mod) return { ok: false, error: 'Mod not found' }
      const result = await disableMod(mod, settings.gamePath, settings.libraryPath)
      if (!result.ok) {
        pushGeneralLog(getMainWindow?.() ?? null, {
          level: 'error',
          source: 'mods',
          message: `Disable mod failed: ${mod.name}`,
          details: { modId: mod.uuid, modName: mod.name, error: result.error },
        })
      }
      return result
    }
  )

  ipcMain.handle(
    IPC.PURGE_MODS,
    async (): Promise<IpcResult<PurgeModsResult>> => {
      const settings = loadSettings()
      return purgeMods(settings.gamePath, settings.libraryPath)
    }
  )

  ipcMain.handle(
    IPC.DELETE_MOD,
    async (_event, modId: string): Promise<IpcResult> => {
      const settings = loadSettings()
      const mods = await scanMods(settings.libraryPath)
      const mod = mods.find((m) => m.uuid === modId)
      if (!mod) return { ok: false, error: 'Mod not found' }

      // Disable first if enabled
      if (mod.enabled) {
        await disableMod(mod, settings.gamePath, settings.libraryPath)
      }

      const found = findModDir(settings.libraryPath, modId)
      if (!found) return { ok: false, error: 'Mod directory not found' }
      fs.rmSync(found.dir, { recursive: true, force: true })
      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC.REORDER_MODS,
    async (_event, orderedIds: string[]): Promise<IpcResult> => {
      const settings = loadSettings()
      const allMods = await scanMods(settings.libraryPath)
      const uuidToDir = new Map(allMods.map((m) => [m.uuid, path.join(settings.libraryPath, getModFolderKey(m))]))
      for (let i = 0; i < orderedIds.length; i++) {
        const modDir = uuidToDir.get(orderedIds[i])
        if (!modDir) continue
        const meta = readMetadata(modDir)
        if (meta) {
          meta.order = i
          writeMetadata(modDir, meta)
        }
      }
      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC.UPDATE_MOD_METADATA,
    async (
      _event,
      modId: string,
      updates: Partial<ModMetadata>
    ): Promise<IpcResult<ModMetadata>> => {
      const settings = loadSettings()
      const found = findModDir(settings.libraryPath, modId)
      if (!found) return { ok: false, error: 'Metadata not found' }
      const updated = { ...found.mod, ...updates, uuid: found.mod.uuid }
      writeMetadata(found.dir, updated)
      return { ok: true, data: updated }
    }
  )

}
