import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type {
  ActiveDownload,
  AppSettings,
  ConflictInfo,
  DownloadEntry,
  DuplicateNxmDownloadInfo,
  FomodInstallRequest,
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
import { translate } from '../../i18n/translate'

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

function stripArchiveExtension(rawName: string): string {
  return rawName.replace(/\.(zip|7z|rar)$/i, '')
}

function normalizeSourceIdentity(rawName: string): string {
  const cleaned = stripArchiveExtension(rawName)
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
        return dashParts.slice(0, index).join(' - ').trim().toLowerCase()
      }
    }
  }

  return cleaned
    .replace(/[-_]?v?\d+(?:[._-]\d+)+(?:[._-]\d+)*$/i, '')
    .replace(/[-_ ]+$/g, '')
    .trim()
    .toLowerCase()
}

function getInstallPromptName(filePath: string, sourceFileName?: string): string {
  const rawName = sourceFileName?.trim()
    || filePath.replace(/\\/g, '/').split('/').pop()
    || filePath

  const cleaned = stripArchiveExtension(rawName)
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
        return dashParts.slice(0, index).join(' - ').trim() || cleaned
      }
    }
  }

  return cleaned
    .replace(/[-_]?v?\d+(?:[._-]\d+)+(?:[._-]\d+)*$/i, '')
    .replace(/[-_ ]+$/g, '')
    .trim() || rawName
}

function getInstalledSourceIdentity(mod: ModMetadata): string | undefined {
  const rawSourceName = mod.sourcePath
    ? mod.sourcePath.replace(/\\/g, '/').split('/').pop()
    : mod.name
  if (!rawSourceName?.trim()) return undefined
  return normalizeSourceIdentity(rawSourceName)
}

function getModOrder(mods: ModMetadata[] | undefined, modId?: string): number | undefined {
  if (!modId) return undefined
  const order = mods?.find((mod) => mod.uuid === modId)?.order
  return typeof order === 'number' && Number.isFinite(order) ? order : undefined
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

function upsertLocalDownloadEntry(entries: DownloadEntry[], entry: DownloadEntry): DownloadEntry[] {
  const normalizedPath = entry.path.trim().toLowerCase()
  const next = entries.filter((item) => item.path.trim().toLowerCase() !== normalizedPath)
  return [entry, ...next]
}

function getArchiveExtension(fileName: string): string {
  const match = /\.[^.\\/]+$/.exec(fileName)
  return match?.[0]?.toLowerCase() ?? ''
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
  incomingSourceIdentity?: string,
  incomingFileId?: number,
  incomingVersion?: string,
): ModMetadata | undefined {
  let candidates = mods.filter((mod) => mod.kind === 'mod' && mod.nexusModId === nexusModId)
  if (!candidates.length) return undefined

  if (incomingSourceIdentity) {
    candidates = candidates.filter((mod) => getInstalledSourceIdentity(mod) === incomingSourceIdentity)
    if (!candidates.length) return undefined
  }

  if (typeof incomingFileId === 'number') {
    const exactFileMatches = candidates.filter((mod) => mod.nexusFileId === incomingFileId)
    if (exactFileMatches.length > 0) {
      candidates = exactFileMatches
    }
  }

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

type DownloadsStoreBridge = DownloadsSlice & {
  settings?: AppSettings | null
  mods?: ModMetadata[]
  addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
  scanMods?: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean }) => Promise<unknown>
  enableMod?: (modId: string) => Promise<IpcResult>
  setRecentLibraryBadge?: (modId: string, badge: 'installed' | 'updated' | 'downgraded', duration?: number) => void
  checkModUpdates?: (options?: { force?: boolean; notify?: boolean; full?: boolean; modIds?: string[] }) => Promise<void>
  clearModUpdate?: (uuid: string) => void
}

