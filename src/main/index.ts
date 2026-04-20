import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
  screen
} from 'electron'
import fs from 'fs'
import path from 'path'
import { getPathDefaults, loadSettings, saveSettings } from './settings'
import { createSplashWindow } from './splash'
import { initializeUpdates } from './updater'
import { registerModManagerHandlers } from './ipc/modManager'
import { registerInstallerHandlers } from './ipc/installer'
import { registerGameDetectorHandlers } from './ipc/gameDetector'
import { registerNexusDownloaderHandlers } from './ipc/nexusDownloader'
import { IPC } from '../shared/types'
import { parseNxmUrl } from '../shared/nxm'
import { clearAppLogs, getAppLogsSnapshot, pushGeneralLog, safeSendToWindow } from './logStore'
import { findNexusDownloadRecordByPath, removeNexusDownloadRecordByPath } from './nexusDownloadRegistry'

const DOWNLOAD_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const GAME_EXECUTABLE_RELATIVE_PATH = path.join('bin', 'x64', 'Cyberpunk2077.exe')

function resolveGameExecutable(gamePath: string): string {
  if (!gamePath) return ''

  const normalizedPath = path.normalize(gamePath)
  try {
    const stats = fs.statSync(normalizedPath)
    if (stats.isDirectory()) {
      return path.join(normalizedPath, GAME_EXECUTABLE_RELATIVE_PATH)
    }
  } catch {
    // Fall through and return the raw path for error reporting via openPath.
  }

  return normalizedPath
}

function isValidConfiguredGamePath(gamePath?: string): boolean {
  const normalizedPath = gamePath?.trim()
  if (!normalizedPath) return false

  try {
    return fs.existsSync(resolveGameExecutable(normalizedPath))
  } catch {
    return false
  }
}

function isUsableDirectoryPath(targetPath?: string): boolean {
  if (!targetPath?.trim()) return false
  if (!path.isAbsolute(targetPath)) return false

  if (fs.existsSync(targetPath)) {
    try {
      return fs.statSync(targetPath).isDirectory()
    } catch {
      return false
    }
  }

  const parentDir = path.dirname(targetPath)
  if (!parentDir || parentDir === targetPath) return false

  try {
    return fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()
  } catch {
    return false
  }
}

function collectDownloadEntries(dirPath: string, limit = 500): Array<{
  path: string
  name: string
  size: number
  modifiedAt: string
  downloadedAt?: string
  extension: string
  nxmModId?: number
  nxmFileId?: number
  version?: string
}> {
  if (!dirPath || !fs.existsSync(dirPath)) return []

  const results: Array<{
    path: string
    name: string
    size: number
    modifiedAt: string
    downloadedAt?: string
    extension: string
    nxmModId?: number
    nxmFileId?: number
    version?: string
  }> = []

  const visit = (currentDir: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (!DOWNLOAD_EXTENSIONS.has(extension)) continue
      const stats = fs.statSync(fullPath)
      const nexusRecord = findNexusDownloadRecordByPath(fullPath)
      results.push({
        path: fullPath,
        name: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        downloadedAt: nexusRecord?.createdAt,
        extension,
        nxmModId: nexusRecord?.modId,
        nxmFileId: nexusRecord?.fileId,
        version: nexusRecord?.version,
      })
    }
  }

  visit(dirPath)

  return results
    .sort((left, right) => {
      const rightOrderTs = Date.parse(right.downloadedAt ?? right.modifiedAt)
      const leftOrderTs = Date.parse(left.downloadedAt ?? left.modifiedAt)
      if (rightOrderTs !== leftOrderTs) return rightOrderTs - leftOrderTs

      const rightModifiedTs = Date.parse(right.modifiedAt)
      const leftModifiedTs = Date.parse(left.modifiedAt)
      if (rightModifiedTs !== leftModifiedTs) return rightModifiedTs - leftModifiedTs

      return right.name.localeCompare(left.name, undefined, { sensitivity: 'base' })
    })
    .slice(0, limit)
}

