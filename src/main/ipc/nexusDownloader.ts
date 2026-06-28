import { app, ipcMain, net } from 'electron'
import type { BrowserWindow } from 'electron'
import type { IncomingMessage } from 'http'
import https from 'https'
import fs from 'fs'
import crypto from 'crypto'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type {
  IpcResult,
  NxmDownloadStartRequest,
  NxmDownloadStartResponse,
  NxmLinkPayload,
  NexusValidateResult,
  ModUpdateCheckRequest,
  ModUpdateCheckResult,
  ModUpdateStatus,
  ModUpdateState,
} from '../../shared/types'
import { parseNxmUrl } from '../../shared/nxm'
import { pushGeneralLog, pushRequestLog, safeSendToWindow } from '../logStore'
import { loadSettings } from '../settings'
import { findNexusDownloadRecord, removeNexusDownloadRecordByPath, upsertNexusDownloadRecord } from '../nexusDownloadRegistry'
import { findModDir } from './modManager'

const NEXUS_API = 'https://api.nexusmods.com/v1'
const APPLICATION_NAME = 'Hyperion'
const APPLICATION_VERSION = app.getVersion()
const USER_AGENT = `${APPLICATION_NAME}-${APPLICATION_VERSION}`
const GAME_DOMAIN = 'cyberpunk2077'
const NEXUS_REQUEST_TIMEOUT_MS = 20_000
const inFlightApiRequests = new Map<string, Promise<IpcResult<unknown>>>()

interface RawNexusValidateResult {
  userId?: number | string
  user_id?: number | string
  key?: string
  name?: string
  username?: string
  isPremium?: boolean | string | number
  is_premium?: boolean | string | number
  premium?: boolean | string | number
  email?: string
}

interface LoggedSecretValue {
  __hyperionSecret: true
  masked: string
  value: string
}

function buildErrorDetails(error: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string }
    return {
      ...extra,
      error: error.message,
      code: errorWithCode.code,
    }
  }

  return {
    ...extra,
    error: String(error),
  }
}

function createLoggedSecretValue(value: unknown): LoggedSecretValue {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const masked = text.length <= 8
    ? '[hidden]'
    : `${text.slice(0, 4)}...${text.slice(-4)}`

  return {
    __hyperionSecret: true,
    masked,
    value: text,
  }
}

