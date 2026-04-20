import type { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import {
  IPC,
  type AppGeneralLogEntry,
  type AppLogsSnapshot,
  type AppLogsUpdate,
  type IpcChannel,
  type NexusApiLogEntry,
} from '../shared/types'

const MAX_GENERAL_LOG_ENTRIES = 200
const MAX_REQUEST_LOG_ENTRIES = 120

const generalLogEntries: AppGeneralLogEntry[] = []
const requestLogEntries: NexusApiLogEntry[] = []

function shouldStoreGeneralLog(entry: Omit<AppGeneralLogEntry, 'id' | 'timestamp'>): boolean {
  if (entry.level !== 'info') return true

  return entry.message === 'NXM download requested'
}

export function safeSendToWindow(
  mainWindow: BrowserWindow | null,
  channel: IpcChannel,
  ...args: unknown[]
): boolean {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    const webContents = mainWindow.webContents
    if (!webContents || webContents.isDestroyed()) return false
    webContents.send(channel, ...args)
    return true
  } catch {
    return false
  }
}

function emitLogUpdate(mainWindow: BrowserWindow | null, update: AppLogsUpdate): void {
  safeSendToWindow(mainWindow, IPC.APP_LOGS_UPDATED, update)
}

function trimLogs<T>(entries: T[], limit: number): void {
  if (entries.length > limit) {
    entries.length = limit
  }
}

export function pushGeneralLog(
  mainWindow: BrowserWindow | null,
  entry: Omit<AppGeneralLogEntry, 'id' | 'timestamp'>,
): AppGeneralLogEntry {
  const nextEntry: AppGeneralLogEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...entry,
  }

  if (!shouldStoreGeneralLog(entry)) {
    return nextEntry
  }

  generalLogEntries.unshift(nextEntry)
  trimLogs(generalLogEntries, MAX_GENERAL_LOG_ENTRIES)
  emitLogUpdate(mainWindow, { kind: 'general', entry: nextEntry })
  return nextEntry
}

export function pushRequestLog(
  mainWindow: BrowserWindow | null,
  entry: Omit<NexusApiLogEntry, 'id' | 'timestamp'>,
): NexusApiLogEntry {
  const nextEntry: NexusApiLogEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...entry,
  }

  requestLogEntries.unshift(nextEntry)
  trimLogs(requestLogEntries, MAX_REQUEST_LOG_ENTRIES)
  emitLogUpdate(mainWindow, { kind: 'requests', entry: nextEntry })
  return nextEntry
}

export function getAppLogsSnapshot(): AppLogsSnapshot {
  return {
    general: generalLogEntries.filter((entry) => shouldStoreGeneralLog(entry)),
    requests: [...requestLogEntries],
  }
}

export function clearAppLogs(kind: 'general' | 'requests' | 'all'): void {
  if (kind === 'general' || kind === 'all') {
    generalLogEntries.length = 0
  }
  if (kind === 'requests' || kind === 'all') {
    requestLogEntries.length = 0
  }
}