app.setName('Hyperion')

if (process.platform === 'win32') {
  app.setAppUserModelId('com.hyperion.modmanager')
}

if (!app.isPackaged) {
  app.setPath('sessionData', path.join(app.getPath('temp'), 'Hyperion-dev-session', String(process.pid)))
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
const pendingNxmUrls: string[] = []

function normalizeNxmProtocolArg(value?: string): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^"+|"+$/g, '')
  return /^nxm:\/\//i.test(normalized) ? normalized : null
}

function findNxmProtocolArg(args: string[]): string | null {
  for (const arg of args) {
    const normalized = normalizeNxmProtocolArg(arg)
    if (normalized) return normalized
  }
  return null
}

function describeNxmUrl(raw: string): Record<string, unknown> {
  const parsed = parseNxmUrl(raw)
  if (!parsed) return { rawScheme: 'nxm', parsed: false }
  return {
    rawScheme: 'nxm',
    parsed: true,
    modId: parsed.modId,
    fileId: parsed.fileId,
  }
}

const startupNxmArg = findNxmProtocolArg(process.argv)
if (startupNxmArg) {
  pendingNxmUrls.push(startupNxmArg)
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'nexus',
    message: 'NXM link detected in startup arguments',
    details: describeNxmUrl(startupNxmArg),
  })
}

function flushPendingNxmUrls(): void {
  if (!rendererReady || !mainWindow) return

  while (pendingNxmUrls.length > 0) {
    const nextUrl = pendingNxmUrls[0]
    if (!safeSendToWindow(mainWindow, IPC.NXM_LINK_RECEIVED, nextUrl)) {
      return
    }
    pendingNxmUrls.shift()
  }
}

function enqueueOrSendNxmUrl(url: string): void {
  if (!rendererReady || !mainWindow || !safeSendToWindow(mainWindow, IPC.NXM_LINK_RECEIVED, url)) {
    pendingNxmUrls.push(url)
    return
  }

  flushPendingNxmUrls()
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const nxm = findNxmProtocolArg(argv)
  if (nxm) {
    pushGeneralLog(mainWindow, {
      level: 'info',
      source: 'nexus',
      message: 'NXM link received from second instance',
      details: describeNxmUrl(nxm),
    })
    enqueueOrSendNxmUrl(nxm)
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('open-url', (_event, url) => {
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'nexus',
    message: 'NXM link received from OS open-url event',
    details: describeNxmUrl(url),
  })
  enqueueOrSendNxmUrl(url)
})

function resolveWindowIconPath(): string {
  if (process.platform === 'win32') {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'resources', 'icon.png')
    }

    return path.join(app.getAppPath(), 'build', 'icon.ico')
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'icon.png')
  }

  return path.join(app.getAppPath(), 'src', 'main', 'resources', 'icon.png')
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getInitialMainWindowBounds(): {
  width: number
  height: number
  minWidth: number
  minHeight: number
  x: number
  y: number
} {
  const display = screen.getPrimaryDisplay()
  const { x, y, width: workWidth, height: workHeight } = display.workArea

  const maxWidth = Math.max(1100, workWidth - 96)
  const maxHeight = Math.max(720, workHeight - 72)
  const width = clampNumber(Math.round(workWidth * 0.82), Math.min(1360, maxWidth), maxWidth)
  const height = clampNumber(Math.round(workHeight * 0.84), Math.min(860, maxHeight), maxHeight)

  return {
    width,
    height,
    minWidth: Math.min(1100, maxWidth),
    minHeight: Math.min(720, maxHeight),
    x: x + Math.round((workWidth - width) / 2),
    y: y + Math.round((workHeight - height) / 2),
  }
}

