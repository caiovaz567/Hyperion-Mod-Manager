import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type {
  ModMetadata,
  IpcResult,
  PurgeModsResult,
  ConflictInfo,
  ModConflictSummary,
  ModTreeCreateEntryRequest,
  ModTreeRenameEntryRequest,
  ModTreeDeleteEntryRequest,
  ArchiveResourceEntry,
} from '../../shared/types'
import { pushGeneralLog } from '../logStore'
import { loadSettings } from '../settings'
import { detectModType } from './archiveParser'
import {
  getArchiveResourceDisplayPath,
  getArchiveResourceIdentity,
  getArchiveResourceKeys,
  getStoredArchiveResources,
  hydrateArchiveResourcePaths,
  resolveArchiveResources,
} from './hashResolver'
import {
  listFilesRecursive,
  getPathSizeSafe,
} from '../fileUtils'

type ConflictCalculationOptions = {
  refreshArchiveResources?: boolean
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

function sanitizeModFolderName(rawName: string): string {
  const cleaned = rawName
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return cleaned || 'mod'
}

function getUniqueModFolderName(
  libraryPath: string,
  rawName: string,
  excludeDirPath?: string
): string {
  const baseName = sanitizeModFolderName(rawName)
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

function readArchiveSidecar(modDir: string): { version: number; resources: ArchiveResourceEntry[] } | null {
  try {
    const sidecarPath = path.join(modDir, ARCHIVE_SIDECAR_FILE)
    if (fs.existsSync(sidecarPath)) {
      return JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'))
    }
  } catch {
    // corrupt sidecar
  }
  return null
}

export function writeArchiveSidecar(modDir: string, resources: ArchiveResourceEntry[], version: number): void {
  fs.writeFileSync(
    path.join(modDir, ARCHIVE_SIDECAR_FILE),
    JSON.stringify({ version, resources }, null, 2),
    'utf-8'
  )
}

const GAME_ROOT_DIRS = new Set(['archive', 'bin', 'engine', 'mods', 'r6', 'red4ext'])
const ARCHIVE_EXTENSIONS = new Set(['.archive', '.xl'])
const LOAD_ORDERED_ARCHIVE_EXTENSION = '.archive'
const ARCHIVE_MOD_DEPLOY_DIR = path.join('archive', 'pc', 'mod')
export const ARCHIVE_RESOURCE_INDEX_VERSION = 3
const ARCHIVE_SIDECAR_FILE = '_archive_resources.json'
const METADATA_FILE = '_metadata.json'

function isHyperionInternalFile(relFile: string): boolean {
  const normalized = normalizeRelativePath(relFile).toLowerCase()
  return normalized === METADATA_FILE || normalized === ARCHIVE_SIDECAR_FILE
}

function getScannedModFiles(modDir: string): string[] {
  return listFilesRecursive(modDir).filter((relFile) => !isHyperionInternalFile(relFile))
}

export function isLoadOrderedArchiveDeployPath(relativeDeployPath: string): boolean {
  const normalized = normalizeRelativePath(relativeDeployPath)
  const lower = normalized.toLowerCase()
  const archiveModDir = ARCHIVE_MOD_DEPLOY_DIR.toLowerCase()
  return (
    path.extname(lower) === LOAD_ORDERED_ARCHIVE_EXTENSION
    && lower.startsWith(`${archiveModDir}${path.sep}`)
  )
}

function stableAsciiHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

function safeVirtualArchiveSegment(value: string | undefined, fallback: string): string {
  const normalized = (value ?? '').normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/^_+|_+$/g, '')

  return (normalized || fallback).slice(0, 48)
}

function buildLoadOrderedArchiveDeployPath(
  mod: ModMetadata,
  relFile: string,
  deployPath: string,
  highestOrder: number
): string {
  const rank = Math.max(0, highestOrder - mod.order).toString().padStart(6, '0')
  const uniqueId = stableAsciiHash(`${mod.uuid}:${relFile}:${deployPath}`)
  const modSegment = safeVirtualArchiveSegment(mod.name || mod.folderName || mod.uuid, 'mod')
  const archiveSegment = safeVirtualArchiveSegment(path.basename(deployPath, path.extname(deployPath)), 'archive')
  return path.join(
    ARCHIVE_MOD_DEPLOY_DIR,
    `!${rank}__${uniqueId}__${modSegment}__${archiveSegment}${LOAD_ORDERED_ARCHIVE_EXTENSION}`
  )
}

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
    return mod.deployedPaths.filter((relFile) => !isHyperionInternalFile(relFile))
  }

  if (!Array.isArray(mod.files)) return []
  return mod.files
    .filter((relFile) => !isHyperionInternalFile(relFile))
    .map((relFile) => getDeployRelativePath(mod, relFile))
}