function maskSensitiveUrl(raw: string): string {
  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw, NEXUS_API)

    for (const key of ['key', 'apikey', 'apiKey']) {
      const value = url.searchParams.get(key)
      if (!value) continue
      const masked = createLoggedSecretValue(value).masked
      url.searchParams.set(key, masked)
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return url.toString()
    }

    return `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!payload) return null

  const sanitizedEntries = Object.entries(payload).map(([key, value]) => {
    if (key === 'apiKey' || key === 'key' || key === 'apikey') {
      return [key, createLoggedSecretValue(value)]
    }
    if ((key === 'endpoint' || key === 'url') && typeof value === 'string') {
      return [key, maskSensitiveUrl(value)]
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return [key, sanitizePayload(value as Record<string, unknown>)]
    }
    if (Array.isArray(value)) {
      return [key, value.map((item) => (
        item && typeof item === 'object'
          ? sanitizePayload(item as Record<string, unknown>)
          : item
      ))]
    }
    return [key, value]
  })

  return Object.fromEntries(sanitizedEntries)
}

function summarizeNexusFileEntryForLog(file: NexusFileEntry): Record<string, unknown> {
  return {
    file_id: file.file_id,
    name: file.name,
    version: file.version ?? file.mod_version,
    category_name: file.category_name,
    is_primary: file.is_primary,
    uploaded_timestamp: file.uploaded_timestamp,
  }
}

function summarizeNexusResponseForLog(endpoint: string, data: unknown): unknown {
  if (
    endpoint.includes('/files.json') &&
    data &&
    typeof data === 'object' &&
    Array.isArray((data as NexusFilesResponse).files)
  ) {
    const files = (data as NexusFilesResponse).files ?? []
    const fileUpdates = (data as NexusFilesResponse).file_updates ?? []
    return {
      files: {
        count: files.length,
        sample: files.slice(0, 8).map(summarizeNexusFileEntryForLog),
        omitted: Math.max(0, files.length - 8),
      },
      file_updates: {
        count: fileUpdates.length,
        sample: fileUpdates.slice(0, 8),
        omitted: Math.max(0, fileUpdates.length - 8),
      },
    }
  }

  if (endpoint.includes('/updated.json') && Array.isArray(data)) {
    const entries = data as NexusUpdatedMod[]
    return {
      count: entries.length,
      sample: entries.slice(0, 12),
      omitted: Math.max(0, entries.length - 12),
    }
  }

  return data
}

// ─── Nexus API Client ─────────────────────────────────────────────────────────

async function nexusGet<T>(
  endpoint: string,
  apiKey: string,
  mainWindow: BrowserWindow | null,
  requestPayload?: Record<string, unknown>,
): Promise<IpcResult<T>> {
  const url = `${NEXUS_API}${endpoint}`
  const loggedEndpoint = maskSensitiveUrl(endpoint)
  const loggedUrl = maskSensitiveUrl(url)
  const requestContext = sanitizePayload({
    endpoint,
    ...requestPayload,
  })
  const requestKey = `GET:${url}`
  const existingRequest = inFlightApiRequests.get(requestKey)
  if (existingRequest) {
    return existingRequest as Promise<IpcResult<T>>
  }

  const requestPromise = (async (): Promise<IpcResult<T>> => {
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort('timeout'), NEXUS_REQUEST_TIMEOUT_MS)

    try {
      const response = await net.fetch(url, {
        signal: controller.signal,
        headers: {
          apikey: apiKey,
          'User-Agent': USER_AGENT,
          'Application-Name': APPLICATION_NAME,
          'Application-Version': APPLICATION_VERSION,
          Accept: 'application/json',
        },
      })
      const durationMs = Date.now() - startedAt
      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText)
        pushRequestLog(mainWindow, {
          method: 'GET',
          endpoint: loggedEndpoint,
          url: loggedUrl,
          requestContext,
          requestBody: null,
          responseBody: text,
          status: 'error',
          statusCode: response.status,
          durationMs,
          error: text,
        })
        return { ok: false, error: `Nexus API ${response.status}: ${text}` }
      }
      const data = await response.json() as T
      pushRequestLog(mainWindow, {
        method: 'GET',
        endpoint: loggedEndpoint,
        url: loggedUrl,
        requestContext,
        requestBody: null,
        responseBody: summarizeNexusResponseForLog(endpoint, data),
        status: 'success',
        statusCode: response.status,
        durationMs,
      })
      return { ok: true, data }
    } catch (err) {
      const timedOut = controller.signal.aborted && controller.signal.reason === 'timeout'
      const errorMessage = timedOut ? 'Request timeout' : err instanceof Error ? err.message : 'Network error'
      pushRequestLog(mainWindow, {
        method: 'GET',
        endpoint: loggedEndpoint,
        url: loggedUrl,
        requestContext,
        requestBody: null,
        responseBody: null,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: errorMessage,
      })
      return { ok: false, error: errorMessage }
    } finally {
      clearTimeout(timeoutId)
      inFlightApiRequests.delete(requestKey)
    }
  })()

  inFlightApiRequests.set(requestKey, requestPromise as Promise<IpcResult<unknown>>)
  return requestPromise
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function normalizeNexusValidateResult(
  payload: RawNexusValidateResult,
  apiKey: string,
): NexusValidateResult {
  const rawUserId = payload.userId ?? payload.user_id
  const normalizedUserId =
    typeof rawUserId === 'number'
      ? rawUserId
      : typeof rawUserId === 'string'
      ? Number.parseInt(rawUserId, 10) || 0
      : 0

  return {
    userId: normalizedUserId,
    key: typeof payload.key === 'string' && payload.key.trim() ? payload.key : apiKey,
    name:
      (typeof payload.name === 'string' && payload.name.trim()) ||
      (typeof payload.username === 'string' && payload.username.trim()) ||
      'Unknown User',
    isPremium: normalizeBoolean(payload.isPremium ?? payload.is_premium ?? payload.premium),
    email: typeof payload.email === 'string' ? payload.email : '',
  }
}

export async function validateNexusApiKey(
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<IpcResult<NexusValidateResult>> {
  const result = await nexusGet<RawNexusValidateResult>(
    '/users/validate.json',
    apiKey,
    mainWindow,
    { apiKey },
  )

  if (!result.ok || !result.data) {
    return result as IpcResult<NexusValidateResult>
  }

  return {
    ok: true,
    data: normalizeNexusValidateResult(result.data, apiKey),
  }
}

async function fetchFileInfo(
  modId: number,
  fileId: number,
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<{ version?: string; fileName?: string; displayName?: string }> {
  const result = await nexusGet<{ version?: string; mod_version?: string; file_name?: string; name?: string }>(
    `/games/${GAME_DOMAIN}/mods/${modId}/files/${fileId}.json`,
    apiKey,
    mainWindow,
    { modId, fileId, gameDomain: GAME_DOMAIN },
  )
  if (!result.ok || !result.data) return {}
  const raw = result.data.version ?? result.data.mod_version
  const version = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
  const fileName = typeof result.data.file_name === 'string' && result.data.file_name.trim()
    ? result.data.file_name.trim()
    : undefined
  // File display name fallback; the mod page name is preferred when available.
  const displayName = typeof result.data.name === 'string' && result.data.name.trim()
    ? result.data.name.trim()
    : undefined
  return { version, fileName, displayName }
}

interface RawNexusModInfo {
  name?: string | null
  category_id?: number | string | null
  category_name?: string | null
  category?: {
    category_id?: number | string | null
    id?: number | string | null
    name?: string | null
  } | string | null
}

interface RawNexusGameInfo {
  categories?: Array<{
    category_id?: number | string | null
    name?: string | null
  }> | null
}

// The Nexus mod-info endpoint only returns a numeric `category_id`; the human-readable
// name lives in the game's category list (`/games/{game}.json`). We fetch that list once
// and cache it for the session to resolve ids → names.
let gameCategoryMapCache: Map<number, string> | null = null
let gameCategoryMapPromise: Promise<Map<number, string>> | null = null

async function getGameCategoryMap(
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<Map<number, string>> {
  if (gameCategoryMapCache) return gameCategoryMapCache
  if (gameCategoryMapPromise) return gameCategoryMapPromise

  gameCategoryMapPromise = (async () => {
    const result = await nexusGet<RawNexusGameInfo>(
      `/games/${GAME_DOMAIN}.json`,
      apiKey,
      mainWindow,
      { gameDomain: GAME_DOMAIN },
    )
    const map = new Map<number, string>()
    if (result.ok && Array.isArray(result.data?.categories)) {
      for (const entry of result.data!.categories!) {
        const rawId = entry?.category_id
        const id = typeof rawId === 'number'
          ? rawId
          : typeof rawId === 'string'
            ? Number.parseInt(rawId, 10)
            : NaN
        const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
        if (Number.isFinite(id) && name) map.set(id, name)
      }
    }
    // Only cache a successful, non-empty result so transient failures retry later.
    if (map.size > 0) gameCategoryMapCache = map
    return map
  })()

  try {
    return await gameCategoryMapPromise
  } finally {
    gameCategoryMapPromise = null
  }
}

async function fetchModCategoryInfo(
  modId: number,
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<{ categoryId?: number; categoryName?: string; modName?: string }> {
  const [result, categoryMap] = await Promise.all([
    nexusGet<RawNexusModInfo>(
      `/games/${GAME_DOMAIN}/mods/${modId}.json`,
      apiKey,
      mainWindow,
      { modId, gameDomain: GAME_DOMAIN },
    ),
    getGameCategoryMap(apiKey, mainWindow),
  ])
  if (!result.ok || !result.data) return {}

  const rawCategory = result.data.category
  const rawCategoryId = result.data.category_id
    ?? (rawCategory && typeof rawCategory === 'object' ? rawCategory.category_id ?? rawCategory.id : undefined)
  const parsedCategoryId = typeof rawCategoryId === 'number'
    ? rawCategoryId
    : typeof rawCategoryId === 'string'
      ? Number.parseInt(rawCategoryId, 10)
      : undefined
  const categoryId = typeof parsedCategoryId === 'number' && Number.isFinite(parsedCategoryId)
    ? parsedCategoryId
    : undefined
  // Prefer an explicit name from the mod payload, then resolve the id against the
  // game's category list (the usual path, since the mod payload omits the name).
  const rawCategoryName = result.data.category_name
    ?? (rawCategory && typeof rawCategory === 'object' ? rawCategory.name : undefined)
    ?? (typeof rawCategory === 'string' ? rawCategory : undefined)
    ?? (categoryId != null ? categoryMap.get(categoryId) : undefined)
  const categoryName = typeof rawCategoryName === 'string' && rawCategoryName.trim()
    ? rawCategoryName.trim()
    : undefined
  const modName = typeof result.data.name === 'string' && result.data.name.trim()
    ? result.data.name.trim()
    : undefined

  return { categoryId, categoryName, modName }
}

// ─── MD5 lookup (identify a manually-added archive on Nexus) ────────────────────

interface RawNexusMd5Result {
  mod?: {
    mod_id?: number
    category_id?: number
    name?: string
  }
  file_details?: {
    file_id?: number
    name?: string
    version?: string
    mod_version?: string
  }
}

export interface NexusMd5Match {
  modId: number
  fileId?: number
  version?: string
  categoryId?: number
  categoryName?: string
  modName?: string
}

function computeFileMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

// Identify an archive on Nexus by its MD5 hash via the md5_search endpoint: hash
// the archive and ask Nexus which mod/file it belongs to. Lets manually-downloaded
// archives recover their Nexus identity (mod id, file id, version, category) when
// there's no download record or meta.ini. Best-effort: returns null on any failure
// or no match.
export async function lookupNexusModByMd5(
  filePath: string,
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<NexusMd5Match | null> {
  if (!apiKey?.trim() || !filePath || !fs.existsSync(filePath)) return null

  let md5: string
  try {
    md5 = await computeFileMd5(filePath)
  } catch {
    return null
  }

  const result = await nexusGet<RawNexusMd5Result[]>(
    `/games/${GAME_DOMAIN}/mods/md5_search/${md5}.json`,
    apiKey,
    mainWindow,
    { md5, gameDomain: GAME_DOMAIN },
  )
  if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) return null

  // An MD5 collision across different mods is effectively impossible for real
  // archives, but the endpoint returns an array — take the first usable entry.
  const match = result.data.find((entry) => {
    const id = entry?.mod?.mod_id
    return typeof id === 'number' && id > 0
  })
  if (!match?.mod?.mod_id) return null

  const modId = match.mod.mod_id
  const fileId = typeof match.file_details?.file_id === 'number' && match.file_details.file_id > 0
    ? match.file_details.file_id
    : undefined
  const version = normalizeVersionString(match.file_details?.version ?? match.file_details?.mod_version)

  let categoryId: number | undefined
  let categoryName: string | undefined
  const rawCategoryId = match.mod.category_id
  if (typeof rawCategoryId === 'number' && Number.isFinite(rawCategoryId)) {
    categoryId = rawCategoryId
    // Category resolution is secondary — never let it throw away the mod id.
    try {
      const categoryMap = await getGameCategoryMap(apiKey, mainWindow)
      categoryName = categoryMap.get(rawCategoryId) ?? undefined
    } catch {
      categoryName = undefined
    }
  }

  const modName = typeof match.mod.name === 'string' && match.mod.name.trim()
    ? match.mod.name.trim()
    : undefined

  return { modId, fileId, version, categoryId, categoryName, modName }
}

function normalizeVersionString(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/^v/i, '')
}

function getVersionNumberParts(value?: string): number[] | null {
  const normalized = normalizeVersionString(value)
  if (!normalized) return null
  const matches = normalized.match(/\d+/g)
  if (!matches?.length) return null
  return matches.map((part) => Number.parseInt(part, 10))
}

function compareNumericVersions(left?: string, right?: string): number | null {
  const leftParts = getVersionNumberParts(left)
  const rightParts = getVersionNumberParts(right)
  if (!leftParts || !rightParts) return null
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1
  }

  return 0
}

function normalizeRequestedAt(value?: string): string {
  if (typeof value !== 'string') return new Date().toISOString()
  const trimmed = value.trim()
  if (!trimmed) return new Date().toISOString()
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()
}

async function fetchDownloadUrl(
  modId: number,
  fileId: number,
  key: string,
  expires: number,
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<IpcResult<string>> {
  const qs = key ? `?key=${encodeURIComponent(key)}&expires=${expires}` : ''
  const result = await nexusGet<Array<{ name: string; short_name: string; URI: string }>>(
    `/games/${GAME_DOMAIN}/mods/${modId}/files/${fileId}/download_link.json${qs}`,
    apiKey,
    mainWindow,
    {
      modId,
      fileId,
      expires,
      key,
      gameDomain: GAME_DOMAIN,
    },
  )
  if (!result.ok || !result.data?.length) {
    return { ok: false, error: result.error ?? 'No download links returned' }
  }
  return { ok: true, data: result.data[0].URI }
}

// ─── File Downloader ──────────────────────────────────────────────────────────

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number, speedBps: number) => void,
  signal: AbortSignal,
  startByte = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let prevBytes = startByte
    let downloadedBytes = startByte
    let totalBytes = 0
    let speedInterval: NodeJS.Timeout | null = null
    let writer: fs.WriteStream | null = null
    let settled = false
    let responseStream: IncomingMessage | null = null
    let req: ReturnType<typeof https.get> | null = null

    const cleanup = () => {
      if (speedInterval) {
        clearInterval(speedInterval)
        speedInterval = null
      }
      signal.removeEventListener('abort', handleAbort)
    }

    const settleResolve = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const settleReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const handleAbort = () => {
      const reason = signal.reason === 'pause' ? 'Paused' : 'Cancelled'
      const abortError = new Error(reason)
      responseStream?.destroy?.(abortError)
      writer?.destroy(abortError)
      req?.destroy(abortError)
    }

    signal.addEventListener('abort', handleAbort, { once: true })

    req = https.get(url, {
      signal,
      headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : undefined,
    }, (response) => {
      responseStream = response

      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        req?.destroy()
        cleanup()
        downloadFile(response.headers.location, destPath, onProgress, signal, startByte).then(settleResolve, settleReject)
        return
      }
      if (response.statusCode === 416) {
        onProgress(downloadedBytes, downloadedBytes, 0)
        settleResolve()
        return
      }
      if (!response.statusCode || response.statusCode >= 400) {
        settleReject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      const isPartialResponse = response.statusCode === 206 && startByte > 0
      const contentLength = parseInt(response.headers['content-length'] ?? '0', 10) || 0
      const contentRange = response.headers['content-range']
      if (isPartialResponse && typeof contentRange === 'string') {
        const match = /\/(\d+)$/.exec(contentRange)
        totalBytes = match ? parseInt(match[1], 10) : startByte + contentLength
      } else {
        totalBytes = contentLength
        downloadedBytes = isPartialResponse ? downloadedBytes : 0
        prevBytes = downloadedBytes
      }

      writer = fs.createWriteStream(destPath, { flags: isPartialResponse ? 'a' : 'w' })

      speedInterval = setInterval(() => {
        const delta = downloadedBytes - prevBytes
        prevBytes = downloadedBytes
        onProgress(downloadedBytes, totalBytes, delta)
      }, 1000)

      response.on('data', (chunk: Buffer) => { downloadedBytes += chunk.length })
      response.on('error', settleReject)
      response.pipe(writer)

      writer.on('finish', () => {
        onProgress(downloadedBytes, totalBytes, 0)
        settleResolve()
      })

      writer.on('error', settleReject)
    })

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.name === 'AbortError' || err.code === 'ERR_ABORTED') {
        const reason = signal.reason === 'pause' ? 'Paused' : 'Cancelled'
        settleReject(new Error(reason))
        return
      }
      settleReject(err)
    })
  })
}

// ─── IPC Handler Registration ─────────────────────────────────────────────────

interface DownloadHandle {
  abort: AbortController | null
  payload: NxmLinkPayload
  destPath: string
  fileName: string
  startedAt: string
  status: 'downloading' | 'paused' | 'cancelling'
  requestToken: number
  version?: string
  categoryId?: number
  categoryName?: string
  displayName?: string
}

const inFlightDownloads = new Map<string, DownloadHandle>()

function findActiveDownloadByNexusIds(modId: number, fileId: number): DownloadHandle | null {
  for (const handle of inFlightDownloads.values()) {
    if (handle.payload.modId === modId && handle.payload.fileId === fileId) {
      return handle
    }
  }
  return null
}

async function resolveCdnUrl(
  payload: NxmLinkPayload,
  mainWindow: BrowserWindow | null,
): Promise<IpcResult<string>> {
  const settings = loadSettings()
  if (!settings.nexusApiKey) {
    return { ok: false, error: 'Nexus API key not configured. Add it in Settings > Nexus.' }
  }

  return fetchDownloadUrl(
    payload.modId,
    payload.fileId,
    payload.key,
    payload.expires,
    settings.nexusApiKey,
    mainWindow,
  )
}

function removePartialFile(destPath: string): void {
  try {
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath)
    }
  } catch {
    // ignore cleanup failures
  }
}

function getExistingBytes(destPath: string): number {
  try {
    return fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
  } catch {
    return 0
  }
}

function splitArchiveFileName(fileName: string): { baseName: string; extension: string } {
  const extension = path.extname(fileName)
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  return {
    baseName: baseName || fileName,
    extension,
  }
}

function stripDuplicateArchiveSuffix(baseName: string): string {
  return baseName.replace(/\s+copy(?:\s+\d+)?$/i, '').trim() || baseName.trim()
}

function buildDuplicateArchiveName(fileName: string, index: number): string {
  const { baseName, extension } = splitArchiveFileName(fileName)
  const normalizedBaseName = stripDuplicateArchiveSuffix(baseName)
  const suffix = index === 0 ? ' Copy' : ` Copy ${index + 1}`
  return `${normalizedBaseName}${suffix}${extension}`
}

function getReservedDownloadTargets(): Set<string> {
  const reserved = new Set<string>()
  for (const handle of inFlightDownloads.values()) {
    reserved.add(path.normalize(handle.destPath).toLowerCase())
  }
  return reserved
}

function resolveDuplicateDownloadTarget(downloadDir: string, fileName: string): { fileName: string; destPath: string } {
  const reservedTargets = getReservedDownloadTargets()
  for (let index = 0; index < 500; index += 1) {
    const candidateName = buildDuplicateArchiveName(fileName, index)
    const candidatePath = path.join(downloadDir, candidateName)
    const normalizedCandidatePath = path.normalize(candidatePath).toLowerCase()
    if (!fs.existsSync(candidatePath) && !reservedTargets.has(normalizedCandidatePath)) {
      return {
        fileName: candidateName,
        destPath: candidatePath,
      }
    }
  }

  const fallbackName = `${uuidv4()}-${fileName}`
  return {
    fileName: fallbackName,
    destPath: path.join(downloadDir, fallbackName),
  }
}

function beginDownload(
  id: string,
  mainWindow: BrowserWindow | null,
  cdnUrl: string,
): void {
  const handle = inFlightDownloads.get(id)
  if (!handle) return

  const existingBytes = getExistingBytes(handle.destPath)
  const abort = new AbortController()
  handle.requestToken += 1
  const requestToken = handle.requestToken

  handle.abort = abort
  handle.status = 'downloading'

  void (async () => {
    try {
      await downloadFile(
        cdnUrl,
        handle.destPath,
        (downloadedBytes, totalBytes, speedBps) => {
          const latestHandle = inFlightDownloads.get(id)
          if (!latestHandle || latestHandle.requestToken !== requestToken || latestHandle.status !== 'downloading') {
            return
          }
          safeSendToWindow(mainWindow, IPC.NXM_DOWNLOAD_PROGRESS, {
            id, downloadedBytes, totalBytes, speedBps,
          })
        },
        abort.signal,
        existingBytes,
      )
      const latestHandle = inFlightDownloads.get(id)
      if (!latestHandle || latestHandle.requestToken !== requestToken) return

      inFlightDownloads.delete(id)
      upsertNexusDownloadRecord({
        modId: latestHandle.payload.modId,
        fileId: latestHandle.payload.fileId,
        filePath: latestHandle.destPath,
        fileName: latestHandle.fileName,
        createdAt: latestHandle.startedAt,
        version: latestHandle.version,
        categoryId: latestHandle.categoryId,
        categoryName: latestHandle.categoryName,
        displayName: latestHandle.displayName,
      })
      safeSendToWindow(mainWindow, IPC.NXM_DOWNLOAD_COMPLETE, {
        id,
        savedPath: latestHandle.destPath,
        fileName: latestHandle.fileName,
        version: latestHandle.version,
      })
    } catch (err) {
      const latestHandle = inFlightDownloads.get(id)
      if (!latestHandle || latestHandle.requestToken !== requestToken) return

      const message = err instanceof Error ? err.message : 'Download failed'
      if (message === 'Paused') {
        latestHandle.abort = null
        latestHandle.status = 'paused'
        return
      }

      inFlightDownloads.delete(id)
      if (message === 'Cancelled') {
        removePartialFile(handle.destPath)
        removeNexusDownloadRecordByPath(handle.destPath)
        return
      }

      removePartialFile(handle.destPath)
      removeNexusDownloadRecordByPath(handle.destPath)
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'downloads',
        message: `Download failed: ${handle.fileName}`,
        details: buildErrorDetails(err, {
          fileName: handle.fileName,
          savedPath: handle.destPath,
        }),
      })
      safeSendToWindow(mainWindow, IPC.NXM_DOWNLOAD_ERROR, { id, error: message })
    }
  })()
}

// ─── Mod update check ──────────────────────────────────────────────────────────

interface NexusUpdatedMod {
  mod_id: number
  latest_file_update: number
  latest_mod_activity: number
}

interface NexusFileEntry {
  file_id: number
  name?: string
  version?: string
  mod_version?: string
  category_name?: string | null
  is_primary?: boolean
  uploaded_timestamp?: number
}

interface NexusFileUpdate {
  old_file_id: number
  new_file_id: number
  old_file_name?: string
  new_file_name?: string
  uploaded_timestamp?: number
}

interface NexusFilesResponse {
  files?: NexusFileEntry[]
  file_updates?: NexusFileUpdate[]
}

const MOD_UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000
const MOD_UPDATE_DEEP_CHECK_CONCURRENCY = 4
let lastModUpdateCheckAt = 0
let lastModUpdateStatuses: ModUpdateStatus[] = []

function nexusModPageUrl(modId: number): string {
  return `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${modId}`
}

// MAIN files are the canonical release; never treat OLD_VERSION/ARCHIVED as "latest".
function pickLatestPrimaryFile(files: NexusFileEntry[]): NexusFileEntry | null {
  const usable = files.filter((file) => {
    const category = (file.category_name || '').toUpperCase()
    return category !== 'OLD_VERSION' && category !== 'ARCHIVED'
  })
  const pool = usable.length ? usable : files
  if (!pool.length) return null
  const main = pool.filter((file) => (file.category_name || '').toUpperCase() === 'MAIN')
  const candidates = main.length ? main : pool
  return candidates.reduce((best, file) =>
    (file.uploaded_timestamp ?? 0) > (best.uploaded_timestamp ?? 0) ? file : best,
  )
}

const SUPERSEDED_CATEGORIES = new Set(['OLD_VERSION', 'ARCHIVED', 'DELETED'])

function isSupersededCategory(file: NexusFileEntry | null | undefined): boolean {
  return SUPERSEDED_CATEGORIES.has((file?.category_name || '').toUpperCase())
}

// Follow the authoritative file_updates chain (old_file_id -> new_file_id) to the
// newest successor of the installed file. This keeps update detection scoped to the
// exact file the user installed instead of comparing an OPTIONAL file against the
// page's latest MAIN release.
function findLatestFileIdInLineage(fileUpdates: NexusFileUpdate[], startFileId: number): number {
  let currentId = startFileId
  const visited = new Set<number>([currentId])
  for (;;) {
    const next = fileUpdates.find((update) => update.old_file_id === currentId)
    if (!next || visited.has(next.new_file_id)) break
    currentId = next.new_file_id
    visited.add(currentId)
  }
  return currentId
}

function normalizeFileName(name?: string): string {
  return (name || '').trim().toLowerCase()
}

// Fallback when file_updates has no link for the installed file (author uploaded a new
// version without chaining it): find the newest non-superseded file that shares the same
// display name lineage. Matching by name avoids flagging an unrelated file on the page.
function pickLatestSameNameFile(
  files: NexusFileEntry[],
  installedFile: NexusFileEntry,
): NexusFileEntry | null {
  const targetName = normalizeFileName(installedFile.name)
  if (!targetName) return null
  const candidates = files.filter(
    (file) => normalizeFileName(file.name) === targetName && !isSupersededCategory(file),
  )
  if (!candidates.length) return null
  return candidates.reduce((best, file) =>
    (file.uploaded_timestamp ?? 0) > (best.uploaded_timestamp ?? 0) ? file : best,
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }))

  return results
}

export async function checkModUpdates(
  request: ModUpdateCheckRequest,
  mainWindow: BrowserWindow | null,
): Promise<IpcResult<ModUpdateCheckResult>> {
  const checkedAt = new Date().toISOString()
  const settings = loadSettings()
  const apiKey = settings.nexusApiKey
  const restrictIds = request.modIds && request.modIds.length > 0 ? new Set(request.modIds) : null
  const mods = (request.mods || []).filter(
    (mod) =>
      typeof mod.nexusModId === 'number' &&
      mod.nexusModId > 0 &&
      (!restrictIds || restrictIds.has(mod.uuid)),
  )

  if (!apiKey) {
    return { ok: true, data: { statuses: [], checkedAt, skippedReason: 'no-api-key' } }
  }
  if (mods.length === 0) {
    return { ok: true, data: { statuses: [], checkedAt } }
  }
  if (
    !request.force &&
    !request.full &&
    lastModUpdateStatuses.length > 0 &&
    Date.now() - lastModUpdateCheckAt < MOD_UPDATE_CHECK_THROTTLE_MS
  ) {
    return { ok: true, data: { statuses: lastModUpdateStatuses, checkedAt, skippedReason: 'throttled' } }
  }

  const deepCheckMod = async (mod: ModUpdateCheckRequest['mods'][number]): Promise<ModUpdateStatus> => {
    const [filesResult, categoryInfo] = await Promise.all([
      nexusGet<NexusFilesResponse>(
        `/games/${GAME_DOMAIN}/mods/${mod.nexusModId}/files.json`,
        apiKey,
        mainWindow,
        { modId: mod.nexusModId },
      ),
      // Only fetch category when the mod doesn't already have one
      !mod.nexusCategoryName
        ? fetchModCategoryInfo(mod.nexusModId, apiKey, mainWindow)
        : Promise.resolve({ categoryId: undefined, categoryName: undefined }),
    ])

    if (!filesResult.ok || !filesResult.data?.files) {
      return {
        uuid: mod.uuid,
        nexusModId: mod.nexusModId,
        state: 'unknown',
        currentVersion: mod.version,
        modPageUrl: nexusModPageUrl(mod.nexusModId),
        nexusCategoryId: categoryInfo.categoryId,
        nexusCategoryName: categoryInfo.categoryName,
      }
    }

    const files = filesResult.data.files
    const fileUpdates = filesResult.data.file_updates ?? []
    const installedFile = mod.nexusFileId
      ? files.find((file) => file.file_id === mod.nexusFileId)
      : undefined

    let state: ModUpdateState
    let latest: NexusFileEntry | null = null

    if (mod.nexusFileId) {
      // Authoritative: trace the installed file's own update lineage. Only a genuine
      // successor of THIS file counts — never the page's latest MAIN release.
      const latestFileId = findLatestFileIdInLineage(fileUpdates, mod.nexusFileId)
      const lineageSuccessor =
        latestFileId !== mod.nexusFileId
          ? files.find((file) => file.file_id === latestFileId) ?? null
          : null

      if (lineageSuccessor && !isSupersededCategory(lineageSuccessor)) {
        latest = lineageSuccessor
        state = 'update-available'
      } else if (installedFile) {
        // No chain link: catch updates the author uploaded without chaining by matching
        // the same file name and a newer upload/version.
        const sameNameLatest = pickLatestSameNameFile(files, installedFile)
        const isNewer = Boolean(
          sameNameLatest &&
          sameNameLatest.file_id !== mod.nexusFileId &&
          (((sameNameLatest.uploaded_timestamp ?? 0) > (installedFile.uploaded_timestamp ?? 0)) ||
            (compareNumericVersions(
              sameNameLatest.version || sameNameLatest.mod_version,
              installedFile.version || installedFile.mod_version,
            ) ?? 0) > 0),
        )
        if (isNewer && sameNameLatest) {
          latest = sameNameLatest
          state = 'update-available'
        } else {
          state = 'up-to-date'
        }
      } else {
        // Installed file id is gone from the page and not in any chain — can't be sure.
        state = 'unknown'
      }
    } else {
      // Legacy fallback: mod has no recorded Nexus file id, so compare against the
      // latest MAIN file by version/timestamp. Less precise but the best we can do.
      latest = pickLatestPrimaryFile(files)
      const versionCompare = compareNumericVersions(
        latest?.version || latest?.mod_version,
        mod.version,
      )
      if (!latest) {
        state = 'unknown'
      } else if (versionCompare != null && versionCompare > 0) {
        state = 'update-available'
      } else {
        state = 'unknown'
      }
    }

    const currentVersion = installedFile?.version || installedFile?.mod_version || mod.version
    const latestVersion = latest?.version || latest?.mod_version
    const updatedAtIso = latest?.uploaded_timestamp
      ? new Date(latest.uploaded_timestamp * 1000).toISOString()
      : undefined

    return {
      uuid: mod.uuid,
      nexusModId: mod.nexusModId,
      state,
      currentVersion,
      latestVersion: state === 'update-available' ? latestVersion : undefined,
      latestFileId: state === 'update-available' ? latest?.file_id : undefined,
      latestFileName: state === 'update-available' ? latest?.name : undefined,
      updatedAt: state === 'update-available' ? updatedAtIso : undefined,
      modPageUrl: nexusModPageUrl(mod.nexusModId),
      nexusCategoryId: categoryInfo.categoryId,
      nexusCategoryName: categoryInfo.categoryName,
    }
  }

  let statuses: ModUpdateStatus[]
  if (restrictIds || request.full) {
    // Scoped check (specific mod ids) or a manual full pass — deep-check each mod
    // directly. The scoped path skips the updated.json bulk call entirely, so
    // refreshing one freshly-installed mod costs a single files.json request.
    statuses = await mapWithConcurrency(mods, MOD_UPDATE_DEEP_CHECK_CONCURRENCY, deepCheckMod)
  } else {
    // One bulk call lists every mod in the game updated within `period`, so a check
    // only deep-checks the handful of installed mods that actually changed. The period
    // is derived from the time since the last check so it always covers the gap. Only
    // the changed mods' statuses are returned; the renderer merges them into the cache
    // and leaves untouched mods as they were (no per-mod request for the rest).
    const period = request.period ?? '1m'
    const updated = await nexusGet<NexusUpdatedMod[]>(
      `/games/${GAME_DOMAIN}/mods/updated.json?period=${period}`,
      apiKey,
      mainWindow,
      { period },
    )
    if (!updated.ok || !Array.isArray(updated.data)) {
      return { ok: false, error: updated.error || 'Failed to fetch Nexus mod updates' }
    }
    const recentlyUpdated = new Set<number>()
    for (const entry of updated.data) {
      recentlyUpdated.add(entry.mod_id)
    }

    const changedMods = mods.filter((mod) => recentlyUpdated.has(mod.nexusModId))
    statuses = await mapWithConcurrency(changedMods, MOD_UPDATE_DEEP_CHECK_CONCURRENCY, deepCheckMod)
  }

  // Persist fetched Nexus categories to _metadata.json
  const libraryPath = settings.libraryPath
  for (const status of statuses) {
    if (!status.nexusCategoryName && !status.nexusCategoryId) continue
    try {
      const found = findModDir(libraryPath, status.uuid)
      if (!found) continue
      const metaPath = path.join(found.dir, '_metadata.json')
      const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
      if (status.nexusCategoryId != null) raw.nexusCategoryId = status.nexusCategoryId
      if (status.nexusCategoryName) raw.nexusCategoryName = status.nexusCategoryName
      fs.writeFileSync(metaPath, JSON.stringify(raw, null, 2), 'utf-8')
    } catch {
      // Non-fatal — category will be fetched again on the next check
    }
  }

  lastModUpdateCheckAt = Date.now()
  lastModUpdateStatuses = statuses
  return { ok: true, data: { statuses, checkedAt } }
}

export function registerNexusDownloaderHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.NEXUS_VALIDATE_KEY, async (_event, apiKey: string) => {
    return validateNexusApiKey(apiKey, getMainWindow())
  })

  ipcMain.handle(IPC.NEXUS_CHECK_MOD_UPDATES, async (_event, request: ModUpdateCheckRequest) => {
    return checkModUpdates(request, getMainWindow())
  })

  ipcMain.handle(IPC.NXM_DOWNLOAD_START, async (_event, request: NxmDownloadStartRequest) => {
    const mainWindow = getMainWindow()
    const settings = loadSettings()
    const payload = request.payload
    const allowDuplicate = request.allowDuplicate === true
    const requestedAt = normalizeRequestedAt(request.requestedAt)

    pushGeneralLog(mainWindow, {
      level: 'info',
      source: 'nexus',
      message: 'NXM download requested',
      details: {
        modId: payload.modId,
        fileId: payload.fileId,
        allowDuplicate,
      },
    })

    if (!settings.nexusApiKey) {
      pushGeneralLog(mainWindow, {
        level: 'warn',
        source: 'nexus',
        message: 'NXM download blocked: API key missing',
        details: { modId: payload.modId, fileId: payload.fileId },
      })
      return { ok: false, error: 'Nexus API key not configured. Add it in Settings > Nexus.' }
    }
    if (!settings.downloadPath) {
      pushGeneralLog(mainWindow, {
        level: 'warn',
        source: 'downloads',
        message: 'Downloads path invalid',
        details: { reason: 'Download path not configured' },
      })
      return { ok: false, error: 'Download path not configured. Set it in Settings > Paths.' }
    }

    const downloadDir = settings.downloadPath
    try {
      fs.mkdirSync(downloadDir, { recursive: true })
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'downloads',
        message: 'Downloads path is not writable',
        details: buildErrorDetails(error, { downloadDir }),
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not prepare downloads folder',
      }
    }

    const activeDownload = findActiveDownloadByNexusIds(payload.modId, payload.fileId)
    if (activeDownload && !allowDuplicate) {
      pushGeneralLog(mainWindow, {
        level: 'info',
        source: 'nexus',
        message: 'NXM download matched an active transfer',
        details: {
          modId: payload.modId,
          fileId: payload.fileId,
          activeFileName: activeDownload.fileName,
        },
      })
      const duplicateTarget = resolveDuplicateDownloadTarget(downloadDir, activeDownload.fileName)
      return {
        ok: true,
        data: {
          status: 'duplicate',
          duplicate: {
            modId: payload.modId,
            fileId: payload.fileId,
            existingFileName: activeDownload.fileName,
            existingFilePath: activeDownload.destPath,
            incomingFileName: duplicateTarget.fileName,
            existingIsDownloading: true,
          },
        } satisfies NxmDownloadStartResponse,
      }
    }

    const existingDownload = findNexusDownloadRecord(payload.modId, payload.fileId)
    const existingIsInCurrentDir = existingDownload
      ? path.normalize(path.dirname(existingDownload.filePath)).toLowerCase() === path.normalize(downloadDir).toLowerCase()
      : false
    if (existingDownload && existingIsInCurrentDir && !allowDuplicate) {
      pushGeneralLog(mainWindow, {
        level: 'info',
        source: 'nexus',
        message: 'NXM download matched an existing archive',
        details: {
          modId: payload.modId,
          fileId: payload.fileId,
          existingFileName: existingDownload.fileName,
        },
      })
      const duplicateTarget = resolveDuplicateDownloadTarget(downloadDir, existingDownload.fileName)
      return {
        ok: true,
        data: {
          status: 'duplicate',
          duplicate: {
            modId: payload.modId,
            fileId: payload.fileId,
            existingFileName: existingDownload.fileName,
            existingFilePath: existingDownload.filePath,
            incomingFileName: duplicateTarget.fileName,
            existingIsDownloading: false,
          },
        } satisfies NxmDownloadStartResponse,
      }
    }

    const id = uuidv4()
    const cdnResult = await resolveCdnUrl(payload, mainWindow)
    if (!cdnResult.ok || !cdnResult.data) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'nexus',
        message: 'NXM download could not resolve CDN URL',
        details: {
          modId: payload.modId,
          fileId: payload.fileId,
          error: cdnResult.error ?? 'Unknown error',
        },
      })
      return { ok: false, error: cdnResult.error ?? 'Could not resolve download URL' }
    }

    const cdnUrl = cdnResult.data
    let rawName: string
    try {
      rawName = decodeURIComponent(path.basename(new URL(cdnUrl).pathname))
    } catch {
      rawName = ''
    }

    const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar'])
    const hasValidExtension = ARCHIVE_EXTENSIONS.has(path.extname(rawName).toLowerCase())

    const [fileInfo, modCategoryInfo] = await Promise.all([
      fetchFileInfo(payload.modId, payload.fileId, settings.nexusApiKey, mainWindow)
        .catch(() => ({} as { version?: string; fileName?: string; displayName?: string })),
      fetchModCategoryInfo(payload.modId, settings.nexusApiKey, mainWindow)
        .catch(() => ({} as { categoryId?: number; categoryName?: string })),
    ])

    const detectedVersion = normalizeVersionString(fileInfo.version)

    // Prefer the Nexus API file_name when the CDN URL path has no archive extension
    // (some CDNs use UUID-like paths that strip the filename).
    const nameFromApi = fileInfo.fileName && ARCHIVE_EXTENSIONS.has(path.extname(fileInfo.fileName).toLowerCase())
      ? fileInfo.fileName
      : undefined

    const currentDirDownload = existingIsInCurrentDir ? existingDownload : null

    const resolvedFileName = activeDownload?.fileName
      || currentDirDownload?.fileName
      || (hasValidExtension ? rawName : undefined)
      || nameFromApi
      || `mod-${payload.modId}-file-${payload.fileId}.zip`

    const target = (currentDirDownload || activeDownload) && allowDuplicate
      ? resolveDuplicateDownloadTarget(downloadDir, resolvedFileName)
      : {
          fileName: resolvedFileName,
          destPath: path.join(downloadDir, resolvedFileName),
        }

    inFlightDownloads.set(id, {
      abort: null,
      payload,
      destPath: target.destPath,
      fileName: target.fileName,
      startedAt: requestedAt,
      status: 'downloading',
      requestToken: 0,
      version: detectedVersion,
      categoryId: modCategoryInfo.categoryId,
      categoryName: modCategoryInfo.categoryName,
      displayName: modCategoryInfo.modName ?? fileInfo.displayName,
    })

    beginDownload(id, mainWindow, cdnUrl)

    pushGeneralLog(mainWindow, {
      level: 'info',
      source: 'nexus',
      message: 'NXM download started',
      details: {
        id,
        modId: payload.modId,
        fileId: payload.fileId,
        fileName: target.fileName,
      },
    })

    return {
      ok: true,
      data: {
        status: 'started',
        id,
        fileName: target.fileName,
        startedAt: requestedAt,
        savedPath: target.destPath,
        version: detectedVersion,
      } satisfies NxmDownloadStartResponse,
    }
  })

  ipcMain.handle(IPC.NXM_DOWNLOAD_PAUSE, (_event, id: string) => {
    const handle = inFlightDownloads.get(id)
    if (!handle || handle.status !== 'downloading' || !handle.abort) {
      return { ok: false, error: 'Download is not currently active' }
    }

    handle.status = 'paused'
    handle.abort.abort('pause')
    return { ok: true }
  })

  ipcMain.handle(IPC.NXM_DOWNLOAD_RESUME, async (_event, id: string) => {
    const mainWindow = getMainWindow()
    const handle = inFlightDownloads.get(id)
    if (!handle || handle.status !== 'paused') {
      return { ok: false, error: 'Download is not paused' }
    }

    const cdnResult = await resolveCdnUrl(handle.payload, mainWindow)
    if (!cdnResult.ok || !cdnResult.data) {
      return { ok: false, error: cdnResult.error ?? 'Could not resume download' }
    }
    beginDownload(id, mainWindow, cdnResult.data)
    return { ok: true }
  })

  ipcMain.handle(IPC.NXM_DOWNLOAD_CANCEL, (_event, id: string) => {
    const handle = inFlightDownloads.get(id)
    if (handle) {
      if (handle.abort) {
        handle.status = 'cancelling'
        handle.abort.abort('cancel')
      } else {
        removePartialFile(handle.destPath)
        removeNexusDownloadRecordByPath(handle.destPath)
        inFlightDownloads.delete(id)
      }
    }
    return { ok: true }
  })
}
