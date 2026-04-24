import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type {
  ModMetadata,
  IpcResult,
  PurgeModsResult,
  ModTreeCreateEntryRequest,
  ModTreeRenameEntryRequest,
  ModTreeDeleteEntryRequest,
} from '../../shared/types'
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

function sanitizeSeparatorFolderName(rawName: string): string {
  const cleaned = rawName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return cleaned || 'New Separator'
}

function sanitizeModTreeEntryName(rawName: string): string {
  const cleaned = rawName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ ]+$/g, '')

  if (!cleaned || cleaned === '.' || cleaned === '..') return ''
  return cleaned
}

function getUniqueSeparatorFolderName(
  libraryPath: string,
  rawName: string,
  excludeDirPath?: string
): string {
  const baseName = sanitizeSeparatorFolderName(rawName)
  const excludedPath = excludeDirPath ? path.resolve(excludeDirPath) : null
  let candidate = baseName
  let suffix = 2

  while (true) {
    const candidatePath = path.join(libraryPath, candidate)
    if (!fs.existsSync(candidatePath) || (excludedPath && path.resolve(candidatePath) === excludedPath)) {
      return candidate
    }

    candidate = `${baseName} ${suffix}`
    suffix += 1
  }
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

export function normalizeRelativePath(relPath: string): string {
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

export function getDeployRelativePath(mod: ModMetadata, relFile: string): string {
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

export function getTrackedDeploymentPaths(mod: ModMetadata): string[] {
  if (Array.isArray(mod.deployedPaths) && mod.deployedPaths.length > 0) {
    return mod.deployedPaths
  }

  if (!Array.isArray(mod.files)) return []
  return mod.files
    .filter((relFile) => relFile !== '_metadata.json')
    .map((relFile) => getDeployRelativePath(mod, relFile))
}

function resolveScannedModDir(libraryPath: string, mod: ModMetadata): { mod: ModMetadata; dir: string } | null {
  const directDir = path.join(libraryPath, getModFolderKey(mod))
  const directMeta = readMetadata(directDir)
  if (directMeta?.uuid === mod.uuid) {
    return { mod: directMeta, dir: directDir }
  }

  return findModDir(libraryPath, mod.uuid)
}

async function redeployEnabledMods(
  gamePath: string,
  libraryPath: string,
  sourceMods?: ModMetadata[]
): Promise<IpcResult<ModMetadata[]>> {
  if (!gamePath) return { ok: false, error: 'Game path not set' }

  const mods = sourceMods ?? await scanMods(libraryPath)
  const enabledMods = mods.filter((mod) => mod.kind === 'mod' && mod.enabled)

  try {
    await prepareBaseGameDir(gamePath)

    const removalPaths = new Set<string>()
    for (const mod of mods) {
      if (mod.kind !== 'mod') continue

      const trackedPaths = mod.enabled
        ? getTrackedDeploymentPaths(mod)
        : Array.isArray(mod.deployedPaths)
          ? mod.deployedPaths
          : []

      if (trackedPaths.length === 0) continue

      await removeLegacyFolderLink(gamePath, mod)
      for (const deployedRelativePath of trackedPaths) {
        const normalized = normalizeRelativePath(deployedRelativePath)
        if (normalized) removalPaths.add(normalized)
      }
    }

    for (const deployedRelativePath of removalPaths) {
      const target = resolveDeploymentTarget(gamePath, deployedRelativePath)
      if (target) removeDeployedFile(target, gamePath)
    }

    for (const mod of enabledMods) {
      const resolvedMod = resolveScannedModDir(libraryPath, mod)
      const metadata = resolvedMod?.mod ?? mod
      const modFolderKey = getModFolderKey(metadata)
      const modDir = resolvedMod?.dir ?? path.join(libraryPath, modFolderKey)
      const modFiles = Array.isArray(metadata.files) ? metadata.files : []
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

      metadata.deployedPaths = Array.from(new Set(deployedPaths))
      writeMetadata(modDir, metadata)
    }

    for (const mod of mods) {
      if (mod.kind !== 'mod' || mod.enabled || !Array.isArray(mod.deployedPaths) || mod.deployedPaths.length === 0) {
        continue
      }

      const resolvedMod = resolveScannedModDir(libraryPath, mod)
      if (!resolvedMod) continue
      resolvedMod.mod.deployedPaths = []
      writeMetadata(resolvedMod.dir, resolvedMod.mod)
    }

    return { ok: true, data: await scanMods(libraryPath) }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
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

function normalizeEmptyDirs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => normalizeRelativePath(entry))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }))
}

