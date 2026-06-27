import type { IpcChannel } from '../../shared/types'
import type { ElectronAPI } from '../../../src/main/preload'

declare global {
  interface Window {
    api: {
      invoke: (channel: IpcChannel, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: IpcChannel, listener: (...args: unknown[]) => void) => () => void
      once: (channel: IpcChannel, listener: (...args: unknown[]) => void) => void
      getPathForFile: (file: File) => string
    }
  }
}

/**
 * Singleton service that wraps window.api for typed IPC calls.
 * Components must never call window.api directly.
 */
class IpcServiceClass {
  invoke<T = unknown>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
    return window.api.invoke(channel, ...args) as Promise<T>
  }

  send(channel: string, ...args: unknown[]): void {
    window.api.send(channel, ...args)
  }

  on(channel: IpcChannel, listener: (...args: unknown[]) => void): () => void {
    return window.api.on(channel, listener)
  }

  once(channel: IpcChannel, listener: (...args: unknown[]) => void): void {
    window.api.once(channel, listener)
  }

  getPathForFile(file: File): string {
    return window.api.getPathForFile(file)
  }
}

export const IpcService = new IpcServiceClass()
