import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { AppSettings, IpcResult } from '../../../shared/types'
import type { PathDefaults } from '../../../shared/types'
import { IpcService } from '../../services/IpcService'

export interface SettingsSlice {
  settings: AppSettings | null
  defaultPaths: PathDefaults | null
  gamePathValid: boolean
  libraryPathValid: boolean
  gameRunning: boolean
  loadSettings: () => Promise<AppSettings>
  loadDefaultPaths: () => Promise<PathDefaults>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  detectGamePath: () => Promise<IpcResult<string>>
  checkGamePath: (gamePath?: string) => Promise<boolean>
  checkLibraryPath: (libraryPath?: string) => Promise<boolean>
  validateGamePath: (gamePath?: string) => Promise<boolean>
  validateLibraryPath: (libraryPath?: string) => Promise<boolean>
  checkGameRunning: () => Promise<boolean>
  killGame: () => Promise<boolean>
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (
  set,
  get
) => ({
  settings: null,
  defaultPaths: null,
  gamePathValid: false,
  libraryPathValid: false,
  gameRunning: false,

  loadSettings: async () => {
    const data = await IpcService.invoke<AppSettings>(IPC.GET_SETTINGS)
    const validation = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_GAME_PATH, data.gamePath)
    const libraryValidation = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_LIBRARY_PATH, data.libraryPath)
    set({
      settings: data,
      gamePathValid: Boolean(validation.ok && validation.data),
      libraryPathValid: Boolean(libraryValidation.ok && libraryValidation.data),
    })
    return data
  },

  loadDefaultPaths: async () => {
    const defaults = await IpcService.invoke<PathDefaults>(IPC.GET_PATH_DEFAULTS)
    set({ defaultPaths: defaults })
    return defaults
  },

  updateSettings: async (partial) => {
    const current = get().settings
    if (!current) return
    const merged = { ...current, ...partial }
    await IpcService.invoke(IPC.SET_SETTINGS, merged)
    const validation = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_GAME_PATH, merged.gamePath)
    const libraryValidation = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_LIBRARY_PATH, merged.libraryPath)
    set({
      settings: merged,
      gamePathValid: Boolean(validation.ok && validation.data),
      libraryPathValid: Boolean(libraryValidation.ok && libraryValidation.data),
    })
  },

  detectGamePath: async () => IpcService.invoke<IpcResult<string>>(IPC.DETECT_GAME),

  checkGamePath: async (gamePath) => {
    const currentPath = gamePath ?? get().settings?.gamePath ?? ''
    const result = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_GAME_PATH, currentPath)
    return Boolean(result.ok && result.data)
  },

  checkLibraryPath: async (libraryPath) => {
    const currentPath = libraryPath ?? get().settings?.libraryPath ?? ''
    const result = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_LIBRARY_PATH, currentPath)
    return Boolean(result.ok && result.data)
  },

  validateGamePath: async (gamePath) => {
    const currentPath = gamePath ?? get().settings?.gamePath ?? ''
    const result = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_GAME_PATH, currentPath)
    const isValid = Boolean(result.ok && result.data)
    set({ gamePathValid: isValid })
    return isValid
  },

  validateLibraryPath: async (libraryPath) => {
    const currentPath = libraryPath ?? get().settings?.libraryPath ?? ''
    const result = await IpcService.invoke<IpcResult<boolean>>(IPC.VALIDATE_LIBRARY_PATH, currentPath)
    const isValid = Boolean(result.ok && result.data)
    set({ libraryPathValid: isValid })
    return isValid
  },

  checkGameRunning: async () => {
    const running = await IpcService.invoke<boolean>(IPC.GAME_RUNNING)
    set({ gameRunning: running })
    return running
  },

  killGame: async () => {
    const result = await IpcService.invoke<{ ok: boolean }>(IPC.KILL_GAME)
    if (result.ok) set({ gameRunning: false })
    return result.ok
  },
})
