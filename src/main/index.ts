import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net
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

function collectDownloadEntries(dirPath: string, limit = 500): Array<{
  path: string
  name: string
  size: number
  modifiedAt: string
  extension: string
}> {
  if (!dirPath || !fs.existsSync(dirPath)) return []

  const results: Array<{
    path: string
    name: string
    size: number
    modifiedAt: string
    extension: string
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
      results.push({
        path: fullPath,
        name: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        extension
      })
    }
  }

  visit(dirPath)

  return results
    .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime())
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
let pendingNxmUrl: string | null = null

const startupNxmArg = process.argv.find((a) => a.startsWith('nxm://'))
if (startupNxmArg) pendingNxmUrl = startupNxmArg

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const nxm = argv.find((a) => a.startsWith('nxm://'))
  if (nxm) {
    if (mainWindow) {
      mainWindow.webContents.send(IPC.NXM_LINK_RECEIVED, nxm)
    } else {
      pendingNxmUrl = nxm
    }
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('open-url', (_event, url) => {
  if (mainWindow) {
    mainWindow.webContents.send(IPC.NXM_LINK_RECEIVED, url)
  } else {
    pendingNxmUrl = url
  }
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

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
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
    saveSettings(settings)
    return { ok: true }
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
    try {
      return { ok: true, data: collectDownloadEntries(settings.downloadPath) }
    } catch (error) {
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
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not delete download file'
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
    if (errMsg) return { ok: false, error: errMsg }
    return { ok: true }
  })

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion())

  // Window controls (titlebar buttons)
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

app.whenReady().then(async () => {
  // Show splash while loading
  const splash = createSplashWindow()

  splash.webContents.on('did-finish-load', () => {
    splash.webContents.executeJavaScript(`
      const s = document.getElementById('status'); if (s) s.textContent = 'Loading...';
    `).catch(() => {/* splash element may not exist */})
  })

  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('nxm')
  } else {
    // In dev mode pass the app path and -- so Electron doesn't treat the nxm:// URL as a module path
    app.setAsDefaultProtocolClient('nxm', process.execPath, [app.getAppPath(), '--'])
  }

  // Register all IPC handlers
  registerGlobalHandlers()
  registerModManagerHandlers()
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

  // Initialize auto-updater
  initializeUpdates(mainWindow)

  // When renderer is ready, show main window first then close splash.
  // Showing before closing prevents Windows from reassigning focus to
  // another window (or the taskbar) between the two operations.
  ipcMain.once(IPC.APP_READY, () => {
    mainWindow?.show()
    mainWindow?.focus()
    if (!splash.isDestroyed()) {
      splash.close()
    }
    if (pendingNxmUrl && mainWindow) {
      mainWindow.webContents.send(IPC.NXM_LINK_RECEIVED, pendingNxmUrl)
      pendingNxmUrl = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
