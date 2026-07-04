// Minimal Electron stub for vitest. Main-process modules import `electron` at the
// top level (ipcMain, app.getPath in settings.ts, safeStorage, net), but the units
// under test are pure functions that never touch these at call time - the stub only
// has to satisfy module-load side effects.
import path from 'path'
import os from 'os'

const stubUserData = path.join(os.tmpdir(), 'hyperion-vitest-userdata')

export const app = {
  getPath: (_name: string) => stubUserData,
  getVersion: () => '0.0.0-test',
  isPackaged: false,
  isReady: () => true,
  on: (_event: string, _listener: (...args: unknown[]) => void) => app,
  whenReady: () => Promise.resolve(),
}

export const ipcMain = {
  handle: (_channel: string, _listener: (...args: unknown[]) => unknown) => {},
  on: (_channel: string, _listener: (...args: unknown[]) => void) => ipcMain,
  removeHandler: (_channel: string) => {},
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(value, 'utf-8'),
  decryptString: (value: Buffer) => value.toString('utf-8'),
}

export class BrowserWindow {
  webContents = { send: (_channel: string, ..._args: unknown[]) => {} }
  isDestroyed() {
    return false
  }
}

export const net = {
  request: () => {
    throw new Error('electron.net is not available in tests')
  },
}

export const shell = {
  openExternal: async (_url: string) => {},
  showItemInFolder: (_fullPath: string) => {},
}

export const dialog = {}
export const nativeTheme = { shouldUseDarkColors: true, on: () => nativeTheme }

export default { app, ipcMain, safeStorage, BrowserWindow, net, shell, dialog, nativeTheme }