function setEmptyDirs(meta: ModMetadata, emptyDirs: string[]): void {
  if (emptyDirs.length > 0) {
    meta.emptyDirs = emptyDirs
  } else if (meta.emptyDirs !== undefined) {
    delete meta.emptyDirs
  }
}

function collectEmptyDirsFrom(startDir: string, stopDir: string): string[] {
  const results: string[] = []
  const resolvedStopDir = path.resolve(stopDir)
  let currentDir = path.resolve(startDir)

  while (currentDir.startsWith(`${resolvedStopDir}${path.sep}`)) {
    try {
      if (!fs.existsSync(currentDir)) break
      const stats = fs.statSync(currentDir)
      if (!stats.isDirectory()) break
      if (fs.readdirSync(currentDir).length > 0) break
      results.push(normalizeRelativePath(path.relative(resolvedStopDir, currentDir)))
      currentDir = path.dirname(currentDir)
    } catch {
      break
    }
  }

  return results.filter(Boolean)
}

async function createSeparator(libraryPath: string, rawName: string): Promise<IpcResult<ModMetadata>> {
  if (!libraryPath) return { ok: false, error: 'Library path not set' }

  fs.mkdirSync(libraryPath, { recursive: true })

  const currentEntries = await scanMods(libraryPath)
  const nextOrder = currentEntries.length
  const uuid = uuidv4()
  const name = rawName.trim() || 'New Separator'
  const folderName = getUniqueSeparatorFolderName(libraryPath, name)
  const modDir = path.join(libraryPath, folderName)
  const installedAt = new Date().toISOString()

  const separator: ModMetadata = {
    uuid,
    name,
    type: 'unknown',
    kind: 'separator',
    order: nextOrder,
    enabled: false,
    installedAt,
    fileSize: 0,
    files: ['_metadata.json'],
    folderName,
    deployedPaths: [],
  }

  fs.mkdirSync(modDir, { recursive: true })
  writeMetadata(modDir, separator)
  return { ok: true, data: separator }
}

function resolvePathInsideModDir(modDir: string, relativePath = ''): { normalized: string; absolute: string } | null {
  const normalized = normalizeRelativePath(relativePath)
  const resolvedModDir = path.resolve(modDir)
  const absolute = normalized ? path.resolve(modDir, normalized) : resolvedModDir

  if (absolute !== resolvedModDir && !absolute.startsWith(`${resolvedModDir}${path.sep}`)) {
    return null
  }

  return { normalized, absolute }
}

async function refreshModAfterTreeMutation(
  modId: string,
  libraryPath: string,
  gamePath: string
): Promise<IpcResult<ModMetadata>> {
  let scannedMods = await scanMods(libraryPath)
  let updatedMod = scannedMods.find((entry) => entry.uuid === modId)
  if (!updatedMod) return { ok: false, error: 'Mod not found after file operation' }

  if (updatedMod.enabled) {
    const syncResult = await enableMod(updatedMod, gamePath, libraryPath)
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error ?? 'Could not resync modified mod' }
    }

    scannedMods = await scanMods(libraryPath)
    updatedMod = scannedMods.find((entry) => entry.uuid === modId)
    if (!updatedMod) return { ok: false, error: 'Mod not found after resync' }
  }

  return { ok: true, data: updatedMod }
}

