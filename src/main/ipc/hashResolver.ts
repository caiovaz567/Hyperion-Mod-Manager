import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { app } from 'electron'
import { spawn } from 'child_process'
import type { ArchiveResourceEntry, ModMetadata } from '../../shared/types'
import { loadSettings } from '../settings'
import { parseRed4Archive } from './archiveParser'

let hashDb: Map<string, string> | null = null
let hashDbPromise: Promise<Map<string, string>> | null = null
let dbLoaded = false
const resolvedKarkHashes = new Map<string, string | null>()
const lxrsPathCache = new Map<string, { size: number; mtimeMs: number; paths: string[] }>()
let optionalHashPathListsCache: { key: string; paths: string[] } | null = null
let karkDatabaseCandidatesCache: { key: string; paths: string[] } | null = null

const ARCHIVE_HASH_PATTERN = /^(?:0x)?[0-9a-f]{1,16}$/i
const FNV1A64_OFFSET = 0xcbf29ce484222325n
const FNV1A64_PRIME = 0x100000001b3n
const EXTERNAL_HASH_CHUNK_SIZE = 250
const HASH_DB_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024

export function normalizeArchiveHash(value?: string): string | null {
  const normalized = value?.trim().replace(/^0x/i, '').toLowerCase()
  if (!normalized || !ARCHIVE_HASH_PATTERN.test(normalized)) return null
  return normalized.padStart(16, '0')
}

export function normalizeArchiveResourcePath(value?: string): string | null {
  const normalized = value
    ?.trim()
    .split(/[\\/]+/)
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .join('/')

  return normalized || null
}

export function getArchiveResourceDisplayPath(resource: ArchiveResourceEntry): string {
  return normalizeArchiveResourcePath(resource.resourcePath) ?? normalizeArchiveHash(resource.hash) ?? 'Unknown archive resource'
}

export function getArchiveResourceKeys(resource: ArchiveResourceEntry): string[] {
  const keys: string[] = []
  const hash = normalizeArchiveHash(resource.hash)
  const resourcePath = normalizeArchiveResourcePath(resource.resourcePath)

  if (hash) keys.push(`hash:${hash}`)
  if (resourcePath && !normalizeArchiveHash(resourcePath)) keys.push(`path:${resourcePath.toLowerCase()}`)

  return keys
}

export function getArchiveResourceIdentity(resource: ArchiveResourceEntry, fallbackKey?: string): string {
  const hash = normalizeArchiveHash(resource.hash)
  if (hash) return `hash:${hash}`

  const resourcePath = normalizeArchiveResourcePath(resource.resourcePath)
  if (resourcePath) return `path:${resourcePath.toLowerCase()}`

  return fallbackKey ?? 'unknown'
}

export function getStoredArchiveResources(mod: ModMetadata): ArchiveResourceEntry[] {
  const resources: ArchiveResourceEntry[] = []

  if (Array.isArray(mod.archiveResources)) {
    for (const resource of mod.archiveResources) {
      const hash = normalizeArchiveHash(resource.hash)
      const resourcePath = normalizeArchiveResourcePath(resource.resourcePath)
      const archivePath = normalizeArchiveResourcePath(resource.archivePath)

      if (!hash && !resourcePath) continue
      resources.push({
        ...(hash ? { hash } : {}),
        ...(resourcePath ? { resourcePath } : {}),
        ...(archivePath ? { archivePath } : {}),
      })
    }
  }

  if (Array.isArray(mod.hashes)) {
    for (const value of mod.hashes) {
      const hash = normalizeArchiveHash(value)
      if (hash) {
        resources.push({ hash })
        continue
      }

      const resourcePath = normalizeArchiveResourcePath(value)
      if (resourcePath) resources.push({ resourcePath })
    }
  }

  const uniqueResources = new Map<string, ArchiveResourceEntry>()
  for (const resource of resources) {
    const identity = getArchiveResourceIdentity(resource)
    const existing = uniqueResources.get(identity)

    if (!existing) {
      uniqueResources.set(identity, resource)
      continue
    }

    uniqueResources.set(identity, {
      hash: normalizeArchiveHash(existing.hash) ?? normalizeArchiveHash(resource.hash) ?? undefined,
      resourcePath: normalizeArchiveResourcePath(existing.resourcePath) ?? normalizeArchiveResourcePath(resource.resourcePath) ?? undefined,
      archivePath: normalizeArchiveResourcePath(existing.archivePath) ?? normalizeArchiveResourcePath(resource.archivePath) ?? undefined,
    })
  }

  return Array.from(uniqueResources.values())
}

function getResourcesDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(app.getAppPath(), 'src', 'main', 'resources')
}