function hasArchivePayload(files: string[]): boolean {
  return files.some((file) => path.extname(file).toLowerCase() === '.archive')
}

function archiveResourcesEqual(left: ArchiveResourceEntry[], right: ArchiveResourceEntry[]): boolean {
  if (left.length !== right.length) return false

  const normalize = (resources: ArchiveResourceEntry[]) =>
    resources
      .map((resource) => JSON.stringify({
        hash: resource.hash ?? '',
        resourcePath: resource.resourcePath ?? '',
        archivePath: resource.archivePath ?? '',
      }))
      .sort()

  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function hasUnresolvedArchiveResources(resources: ArchiveResourceEntry[]): boolean {
  return resources.some((resource) => Boolean(resource.hash) && !resource.resourcePath)
}

async function refreshArchiveResourceMetadata(
  modDir: string,
  meta: ModMetadata,
  options: { deep?: boolean } = {}
): Promise<boolean> {
  if (meta.kind !== 'mod') return false

  const files = Array.isArray(meta.files) ? meta.files : []
  const containsArchivePayload = hasArchivePayload(files)
  if (!containsArchivePayload) {
    let changed = false
    const sidecarPath = path.join(modDir, ARCHIVE_SIDECAR_FILE)
    if (fs.existsSync(sidecarPath)) {
      try { fs.unlinkSync(sidecarPath) } catch {}
      changed = true
    }
    if (meta.archiveResources !== undefined) {
      delete meta.archiveResources
      changed = true
    }
    if (meta.archiveResourceIndexVersion !== undefined) {
      delete meta.archiveResourceIndexVersion
      changed = true
    }
    return changed
  }

  const storedResources = getStoredArchiveResources(meta)
  if (!options.deep) {
    return false
  }

  // Already indexed at current version — skip loading the hash DB and running external scripts.
  if (
    Array.isArray(meta.archiveResources) &&
    meta.archiveResourceIndexVersion === ARCHIVE_RESOURCE_INDEX_VERSION &&
    storedResources.length > 0
  ) {
    if (!hasUnresolvedArchiveResources(storedResources)) {
      return false
    }

    const hydratedResources = await hydrateArchiveResourcePaths(storedResources)
    if (archiveResourcesEqual(storedResources, hydratedResources)) {
      return false
    }

    meta.archiveResources = hydratedResources
    writeArchiveSidecar(modDir, hydratedResources, ARCHIVE_RESOURCE_INDEX_VERSION)
    return true
  }

  const parsedResources = await resolveArchiveResources(modDir)
  const nextResources = parsedResources.length > 0
    ? parsedResources
    : await hydrateArchiveResourcePaths(storedResources)

  let changed = false
  if (!Array.isArray(meta.archiveResources) || !archiveResourcesEqual(storedResources, nextResources)) {
    meta.archiveResources = nextResources
    writeArchiveSidecar(modDir, nextResources, ARCHIVE_RESOURCE_INDEX_VERSION)
    changed = true
  }

  if (meta.archiveResourceIndexVersion !== ARCHIVE_RESOURCE_INDEX_VERSION) {
    meta.archiveResourceIndexVersion = ARCHIVE_RESOURCE_INDEX_VERSION
    changed = true
  }

  return changed
}

function chooseArchiveResourceDisplay(resources: ArchiveResourceEntry[]): ArchiveResourceEntry {
  const withPath = resources.find((resource) => resource.resourcePath)
  const withHash = resources.find((resource) => resource.hash)

  return {
    hash: withPath?.hash ?? withHash?.hash,
    resourcePath: withPath?.resourcePath,
    archivePath: withPath?.archivePath ?? withHash?.archivePath,
  }
}

function addArchiveOwner(
  ownersByKey: Map<string, Array<{ modId: string; name: string; order: number; resource: ArchiveResourceEntry }>>,
  mod: ModMetadata,
  resource: ArchiveResourceEntry
): void {
  for (const key of getArchiveResourceKeys(resource)) {
    const owners = ownersByKey.get(key) ?? []
    if (!owners.some((owner) => owner.modId === mod.uuid && getArchiveResourceIdentity(owner.resource, key) === getArchiveResourceIdentity(resource, key))) {
      owners.push({ modId: mod.uuid, name: mod.name, order: mod.order, resource })
    }
    ownersByKey.set(key, owners)
  }
}

function resolveScannedModDir(libraryPath: string, mod: ModMetadata): { mod: ModMetadata; dir: string } | null {
  const directDir = path.join(libraryPath, getModFolderKey(mod))
  const directMeta = readMetadata(directDir)
  if (directMeta?.uuid === mod.uuid) {
    return { mod: directMeta, dir: directDir }
  }

  return findModDir(libraryPath, mod.uuid)
}

/**
 * Deployment is virtual: enabled mods are mapped into the game by the usvfs VFS
 * at Launch Game (see `buildEnabledModLinks` + `IPC.LAUNCH_GAME`). Nothing is
 * ever written into the game folder, so this is a no-op that simply returns the
 * current library — kept as the single chokepoint that callers invoke to refresh
 * state after enable/disable/install/reorder.
 */
async function redeployEnabledMods(
  gamePath: string,
  libraryPath: string,
  sourceMods?: ModMetadata[]
): Promise<IpcResult<ModMetadata[]>> {
  if (!gamePath) return { ok: false, error: 'Game path not set' }
  return { ok: true, data: sourceMods ?? await scanMods(libraryPath) }
}

/**
 * Computes the ordered list of directory mounts for all enabled mods — the
 * mapping the usvfs VFS virtually links over the game tree at launch.
 *
 * Each file's deploy path is reduced to the shallowest `sourceDir -> destDir`
 * mount by peeling the longest common path suffix, then linked **as a recursive
 * directory** so usvfs creates folders that don't exist in the game (e.g.
 * `bin/x64/plugins`). Per-file linking can't do this — usvfs requires a file's
 * destination directory to already exist.
 *
 * Order matches load order (ascending priority): a later mod's link overrides an
 * earlier one on shared paths, realizing MO2-style "higher load order wins".
 * Cyberpunk archive conflicts are special: the game resolves resources by archive
 * filename order, so .archive files are given unique virtual names where lower UI
 * entries sort first.
 */
export async function buildEnabledModLinks(
  gamePath: string,
  libraryPath: string,
  sourceMods?: ModMetadata[]
): Promise<{ source: string; dest: string; dir: boolean }[]> {
  if (!gamePath) return []

  const mods = sourceMods ?? await scanMods(libraryPath)
  const enabledMods = mods.filter((mod) => mod.kind === 'mod' && mod.enabled)
  const highestOrder = enabledMods.reduce((highest, mod) => Math.max(highest, mod.order), 0)
  const links: { source: string; dest: string; dir: boolean }[] = []

  // An empty real directory used to materialize virtual game folders that don't
  // exist yet (e.g. archive/pc/mod) before linking loose files into them.
  const emptyDir = path.join(os.tmpdir(), 'hyperion-vfs-empty')
  try { fs.mkdirSync(emptyDir, { recursive: true }) } catch { /* ignore */ }

  for (const mod of enabledMods) {
    const resolvedMod = resolveScannedModDir(libraryPath, mod)
    const metadata = resolvedMod?.mod ?? mod
    const modFolderKey = getModFolderKey(metadata)
    const modDir = resolvedMod?.dir ?? path.join(libraryPath, modFolderKey)
    const modFiles = Array.isArray(metadata.files) ? metadata.files : []
    const seen = new Set<string>()

    for (const relFile of modFiles) {
      if (isHyperionInternalFile(relFile)) continue

      const normalizedRelativePath = normalizeRelativePath(relFile)
      const src = path.join(modDir, normalizedRelativePath)
      if (!fs.existsSync(src)) continue

      const rawDeployPath = normalizeRelativePath(getDeployRelativePath(metadata, normalizedRelativePath))
      const useLoadOrderedArchiveName = isLoadOrderedArchiveDeployPath(rawDeployPath)
      const relativeDeployPath = useLoadOrderedArchiveName
        ? buildLoadOrderedArchiveDeployPath(metadata, normalizedRelativePath, rawDeployPath, highestOrder)
        : rawDeployPath
      const fileDest = resolveDeploymentTarget(gamePath, relativeDeployPath)
      if (!fileDest) continue

      const srcSegs = normalizedRelativePath.split('\\').filter(Boolean)
      const destSegs = relativeDeployPath.split('\\').filter(Boolean)
      if (useLoadOrderedArchiveName) {
        const destParent = path.dirname(fileDest)
        const dirKey = `mk:${destParent}`
        if (!seen.has(dirKey)) {
          seen.add(dirKey)
          links.push({ source: emptyDir, dest: destParent, dir: true })
        }

        const fileKey = `file:${src}\0${fileDest}`
        if (!seen.has(fileKey)) {
          seen.add(fileKey)
          links.push({ source: src, dest: fileDest, dir: false })
        }
        continue
      }

      // A loose file at the mod root has no source directory to mount. usvfs can't
      // link a file whose target folder doesn't exist, so first materialize that
      // folder virtually from an empty directory, then link the file into it.
      if (srcSegs.length <= 1) {
        const destParent = path.dirname(fileDest)
        const dirKey = `mk:${destParent}`
        if (!seen.has(dirKey)) {
          seen.add(dirKey)
          links.push({ source: emptyDir, dest: destParent, dir: true })
        }
        if (!seen.has(src)) {
          seen.add(src)
          links.push({ source: src, dest: fileDest, dir: false })
        }
        continue
      }

      // Nested file: peel common trailing segments but keep the mod's top-level
      // directory, so the mount is e.g. modDir/bin -> game/bin (recursive) and the
      // mod root (with _metadata.json) is never linked.
      let i = srcSegs.length - 1
      let j = destSegs.length - 1
      while (i >= 1 && j >= 1 && srcSegs[i].toLowerCase() === destSegs[j].toLowerCase()) {
        i -= 1
        j -= 1
      }

      const mountSource = path.join(modDir, ...srcSegs.slice(0, i + 1))
      const mountDest = path.join(gamePath, ...destSegs.slice(0, j + 1))
      const key = `${mountSource}\0${mountDest}`
      if (seen.has(key)) continue
      seen.add(key)

      links.push({ source: mountSource, dest: mountDest, dir: true })
    }
  }

  // Deduplicate across mods: the per-mod seen set only prevents duplicates within
  // one mod, but multiple mods can produce the same link (e.g. emptyDir → archive/pc/mod
  // for each mod that has load-ordered archives). usvfs fails repeated identical links.
  const globalSeen = new Set<string>()
  return links.filter((link) => {
    const key = `${link.source}\0${link.dest}`
    if (globalSeen.has(key)) return false
    globalSeen.add(key)
    return true
  })
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

function readMetadata(modDir: string): ModMetadata | null {
  const metaPath = path.join(modDir, '_metadata.json')
  try {
    if (!fs.existsSync(metaPath)) return null
    const raw: ModMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))

    // Migrate old format: move archive data to sidecar if not already there
    let sidecar = readArchiveSidecar(modDir)
    if (!sidecar && Array.isArray(raw.archiveResources) && raw.archiveResources.length > 0) {
      writeArchiveSidecar(modDir, raw.archiveResources, raw.archiveResourceIndexVersion ?? ARCHIVE_RESOURCE_INDEX_VERSION)
      sidecar = { version: raw.archiveResourceIndexVersion ?? ARCHIVE_RESOURCE_INDEX_VERSION, resources: raw.archiveResources }
    }

    // Strip legacy fields from disk if still present
    if (raw.hashes !== undefined || raw.archiveResources !== undefined || raw.archiveResourceIndexVersion !== undefined) {
      const clean: ModMetadata = { ...raw }
      delete clean.hashes
      delete clean.archiveResources
      delete clean.archiveResourceIndexVersion
      fs.writeFileSync(metaPath, JSON.stringify(clean, null, 2), 'utf-8')
    }

    // Build in-memory meta: strip legacy fields, populate from sidecar
    const meta: ModMetadata = { ...raw }
    delete meta.hashes
    delete meta.archiveResources
    delete meta.archiveResourceIndexVersion
    if (sidecar) {
      meta.archiveResources = sidecar.resources
      meta.archiveResourceIndexVersion = sidecar.version
    }

    return meta
  } catch {
    // corrupt metadata
  }
  return null
}