function createMainWindow(): BrowserWindow {
  const bounds = getInitialMainWindowBounds()
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    x: bounds.x,
    y: bounds.y,
    show: false,
    frame: false,
    title: 'Hyperion',
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerGlobalHandlers(): void {
  // Settings
  ipcMain.handle(IPC.GET_SETTINGS, () => loadSettings())
  ipcMain.handle(IPC.GET_PATH_DEFAULTS, () => getPathDefaults())
  ipcMain.handle(IPC.SET_SETTINGS, (_event, settings) => {
    try {
      saveSettings(settings)

      if (settings.gamePath?.trim() && !isValidConfiguredGamePath(settings.gamePath)) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'settings',
          message: 'Game path invalid',
          details: { gamePath: settings.gamePath },
        })
      }

      if (settings.downloadPath?.trim() && !isUsableDirectoryPath(settings.downloadPath)) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'settings',
          message: 'Downloads path invalid',
          details: { downloadPath: settings.downloadPath },
        })
      }

      return { ok: true }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Settings save failed',
        details: error instanceof Error ? { error: error.message } : { error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not save settings',
      }
    }
  })

  // File dialogs
  ipcMain.handle(IPC.OPEN_FILE_DIALOG, async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, options)
    return result
  })

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      ...options,
      properties: ['openDirectory']
    })
    return result
  })

  ipcMain.handle(IPC.LIST_DOWNLOADS, () => {
    const settings = loadSettings()
    if (!settings.downloadPath) return { ok: true, data: [] }
    if (!isUsableDirectoryPath(settings.downloadPath)) {
      pushGeneralLog(mainWindow, {
        level: 'warn',
        source: 'downloads',
        message: 'Downloads path invalid',
        details: { downloadPath: settings.downloadPath },
      })
      return { ok: false, error: 'Downloads path is invalid' }
    }
    try {
      return { ok: true, data: collectDownloadEntries(settings.downloadPath) }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Downloads folder read failed',
        details: error instanceof Error
          ? { downloadPath: settings.downloadPath, error: error.message }
          : { downloadPath: settings.downloadPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not read downloads folder'
      }
    }
  })

  ipcMain.handle(IPC.DELETE_DOWNLOAD, (_event, downloadPath: string) => {
    try {
      if (!downloadPath || !fs.existsSync(downloadPath)) {
        return { ok: false, error: 'Download file not found' }
      }

      fs.rmSync(downloadPath, { force: true })
      removeNexusDownloadRecordByPath(downloadPath)
      return { ok: true }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Download delete failed',
        details: error instanceof Error
          ? { downloadPath, error: error.message }
          : { downloadPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not delete download file'
      }
    }
  })

  ipcMain.handle(IPC.DELETE_ALL_DOWNLOADS, () => {
    const settings = loadSettings()
    if (!settings.downloadPath) return { ok: false, error: 'Downloads path not configured' }
    if (!isUsableDirectoryPath(settings.downloadPath)) {
      return { ok: false, error: 'Downloads path is invalid' }
    }

    try {
      const entries = collectDownloadEntries(settings.downloadPath)
      let removed = 0
      let failed = 0
      const failures: Array<{ path: string; error: string }> = []

      for (const entry of entries) {
        try {
          fs.rmSync(entry.path, { force: true })
          removeNexusDownloadRecordByPath(entry.path)
          removed += 1
        } catch (error) {
          failed += 1
          failures.push({
            path: entry.path,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (failures.length > 0) {
        pushGeneralLog(mainWindow, {
          level: 'warn',
          source: 'filesystem',
          message: 'Some downloads could not be deleted',
          details: { failures },
        })
      }

      return { ok: true, data: { removed, failed } }
    } catch (error) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'filesystem',
        message: 'Delete all downloads failed',
        details: error instanceof Error
          ? { downloadPath: settings.downloadPath, error: error.message }
          : { downloadPath: settings.downloadPath, error: String(error) },
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not delete downloads',
      }
    }
  })

  // Shell
  ipcMain.handle(IPC.OPEN_PATH, async (_event, targetPath: string) => {
    if (!targetPath) return { ok: false, error: 'Path not provided' }
    const errorMessage = await shell.openPath(targetPath)
    if (errorMessage) {
      return { ok: false, error: errorMessage }
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.SHOW_ITEM_IN_FOLDER, (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: string) => {
    // Only allow https:// URLs for security
    if (url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle(IPC.LAUNCH_GAME, async () => {
    const settings = loadSettings()
    if (!settings.gamePath) return { ok: false, error: 'Game path not configured' }
    const launchTarget = resolveGameExecutable(settings.gamePath)
    const errMsg = await shell.openPath(launchTarget)
    if (errMsg) {
      pushGeneralLog(mainWindow, {
        level: 'error',
        source: 'launcher',
        message: 'Game launch failed',
        details: { launchTarget, error: errMsg },
      })
      return { ok: false, error: errMsg }
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion())
  ipcMain.handle(IPC.APP_LOGS_GET, () => ({ ok: true, data: getAppLogsSnapshot() }))
  ipcMain.handle(IPC.APP_LOGS_CLEAR, (_event, kind: 'general' | 'requests' | 'all' = 'all') => {
    clearAppLogs(kind)
    return { ok: true }
  })

  // Window controls (titlebar buttons)
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })
}

app.whenReady().then(async () => {
  // Show splash while loading
  const splash = createSplashWindow()
  let mainWindowReadyToShow = false

  const updateSplashStatus = (message: string) => {
    if (splash.isDestroyed()) return
    const serialized = JSON.stringify(message)
    splash.webContents.executeJavaScript(`
      const s = document.getElementById('status');
      if (s) s.textContent = ${serialized};
    `).catch(() => { /* splash element may not exist */ })
  }

  const revealMainWindow = () => {
    if (!rendererReady || !mainWindowReadyToShow || !mainWindow) return

    if (!splash.isDestroyed()) {
      splash.hide()
      splash.setAlwaysOnTop(false)
      splash.destroy()
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.moveTop()
    mainWindow.focus()

    flushPendingNxmUrls()
  }

  splash.webContents.on('did-finish-load', () => {
    updateSplashStatus('Loading settings...')
  })

  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('nxm')
  } else {
    // In dev mode pass the app path and -- so Electron doesn't treat the nxm:// URL as a module path
    app.setAsDefaultProtocolClient('nxm', process.execPath, [app.getAppPath(), '--'])
  }

  // Register all IPC handlers
  registerGlobalHandlers()
  registerModManagerHandlers(() => mainWindow)
  registerInstallerHandlers(() => mainWindow)
  registerGameDetectorHandlers()
  registerNexusDownloaderHandlers(() => mainWindow)

  // Load initial settings
  const settings = loadSettings()

  // Ensure library directory exists
  if (settings.libraryPath && !fs.existsSync(settings.libraryPath)) {
    fs.mkdirSync(settings.libraryPath, { recursive: true })
  }

  // Create main window (hidden)
  mainWindow = createMainWindow()
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'app',
    message: 'App started',
    details: { packaged: app.isPackaged, version: app.getVersion() },
  })

  if (settings.gamePath?.trim() && !isValidConfiguredGamePath(settings.gamePath)) {
    pushGeneralLog(mainWindow, {
      level: 'warn',
      source: 'settings',
      message: 'Game path invalid',
      details: { gamePath: settings.gamePath },
    })
  }

  if (settings.downloadPath?.trim() && !isUsableDirectoryPath(settings.downloadPath)) {
    pushGeneralLog(mainWindow, {
      level: 'warn',
      source: 'settings',
      message: 'Downloads path invalid',
      details: { downloadPath: settings.downloadPath },
    })
  }

  mainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true
    revealMainWindow()
  })

  // Initialize auto-updater
  initializeUpdates(mainWindow)

  // Reveal the main window only when Electron has a first paint ready and
  // the renderer explicitly signals that the boot sequence is complete.
  ipcMain.on(IPC.APP_BOOT_STATUS, (_event, message: string) => {
    updateSplashStatus(message)
  })

  ipcMain.once(IPC.APP_READY, () => {
    rendererReady = true
    flushPendingNxmUrls()
    revealMainWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  pushGeneralLog(mainWindow, {
    level: 'info',
    source: 'app',
    message: 'App shutting down',
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