function calculateArchivePathHash(value: string): string {
  const bytes = Buffer.from(value, 'utf-8')
  let hash = FNV1A64_OFFSET

  for (const byte of bytes) {
    const signedByte = byte > 127 ? byte - 256 : byte
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt.asUintN(64, BigInt(signedByte))) * FNV1A64_PRIME
    )
  }

  return hash.toString(16).padStart(16, '0')
}

function getArchivePathHashCandidates(resourcePath: string): string[] {
  const segments = resourcePath
    .trim()
    .split(/[\\/]+/)
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')

  if (segments.length === 0) return []

  const backslashPath = segments.join('\\')
  const slashPath = segments.join('/')
  const candidates = new Set([
    backslashPath,
    backslashPath.toLowerCase(),
    slashPath,
    slashPath.toLowerCase(),
  ])

  return Array.from(new Set(Array.from(candidates).map(calculateArchivePathHash)))
}

function addKnownPathToDb(map: Map<string, string>, resourcePath?: string): void {
  const rawPath = resourcePath ?? ''
  const displayPath = normalizeArchiveResourcePath(rawPath)
  if (!displayPath) return

  for (const hash of getArchivePathHashCandidates(rawPath)) {
    if (!map.has(hash)) map.set(hash, displayPath)
  }
}

function loadKnownPathList(map: Map<string, string>, listPath: string): void {
  if (!fs.existsSync(listPath)) return

  try {
    const lines = fs.readFileSync(listPath, 'utf-8').split(/\r?\n/)
    for (const line of lines) {
      addKnownPathToDb(map, line)
    }
  } catch {
    // Optional path lists should never block conflict detection.
  }
}

function getOptionalHashPathLists(): string[] {
  const settings = loadSettings()
  const cacheKey = `${settings.gamePath}\n${settings.libraryPath}`
  if (optionalHashPathListsCache?.key === cacheKey) {
    return optionalHashPathListsCache.paths
  }

  const candidates = new Set<string>()

  if (settings.gamePath) {
    candidates.add(path.join(settings.gamePath, 'red4ext', 'plugins', 'Codeware', 'Data', 'KnownHashes.txt'))
  }

  if (settings.libraryPath) {
    candidates.add(path.join(settings.libraryPath, 'Codeware', 'red4ext', 'plugins', 'Codeware', 'Data', 'KnownHashes.txt'))
  }

  const paths = Array.from(candidates)
  optionalHashPathListsCache = { key: cacheKey, paths }
  return paths
}

async function doLoadHashDatabase(): Promise<Map<string, string>> {
  const dbPath = path.join(getResourcesDir(), 'hashes.csv.gz')
  const map = new Map<string, string>()

  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath)
      if (stats.size > HASH_DB_MAX_COMPRESSED_BYTES) {
        throw new Error('Hash database is too large to load')
      }

      const compressed = await fs.promises.readFile(dbPath)
      const decompressed = await new Promise<string>((resolve, reject) => {
        zlib.gunzip(compressed, (err, result) => {
          if (err) reject(err)
          else resolve(result.toString('utf-8'))
        })
      })
      const lines = decompressed.split('\n')

      for (const line of lines) {
        const commaIdx = line.indexOf(',')
        if (commaIdx === -1) continue
        const hash = normalizeArchiveHash(line.slice(0, commaIdx).trim())
        const resourcePath = normalizeArchiveResourcePath(line.slice(commaIdx + 1).trim())
        if (hash && resourcePath) {
          map.set(hash, resourcePath)
        }
      }
    } catch {
      // DB unavailable — conflict detection will use raw hashes
    }
  }

  for (const listPath of getOptionalHashPathLists()) {
    loadKnownPathList(map, listPath)
  }

  dbLoaded = true
  hashDb = map
  return map
}

/**
 * Loads the hashes.csv.gz database (hash → resource path).
 * The database is located at resources/hashes.csv.gz next to the app.
 */
export async function loadHashDatabase(): Promise<Map<string, string>> {
  if (hashDb) return hashDb
  if (!hashDbPromise) hashDbPromise = doLoadHashDatabase()
  return hashDbPromise
}

function getOodlePath(): string | null {
  if (process.platform !== 'win32') return null

  const settings = loadSettings()
  const candidates = [
    settings.gamePath ? path.join(settings.gamePath, 'bin', 'x64', 'oo2ext_7_win64.dll') : '',
  ]

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null
}

