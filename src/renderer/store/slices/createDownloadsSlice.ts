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

// Serialize Nexus start requests per mod:file key so repeated clicks keep
// their order and fall through to the duplicate prompt instead of racing.
const pendingDownloadStarts = new Map<string, Promise<void>>()
const copySuffixPattern = /\sCopy(?:\s\d+)?$/i

function extractVersionFromFileName(rawName: string): string | undefined {
  const cleaned = rawName
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*nexus[^)]*\)/gi, ' ')
    .replace(/[_]+/g, ' ')
    .trim()

  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  if (dashParts.length > 1) {
    for (let index = 1; index < dashParts.length; index += 1) {
      const trailing = dashParts.slice(index)
      const versionLike = trailing.every((part) => /^v?\d+[a-z0-9.]*$/i.test(part))
      if (versionLike) {
        return trailing.map((part) => part.replace(/^v/i, '')).join('.')
      }
    }
  }

  const match = /[-_ ]v?(\d+(?:[._-]\d+)+)$/i.exec(cleaned)
  if (match) return match[1].replace(/[_-]/g, '.')

  return undefined
}

function normalizeVersion(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/^v/i, '')
}

function tokenizeVersion(value?: string): string[] {
  if (!value) return []
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

function compareVersionTokens(left?: string, right?: string): number | null {
  const leftTokens = tokenizeVersion(left)
  const rightTokens = tokenizeVersion(right)
  if (!leftTokens.length || !rightTokens.length) return null

  const length = Math.max(leftTokens.length, rightTokens.length)
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index] ?? '0'
    const rightToken = rightTokens[index] ?? '0'
    const leftNumber = Number(leftToken)
    const rightNumber = Number(rightToken)
    const bothNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)

    if (bothNumeric) {
      if (leftNumber === rightNumber) continue
      return leftNumber < rightNumber ? -1 : 1
    }

    if (leftToken === rightToken) continue
    return leftToken.localeCompare(rightToken)
  }

  return 0
}

function getVersionRelation(existingVersion?: string, incomingVersion?: string): 'upgrade' | 'downgrade' | 'different' | 'unknown' {
  const comparison = compareVersionTokens(existingVersion, incomingVersion)
  if (comparison === null) return 'unknown'
  if (comparison < 0) return 'upgrade'
  if (comparison > 0) return 'downgrade'
  return 'different'
}

function persistNewFiles(next: string[]): void {
  try { localStorage.setItem('hyperion:newFiles', JSON.stringify(next)) } catch { /* ignore */ }
}

function removeNewFilePath(entries: string[], filePath: string): string[] {
  const normalizedPath = filePath.trim().toLowerCase()
  return entries.filter((entryPath) => entryPath.trim().toLowerCase() !== normalizedPath)
}

function isCopyVariant(name: string): boolean {
  return copySuffixPattern.test(name.trim())
}

