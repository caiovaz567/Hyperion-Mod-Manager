import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcChannel } from '../shared/types'

const api = {
  invoke: (channel: IpcChannel, ...args: unknown[]): Promise<unknown> => {
    return ipcRenderer.invoke(channel, ...args)
  },
  send: (channel: string, ...args: unknown[]): void => {
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: IpcChannel, listener: (...args: unknown[]) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      listener(...args)
    }
    ipcRenderer.on(channel, wrapped)
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  once: (channel: IpcChannel, listener: (...args: unknown[]) => void): void => {
    ipcRenderer.once(channel, (_event, ...args) => listener(...args))
  },
  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