async function runPowerShellJsonAsync<T>(scriptName: string, args: string[], fallback: T): Promise<T> {
  if (process.platform !== 'win32') return fallback

  const scriptPath = path.join(getResourcesDir(), scriptName)
  if (!fs.existsSync(scriptPath)) return fallback

  return new Promise<T>((resolve) => {
    let stdout = ''
    let settled = false

    const settle = (value: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
        { windowsHide: true }
      )
    } catch {
      resolve(fallback)
      return
    }

    const MAX_BYTES = 20 * 1024 * 1024
    const timer = setTimeout(() => {
      child.kill()
      settle(fallback)
    }, 60_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > MAX_BYTES) {
        child.kill()
        settle(fallback)
      }
    })

    child.on('error', () => settle(fallback))

    child.on('close', (code) => {
      if (code !== 0) {
        settle(fallback)
        return
      }

      const output = stdout.trim()
      if (!output) {
        settle(fallback)
        return
      }

      try {
        const indices = [output.indexOf('['), output.indexOf('{')].filter((i) => i >= 0)
        if (indices.length === 0) {
          settle(fallback)
          return
        }
        settle(JSON.parse(output.slice(Math.min(...indices))) as T)
      } catch {
        settle(fallback)
      }
    })
  })
}

async function resolveLxrsPaths(archivePath: string): Promise<string[]> {
  const oodlePath = getOodlePath()
  if (!oodlePath) return []

  try {
    const stats = fs.statSync(archivePath)
    const cached = lxrsPathCache.get(archivePath)
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return cached.paths
    }

    const paths = (await runPowerShellJsonAsync<string[]>(
      'resolve-lxrs.ps1',
      ['-ArchivePath', archivePath, '-OodlePath', oodlePath],
      []
    )).filter((value): value is string => typeof value === 'string')

    lxrsPathCache.set(archivePath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      paths,
    })

    return paths
  } catch {
    return []
  }
}

async function buildLxrsPathLookup(archivePath: string): Promise<Map<string, string>> {
  const lookup = new Map<string, string>()

  for (const resourcePath of await resolveLxrsPaths(archivePath)) {
    const displayPath = normalizeArchiveResourcePath(resourcePath)
    if (!displayPath) continue

    for (const hash of getArchivePathHashCandidates(resourcePath)) {
      if (!lookup.has(hash)) lookup.set(hash, displayPath)
    }
  }

  return lookup
}

function getKarkDatabaseCandidates(): string[] {
  const settings = loadSettings()
  const cacheKey = `${settings.gamePath}\n${settings.libraryPath}`
  if (karkDatabaseCandidatesCache?.key === cacheKey) {
    return karkDatabaseCandidatesCache.paths
  }

  const candidates = new Set<string>()

  if (settings.gamePath) {
    candidates.add(path.join(settings.gamePath, 'tools', 'wolvenkit', 'wolvenkit-resources', 'red.kark'))
    candidates.add(path.join(settings.gamePath, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'tweakdb', 'usedhashes.kark'))
  }

  const wolvenKitRoaming = path.join(app.getPath('appData'), 'REDModding', 'WolvenKit')
  candidates.add(path.join(wolvenKitRoaming, 'red.kark'))

  if (settings.libraryPath) {
    candidates.add(path.join(settings.libraryPath, 'CET_1.37.1_-_Scripting_fixes', 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'tweakdb', 'usedhashes.kark'))
    candidates.add(path.join(settings.libraryPath, 'Codeware', 'red.kark'))
  }

  const paths = Array.from(candidates).filter((candidate) => fs.existsSync(candidate))
  karkDatabaseCandidatesCache = { key: cacheKey, paths }
  return paths
}

async function resolveHashesFromKark(targetHashes: string[]): Promise<Map<string, string>> {
  const oodlePath = getOodlePath()
  const normalizedTargets = Array.from(new Set(targetHashes.map((hash) => normalizeArchiveHash(hash)).filter((hash): hash is string => Boolean(hash))))
  const unresolvedTargets = normalizedTargets.filter((hash) => !resolvedKarkHashes.has(hash))

  if (oodlePath && unresolvedTargets.length > 0) {
    const karkPaths = getKarkDatabaseCandidates()

    for (let index = 0; index < unresolvedTargets.length; index += EXTERNAL_HASH_CHUNK_SIZE) {
      const chunk = unresolvedTargets.slice(index, index + EXTERNAL_HASH_CHUNK_SIZE)
      const remaining = new Set(chunk)

      for (const karkPath of karkPaths) {
        if (remaining.size === 0) break

        const matches = await runPowerShellJsonAsync<Record<string, string>>(
          'resolve-kark-hashes.ps1',
          ['-KarkPath', karkPath, '-OodlePath', oodlePath, '-Hashes', Array.from(remaining).join(',')],
          {}
        )

        for (const [rawHash, rawPath] of Object.entries(matches)) {
          const hash = normalizeArchiveHash(rawHash)
          const resourcePath = normalizeArchiveResourcePath(rawPath)
          if (!hash || !resourcePath || !remaining.has(hash)) continue

          resolvedKarkHashes.set(hash, resourcePath)
          remaining.delete(hash)
        }
      }

      for (const hash of remaining) {
        resolvedKarkHashes.set(hash, null)
      }
    }
  } else {
    for (const hash of unresolvedTargets) {
      resolvedKarkHashes.set(hash, null)
    }
  }

  const resolved = new Map<string, string>()
  for (const hash of normalizedTargets) {
    const resourcePath = resolvedKarkHashes.get(hash)
    if (resourcePath) resolved.set(hash, resourcePath)
  }

  return resolved
}