async function installCompletedDownload(
  get: () => DownloadsSlice,
  filePath: string,
  payload: Pick<NxmLinkPayload, 'modId' | 'fileId'>,
  details: {
    fileName?: string
    version?: string
  },
): Promise<void> {
  const state = get() as DownloadsStoreBridge
  const result = await state.installMod(filePath, {
    nexusModId: payload.modId,
    nexusFileId: payload.fileId,
    sourceFileName: details.fileName,
    sourceVersion: details.version,
    preferDuplicatePrompt: true,
  })

  if (!result.ok) {
    state.addToast?.(result.error ?? translate('downloads.toast.autoInstallFailed'), 'error')
    return
  }

  if (result.data?.status === 'duplicate' || result.data?.status === 'version-mismatch' || result.data?.status === 'fomod') {
    return
  }

  if (result.data?.status === 'installed' && result.data.mod) {
    const mod = result.data.mod
    await state.scanMods?.({ refreshConflicts: false, refreshModUpdates: false })
    const enableResult = await state.enableMod?.(mod.uuid)
    await state.scanMods?.({ immediateConflicts: true, refreshModUpdates: false })
    if (enableResult && !enableResult.ok) {
      state.addToast?.(translate('downloads.toast.installedNotActivatedNamed', { name: mod.name, error: enableResult.error ?? '' }), 'warning', 3000)
    } else {
      state.addToast?.(translate('downloads.toast.installedActivated', { name: mod.name }), 'success', 2200)
    }
    state.setRecentLibraryBadge?.(mod.uuid, 'installed')
  }
}

async function installCompletedModUpdate(
  get: () => DownloadsSlice,
  filePath: string,
  payload: Pick<NxmLinkPayload, 'modId' | 'fileId'>,
  details: {
    fileName?: string
    version?: string
    intent: NonNullable<ActiveDownload['intent']>
  },
): Promise<void> {
  const state = get() as DownloadsStoreBridge
  const intent = details.intent
  const preserveOrder = getModOrder(state.mods, intent.targetModId)
  const result = await state.installMod(filePath, {
    duplicateAction: 'replace',
    targetModId: intent.targetModId,
    preserveOrder,
    nexusModId: payload.modId,
    nexusFileId: payload.fileId,
    sourceFileName: details.fileName,
    sourceVersion: details.version ?? intent.latestVersion,
    skipVersionMismatchPrompt: true,
  })

  if (!result.ok || !result.data) {
    state.addToast?.(result.error ?? translate('downloads.toast.updateFailed', { name: intent.targetModName ?? '' }), 'error')
    return
  }

  if (result.data.status === 'installed' && result.data.mod) {
    await state.scanMods?.({ refreshConflicts: false, refreshModUpdates: false })
    const enableResult = await state.enableMod?.(result.data.mod.uuid)
    await state.scanMods?.({ immediateConflicts: true, refreshModUpdates: false })
    if (enableResult && !enableResult.ok) {
      state.addToast?.(translate('downloads.toast.updatedNotActivated', { error: enableResult.error ?? '' }), 'warning')
    } else {
      state.addToast?.(translate('downloads.toast.updatedActivated', { name: result.data.mod.name }), 'success')
    }
    state.setRecentLibraryBadge?.(result.data.mod.uuid, 'updated')
    // We just installed this mod's latest file - clear its update flag locally,
    // no Nexus request needed.
    state.clearModUpdate?.(result.data.mod.uuid)
  }
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
  options?: StartNxmDownloadOptions
}

export interface VersionMismatchPromptInfo {
  nexusModId: number
  existingModId: string
  existingModName: string
  existingOrder?: number
  existingSourceFileName?: string
  matchedSourceIdentity?: string
  existingVersion?: string
  incomingVersion?: string
  sourcePath: string
  sourceFileName?: string
  sourceVersion?: string
}

export interface OverwriteConflictPromptInfo {
  mod: ModMetadata
  conflicts: ConflictInfo[]
  request: InstallModRequest
  fomodRequest?: FomodInstallRequest
}

export interface FomodPromptInfo {
  xml: string
  tempDir: string
  extractRoot: string
  originalFilePath: string
  request: Partial<InstallModRequest>
  needsExtraction?: boolean
}

export interface StartNxmDownloadOptions {
  allowDuplicate?: boolean
  navigateToDownloads?: boolean
  intent?: ActiveDownload['intent']
}