async function createModTreeEntry(
  request: ModTreeCreateEntryRequest,
  libraryPath: string,
  gamePath: string
): Promise<IpcResult<ModMetadata>> {
  const found = findModDir(libraryPath, request.modId)
  if (!found) return { ok: false, error: 'Mod directory not found' }

  const entryName = sanitizeModTreeEntryName(request.name)
  if (!entryName) return { ok: false, error: 'Entry name cannot be empty' }

  const parentInfo = resolvePathInsideModDir(found.dir, request.parentRelativePath)
  if (!parentInfo) return { ok: false, error: 'Invalid parent path' }

  fs.mkdirSync(parentInfo.absolute, { recursive: true })

  const targetInfo = resolvePathInsideModDir(found.dir, path.join(parentInfo.normalized, entryName))
  if (!targetInfo) return { ok: false, error: 'Invalid entry path' }
  if (path.basename(targetInfo.absolute) === '_metadata.json') {
    return { ok: false, error: 'Reserved file name' }
  }
  if (fs.existsSync(targetInfo.absolute)) {
    return { ok: false, error: 'An entry with this name already exists' }
  }

  if (request.kind === 'folder') {
    fs.mkdirSync(targetInfo.absolute, { recursive: true })
    const nextEmptyDirs = normalizeEmptyDirs([...(found.mod.emptyDirs ?? []), targetInfo.normalized])
    setEmptyDirs(found.mod, nextEmptyDirs)
    writeMetadata(found.dir, found.mod)
  } else {
    fs.mkdirSync(path.dirname(targetInfo.absolute), { recursive: true })
    fs.writeFileSync(targetInfo.absolute, '', 'utf-8')
    const createdParent = normalizeRelativePath(parentInfo.normalized)
    const nextEmptyDirs = normalizeEmptyDirs(
      (found.mod.emptyDirs ?? []).filter((entry) => entry !== createdParent)
    )
    setEmptyDirs(found.mod, nextEmptyDirs)
    writeMetadata(found.dir, found.mod)
  }

  return refreshModAfterTreeMutation(request.modId, libraryPath, gamePath)
}

async function renameModTreeEntry(
  request: ModTreeRenameEntryRequest,
  libraryPath: string,
  gamePath: string
): Promise<IpcResult<ModMetadata>> {
  const found = findModDir(libraryPath, request.modId)
  if (!found) return { ok: false, error: 'Mod directory not found' }

  const nextName = sanitizeModTreeEntryName(request.nextName)
  if (!nextName) return { ok: false, error: 'Entry name cannot be empty' }

  const sourceInfo = resolvePathInsideModDir(found.dir, request.relativePath)
  if (!sourceInfo || !sourceInfo.normalized) return { ok: false, error: 'Invalid entry path' }
  if (path.basename(sourceInfo.absolute) === '_metadata.json') {
    return { ok: false, error: 'Reserved file cannot be renamed' }
  }
  if (!fs.existsSync(sourceInfo.absolute)) return { ok: false, error: 'Entry not found' }

  const targetInfo = resolvePathInsideModDir(found.dir, path.join(path.dirname(sourceInfo.normalized), nextName))
  if (!targetInfo) return { ok: false, error: 'Invalid destination path' }
  if (path.basename(targetInfo.absolute) === '_metadata.json') {
    return { ok: false, error: 'Reserved file name' }
  }
  if (sourceInfo.absolute === targetInfo.absolute) {
    return refreshModAfterTreeMutation(request.modId, libraryPath, gamePath)
  }
  if (fs.existsSync(targetInfo.absolute)) {
    return { ok: false, error: 'An entry with this name already exists' }
  }

  fs.renameSync(sourceInfo.absolute, targetInfo.absolute)
  if (found.mod.kind === 'mod') {
    const sourcePrefix = `${sourceInfo.normalized}${path.sep}`
    const nextEmptyDirs = normalizeEmptyDirs(
      (found.mod.emptyDirs ?? []).map((entry) => {
        if (entry === sourceInfo.normalized) return targetInfo.normalized
        if (entry.startsWith(sourcePrefix)) {
          return normalizeRelativePath(path.join(targetInfo.normalized, entry.slice(sourcePrefix.length)))
        }
        return entry
      })
    )
    setEmptyDirs(found.mod, nextEmptyDirs)
    writeMetadata(found.dir, found.mod)
  }
  return refreshModAfterTreeMutation(request.modId, libraryPath, gamePath)
}

