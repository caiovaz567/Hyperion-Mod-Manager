import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import { safeSendToWindow } from './logStore'

// Cache the latest "update available" result so a check that resolves during the splash
// (before the renderer mounts its listeners) is not lost — it is re-emitted on APP_READY.
let cachedUpdateInfo: { version: string; releaseNotes: unknown } | null = null
let updatesWindow: BrowserWindow | null = null

export function initializeUpdates(mainWindow: BrowserWindow): void {
  updatesWindow = mainWindow
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    cachedUpdateInfo = {
      version: info.version,
      releaseNotes: info.releaseNotes,
    }
    safeSendToWindow(mainWindow, IPC.UPDATE_AVAILABLE, cachedUpdateInfo)
  })

  autoUpdater.on('download-progress', (progress) => {
    safeSendToWindow(mainWindow, IPC.UPDATE_PROGRESS, {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    safeSendToWindow(mainWindow, IPC.UPDATE_DOWNLOADED, {
      version: info.version
    })
  })

  autoUpdater.on('error', (err) => {
    safeSendToWindow(mainWindow, IPC.UPDATE_ERROR, err.message)
  })

  // Register IPC handlers for update actions
  const { ipcMain } = require('electron')

  ipcMain.handle(IPC.CHECK_UPDATE, async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      safeSendToWindow(mainWindow, IPC.UPDATE_ERROR, message)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(IPC.DOWNLOAD_UPDATE, async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      safeSendToWindow(mainWindow, IPC.UPDATE_ERROR, message)
      return { ok: false, error: message }
    }
  })

  ipcMain.on(IPC.INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall(true, true)
  })
}

// Kick off the self-update check immediately at startup so the GitHub round-trip
// overlaps with the splash and the header button is ready when the window opens.
// Errors are swallowed here — they still reach the renderer via the error event.
export async function checkForUpdatesOnStartup(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Surfaced through the autoUpdater 'error' listener if a window is attached.
  }
}

// Re-emit the cached update result once the renderer signals it is ready, covering
// the case where the check resolved before the renderer's listeners were registered.
export function flushCachedUpdateInfo(): void {
  if (cachedUpdateInfo && updatesWindow) {
    safeSendToWindow(updatesWindow, IPC.UPDATE_AVAILABLE, cachedUpdateInfo)
  }
}