/**
 * Extracts all FNV1a64 hashes from .archive files in a directory
 * and resolves them to resource paths when the DB is available.
 */
export async function resolveArchiveResources(modDir: string): Promise<ArchiveResourceEntry[]> {
  const db = await loadHashDatabase()
  const resourcesByHash = new Map<string, ArchiveResourceEntry>()
  const unresolvedHashes = new Set<string>()

  const archiveFiles = findArchives(modDir)
  for (const archivePath of archiveFiles) {
    const entries = parseRed4Archive(archivePath)
    if (!entries) continue
    const relativeArchivePath = normalizeArchiveResourcePath(path.relative(modDir, archivePath)) ?? path.basename(archivePath)
    const lxrsLookup = await buildLxrsPathLookup(archivePath)

    for (const entry of entries) {
      const hashStr = entry.hash.toString(16).padStart(16, '0')
      const resolved = normalizeArchiveResourcePath(lxrsLookup.get(hashStr) ?? db.get(hashStr))
      const existing = resourcesByHash.get(hashStr)
      if (!resolved && !existing?.resourcePath) unresolvedHashes.add(hashStr)
      if (resolved) unresolvedHashes.delete(hashStr)

      resourcesByHash.set(hashStr, {
        hash: hashStr,
        resourcePath: existing?.resourcePath ?? resolved ?? undefined,
        archivePath: existing?.archivePath ?? relativeArchivePath,
      })
    }

    for (const [hash, resourcePath] of lxrsLookup.entries()) {
      if (resourcesByHash.has(hash)) continue
      resourcesByHash.set(hash, {
        hash,
        resourcePath,
        archivePath: relativeArchivePath,
      })
    }
  }

  if (unresolvedHashes.size > 0) {
    const resolvedFromKark = await resolveHashesFromKark(Array.from(unresolvedHashes))
    for (const [hash, resourcePath] of resolvedFromKark.entries()) {
      const existing = resourcesByHash.get(hash)
      if (!existing || existing.resourcePath) continue
      resourcesByHash.set(hash, { ...existing, resourcePath })
    }
  }

  return Array.from(resourcesByHash.values()).sort((left, right) =>
    getArchiveResourceDisplayPath(left).localeCompare(getArchiveResourceDisplayPath(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  )
}

export async function hydrateArchiveResourcePaths(
  resources: ArchiveResourceEntry[]
): Promise<ArchiveResourceEntry[]> {
  const db = await loadHashDatabase()
  const missingHashes = resources
    .map((resource) => normalizeArchiveHash(resource.hash))
    .filter((hash): hash is string => Boolean(hash))
    .filter((hash, index, hashes) => hashes.indexOf(hash) === index)
    .filter((hash) => !db.has(hash))
  const resolvedFromKark = await resolveHashesFromKark(missingHashes)

  return resources.map((resource) => {
    const hash = normalizeArchiveHash(resource.hash)
    if (!hash || resource.resourcePath) return resource

    const resolved = normalizeArchiveResourcePath(db.get(hash) ?? resolvedFromKark.get(hash))
    return resolved ? { ...resource, hash, resourcePath: resolved } : { ...resource, hash }
  })
}

export async function resolveHashes(modDir: string): Promise<string[]> {
  const resources = await resolveArchiveResources(modDir)
  return resources.map((resource) => resource.hash).filter((hash): hash is string => Boolean(hash))
}

function findArchives(dir: string, depth = 0): string[] {
  if (depth > 4) return []
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findArchives(full, depth + 1))
      } else if (entry.name.endsWith('.archive')) {
        results.push(full)
      }
    }
  } catch { /* ignore */ }
  return results
}

/**
 * Pre-loads the hash database at startup for fast conflict detection.
 */
export async function preloadHashDatabase(): Promise<void> {
  await loadHashDatabase()
}