async function deleteModTreeEntry(
  request: ModTreeDeleteEntryRequest,
  libraryPath: string,
  gamePath: string
): Promise<IpcResult<ModMetadata>> {
  const found = findModDir(libraryPath, request.modId)
  if (!found) return { ok: false, error: 'Mod directory not found' }

  const targetInfo = resolvePathInsideModDir(found.dir, request.relativePath)
  if (!targetInfo || !targetInfo.normalized) return { ok: false, error: 'Invalid entry path' }
  if (path.basename(targetInfo.absolute) === '_metadata.json') {
    return { ok: false, error: 'Reserved file cannot be deleted' }
  }
  if (!fs.existsSync(targetInfo.absolute)) return { ok: false, error: 'Entry not found' }

  fs.rmSync(targetInfo.absolute, { recursive: true, force: true })
  if (found.mod.kind === 'mod') {
    const removedPrefix = `${targetInfo.normalized}${path.sep}`
    const parentRelativePath = normalizeRelativePath(path.dirname(targetInfo.normalized))
    const nextEmptyDirs = normalizeEmptyDirs([
      ...(found.mod.emptyDirs ?? []).filter((entry) => entry !== targetInfo.normalized && !entry.startsWith(removedPrefix)),
      ...collectEmptyDirsFrom(path.dirname(targetInfo.absolute), found.dir)
        .filter((entry) => entry !== parentRelativePath || entry.length > 0),
    ])
    setEmptyDirs(found.mod, nextEmptyDirs)
    writeMetadata(found.dir, found.mod)
  }
  return refreshModAfterTreeMutation(request.modId, libraryPath, gamePath)
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

          const normalizedEmptyDirs = normalizeEmptyDirs(meta.emptyDirs)
          if (!Array.isArray(meta.emptyDirs) || normalizedEmptyDirs.length !== meta.emptyDirs.length || meta.emptyDirs.some((entry, index) => entry !== normalizedEmptyDirs[index])) {
            setEmptyDirs(meta, normalizedEmptyDirs)
            shouldWrite = true
          }

          if (meta.deployedPaths && !Array.isArray(meta.deployedPaths)) {
            delete meta.deployedPaths
            shouldWrite = true
          }

          if (typeof meta.notes !== 'string' || meta.notes.trim().length === 0) {
            if (meta.notes !== undefined) {
              delete meta.notes
              shouldWrite = true
            }
          } else if (meta.notes !== meta.notes.trim()) {
            meta.notes = meta.notes.trim()
            shouldWrite = true
          }

          if (meta.previewImagePath !== undefined && typeof meta.previewImagePath !== 'string') {
            delete meta.previewImagePath
            shouldWrite = true
          }

          if (meta.galleryImagePaths !== undefined) {
            const normalizedGallery = Array.isArray(meta.galleryImagePaths)
              ? meta.galleryImagePaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
              : []

            if (!Array.isArray(meta.galleryImagePaths) || normalizedGallery.length !== meta.galleryImagePaths.length) {
              if (normalizedGallery.length > 0) {
                meta.galleryImagePaths = normalizedGallery
              } else {
                delete meta.galleryImagePaths
              }
              shouldWrite = true
            }
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
  if (!resolvedMod) return { ok: false, error: 'Mod directory not found' }

  resolvedMod.mod.enabled = true
  if (!resolvedMod.mod.enabledAt) {
    resolvedMod.mod.enabledAt = new Date().toISOString()
  }
  writeMetadata(resolvedMod.dir, resolvedMod.mod)

  const redeployResult = await redeployEnabledMods(gamePath, libraryPath)
  if (!redeployResult.ok) return { ok: false, error: redeployResult.error }
  return { ok: true }
}

export async function disableMod(
  mod: ModMetadata,
  gamePath: string,
  libraryPath: string
): Promise<IpcResult> {
  if (!gamePath) return { ok: false, error: 'Game path not set' }

  const resolvedMod = findModDir(libraryPath, mod.uuid)
  if (!resolvedMod) return { ok: false, error: 'Mod directory not found' }

  resolvedMod.mod.enabled = false
  writeMetadata(resolvedMod.dir, resolvedMod.mod)

  const redeployResult = await redeployEnabledMods(gamePath, libraryPath)
  if (!redeployResult.ok) return { ok: false, error: redeployResult.error }
  return { ok: true }
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

  try {
    await prepareBaseGameDir(gamePath)

    for (const mod of enabledMods) {
      await removeLegacyFolderLink(gamePath, mod)
      for (const deployedRelativePath of getTrackedDeploymentPaths(mod)) {
        removeDeployedFile(path.join(gamePath, deployedRelativePath), gamePath)
      }

      const resolvedMod = findModDir(libraryPath, mod.uuid)
      if (!resolvedMod) {
        failed += 1
        continue
      }

      resolvedMod.mod.enabled = false
      resolvedMod.mod.deployedPaths = []
      writeMetadata(resolvedMod.dir, resolvedMod.mod)
      purged += 1
    }
  } catch {
    failed += 1
  }

  return { ok: failed === 0, data: { purged, failed }, error: failed > 0 ? `${failed} mod(s) could not be purged` : undefined }
}

async function setModsEnabledInBatch(
  modIds: string[],
  enabled: boolean,
  gamePath: string,
  libraryPath: string,
  mainWindow: BrowserWindow | null
): Promise<IpcResult<{ processed: string[]; failed: string[] }>> {
  const requestedIds = Array.from(new Set(modIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
  const processed: string[] = []
  const failed: string[] = []

  if (requestedIds.length === 0) {
    return { ok: true, data: { processed, failed } }
  }

  if (!gamePath) {
    return { ok: false, data: { processed, failed: requestedIds }, error: 'Game path not set' }
  }

  if (!libraryPath) {
    return { ok: false, data: { processed, failed: requestedIds }, error: 'Library path not set' }
  }

  const all = await scanMods(libraryPath)
  const modsById = new Map(all.map((mod) => [mod.uuid, mod]))
  const changedMods = new Map<string, ModMetadata>()
  const enabledAt = new Date().toISOString()
  const actionLabel = enabled ? 'Enable' : 'Disable'

  for (const id of requestedIds) {
    const mod = modsById.get(id)
    if (!mod || mod.kind !== 'mod') {
      failed.push(id)
      continue
    }

    try {
      const resolvedMod = resolveScannedModDir(libraryPath, mod)
      if (!resolvedMod) {
        failed.push(id)
        continue
      }

      const nextMod = { ...resolvedMod.mod, enabled }
      if (enabled && !nextMod.enabledAt) {
        nextMod.enabledAt = enabledAt
      }

      writeMetadata(resolvedMod.dir, nextMod)
      changedMods.set(id, nextMod)
      processed.push(id)
    } catch (error) {
      failed.push(id)
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'mods',
        message: `${actionLabel} mod failed: ${mod.name}`,
        details: {
          modId: mod.uuid,
          modName: mod.name,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  if (processed.length === 0) {
    return {
      ok: failed.length === 0,
      data: { processed, failed },
      error: failed.length > 0 ? `${failed.length} mod(s) failed` : undefined,
    }
  }

  const nextMods = all.map((mod) => changedMods.get(mod.uuid) ?? mod)
  const redeployResult = await redeployEnabledMods(gamePath, libraryPath, nextMods)
  if (!redeployResult.ok) {
    const allFailed = Array.from(new Set([...failed, ...processed]))
    pushGeneralLog(mainWindow, {
      level: 'error',
      source: 'mods',
      message: `${actionLabel} mods failed during redeploy`,
      details: { modIds: processed, error: redeployResult.error },
    })
    return {
      ok: false,
      data: { processed: [], failed: allFailed },
      error: redeployResult.error ?? `${allFailed.length} mod(s) failed`,
    }
  }

  return {
    ok: failed.length === 0,
    data: { processed, failed },
    error: failed.length > 0 ? `${failed.length} mod(s) failed` : undefined,
  }
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
    IPC.ENABLE_MODS,
    async (_event, modIds: string[]): Promise<IpcResult<{ processed: string[]; failed: string[] }>> => {
      const settings = loadSettings()
      return setModsEnabledInBatch(modIds, true, settings.gamePath, settings.libraryPath, getMainWindow?.() ?? null)
    }
  )

  ipcMain.handle(
    IPC.DISABLE_MODS,
    async (_event, modIds: string[]): Promise<IpcResult<{ processed: string[]; failed: string[] }>> => {
      const settings = loadSettings()
      return setModsEnabledInBatch(modIds, false, settings.gamePath, settings.libraryPath, getMainWindow?.() ?? null)
    }
  )

  ipcMain.handle(
    IPC.RESTORE_ENABLED_MODS,
    async (): Promise<IpcResult<ModMetadata[]>> => {
      const settings = loadSettings()
      return redeployEnabledMods(settings.gamePath, settings.libraryPath)
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
    IPC.CREATE_SEPARATOR,
    async (_event, name: string): Promise<IpcResult<ModMetadata>> => {
      const settings = loadSettings()
      return createSeparator(settings.libraryPath, name)
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

      if (allMods.some((mod) => mod.kind === 'mod' && mod.enabled)) {
        const redeployResult = await redeployEnabledMods(settings.gamePath, settings.libraryPath)
        if (!redeployResult.ok) {
          return { ok: false, error: redeployResult.error }
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
      let nextDir = found.dir
      const updated = { ...found.mod, ...updates, uuid: found.mod.uuid }

      if (found.mod.kind === 'separator' && typeof updates.name === 'string') {
        const nextName = updates.name.trim() || found.mod.name
        const nextFolderName = getUniqueSeparatorFolderName(settings.libraryPath, nextName, found.dir)
        if (nextFolderName !== path.basename(found.dir)) {
          nextDir = path.join(settings.libraryPath, nextFolderName)
          fs.renameSync(found.dir, nextDir)
        }
        updated.folderName = nextFolderName
      }

      writeMetadata(nextDir, updated)
      return { ok: true, data: updated }
    }
  )

  ipcMain.handle(
    IPC.MOD_TREE_CREATE_ENTRY,
    async (_event, request: ModTreeCreateEntryRequest): Promise<IpcResult<ModMetadata>> => {
      const settings = loadSettings()
      try {
        return await createModTreeEntry(request, settings.libraryPath, settings.gamePath)
      } catch (error) {
        pushGeneralLog(getMainWindow?.() ?? null, {
          level: 'error',
          source: 'mods',
          message: 'Create mod tree entry failed',
          details: error instanceof Error ? { request, error: error.message } : { request, error: String(error) },
        })
        return { ok: false, error: error instanceof Error ? error.message : 'Could not create entry' }
      }
    }
  )

  ipcMain.handle(
    IPC.MOD_TREE_RENAME_ENTRY,
    async (_event, request: ModTreeRenameEntryRequest): Promise<IpcResult<ModMetadata>> => {
      const settings = loadSettings()
      try {
        return await renameModTreeEntry(request, settings.libraryPath, settings.gamePath)
      } catch (error) {
        pushGeneralLog(getMainWindow?.() ?? null, {
          level: 'error',
          source: 'mods',
          message: 'Rename mod tree entry failed',
          details: error instanceof Error ? { request, error: error.message } : { request, error: String(error) },
        })
        return { ok: false, error: error instanceof Error ? error.message : 'Could not rename entry' }
      }
    }
  )

  ipcMain.handle(
    IPC.MOD_TREE_DELETE_ENTRY,
    async (_event, request: ModTreeDeleteEntryRequest): Promise<IpcResult<ModMetadata>> => {
      const settings = loadSettings()
      try {
        return await deleteModTreeEntry(request, settings.libraryPath, settings.gamePath)
      } catch (error) {
        pushGeneralLog(getMainWindow?.() ?? null, {
          level: 'error',
          source: 'mods',
          message: 'Delete mod tree entry failed',
          details: error instanceof Error ? { request, error: error.message } : { request, error: String(error) },
        })
        return { ok: false, error: error instanceof Error ? error.message : 'Could not delete entry' }
      }
    }
  )

  ipcMain.handle(
    IPC.CALCULATE_MOD_CONFLICTS,
    async (): Promise<IpcResult<{ summaries: ModConflictSummary[]; conflicts: ConflictInfo[] }>> => {
      try {
        const settings = loadSettings()
        const mods = await scanMods(settings.libraryPath)

        const pathOwners = new Map<string, Array<{ modId: string; name: string; order: number }>>()

        for (const mod of mods.filter((m) => m.kind === 'mod')) {
          for (const rel of getTrackedDeploymentPaths(mod)) {
            const normalized = normalizeRelativePath(rel)
            if (!normalized) continue
            const owners = pathOwners.get(normalized) ?? []
            if (!owners.find((o) => o.modId === mod.uuid)) {
              owners.push({ modId: mod.uuid, name: mod.name, order: mod.order })
            }
            pathOwners.set(normalized, owners)
          }
        }

        const conflicts: ConflictInfo[] = []
        const summaryMap = new Map<string, { overwrites: number; overwrittenBy: number }>()
        for (const m of mods) summaryMap.set(m.uuid, { overwrites: 0, overwrittenBy: 0 })

        for (const [resourcePath, owners] of pathOwners.entries()) {
          if (owners.length <= 1) continue
          const uniqueOwners = Array.from(new Map(owners.map((o) => [o.modId, o])).values())
          if (uniqueOwners.length <= 1) continue
          const sorted = [...uniqueOwners].sort((a, b) => a.order - b.order)
          const winner = sorted[sorted.length - 1]

          for (const owner of uniqueOwners) {
            if (owner.modId === winner.modId) continue

            conflicts.push({
              kind: 'overwrite',
              resourcePath: resourcePath.split(path.sep).join('/'),
              existingModId: owner.modId,
              existingModName: owner.name,
              incomingModId: winner.modId,
              incomingModName: winner.name,
              existingOrder: owner.order,
              incomingOrder: winner.order,
              incomingWins: winner.order > owner.order,
            })

            const sWinner = summaryMap.get(winner.modId)
            if (sWinner) sWinner.overwrites += 1
            const sOwner = summaryMap.get(owner.modId)
            if (sOwner) sOwner.overwrittenBy += 1
          }
        }

        const summaries: ModConflictSummary[] = Array.from(summaryMap.entries()).map(([modId, v]) => ({ modId, overwrites: v.overwrites, overwrittenBy: v.overwrittenBy }))
        return { ok: true, data: { summaries, conflicts } }
      } catch (err: unknown) {
        return { ok: false, error: String(err) }
      }
    }
  )

}
