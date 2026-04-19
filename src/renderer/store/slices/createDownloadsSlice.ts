import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type {
  ActiveDownload,
  DownloadEntry,
  DuplicateModInfo,
  InstallModRequest,
  InstallModResponse,
  InstallProgress,
  IpcResult,
  ModMetadata,
  NxmLinkPayload,
} from '../../../shared/types'
import { IpcService } from '../../services/IpcService'

function parseNxmUrl(raw: string): NxmLinkPayload | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'nxm:') return null
    const parts = url.pathname.replace(/^\//, '').split('/')
    if (parts.length < 4 || parts[0] !== 'mods' || parts[2] !== 'files') return null
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

export interface InstallPromptInfo {
  mode: 'duplicate' | 'reinstall'
  existingModId: string
  existingModName: string
  incomingModName: string
  sourcePath: string
}

export interface DownloadsSlice {
  installing: boolean
  installProgress: number
  installStatus: string
  pendingMod: ModMetadata | null
  installPrompt: InstallPromptInfo | null
  pendingInstallRequest: InstallModRequest | null
  activeDownloads: ActiveDownload[]
  localFiles: DownloadEntry[]

  installMod: (
    filePath: string,
    request?: Partial<InstallModRequest>
  ) => Promise<IpcResult<InstallModResponse>>
  reinstallMod: (modId: string) => Promise<IpcResult<InstallModResponse>>
  openReinstallPrompt: (mod: ModMetadata) => void
  clearInstallPrompt: () => void
  clearInstall: () => void
  refreshLocalFiles: () => Promise<void>
  startNxmDownload: (payload: NxmLinkPayload) => Promise<void>
  cancelDownload: (id: string) => Promise<void>
  setupNxmListeners: () => () => void
}

export const createDownloadsSlice: StateCreator<DownloadsSlice, [], [], DownloadsSlice> = (
  set,
  get
) => ({
  installing: false,
  installProgress: 0,
  installStatus: '',
  pendingMod: null,
  installPrompt: null,
  pendingInstallRequest: null,
  activeDownloads: [],
  localFiles: [],

  installMod: async (filePath, request = {}) => {
    set({ installing: true, installProgress: 0, installStatus: 'Starting...' })

    const unsubscribe = IpcService.on(IPC.INSTALL_PROGRESS, (...args) => {
      const progress = args[0] as InstallProgress
      set({ installProgress: progress.percent, installStatus: progress.step })
    })

    const result = await IpcService.invoke<IpcResult<InstallModResponse>>(
      IPC.INSTALL_MOD,
      {
        filePath,
        ...request,
      }
    )

    unsubscribe()
    set({ installing: false })

    if (result.ok && result.data) {
      if (result.data.status === 'duplicate' && result.data.duplicate) {
        set({
          installPrompt: {
            mode: 'duplicate',
            existingModId: result.data.duplicate.existingModId,
            existingModName: result.data.duplicate.existingModName,
            incomingModName: result.data.duplicate.incomingModName,
            sourcePath: result.data.duplicate.sourcePath,
          },
          pendingInstallRequest: {
            filePath,
            targetModId: result.data.duplicate.existingModId,
            ...request,
            duplicateAction: 'prompt',
          },
        })
      } else {
        set({
          pendingMod: result.data.mod ?? null,
          installPrompt: null,
          pendingInstallRequest: null,
        })
      }
    }

    return result
  },

  reinstallMod: async (modId) => {
    set({ installing: true, installProgress: 0, installStatus: 'Reinstalling...' })

    const unsubscribe = IpcService.on(IPC.INSTALL_PROGRESS, (...args) => {
      const progress = args[0] as InstallProgress
      set({ installProgress: progress.percent, installStatus: progress.step })
    })

    const result = await IpcService.invoke<IpcResult<InstallModResponse>>(
      IPC.REINSTALL_MOD,
      modId
    )

    unsubscribe()
    set({ installing: false })

    if (result.ok && result.data?.status === 'installed') {
      set({ pendingMod: result.data.mod ?? null })
    }

    return result
  },

  openReinstallPrompt: (mod) =>
    set({
      installPrompt: mod.sourcePath
        ? {
            mode: 'reinstall',
            existingModId: mod.uuid,
            existingModName: mod.name,
            incomingModName: mod.name,
            sourcePath: mod.sourcePath,
          }
        : null,
      pendingInstallRequest: mod.sourcePath
        ? {
            filePath: mod.sourcePath,
            targetModId: mod.uuid,
            duplicateAction: 'prompt',
          }
        : null,
    }),

  clearInstallPrompt: () =>
    set({
      installPrompt: null,
      pendingInstallRequest: null,
    }),

  clearInstall: () =>
    set({
      installing: false,
      installProgress: 0,
      installStatus: '',
      pendingMod: null,
      installPrompt: null,
      pendingInstallRequest: null,
    }),

  refreshLocalFiles: async () => {
    const result = await IpcService.invoke<IpcResult<DownloadEntry[]>>(IPC.LIST_DOWNLOADS)
    if (result.ok && result.data) {
      set({ localFiles: result.data })
    }
  },

  startNxmDownload: async (payload) => {
    const result = await IpcService.invoke<IpcResult<{ id: string; fileName: string }>>(
      IPC.NXM_DOWNLOAD_START,
      payload
    )
    if (!result.ok || !result.data) return
    const { id, fileName } = result.data
    set((state) => ({
      activeDownloads: [
        ...state.activeDownloads,
        {
          id,
          nxmModId: payload.modId,
          nxmFileId: payload.fileId,
          fileName,
          totalBytes: 0,
          downloadedBytes: 0,
          speedBps: 0,
          status: 'downloading' as const,
        },
      ],
    }))
  },

  cancelDownload: async (id) => {
    await IpcService.invoke(IPC.NXM_DOWNLOAD_CANCEL, id)
    set((state) => ({
      activeDownloads: state.activeDownloads.filter((d) => d.id !== id),
    }))
  },

  setupNxmListeners: () => {
    const unsubLink = IpcService.on(IPC.NXM_LINK_RECEIVED, (...args) => {
      const raw = args[0] as string
      const payload = parseNxmUrl(raw)
      if (!payload) return
      get().startNxmDownload(payload).catch(() => undefined)
    })

    const unsubProgress = IpcService.on(IPC.NXM_DOWNLOAD_PROGRESS, (...args) => {
      const { id, downloadedBytes, totalBytes, speedBps } = args[0] as {
        id: string; downloadedBytes: number; totalBytes: number; speedBps: number
      }
      set((state) => ({
        activeDownloads: state.activeDownloads.map((d) =>
          d.id === id ? { ...d, downloadedBytes, totalBytes, speedBps, status: 'downloading' as const } : d
        ),
      }))
    })

    const unsubComplete = IpcService.on(IPC.NXM_DOWNLOAD_COMPLETE, (...args) => {
      const { id, savedPath } = args[0] as { id: string; savedPath: string; fileName: string }
      set((state) => ({
        activeDownloads: state.activeDownloads.map((d) =>
          d.id === id ? { ...d, status: 'done' as const, savedPath } : d
        ),
      }))
      window.setTimeout(() => {
        set((state) => ({
          activeDownloads: state.activeDownloads.filter((d) => d.id !== id),
        }))
        get().refreshLocalFiles().catch(() => undefined)
      }, 2000)
    })

    const unsubError = IpcService.on(IPC.NXM_DOWNLOAD_ERROR, (...args) => {
      const { id, error } = args[0] as { id: string; error: string }
      set((state) => ({
        activeDownloads: state.activeDownloads.map((d) =>
          d.id === id ? { ...d, status: 'error' as const, error } : d
        ),
      }))
    })

    return () => {
      unsubLink()
      unsubProgress()
      unsubComplete()
      unsubError()
    }
  },
})
