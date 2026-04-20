import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type {
  ActiveDownload,
  DownloadEntry,
  DuplicateNxmDownloadInfo,
  DuplicateModInfo,
  InstallModRequest,
  InstallModResponse,
  InstallProgress,
  IpcResult,
  ModMetadata,
  NxmLinkPayload,
  NxmDownloadStartResponse,
} from '../../../shared/types'
import { parseNxmUrl } from '../../../shared/nxm'
import { IpcService } from '../../services/IpcService'

// Module-level set so concurrent async calls can't both slip through
// before reactive state has a chance to update
const pendingDownloadKeys = new Set<string>()

export interface InstallPromptInfo {
  mode: 'duplicate' | 'reinstall'
  existingModId: string
  existingModName: string
  incomingModName: string
  sourcePath: string
}

export interface DuplicateDownloadPromptInfo extends DuplicateNxmDownloadInfo {
  payload: NxmLinkPayload
}

export interface DownloadsSlice {
  installing: boolean
  installProgress: number
  installStatus: string
  installCurrentFile: string
  installSourcePath: string
  installTargetModId: string
  installPlacement: 'replace' | 'append'
  pendingMod: ModMetadata | null
  installPrompt: InstallPromptInfo | null
  pendingInstallRequest: InstallModRequest | null
  duplicateDownloadPrompt: DuplicateDownloadPromptInfo | null
  activeDownloads: ActiveDownload[]
  localFiles: DownloadEntry[]
  newFiles: string[]
  downloadsLoadedPath: string

  installMod: (
    filePath: string,
    request?: Partial<InstallModRequest>
  ) => Promise<IpcResult<InstallModResponse>>
  reinstallMod: (modId: string) => Promise<IpcResult<InstallModResponse>>
  openReinstallPrompt: (mod: ModMetadata) => void
  clearInstallPrompt: () => void
  confirmDuplicateDownload: () => Promise<void>
  clearDuplicateDownloadPrompt: () => void
  clearInstall: () => void
  refreshLocalFiles: () => Promise<void>
  startNxmDownload: (payload: NxmLinkPayload, options?: { allowDuplicate?: boolean }) => Promise<void>
  pauseDownload: (id: string) => Promise<void>
  resumeDownload: (id: string) => Promise<void>
  cancelDownload: (id: string) => Promise<void>
  markFileAsOld: (filePath: string) => void
  setupNxmListeners: () => () => void
}