function getInstalledTimestamp(installedAt?: string): number {
  if (!installedAt) return 0
  const parsed = Date.parse(installedAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

function selectPreferredNexusMod(
  mods: ModMetadata[],
  nexusModId: number,
  incomingVersion?: string,
): ModMetadata | undefined {
  let candidates = mods.filter((mod) => mod.kind === 'mod' && mod.nexusModId === nexusModId)
  if (!candidates.length) return undefined

  if (incomingVersion) {
    const exactVersionMatches = candidates.filter((mod) => normalizeVersion(mod.version) === incomingVersion)
    if (exactVersionMatches.length > 0) {
      candidates = exactVersionMatches
    }
  }

  return [...candidates].sort((left, right) => {
    const copyDelta = Number(isCopyVariant(left.name)) - Number(isCopyVariant(right.name))
    if (copyDelta !== 0) return copyDelta

    const installedDelta = getInstalledTimestamp(right.installedAt) - getInstalledTimestamp(left.installedAt)
    if (installedDelta !== 0) return installedDelta

    return left.order - right.order
  })[0]
}

function shouldPromptForVersionDecision(existingVersion?: string, incomingVersion?: string): boolean {
  if (!existingVersion || !incomingVersion) return true
  return existingVersion !== incomingVersion
}

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

export interface VersionMismatchPromptInfo {
  nexusModId: number
  existingModId: string
  existingModName: string
  existingVersion?: string
  incomingVersion?: string
  sourcePath: string
  sourceFileName?: string
  sourceVersion?: string
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
  versionMismatchPrompt: VersionMismatchPromptInfo | null
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
  confirmVersionMismatch: (action: 'replace' | 'copy' | 'skip') => Promise<void>
  clearVersionMismatchPrompt: () => void
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
  versionMismatchPrompt: null,
  newFiles: (() => {
    try { return JSON.parse(localStorage.getItem('hyperion:newFiles') ?? '[]') as string[] }
    catch { return [] }
  })(),
  downloadsLoadedPath: '',
  activeDownloads: [],
  localFiles: [],

  installMod: async (filePath, request = {}) => {
    const state = get() as DownloadsSlice & {
      mods?: ModMetadata[]
    }
    const nexusModId = request.nexusModId
    const incomingVersion = normalizeVersion(request.sourceVersion)
      ?? (typeof nexusModId === 'number' ? undefined : extractVersionFromFileName(request.sourceFileName ?? filePath))
    const existingMod = typeof nexusModId === 'number'
      ? selectPreferredNexusMod(state.mods ?? [], nexusModId, incomingVersion)
      : undefined
    const existingVersion = normalizeVersion(existingMod?.version)

    if (!request.skipVersionMismatchPrompt && nexusModId && existingMod && !request.duplicateAction && shouldPromptForVersionDecision(existingVersion, incomingVersion)) {
      set({
        versionMismatchPrompt: {
          nexusModId,
          existingModId: existingMod.uuid,
          existingModName: existingMod.name,
          existingVersion,
          incomingVersion,
          sourcePath: filePath,
          sourceFileName: request.sourceFileName,
          sourceVersion: request.sourceVersion,
        },
      })
      return { ok: true, data: { status: 'version-mismatch' } }
    }

    if (!request.skipVersionMismatchPrompt && nexusModId && existingMod && !request.duplicateAction) {
      request = {
        ...request,
        duplicateAction: 'replace',
        targetModId: existingMod.uuid,
      }
    }

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
      const resultData = result.data

      if (resultData.status === 'duplicate' && resultData.duplicate) {
        set({
          installPrompt: {
            mode: 'duplicate',
            existingModId: resultData.duplicate.existingModId,
            existingModName: resultData.duplicate.existingModName,
            incomingModName: resultData.duplicate.incomingModName,
            sourcePath: resultData.duplicate.sourcePath,
          },
          pendingInstallRequest: {
            filePath,
            targetModId: resultData.duplicate.existingModId,
            ...request,
            duplicateAction: 'prompt',
          },
        })
      } else if (resultData.status === 'installed') {
        set((state) => {
          const nextNewFiles = removeNewFilePath(state.newFiles, filePath)
          if (nextNewFiles.length !== state.newFiles.length) {
            persistNewFiles(nextNewFiles)
          }
          return {
            pendingMod: resultData.mod ?? null,
            installPrompt: null,
            pendingInstallRequest: null,
            newFiles: nextNewFiles,
          }
        })
      } else {
        set({
          pendingMod: resultData.mod ?? null,
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
      set((state) => {
        const sourcePath = targetMod?.sourcePath
        if (!sourcePath) {
          return { pendingMod: result.data?.mod ?? null }
        }

        const nextNewFiles = removeNewFilePath(state.newFiles, sourcePath)
        if (nextNewFiles.length !== state.newFiles.length) {
          persistNewFiles(nextNewFiles)
        }

        return {
          pendingMod: result.data?.mod ?? null,
          newFiles: nextNewFiles,
        }
      })
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

  confirmVersionMismatch: async (action) => {
    const prompt = get().versionMismatchPrompt
    const state = get() as DownloadsSlice & {
      addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      scanMods?: () => Promise<unknown>
      enableMod?: (modId: string) => Promise<IpcResult>
      setRecentLibraryBadge?: (modId: string, badge: 'installed' | 'updated' | 'downgraded', duration?: number) => void
    }

    if (!prompt) return

    set({ versionMismatchPrompt: null })

    if (action === 'skip') return

    const result = await get().installMod(prompt.sourcePath, {
      duplicateAction: action,
      targetModId: action === 'replace' ? prompt.existingModId : undefined,
      nexusModId: prompt.nexusModId,
      sourceFileName: prompt.sourceFileName,
      sourceVersion: prompt.sourceVersion,
      skipVersionMismatchPrompt: true,
    })

    if (!result.ok || !result.data) {
      state.addToast?.(result.error ?? 'Install failed', 'error')
      return
    }

    if (result.data.status === 'installed' && result.data.mod) {
      await state.scanMods?.()
      const enableResult = await state.enableMod?.(result.data.mod.uuid)
      if (enableResult && !enableResult.ok) {
        state.addToast?.(`Installed but couldn't activate: ${enableResult.error}`, 'warning')
      } else {
        state.addToast?.(`${result.data.mod.name} installed & activated`, 'success')
      }
      const badge = action === 'replace'
        ? (getVersionRelation(prompt.existingVersion, prompt.incomingVersion) === 'downgrade' ? 'downgraded' : 'updated')
        : 'installed'
      state.setRecentLibraryBadge?.(result.data.mod.uuid, badge)
    } else if (result.data.status === 'conflict') {
      state.addToast?.('File conflicts detected during install', 'warning')
    }
  },

  clearVersionMismatchPrompt: () =>
    set({
      versionMismatchPrompt: null,
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
      versionMismatchPrompt: null,
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

    const previousStart = pendingDownloadStarts.get(key) ?? Promise.resolve()
    let currentStart: Promise<void>
    currentStart = previousStart
      .catch(() => undefined)
      .then(async () => {
        const requestedAt = new Date().toISOString()
        const result = await IpcService.invoke<IpcResult<NxmDownloadStartResponse>>(
          IPC.NXM_DOWNLOAD_START,
          {
            payload,
            allowDuplicate: options.allowDuplicate === true,
            requestedAt,
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
              startedAt: result.data?.startedAt ?? requestedAt,
              totalBytes: 0,
              downloadedBytes: 0,
              speedBps: 0,
              status: 'downloading' as const,
              savedPath: result.data?.savedPath,
              version: result.data?.version,
            },
          ],
        }))
      })
      .finally(() => {
        if (pendingDownloadStarts.get(key) === currentStart) {
          pendingDownloadStarts.delete(key)
        }
      })

    pendingDownloadStarts.set(key, currentStart)
    await currentStart
  },

  pauseDownload: async (id) => {
    set((state) => ({
      activeDownloads: state.activeDownloads.map((d) =>
        d.id === id ? { ...d, status: 'paused' as const, speedBps: 0, error: undefined } : d
      ),
    }))

    const result = await IpcService.invoke<IpcResult>(IPC.NXM_DOWNLOAD_PAUSE, id)
    if (result.ok) return

    set((state) => ({
      activeDownloads: state.activeDownloads.map((d) =>
        d.id === id ? { ...d, status: 'downloading' as const } : d
      ),
    }))
  },

  resumeDownload: async (id) => {
    set((state) => ({
      activeDownloads: state.activeDownloads.map((d) =>
        d.id === id ? { ...d, status: 'downloading' as const, error: undefined } : d
      ),
    }))

    const result = await IpcService.invoke<IpcResult>(IPC.NXM_DOWNLOAD_RESUME, id)
    if (result.ok) return

    set((state) => ({
      activeDownloads: state.activeDownloads.map((d) =>
        d.id === id ? { ...d, status: 'paused' as const, speedBps: 0 } : d
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
      const next = removeNewFilePath(state.newFiles, filePath)
      persistNewFiles(next)
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
          d.id === id
            ? {
                ...d,
                downloadedBytes,
                totalBytes,
                speedBps: d.status === 'paused' ? 0 : speedBps,
                status: d.status === 'paused' ? 'paused' as const : 'downloading' as const,
              }
            : d
        ),
      }))
    })

    const unsubComplete = IpcService.on(IPC.NXM_DOWNLOAD_COMPLETE, (...args) => {
      const { id, savedPath } = args[0] as { id: string; savedPath: string }
      // Remove the active row immediately and refresh local files so the file
      // appears with the NEW badge without a double-row overlap period.
      set((state) => {
        const next = [...new Set([...state.newFiles, savedPath])]
        persistNewFiles(next)
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
