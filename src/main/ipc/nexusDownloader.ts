import { ipcMain, net } from 'electron'
import type { BrowserWindow } from 'electron'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/types'
import type { IpcResult, NxmLinkPayload, NexusValidateResult } from '../../shared/types'
import { loadSettings } from '../settings'

const NEXUS_API = 'https://api.nexusmods.com/v1'
const USER_AGENT = 'Hyperion/0.6.1 (Electron)'
const GAME_DOMAIN = 'cyberpunk2077'

// ─── NXM URL Parser ───────────────────────────────────────────────────────────

export function parseNxmUrl(raw: string): NxmLinkPayload | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'nxm:') return null
    // nxm://cyberpunk2077/mods/{modId}/files/{fileId}
    const parts = url.pathname.replace(/^\//, '').split('/')
    if (parts.length < 4 || parts[0] !== 'mods' || parts[2] !== 'files') return null
    if (url.hostname !== GAME_DOMAIN) return null

    const modId  = parseInt(parts[1], 10)
    const fileId = parseInt(parts[3], 10)
    const key    = url.searchParams.get('key') ?? ''
    const expires = parseInt(url.searchParams.get('expires') ?? '0', 10)
    const userId  = parseInt(url.searchParams.get('userId') ?? '0', 10)

    if (!modId || !fileId) return null
    return { modId, fileId, key, expires, userId, raw }
  } catch {
    return null
  }
}

// ─── Nexus API Client ─────────────────────────────────────────────────────────

async function nexusGet<T>(endpoint: string, apiKey: string): Promise<IpcResult<T>> {
  try {
    const response = await net.fetch(`${NEXUS_API}${endpoint}`, {
      headers: {
        apikey: apiKey,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      return { ok: false, error: `Nexus API ${response.status}: ${text}` }
    }
    const data = await response.json() as T
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function validateNexusApiKey(apiKey: string): Promise<IpcResult<NexusValidateResult>> {
  return nexusGet<NexusValidateResult>('/users/validate.json', apiKey)
}

async function fetchDownloadUrl(
  modId: number,
  fileId: number,
  key: string,
  expires: number,
  apiKey: string,
): Promise<IpcResult<string>> {
  const qs = key ? `?key=${encodeURIComponent(key)}&expires=${expires}` : ''
  const result = await nexusGet<Array<{ name: string; short_name: string; URI: string }>>(
    `/games/${GAME_DOMAIN}/mods/${modId}/files/${fileId}/download_link.json${qs}`,
    apiKey,
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    let prevBytes = 0
    let downloadedBytes = 0
    let totalBytes = 0

    const req = https.get(url, { signal }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        req.destroy()
        downloadFile(response.headers.location, destPath, onProgress, signal).then(resolve, reject)
        return
      }
      if (!response.statusCode || response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      totalBytes = parseInt(response.headers['content-length'] ?? '0', 10) || 0

      const writer = fs.createWriteStream(destPath)

      const speedInterval = setInterval(() => {
        const delta = downloadedBytes - prevBytes
        prevBytes = downloadedBytes
        onProgress(downloadedBytes, totalBytes, delta)
      }, 1000)

      response.on('data', (chunk: Buffer) => { downloadedBytes += chunk.length })
      response.pipe(writer)

      writer.on('finish', () => {
        clearInterval(speedInterval)
        onProgress(downloadedBytes, totalBytes, 0)
        resolve()
      })

      writer.on('error', (err) => {
        clearInterval(speedInterval)
        try { fs.unlinkSync(destPath) } catch { /* ignore */ }
        reject(err)
      })
    })

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.name === 'AbortError' || err.code === 'ERR_ABORTED') {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath) } catch { /* ignore */ }
        reject(new Error('Cancelled'))
        return
      }
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath) } catch { /* ignore */ }
      reject(err)
    })

    signal.addEventListener('abort', () => {
      req.destroy()
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath) } catch { /* ignore */ }
    })
  })
}

// ─── IPC Handler Registration ─────────────────────────────────────────────────

interface DownloadHandle {
  abort: AbortController
  destPath: string
}

const inFlightDownloads = new Map<string, DownloadHandle>()

export function registerNexusDownloaderHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.NEXUS_VALIDATE_KEY, async (_event, apiKey: string) => {
    return validateNexusApiKey(apiKey)
  })

  ipcMain.handle(IPC.NXM_DOWNLOAD_START, async (_event, payload: NxmLinkPayload) => {
    const mainWindow = getMainWindow()
    const settings = loadSettings()

    if (!settings.nexusApiKey) {
      return { ok: false, error: 'Nexus API key not configured. Add it in Settings > Nexus.' }
    }

    const id = uuidv4()

    const cdnResult = await fetchDownloadUrl(
      payload.modId,
      payload.fileId,
      payload.key,
      payload.expires,
      settings.nexusApiKey,
    )
    if (!cdnResult.ok || !cdnResult.data) {
      return { ok: false, error: cdnResult.error ?? 'Could not resolve download URL' }
    }

    const cdnUrl = cdnResult.data
    let rawName: string
    try {
      rawName = decodeURIComponent(path.basename(new URL(cdnUrl).pathname))
    } catch {
      rawName = ''
    }
    const fileName = rawName || `mod-${payload.modId}-file-${payload.fileId}.zip`
    const downloadDir = settings.downloadPath
    fs.mkdirSync(downloadDir, { recursive: true })
    const destPath = path.join(downloadDir, fileName)

    const abort = new AbortController()
    inFlightDownloads.set(id, { abort, destPath })

    // Fire-and-forget — return id immediately
    void (async () => {
      try {
        await downloadFile(
          cdnUrl,
          destPath,
          (downloadedBytes, totalBytes, speedBps) => {
            mainWindow?.webContents.send(IPC.NXM_DOWNLOAD_PROGRESS, {
              id, downloadedBytes, totalBytes, speedBps,
            })
          },
          abort.signal,
        )
        inFlightDownloads.delete(id)
        mainWindow?.webContents.send(IPC.NXM_DOWNLOAD_COMPLETE, { id, savedPath: destPath, fileName })
      } catch (err) {
        inFlightDownloads.delete(id)
        const message = err instanceof Error ? err.message : 'Download failed'
        if (message !== 'Cancelled') {
          mainWindow?.webContents.send(IPC.NXM_DOWNLOAD_ERROR, { id, error: message })
        }
      }
    })()

    return { ok: true, data: { id, fileName } }
  })

  ipcMain.handle(IPC.NXM_DOWNLOAD_CANCEL, (_event, id: string) => {
    const handle = inFlightDownloads.get(id)
    if (handle) {
      handle.abort.abort()
      inFlightDownloads.delete(id)
    }
    return { ok: true }
  })
}
