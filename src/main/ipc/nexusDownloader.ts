import { app, ipcMain, net } from 'electron'
import type { BrowserWindow } from 'electron'
import type { IncomingMessage } from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type {
  IpcResult,
  NxmDownloadStartRequest,
  NxmDownloadStartResponse,
  NxmLinkPayload,
  NexusValidateResult,
} from '../../shared/types'
import { parseNxmUrl } from '../../shared/nxm'
import { pushGeneralLog, pushRequestLog, safeSendToWindow } from '../logStore'
import { loadSettings } from '../settings'
import { findNexusDownloadRecord, removeNexusDownloadRecordByPath, upsertNexusDownloadRecord } from '../nexusDownloadRegistry'

const NEXUS_API = 'https://api.nexusmods.com/v1'
const APPLICATION_NAME = 'Hyperion'
const APPLICATION_VERSION = app.getVersion()
const USER_AGENT = `${APPLICATION_NAME}-${APPLICATION_VERSION}`
const GAME_DOMAIN = 'cyberpunk2077'
const NEXUS_REQUEST_TIMEOUT_MS = 20_000
const inFlightApiRequests = new Map<string, Promise<IpcResult<unknown>>>()

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
        responseBody: data,
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

export async function validateNexusApiKey(
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<IpcResult<NexusValidateResult>> {
  return nexusGet<NexusValidateResult>(
    '/users/validate.json',
    apiKey,
    mainWindow,
    { apiKey },
  )
}

async function fetchFileVersion(
  modId: number,
  fileId: number,
  apiKey: string,
  mainWindow: BrowserWindow | null,
): Promise<string | undefined> {
  const result = await nexusGet<{ version?: string; mod_version?: string }>(
    `/games/${GAME_DOMAIN}/mods/${modId}/files/${fileId}.json`,
    apiKey,
    mainWindow,
    { modId, fileId, gameDomain: GAME_DOMAIN },
  )
  if (!result.ok || !result.data) return undefined
  const raw = result.data.version ?? result.data.mod_version
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeVersionString(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/^v/i, '')
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

export function registerNexusDownloaderHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.NEXUS_VALIDATE_KEY, async (_event, apiKey: string) => {
    return validateNexusApiKey(apiKey, getMainWindow())
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
    if (existingDownload && !allowDuplicate) {
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
    const resolvedFileName = activeDownload?.fileName || existingDownload?.fileName || rawName || `mod-${payload.modId}-file-${payload.fileId}.zip`
    const target = (existingDownload || activeDownload) && allowDuplicate
      ? resolveDuplicateDownloadTarget(downloadDir, resolvedFileName)
      : {
          fileName: resolvedFileName,
          destPath: path.join(downloadDir, resolvedFileName),
        }

    const detectedVersion = await fetchFileVersion(payload.modId, payload.fileId, settings.nexusApiKey, mainWindow)
      .then((version) => normalizeVersionString(version))
      .catch(() => undefined)

    inFlightDownloads.set(id, {
      abort: null,
      payload,
      destPath: target.destPath,
      fileName: target.fileName,
      startedAt: requestedAt,
      status: 'downloading',
      requestToken: 0,
      version: detectedVersion,
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
