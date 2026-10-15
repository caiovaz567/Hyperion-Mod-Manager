import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/types'
import type { IpcChannel } from '../shared/types'

// Channel allowlist: the bridge only forwards channels the app actually
// defines, so even script running in the renderer can't reach an arbitrary
// ipcMain/ipcRenderer channel through `window.api`.
const ALLOWED_CHANNELS: ReadonlySet<string> = new Set<string>(Object.values(IPC))
const ALLOWED_SEND_CHANNELS: ReadonlySet<string> = new Set<string>([
  ...ALLOWED_CHANNELS,
  'window:minimize',
  'window:maximize',
  'window:close',
])

function assertChannel(channel: string, allowed: ReadonlySet<string>): void {
  if (typeof channel !== 'string' || !allowed.has(channel)) {
    throw new Error(`Blocked IPC channel: ${String(channel)}`)
  }
}

const api = {
  invoke: (channel: IpcChannel, ...args: unknown[]): Promise<unknown> => {
    assertChannel(channel, ALLOWED_CHANNELS)
    return ipcRenderer.invoke(channel, ...args)
  },
  send: (channel: string, ...args: unknown[]): void => {
    assertChannel(channel, ALLOWED_SEND_CHANNELS)
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: IpcChannel, listener: (...args: unknown[]) => void): (() => void) => {
    assertChannel(channel, ALLOWED_CHANNELS)
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      listener(...args)
    }
    ipcRenderer.on(channel, wrapped)
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  once: (channel: IpcChannel, listener: (...args: unknown[]) => void): void => {
    assertChannel(channel, ALLOWED_CHANNELS)
    ipcRenderer.once(channel, (_event, ...args) => listener(...args))
  },
  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