export interface DownloadsSlice {
  detecting: boolean
  installing: boolean
  installProgress: number
  installStatus: string
  installCurrentFile: string
  installSourcePath: string
  installTargetModId: string
  installPlacement: 'replace' | 'append' | 'insert-after'
  pendingMod: ModMetadata | null
  installPrompt: InstallPromptInfo | null
  pendingInstallRequest: InstallModRequest | null
  duplicateDownloadPrompt: DuplicateDownloadPromptInfo | null
  versionMismatchPrompt: VersionMismatchPromptInfo | null
  overwriteConflictPrompt: OverwriteConflictPromptInfo | null
  fomodPrompt: FomodPromptInfo | null
  activeDownloads: ActiveDownload[]
  localFiles: DownloadEntry[]
  newFiles: string[]
  pendingNxmUpdateIntents: Record<string, NonNullable<ActiveDownload['intent']>>
  downloadsLoadedPath: string

  installMod: (
    filePath: string,
    request?: Partial<InstallModRequest>
  ) => Promise<IpcResult<InstallModResponse>>
  reinstallMod: (modId: string) => Promise<IpcResult<InstallModResponse>>
  openReinstallPrompt: (mod: ModMetadata) => Promise<void>
  clearInstallPrompt: () => void
  confirmDuplicateDownload: () => Promise<void>
  clearDuplicateDownloadPrompt: () => void
  confirmVersionMismatch: (action: 'replace' | 'copy' | 'skip') => Promise<void>
  clearVersionMismatchPrompt: () => void
  confirmOverwriteConflicts: (proceed: boolean) => Promise<void>
  clearOverwriteConflictPrompt: () => void
  fomodInstall: (fomodRequest: FomodInstallRequest) => Promise<IpcResult<InstallModResponse>>
  dismissFomodPrompt: () => void
  clearFomodPrompt: () => void
  clearInstall: () => void
  refreshLocalFiles: () => Promise<void>
  startNxmDownload: (payload: NxmLinkPayload, options?: StartNxmDownloadOptions) => Promise<void>
  queueNxmUpdateIntent: (
    modId: number,
    fileId: number,
    intent: NonNullable<ActiveDownload['intent']>
  ) => void
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
  detecting: false,
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
  overwriteConflictPrompt: null,
  fomodPrompt: null,
  newFiles: (() => {
    try { return JSON.parse(localStorage.getItem('hyperion:newFiles') ?? '[]') as string[] }
    catch { return [] }
  })(),
  downloadsLoadedPath: '',
  pendingNxmUpdateIntents: {},
  activeDownloads: [],
  localFiles: [],