export const createDownloadsSlice: StateCreator<DownloadsSlice, [], [], DownloadsSlice> = (
  set,
  get
) => ({
  installing: false,
  installProgress: 0,
  installStatus: '',
  installCurrentFile: '',
  installSourcePath: '',
  installTargetModId: '',
  installPlacement: 'append',
  pendingMod: null,
  installPrompt: null,
  pendingInstallRequest: null,
  duplicateDownloadPrompt: null,
  newFiles: (() => {
    try { return JSON.parse(localStorage.getItem('hyperion:newFiles') ?? '[]') as string[] }
    catch { return [] }
  })(),
  downloadsLoadedPath: '',
  activeDownloads: [],
  localFiles: [],

  installMod: async (filePath, request = {}) => {
    set({
      installing: true,
      installProgress: 0,
      installStatus: 'Starting...',
      installCurrentFile: '',
      installSourcePath: filePath,
      installTargetModId: request.targetModId ?? '',
      installPlacement: request.duplicateAction === 'replace' ? 'replace' : 'append',
    })

    const unsubscribe = IpcService.on(IPC.INSTALL_PROGRESS, (...args) => {
      const progress = args[0] as InstallProgress
      set({ installProgress: progress.percent, installStatus: progress.step, installCurrentFile: progress.currentFile ?? '' })
    })

    const result = await IpcService.invoke<IpcResult<InstallModResponse>>(
      IPC.INSTALL_MOD,
      {
        filePath,
        ...request,
      }
    )

    unsubscribe()
    set({
      installing: false,
      installCurrentFile: '',
      installSourcePath: '',
      installTargetModId: '',
      installPlacement: 'append',
    })

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
    const targetMod = (
      get() as DownloadsSlice & {
        mods?: ModMetadata[]
      }
    ).mods?.find((mod) => mod.uuid === modId)
    set({
      installing: true,
      installProgress: 0,
      installStatus: 'Reinstalling...',
      installCurrentFile: '',
      installSourcePath: targetMod?.sourcePath ?? '',
      installTargetModId: modId,
      installPlacement: 'replace',
    })

    const unsubscribe = IpcService.on(IPC.INSTALL_PROGRESS, (...args) => {
      const progress = args[0] as InstallProgress
      set({ installProgress: progress.percent, installStatus: progress.step, installCurrentFile: progress.currentFile ?? '' })
    })

    const result = await IpcService.invoke<IpcResult<InstallModResponse>>(
      IPC.REINSTALL_MOD,
      modId
    )

    unsubscribe()
    set({
      installing: false,
      installCurrentFile: '',
      installSourcePath: '',
      installTargetModId: '',
      installPlacement: 'append',
    })

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

  confirmDuplicateDownload: async () => {
    const prompt = get().duplicateDownloadPrompt
    if (!prompt) return

    set({ duplicateDownloadPrompt: null })
    await get().startNxmDownload(prompt.payload, { allowDuplicate: true })
  },

  clearDuplicateDownloadPrompt: () =>
    set({
      duplicateDownloadPrompt: null,
    }),

  clearInstall: () =>
    set({
      installing: false,
      installProgress: 0,
      installStatus: '',
      installCurrentFile: '',
      installSourcePath: '',
      installTargetModId: '',
      installPlacement: 'append',
      pendingMod: null,
      installPrompt: null,
      pendingInstallRequest: null,
      duplicateDownloadPrompt: null,
    }),

  refreshLocalFiles: async () => {
    const result = await IpcService.invoke<IpcResult<DownloadEntry[]>>(IPC.LIST_DOWNLOADS)
    const downloadPath = (get() as DownloadsSlice & { settings?: { downloadPath?: string } | null }).settings?.downloadPath ?? ''
    if (result.ok && result.data) {
      set({ localFiles: result.data, downloadsLoadedPath: downloadPath })
      return
    }
    set({ downloadsLoadedPath: downloadPath })
  },

  startNxmDownload: async (payload, options = {}) => {
    const key = `${payload.modId}:${payload.fileId}`
    const notify = (message: string, tone: 'info' | 'warning' | 'error' = 'info') => {
      const state = get() as DownloadsSlice & {
        addToast?: (toastMessage: string, toastType?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      }
      state.addToast?.(message, tone, 2600)
    }

    // Synchronous guard (module-level Set) prevents a race condition where
    // two NXM_LINK_RECEIVED events arrive before the first async call
    // updates reactive state, letting both slip through the activeDownloads check.
    if (pendingDownloadKeys.has(key)) return
    const alreadyActive = get().activeDownloads.find(
      (d) => d.nxmModId === payload.modId && d.nxmFileId === payload.fileId &&
        (d.status === 'queued' || d.status === 'downloading' || d.status === 'paused')
    )
    if (alreadyActive) return

    pendingDownloadKeys.add(key)
    try {
      const result = await IpcService.invoke<IpcResult<NxmDownloadStartResponse>>(
        IPC.NXM_DOWNLOAD_START,
        {
          payload,
          allowDuplicate: options.allowDuplicate === true,
        }
      )
      if (!result.ok || !result.data) {
        notify(result.error ?? 'Could not start Nexus download', 'warning')
        return
      }

      if (result.data.status === 'duplicate' && result.data.duplicate) {
        set({
          duplicateDownloadPrompt: {
            ...result.data.duplicate,
            payload,
          },
        })
        return
      }

      if (result.data.status !== 'started' || !result.data.id || !result.data.fileName) {
        notify('Could not start Nexus download', 'warning')
        return
      }

      const { id, fileName } = result.data
      set((state) => ({
        duplicateDownloadPrompt: null,
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
    } finally {
      pendingDownloadKeys.delete(key)
    }
  },

  pauseDownload: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.NXM_DOWNLOAD_PAUSE, id)
    if (!result.ok) return

    set((state) => ({
      activeDownloads: state.activeDownloads.map((d) =>
        d.id === id ? { ...d, status: 'paused' as const, speedBps: 0 } : d
      ),
    }))
  },

  resumeDownload: async (id) => {
    const result = await IpcService.invoke<IpcResult>(IPC.NXM_DOWNLOAD_RESUME, id)
    if (!result.ok) return

    set((state) => ({
      activeDownloads: state.activeDownloads.map((d) =>
        d.id === id ? { ...d, status: 'downloading' as const, error: undefined } : d
      ),
    }))
  },

  cancelDownload: async (id) => {
    await IpcService.invoke(IPC.NXM_DOWNLOAD_CANCEL, id)
    set((state) => ({
      activeDownloads: state.activeDownloads.filter((d) => d.id !== id),
    }))
  },

  markFileAsOld: (filePath) => {
    set((state) => {
      const next = state.newFiles.filter((p) => p !== filePath)
      try { localStorage.setItem('hyperion:newFiles', JSON.stringify(next)) } catch { /* ignore */ }
      return { newFiles: next }
    })
  },

  setupNxmListeners: () => {
    const unsubLink = IpcService.on(IPC.NXM_LINK_RECEIVED, (...args) => {
      const incoming = args[0] as string | NxmLinkPayload
      const payload = typeof incoming === 'string' ? parseNxmUrl(incoming) : incoming
      if (!payload) {
        const state = get() as DownloadsSlice & {
          addToast?: (toastMessage: string, toastType?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
        }
        state.addToast?.('Could not read Nexus download link', 'warning', 3200)
        return
      }
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
      // Remove the active row immediately and refresh local files so the file
      // appears with the NEW badge without a double-row overlap period.
      set((state) => {
        const next = [...new Set([...state.newFiles, savedPath])]
        try { localStorage.setItem('hyperion:newFiles', JSON.stringify(next)) } catch { /* ignore */ }
        return { activeDownloads: state.activeDownloads.filter((d) => d.id !== id), newFiles: next }
      })
      get().refreshLocalFiles().catch(() => undefined)
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