function writeMetadata(modDir: string, meta: ModMetadata): void {
  const clean: ModMetadata = { ...meta }
  delete clean.hashes
  delete clean.archiveResources
  delete clean.archiveResourceIndexVersion
  fs.writeFileSync(
    path.join(modDir, '_metadata.json'),
    JSON.stringify(clean, null, 2),
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
    files: [METADATA_FILE],
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
  let scannedMods = await scanMods(libraryPath, { refreshFileMetadata: true })
  let updatedMod = scannedMods.find((entry) => entry.uuid === modId)
  if (!updatedMod) return { ok: false, error: 'Mod not found after file operation' }

  if (updatedMod.enabled) {
    const syncResult = await enableMod(updatedMod, gamePath, libraryPath)
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error ?? 'Could not resync modified mod' }
    }

    scannedMods = await scanMods(libraryPath, { refreshFileMetadata: true })
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
  if (isHyperionInternalFile(targetInfo.normalized)) {
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
  if (isHyperionInternalFile(sourceInfo.normalized)) {
    return { ok: false, error: 'Reserved file cannot be renamed' }
  }
  if (!fs.existsSync(sourceInfo.absolute)) return { ok: false, error: 'Entry not found' }

  const targetInfo = resolvePathInsideModDir(found.dir, path.join(path.dirname(sourceInfo.normalized), nextName))
  if (!targetInfo) return { ok: false, error: 'Invalid destination path' }
  if (isHyperionInternalFile(targetInfo.normalized)) {
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
    const sourcePrefix = `${sourceInfo.normalized}/`
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
  if (isHyperionInternalFile(targetInfo.normalized)) {
    return { ok: false, error: 'Reserved file cannot be deleted' }
  }
  if (!fs.existsSync(targetInfo.absolute)) return { ok: false, error: 'Entry not found' }

  fs.rmSync(targetInfo.absolute, { recursive: true, force: true })
  if (found.mod.kind === 'mod') {
    const removedPrefix = `${targetInfo.normalized}/`
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

export async function scanMods(
  libraryPath: string,
  options: { refreshArchiveResources?: boolean; refreshFileMetadata?: boolean } = {}
): Promise<ModMetadata[]> {
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
          const shouldRefreshFileMetadata = Boolean(options.refreshFileMetadata)
          const normalizedFiles = (shouldRefreshFileMetadata || !Array.isArray(meta.files)
            ? getScannedModFiles(modDir)
            : meta.files.filter((relFile) => !isHyperionInternalFile(relFile)))
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

          if (shouldRefreshFileMetadata || !meta.type || meta.type === 'unknown') {
            const detectedType = detectModType(modDir)
            if (detectedType !== 'unknown' && meta.type !== detectedType) {
              meta.type = detectedType
              shouldWrite = true
            }
          }

          if (shouldRefreshFileMetadata || typeof meta.fileSize !== 'number') {
            const computedFileSize = getPathSizeSafe(modDir)
            if (meta.fileSize !== computedFileSize) {
              meta.fileSize = computedFileSize
              shouldWrite = true
            }
          }

          const sourceModifiedAt = getSourceModifiedAt(meta.sourcePath)
          if (sourceModifiedAt && meta.sourceModifiedAt !== sourceModifiedAt) {
            meta.sourceModifiedAt = sourceModifiedAt
            shouldWrite = true
          }

          if (await refreshArchiveResourceMetadata(modDir, meta, { deep: options.refreshArchiveResources })) {
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

  // With virtual (VFS) deployment there is nothing on disk to remove — purging is
  // just flipping every enabled mod off in the library. The VFS reflects this on
  // the next Launch Game.
  for (const mod of enabledMods) {
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
      } else if (found.mod.kind === 'mod' && typeof updates.name === 'string') {
        // Keep the on-disk folder name in sync with the display name on rename.
        const nextName = updates.name.trim() || found.mod.name
        const nextFolderName = getUniqueModFolderName(settings.libraryPath, nextName, found.dir)
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
    async (
      _event,
      options?: ConflictCalculationOptions
    ): Promise<IpcResult<{ summaries: ModConflictSummary[]; conflicts: ConflictInfo[] }>> => {
      try {
        const settings = loadSettings()
        const mods = await scanMods(settings.libraryPath, {
          refreshArchiveResources: options?.refreshArchiveResources === true,
        })

        const pathOwners = new Map<string, Array<{ modId: string; name: string; order: number }>>()
        const archiveOwners = new Map<string, Array<{ modId: string; name: string; order: number; resource: ArchiveResourceEntry }>>()

        for (const mod of mods.filter((m) => m.kind === 'mod' && m.enabled)) {
          for (const rel of getTrackedDeploymentPaths(mod)) {
            const normalized = normalizeRelativePath(rel)
            if (!normalized) continue
            if (isLoadOrderedArchiveDeployPath(normalized)) continue
            const owners = pathOwners.get(normalized) ?? []
            if (!owners.find((o) => o.modId === mod.uuid)) {
              owners.push({ modId: mod.uuid, name: mod.name, order: mod.order })
            }
            pathOwners.set(normalized, owners)
          }

          for (const resource of getStoredArchiveResources(mod)) {
            addArchiveOwner(archiveOwners, mod, resource)
          }
        }

        const conflicts: ConflictInfo[] = []
        const summaryMap = new Map<string, { overwrites: Set<string>; overwrittenBy: Set<string> }>()
        for (const m of mods) summaryMap.set(m.uuid, { overwrites: new Set<string>(), overwrittenBy: new Set<string>() })
        const resourceKeysByMod = new Map<string, Set<string>>()
        for (const m of mods) resourceKeysByMod.set(m.uuid, new Set<string>())
        const addResourceKeysForOwners = (
          owners: Array<{ modId: string }>,
          summaryResourceKey: string
        ) => {
          for (const owner of owners) {
            resourceKeysByMod.get(owner.modId)?.add(summaryResourceKey)
          }
        }
        const addSummaryByLoadOrder = (
          owners: Array<{ modId: string; name: string; order: number }>,
          summaryResourceKey: string
        ) => {
          owners.forEach((owner, index) => {
            const summary = summaryMap.get(owner.modId)
            if (!summary) return
            if (index > 0) summary.overwrites.add(summaryResourceKey)
            if (index < owners.length - 1) summary.overwrittenBy.add(summaryResourceKey)
          })
        }

        for (const [resourcePath, owners] of pathOwners.entries()) {
          const uniqueOwners = Array.from(new Map(owners.map((o) => [o.modId, o])).values())
          const summaryResourceKey = `overwrite:${resourcePath}`
          addResourceKeysForOwners(uniqueOwners, summaryResourceKey)
          if (uniqueOwners.length <= 1) continue
          const sorted = [...uniqueOwners].sort((a, b) => a.order - b.order)
          addSummaryByLoadOrder(sorted, summaryResourceKey)

          for (let lowerIndex = 0; lowerIndex < sorted.length - 1; lowerIndex += 1) {
            const lowerOwner = sorted[lowerIndex]
            for (let higherIndex = lowerIndex + 1; higherIndex < sorted.length; higherIndex += 1) {
              const higherOwner = sorted[higherIndex]
              conflicts.push({
                kind: 'overwrite',
                resourcePath: resourcePath.split(path.sep).join('/'),
                existingModId: lowerOwner.modId,
                existingModName: lowerOwner.name,
                incomingModId: higherOwner.modId,
                incomingModName: higherOwner.name,
                existingOrder: lowerOwner.order,
                incomingOrder: higherOwner.order,
                incomingWins: higherOwner.order > lowerOwner.order,
              })
            }
          }
        }

        const seenArchiveConflicts = new Set<string>()
        for (const [resourceKey, owners] of archiveOwners.entries()) {
          const uniqueOwners = Array.from(new Map(owners.map((owner) => [owner.modId, owner])).values())
          const displayResource = chooseArchiveResourceDisplay(uniqueOwners.map((owner) => owner.resource))
          const conflictIdentity = getArchiveResourceIdentity(displayResource, resourceKey)
          const summaryResourceKey = `archive:${conflictIdentity}`
          addResourceKeysForOwners(uniqueOwners, summaryResourceKey)
          if (uniqueOwners.length <= 1) continue

          const sorted = [...uniqueOwners].sort((a, b) => a.order - b.order)
          addSummaryByLoadOrder(sorted, summaryResourceKey)

          for (let lowerIndex = 0; lowerIndex < sorted.length - 1; lowerIndex += 1) {
            const lowerOwner = sorted[lowerIndex]
            for (let higherIndex = lowerIndex + 1; higherIndex < sorted.length; higherIndex += 1) {
              const higherOwner = sorted[higherIndex]
              const dedupeKey = `${lowerOwner.modId}:${higherOwner.modId}:${conflictIdentity}`
              if (seenArchiveConflicts.has(dedupeKey)) continue
              seenArchiveConflicts.add(dedupeKey)

              conflicts.push({
                kind: 'archive-resource',
                hash: displayResource.hash,
                resourcePath: getArchiveResourceDisplayPath(displayResource),
                existingModId: lowerOwner.modId,
                existingModName: lowerOwner.name,
                incomingModId: higherOwner.modId,
                incomingModName: higherOwner.name,
                existingOrder: lowerOwner.order,
                incomingOrder: higherOwner.order,
                incomingWins: higherOwner.order > lowerOwner.order,
              })
            }
          }
        }

        const summaries: ModConflictSummary[] = Array.from(summaryMap.entries()).map(([modId, v]) => {
          const resourceCount = resourceKeysByMod.get(modId)?.size ?? 0
          return {
            modId,
            overwrites: v.overwrites.size,
            overwrittenBy: v.overwrittenBy.size,
            redundant: resourceCount > 0 && v.overwrittenBy.size >= resourceCount,
          }
        })
        return { ok: true, data: { summaries, conflicts } }
      } catch (err: unknown) {
        return { ok: false, error: String(err) }
      }
    }
  )

}