  installMod: async (filePath, request = {}) => {
    const state = get() as DownloadsSlice & {
      mods?: ModMetadata[]
    }
    const nexusModId = request.nexusModId
    const incomingSourceIdentity = request.sourceFileName
      ? normalizeSourceIdentity(request.sourceFileName)
      : undefined
    const incomingVersion = normalizeVersion(request.sourceVersion)
      ?? (typeof nexusModId === 'number' ? undefined : extractVersionFromFileName(request.sourceFileName ?? filePath))
    const existingMod = typeof nexusModId === 'number'
      ? selectPreferredNexusMod(state.mods ?? [], nexusModId, incomingSourceIdentity, request.nexusFileId, incomingVersion)
      : undefined
    const existingVersion = normalizeVersion(existingMod?.version)

    if (!request.skipVersionMismatchPrompt && nexusModId && existingMod && !request.duplicateAction && shouldPromptForVersionDecision(existingVersion, incomingVersion)) {
      set({
        versionMismatchPrompt: {
          nexusModId,
          existingModId: existingMod.uuid,
          existingModName: existingMod.name,
          existingOrder: existingMod.order,
          existingSourceFileName: existingMod.sourcePath
            ? existingMod.sourcePath.replace(/\\/g, '/').split('/').pop()
            : undefined,
          matchedSourceIdentity: incomingSourceIdentity,
          existingVersion,
          incomingVersion,
          sourcePath: filePath,
          sourceFileName: request.sourceFileName,
          sourceVersion: request.sourceVersion,
        },
      })
      return { ok: true, data: { status: 'version-mismatch' } }
    }

    if (request.preferDuplicatePrompt && nexusModId && existingMod && !request.duplicateAction) {
      const nextNewFiles = removeNewFilePath(get().newFiles, filePath)
      if (nextNewFiles.length !== get().newFiles.length) {
        persistNewFiles(nextNewFiles)
      }

      set({
        installPrompt: {
          mode: 'duplicate',
          existingModId: existingMod.uuid,
          existingModName: existingMod.name,
          incomingModName: getInstallPromptName(filePath, request.sourceFileName),
          sourcePath: filePath,
        },
        pendingInstallRequest: {
          filePath,
          ...request,
          targetModId: existingMod.uuid,
          preserveOrder: existingMod.order,
          duplicateAction: 'prompt',
          preferDuplicatePrompt: false,
        },
        overwriteConflictPrompt: null,
        newFiles: nextNewFiles,
      })

      return { ok: true, data: { status: 'duplicate' } }
    }

    if (!request.skipVersionMismatchPrompt && nexusModId && existingMod && !request.duplicateAction && !request.preferDuplicatePrompt) {
      request = {
        ...request,
        duplicateAction: 'replace',
        targetModId: existingMod.uuid,
        preserveOrder: existingMod.order,
      }
    }

    set({
      detecting: true,
      installProgress: 0,
      installStatus: translate('downloads.installStatus.preparingInstaller'),
      installCurrentFile: '',
      installSourcePath: filePath,
      installTargetModId: request.targetModId ?? '',
      installPlacement: request.duplicateAction === 'replace' ? 'replace' : (request.duplicateAction === 'copy' && request.targetModId) ? 'insert-after' : 'append',
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
      detecting: false,
      installCurrentFile: '',
      installSourcePath: '',
      installTargetModId: '',
      installPlacement: 'append',
    })

    if (result.ok && result.data) {
      const resultData = result.data

      if (resultData.status === 'fomod' && resultData.fomod) {
        set({
          fomodPrompt: {
            xml: resultData.fomod.xml,
            tempDir: resultData.fomod.tempDir,
            extractRoot: resultData.fomod.extractRoot,
            originalFilePath: filePath,
            request,
            needsExtraction: resultData.fomod.needsExtraction,
          },
        })
      } else if (resultData.status === 'duplicate' && resultData.duplicate) {
        const nextNewFiles = request.preferDuplicatePrompt
          ? removeNewFilePath(get().newFiles, filePath)
          : get().newFiles
        if (nextNewFiles.length !== get().newFiles.length) {
          persistNewFiles(nextNewFiles)
        }
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
            preserveOrder: request.preserveOrder ?? getModOrder(state.mods, resultData.duplicate.existingModId),
            preferDuplicatePrompt: false,
          },
          overwriteConflictPrompt: null,
          newFiles: nextNewFiles,
        })
      } else if (resultData.status === 'conflict' && resultData.mod && resultData.conflicts?.length) {
        return await get().installMod(filePath, {
          ...request,
          allowOverwriteConflicts: true,
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
            overwriteConflictPrompt: null,
            newFiles: nextNewFiles,
          }
        })
      } else {
        set({
          pendingMod: resultData.mod ?? null,
          installPrompt: null,
          pendingInstallRequest: null,
          overwriteConflictPrompt: null,
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
      installStatus: translate('downloads.installStatus.reinstalling'),
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

    if (result.ok && result.data?.status === 'installed' && result.data.mod) {
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
      if (targetMod?.enabled) {
        const enableResult = await (get() as DownloadsSlice & {
          enableMod?: (modId: string) => Promise<IpcResult>
          addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
        }).enableMod?.(result.data.mod.uuid)
        if (enableResult && !enableResult.ok) {
          ;(get() as DownloadsSlice & {
            addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
          }).addToast?.(translate('downloads.toast.reinstalledNotActivated', { error: enableResult.error ?? '' }), 'warning')
        }
      }
      await (get() as DownloadsSlice & {
        scanMods?: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean }) => Promise<unknown>
      }).scanMods?.({ immediateConflicts: true, refreshModUpdates: false })
    }

    return result
  },

  openReinstallPrompt: async (mod) => {
    const addToast = (get() as DownloadsSlice & {
      addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
    }).addToast

    if (!mod.sourcePath) {
      addToast?.(translate('downloads.toast.noOriginalSource'), 'warning')
      return
    }

    // Validate the source archive (resolved against the current Downloads
    // folder) before opening the dialog, so the user doesn't click Replace
    // only to hit an error afterwards.
    const check = await IpcService.invoke<IpcResult>(IPC.REINSTALL_SOURCE_CHECK, mod.sourcePath)
    if (!check.ok) {
      addToast?.(check.error ?? translate('downloads.toast.originalSourceUnavailable'), 'error')
      return
    }

    set({
      installPrompt: {
        mode: 'reinstall',
        existingModId: mod.uuid,
        existingModName: mod.name,
        incomingModName: mod.name,
        sourcePath: mod.sourcePath,
      },
      pendingInstallRequest: {
        filePath: mod.sourcePath,
        targetModId: mod.uuid,
        preserveOrder: mod.order,
        duplicateAction: 'prompt',
        reinstall: true,
      },
    })
  },

  clearInstallPrompt: () =>
    set({
      installPrompt: null,
      pendingInstallRequest: null,
    }),

  confirmDuplicateDownload: async () => {
    const prompt = get().duplicateDownloadPrompt
    if (!prompt) return

    set({ duplicateDownloadPrompt: null })
    await get().startNxmDownload(prompt.payload, { ...prompt.options, allowDuplicate: true })
  },

  clearDuplicateDownloadPrompt: () =>
    set({
      duplicateDownloadPrompt: null,
    }),

  confirmVersionMismatch: async (action) => {
    const prompt = get().versionMismatchPrompt
    const state = get() as DownloadsSlice & {
      addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      scanMods?: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean }) => Promise<unknown>
      enableMod?: (modId: string) => Promise<IpcResult>
      setRecentLibraryBadge?: (modId: string, badge: 'installed' | 'updated' | 'downgraded', duration?: number) => void
      mods?: ModMetadata[]
    }

    if (!prompt) return

    set({ versionMismatchPrompt: null })

    if (action === 'skip') return

    const result = await get().installMod(prompt.sourcePath, {
      duplicateAction: action,
      targetModId: action === 'replace' ? prompt.existingModId : undefined,
      preserveOrder: action === 'replace' ? (prompt.existingOrder ?? getModOrder(state.mods, prompt.existingModId)) : undefined,
      nexusModId: prompt.nexusModId,
      sourceFileName: prompt.sourceFileName,
      sourceVersion: prompt.sourceVersion,
      skipVersionMismatchPrompt: true,
    })

    if (!result.ok || !result.data) {
      state.addToast?.(result.error ?? translate('downloads.toast.installFailed'), 'error')
      return
    }

    if (result.data.status === 'installed' && result.data.mod) {
      await state.scanMods?.({ refreshConflicts: false, refreshModUpdates: false })
      const enableResult = await state.enableMod?.(result.data.mod.uuid)
      await state.scanMods?.({ immediateConflicts: true, refreshModUpdates: false })
      if (enableResult && !enableResult.ok) {
        state.addToast?.(translate('downloads.toast.installedNotActivated', { error: enableResult.error ?? '' }), 'warning')
      } else {
        state.addToast?.(translate('downloads.toast.installedActivated', { name: result.data.mod.name }), 'success')
      }
      const badge = action === 'replace'
        ? (getVersionRelation(prompt.existingVersion, prompt.incomingVersion) === 'downgrade' ? 'downgraded' : 'updated')
        : 'installed'
      state.setRecentLibraryBadge?.(result.data.mod.uuid, badge)
    } else if (result.data.status === 'conflict') {
      return
    }
  },

  clearVersionMismatchPrompt: () =>
    set({
      versionMismatchPrompt: null,
    }),

  confirmOverwriteConflicts: async (proceed) => {
    const prompt = get().overwriteConflictPrompt
    const state = get() as DownloadsSlice & {
      addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      scanMods?: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean }) => Promise<unknown>
      enableMod?: (modId: string) => Promise<IpcResult>
      setRecentLibraryBadge?: (modId: string, badge: 'installed' | 'updated' | 'downgraded', duration?: number) => void
    }

    if (!prompt) return

    set({ overwriteConflictPrompt: null })

    if (!proceed) {
      if (prompt.fomodRequest) {
        IpcService.invoke(IPC.FOMOD_CANCEL, prompt.fomodRequest.tempDir).catch(() => {})
      }
      return
    }

    // FOMOD conflict retry - re-use the already-extracted tempDir
    if (prompt.fomodRequest) {
      await get().fomodInstall({ ...prompt.fomodRequest, allowOverwriteConflicts: true })
      return
    }

    const { filePath, ...request } = prompt.request
    const result = await get().installMod(filePath, {
      ...request,
      allowOverwriteConflicts: true,
    })

    if (!result.ok || !result.data) {
      state.addToast?.(result.error ?? translate('downloads.toast.installFailed'), 'error')
      return
    }

    if (result.data.status === 'installed' && result.data.mod) {
      await state.scanMods?.({ refreshConflicts: false, refreshModUpdates: false })
      const enableResult = await state.enableMod?.(result.data.mod.uuid)
      await state.scanMods?.({ immediateConflicts: true, refreshModUpdates: false })
      if (enableResult && !enableResult.ok) {
        state.addToast?.(translate('downloads.toast.installedNotActivated', { error: enableResult.error ?? '' }), 'warning')
      } else {
        state.addToast?.(translate('downloads.toast.installedActivated', { name: result.data.mod.name }), 'success')
      }
      state.setRecentLibraryBadge?.(result.data.mod.uuid, 'installed')
    }
  },

  clearOverwriteConflictPrompt: () =>
    set({
      overwriteConflictPrompt: null,
    }),

  fomodInstall: async (fomodRequest) => {
    const state = get() as DownloadsSlice & {
      addToast?: (message: string, severity?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void
      scanMods?: (options?: { refreshConflicts?: boolean; immediateConflicts?: boolean; refreshModUpdates?: boolean }) => Promise<unknown>
      enableMod?: (modId: string) => Promise<IpcResult>
      setRecentLibraryBadge?: (modId: string, badge: 'installed' | 'updated' | 'downgraded', duration?: number) => void
    }

    set({
      installing: true,
      installProgress: 0,
      installStatus: translate('downloads.installStatus.installingFomod'),
      installCurrentFile: '',
      installSourcePath: fomodRequest.originalFilePath,
      installTargetModId: fomodRequest.targetModId ?? '',
      installPlacement: fomodRequest.duplicateAction === 'replace' ? 'replace'
        : fomodRequest.duplicateAction === 'copy' && fomodRequest.targetModId ? 'insert-after'
        : 'append',
    })

    const unsubscribe = IpcService.on(IPC.INSTALL_PROGRESS, (...args) => {
      const progress = args[0] as InstallProgress
      set({ installProgress: progress.percent, installStatus: progress.step, installCurrentFile: progress.currentFile ?? '' })
    })

    const result = await IpcService.invoke<IpcResult<InstallModResponse>>(IPC.FOMOD_INSTALL, fomodRequest)

    unsubscribe()
    set({
      installing: false,
      installCurrentFile: '',
      installSourcePath: '',
      installTargetModId: '',
      installPlacement: 'append',
    })

    if (result.ok && result.data) {
      const data = result.data

      if (data.status === 'duplicate' && data.duplicate) {
        set({
          installPrompt: {
            mode: 'duplicate',
            existingModId: data.duplicate.existingModId,
            existingModName: data.duplicate.existingModName,
            incomingModName: data.duplicate.incomingModName,
            sourcePath: data.duplicate.sourcePath,
          },
          pendingInstallRequest: {
            filePath: fomodRequest.originalFilePath,
            targetModId: data.duplicate.existingModId,
            preserveOrder: fomodRequest.preserveOrder ?? getModOrder((get() as DownloadsSlice & { mods?: ModMetadata[] }).mods, data.duplicate.existingModId),
            duplicateAction: 'prompt',
          },
        })
      } else if (data.status === 'conflict' && data.mod && data.conflicts?.length) {
        set({
          overwriteConflictPrompt: {
            mod: data.mod,
            conflicts: data.conflicts,
            request: { filePath: fomodRequest.originalFilePath },
            fomodRequest: { ...fomodRequest, allowOverwriteConflicts: false },
          },
        })
      } else if (data.status === 'installed' && data.mod) {
        const badge = fomodRequest.duplicateAction === 'replace' ? 'updated' : 'installed'
        const filePath = fomodRequest.originalFilePath
        set((s) => {
          const nextNewFiles = removeNewFilePath(s.newFiles, filePath)
          if (nextNewFiles.length !== s.newFiles.length) persistNewFiles(nextNewFiles)
          return {
            pendingMod: data.mod ?? null,
            installPrompt: null,
            pendingInstallRequest: null,
            overwriteConflictPrompt: null,
            fomodPrompt: null,
            newFiles: nextNewFiles,
          }
        })
        await state.scanMods?.({ refreshConflicts: false, refreshModUpdates: false })
        const enableResult = await state.enableMod?.(data.mod.uuid)
        await state.scanMods?.({ immediateConflicts: true, refreshModUpdates: false })
        if (enableResult && !enableResult.ok) {
          state.addToast?.(translate('downloads.toast.installedNotActivated', { error: enableResult.error ?? '' }), 'warning')
        } else {
          state.addToast?.(
            badge === 'updated'
              ? translate('downloads.toast.updatedActivated', { name: data.mod.name })
              : translate('downloads.toast.installedActivated', { name: data.mod.name }),
            'success'
          )
        }
        state.setRecentLibraryBadge?.(data.mod.uuid, badge)
      } else if (!result.ok) {
        state.addToast?.(result.error ?? translate('downloads.toast.fomodInstallFailed'), 'error')
      }
    }

    return result
  },

  dismissFomodPrompt: () => set({ fomodPrompt: null }),

  clearFomodPrompt: () => {
    const prompt = get().fomodPrompt
    set({ fomodPrompt: null })
    if (prompt?.tempDir) {
      IpcService.invoke(IPC.FOMOD_CANCEL, prompt.tempDir).catch(() => {})
    }
  },

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
      overwriteConflictPrompt: null,
      fomodPrompt: null,
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
    const uiState = get() as DownloadsSlice & {
      setActiveView?: (view: 'library' | 'downloads' | 'settings') => void
    }

    if (options.navigateToDownloads !== false) {
      uiState.setActiveView?.('downloads')
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
          notify(result.error ?? translate('downloads.toast.nexusDownloadStartFailed'), 'warning')
          return
        }

        if (result.data.status === 'duplicate' && result.data.duplicate) {
          if (
            options.intent?.kind === 'mod-update' &&
            !result.data.duplicate.existingIsDownloading &&
            result.data.duplicate.existingFilePath
          ) {
            await installCompletedModUpdate(
              get,
              result.data.duplicate.existingFilePath,
              payload,
              {
                fileName: result.data.duplicate.existingFileName,
                version: options.intent.latestVersion,
                intent: options.intent,
              }
            )
            return
          }

          set({
            duplicateDownloadPrompt: {
              ...result.data.duplicate,
              payload,
              options,
            },
          })
          return
        }

        if (result.data.status !== 'started' || !result.data.id || !result.data.fileName) {
          notify(translate('downloads.toast.nexusDownloadStartFailed'), 'warning')
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
              intent: options.intent,
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

  queueNxmUpdateIntent: (modId, fileId, intent) => {
    const key = `${modId}:${fileId}`
    set((state) => ({
      pendingNxmUpdateIntents: {
        ...state.pendingNxmUpdateIntents,
        [key]: intent,
      },
    }))
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
    const activeDownload = get().activeDownloads.find((download) => download.id === id)
    const savedPath = activeDownload?.savedPath

    await IpcService.invoke(IPC.NXM_DOWNLOAD_CANCEL, id)

    set((state) => {
      const nextNewFiles = savedPath ? removeNewFilePath(state.newFiles, savedPath) : state.newFiles
      if (nextNewFiles !== state.newFiles) {
        persistNewFiles(nextNewFiles)
      }

      return {
        activeDownloads: state.activeDownloads.filter((d) => d.id !== id),
        newFiles: nextNewFiles,
      }
    })

    await get().refreshLocalFiles().catch(() => undefined)
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
        state.addToast?.(translate('downloads.toast.nexusLinkReadFailed'), 'warning', 3200)
        return
      }
      const key = `${payload.modId}:${payload.fileId}`
      const intent = get().pendingNxmUpdateIntents[key]
      if (intent) {
        set((state) => {
          const next = { ...state.pendingNxmUpdateIntents }
          delete next[key]
          return { pendingNxmUpdateIntents: next }
        })
      }
      get().startNxmDownload(payload, intent ? { navigateToDownloads: false, intent } : undefined).catch(() => undefined)
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
      const { id, savedPath, fileName, version } = args[0] as {
        id: string
        savedPath: string
        fileName?: string
        version?: string
      }
      const completedDownload = get().activeDownloads.find((download) => download.id === id)
      // Swap the active row into a local row immediately so completion does not
      // kick the whole Downloads view through a folder refresh.
      set((state) => {
        const isInlineUpdate = completedDownload?.intent?.kind === 'mod-update'
        const next = isInlineUpdate ? state.newFiles : [...new Set([...state.newFiles, savedPath])]
        const entryName = fileName ?? completedDownload?.fileName ?? savedPath.replace(/\\/g, '/').split('/').pop() ?? savedPath
        const completedEntry: DownloadEntry | null = !isInlineUpdate && completedDownload
          ? {
              path: savedPath,
              name: entryName,
              size: Math.max(completedDownload.totalBytes, completedDownload.downloadedBytes),
              modifiedAt: new Date().toISOString(),
              downloadedAt: new Date().toISOString(),
              extension: getArchiveExtension(entryName),
              nxmModId: completedDownload.nxmModId,
              nxmFileId: completedDownload.nxmFileId,
              version: version ?? completedDownload.version,
            }
          : null
        if (!isInlineUpdate) {
          persistNewFiles(next)
        }
        return {
          activeDownloads: state.activeDownloads.filter((d) => d.id !== id),
          localFiles: completedEntry ? upsertLocalDownloadEntry(state.localFiles, completedEntry) : state.localFiles,
          newFiles: next,
        }
      })
      if (completedDownload?.intent?.kind === 'mod-update') {
        void installCompletedModUpdate(get, savedPath, {
          modId: completedDownload.nxmModId,
          fileId: completedDownload.nxmFileId,
        }, {
          fileName: fileName ?? completedDownload.fileName,
          version: version ?? completedDownload.version ?? completedDownload.intent.latestVersion,
          intent: completedDownload.intent,
        })
      } else if (completedDownload && (get() as DownloadsStoreBridge).settings?.autoInstallDownloads !== false) {
        // Auto-install must never run while the game is open (installing rewrites
        // the mod library usvfs deploys from). The download is already saved into
        // Downloads above, so defer with a clear notice and let the user install
        // it manually after closing the game. Fresh IPC check - the polled
        // `gameRunning` flag can lag the moment a download finishes.
        void (async () => {
          const running = await IpcService.invoke<boolean>(IPC.GAME_RUNNING).catch(() => false)
          if (running) {
            const bridge = get() as DownloadsStoreBridge
            bridge.addToast?.(
              translate('downloads.toast.gameRunningAutoInstallDeferred', {
                name: fileName ?? completedDownload.fileName,
              }),
              'warning',
              4200,
            )
            return
          }
          await installCompletedDownload(get, savedPath, {
            modId: completedDownload.nxmModId,
            fileId: completedDownload.nxmFileId,
          }, {
            fileName: fileName ?? completedDownload.fileName,
            version: version ?? completedDownload.version,
          })
        })()
      }
    })

    const unsubError = IpcService.on(IPC.NXM_DOWNLOAD_ERROR, (...args) => {
      const { id, error } = args[0] as { id: string; error: string }
      set((state) => ({
        activeDownloads: state.activeDownloads.map((d) =>
          d.id === id ? { ...d, status: 'error' as const, error } : d
        ),
      }))
    })

    // The main process watches the Downloads folder and pings us when its
    // contents change (e.g. a manually-downloaded archive dropped in), so the
    // list stays current without the user pressing refresh.
    let folderChangeTimer: ReturnType<typeof setTimeout> | null = null
    const unsubFolderChange = IpcService.on(IPC.DOWNLOADS_CHANGED, () => {
      if (folderChangeTimer) clearTimeout(folderChangeTimer)
      folderChangeTimer = setTimeout(() => {
        folderChangeTimer = null
        void get().refreshLocalFiles()
      }, 250)
    })

    return () => {
      unsubLink()
      unsubProgress()
      unsubComplete()
      unsubError()
      if (folderChangeTimer) clearTimeout(folderChangeTimer)
      unsubFolderChange()
    }
  },
})
