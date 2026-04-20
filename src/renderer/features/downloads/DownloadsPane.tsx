import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import type { DownloadEntry, IpcResult, ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { Tooltip } from '../ui/Tooltip'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { useVirtualRows } from '../../hooks/useVirtualRows'

const DOWNLOADS_GRID_TEMPLATE = 'minmax(420px,1fr) 260px 132px'
const DOWNLOAD_ROW_HEIGHT = 56
const DOWNLOAD_VIRTUALIZATION_THRESHOLD = 120

const formatSpeed = (bps: number): string => {
  if (bps <= 0) return '—'
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

const formatSize = (bytes: number): string => {
  if (bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const formatETA = (downloaded: number, total: number, speed: number): string => {
  if (speed <= 0 || total <= 0 || downloaded >= total) return '—'
  const seconds = Math.round((total - downloaded) / speed)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const s = seconds % 60
  if (minutes < 60) return `${minutes}m ${String(s).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${hours}h ${String(m).padStart(2, '0')}m`
}

const copySuffixPattern = /\sCopy(?:\s\d+)?$/i
const isCopyVariant = (name: string): boolean => copySuffixPattern.test(name.trim())
const getInstalledTimestamp = (installedAt?: string): number => {
  if (!installedAt) return Number.POSITIVE_INFINITY
  const ts = Date.parse(installedAt)
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts
}
const shouldPreferReinstallTarget = (candidate: ModMetadata, current: ModMetadata): boolean => {
  const candidateIsCopy = isCopyVariant(candidate.name)
  const currentIsCopy = isCopyVariant(current.name)
  if (candidateIsCopy !== currentIsCopy) return !candidateIsCopy
  return getInstalledTimestamp(candidate.installedAt) < getInstalledTimestamp(current.installedAt)
}

export const DownloadsPane: React.FC = () => {
  const {
    settings,
    installMod,
    enableMod,
    scanMods,
    addToast,
    setActiveView,
    mods,
    openReinstallPrompt,
    gamePathValid,
    libraryPathValid,
    activeDownloads,
    localFiles,
    installing,
    installSourcePath,
    installProgress,
    installStatus,
    installCurrentFile,
    refreshLocalFiles,
    downloadsLoadedPath,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    newFiles,
    markFileAsOld,
  } = useAppStore((state) => ({
    settings: state.settings,
    installMod: state.installMod,
    enableMod: state.enableMod,
    scanMods: state.scanMods,
    addToast: state.addToast,
    setActiveView: state.setActiveView,
    mods: state.mods,
    openReinstallPrompt: state.openReinstallPrompt,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
    activeDownloads: state.activeDownloads,
    localFiles: state.localFiles,
    installing: state.installing,
    installSourcePath: state.installSourcePath,
    installProgress: state.installProgress,
    installStatus: state.installStatus,
    installCurrentFile: state.installCurrentFile,
    refreshLocalFiles: state.refreshLocalFiles,
    downloadsLoadedPath: state.downloadsLoadedPath,
    pauseDownload: state.pauseDownload,
    resumeDownload: state.resumeDownload,
    cancelDownload: state.cancelDownload,
    newFiles: state.newFiles,
    markFileAsOld: state.markFileAsOld,
  }), shallow)

  const hasRequiredPaths = Boolean(
    settings?.gamePath?.trim() && settings?.libraryPath?.trim() && gamePathValid && libraryPathValid
  )

  const [loading, setLoading] = useState(true)
  const [pendingDeleteDownload, setPendingDeleteDownload] = useState<DownloadEntry | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const downloadsScrollRef = useRef<HTMLDivElement>(null)

  const doRefresh = async () => {
    setLoading(true)
    await refreshLocalFiles().catch(() => undefined)
    setLoading(false)
  }

  useEffect(() => {
    const downloadPath = settings?.downloadPath ?? ''
    if (!downloadPath) {
      setLoading(false)
      return
    }

    if (downloadsLoadedPath === downloadPath) {
      setLoading(false)
      return
    }

    doRefresh().catch(() => setLoading(false))
  }, [downloadsLoadedPath, settings?.downloadPath])

  const installedBySourcePath = useMemo(() => {
    const map = new Map<string, ModMetadata>()
    for (const mod of mods) {
      if (mod.kind !== 'mod' || !mod.sourcePath) continue
      const key = mod.sourcePath.toLowerCase()
      const existing = map.get(key)
      if (!existing || shouldPreferReinstallTarget(mod, existing)) {
        map.set(key, mod)
      }
    }
    return map
  }, [mods])

  const newFilesSet = useMemo(() => new Set(newFiles.map((p) => p.toLowerCase())), [newFiles])

  const handleInstall = async (entry: DownloadEntry) => {
    if (!hasRequiredPaths) {
      addToast('Set Game Path and Mod Library before installing mods', 'warning')
      setActiveView('settings')
      return
    }

    const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
    if (installedMod) {
      openReinstallPrompt(installedMod)
      markFileAsOld(entry.path)
      return
    }

    const installResult = await installMod(entry.path)
    if (!installResult.ok || !installResult.data) {
      addToast(installResult.error ?? 'Install failed', 'error')
      return
    }

    if (installResult.data.status === 'installed' && installResult.data.mod) {
      markFileAsOld(entry.path)
      await scanMods()
      const enableResult = await enableMod(installResult.data.mod.uuid)
      if (!enableResult.ok) {
        addToast(`Installed but couldn't activate: ${enableResult.error}`, 'warning')
        return
      }
      addToast(`${installResult.data.mod.name} installed & activated`, 'success')
      return
    }

    if (installResult.data.status === 'conflict') {
      addToast('File conflicts detected during install', 'warning')
    }
  }

  const openDownloadsFolder = () => {
    if (settings?.downloadPath) {
      IpcService.invoke(IPC.OPEN_PATH, settings.downloadPath)
    }
  }

  const handleDeleteDownload = async () => {
    if (!pendingDeleteDownload) return
    const result = await IpcService.invoke<IpcResult>(IPC.DELETE_DOWNLOAD, pendingDeleteDownload.path)
    if (!result.ok) {
      addToast(result.error ?? 'Could not delete download', 'error')
      return
    }
    markFileAsOld(pendingDeleteDownload.path)
    setPendingDeleteDownload(null)
    addToast(`${pendingDeleteDownload.name} deleted`, 'success')
    await doRefresh()
  }

  const handleDeleteAllDownloads = async () => {
    setDeletingAll(true)
    const result = await IpcService.invoke<IpcResult<{ removed: number; failed: number }>>(
      IPC.DELETE_ALL_DOWNLOADS,
    )
    setDeletingAll(false)
    setDeleteAllOpen(false)
    if (!result.ok) {
      addToast(result.error ?? 'Could not delete downloads', 'error')
      return
    }
    for (const entry of localFiles) markFileAsOld(entry.path)
    const removed = result.data?.removed ?? 0
    const failed = result.data?.failed ?? 0
    if (removed > 0) {
      addToast(`${removed} download${removed === 1 ? '' : 's'} deleted`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} download${failed === 1 ? '' : 's'} could not be deleted`, 'warning')
    }
    await doRefresh()
  }

  const totalRows = activeDownloads.length + localFiles.length
  const virtualizedDownloads = useVirtualRows({
    containerRef: downloadsScrollRef,
    count: totalRows,
    rowHeight: DOWNLOAD_ROW_HEIGHT,
    overscan: 12,
    enabled: totalRows > DOWNLOAD_VIRTUALIZATION_THRESHOLD,
  })
  const visibleActiveDownloads = useMemo(
    () => activeDownloads.slice(
      Math.min(activeDownloads.length, virtualizedDownloads.startIndex),
      Math.min(activeDownloads.length, virtualizedDownloads.endIndex),
    ),
    [activeDownloads, virtualizedDownloads.endIndex, virtualizedDownloads.startIndex]
  )
  const visibleLocalStart = Math.max(0, virtualizedDownloads.startIndex - activeDownloads.length)
  const visibleLocalEnd = Math.max(0, virtualizedDownloads.endIndex - activeDownloads.length)
  const visibleLocalFiles = useMemo(
    () => localFiles.slice(visibleLocalStart, visibleLocalEnd),
    [localFiles, visibleLocalEnd, visibleLocalStart]
  )

  return (
    <div className="h-full animate-settings-in">
      <div className="flex flex-col h-full overflow-hidden">

        {/* Fixed header */}
        <div className="shrink-0 px-8 pt-6 pb-3 w-full">
          <h1 className="brand-font text-xl text-white font-bold tracking-widest uppercase">
            Downloads
          </h1>
          <p className="ui-support-mono mt-1 flex items-center gap-2">
            LOCAL: {localFiles.length}
            {activeDownloads.length > 0 && <>&nbsp;|&nbsp; ACTIVE: {activeDownloads.length}</>}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void doRefresh()}
              className="flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-[0.5px] border-[#252525] bg-[#0a0a0a] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#cccccc] transition-colors hover:border-[#fcee09]/30 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              Refresh
            </button>
            <button
              onClick={openDownloadsFolder}
              className="flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-[0.5px] border-[#252525] bg-[#0a0a0a] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#cccccc] transition-colors hover:border-[#fcee09]/30 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">folder_open</span>
              Open Folder
            </button>
            <Tooltip content="Delete every file in the downloads folder">
              <button
                onClick={() => setDeleteAllOpen(true)}
                disabled={localFiles.length === 0}
                className="flex h-10 w-10 items-center justify-center rounded-sm border-[0.5px] border-[#3a1010] bg-[#0d0404] text-[#f18d8d] transition-colors hover:border-[#f87171] hover:bg-[#1a0505] hover:text-[#ffe1e1] disabled:opacity-40 disabled:hover:border-[#3a1010] disabled:hover:bg-[#0d0404] disabled:hover:text-[#f18d8d] disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Unified table */}
        <div className="flex-1 overflow-hidden px-8 pb-6 w-full">
          <div className="h-full bg-[#050505] rounded-sm border-[0.5px] border-[#1a1a1a] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
            <div ref={downloadsScrollRef} className="hyperion-scrollbar h-full overflow-y-auto">

              {/* Sticky column headers */}
              <div
                className="sticky top-0 z-10 grid gap-4 px-6 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
                style={{ gridTemplateColumns: DOWNLOADS_GRID_TEMPLATE }}
              >
                <div className="flex h-8 items-center text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Archive Name
                </div>
                <div className="flex h-8 items-center text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Download
                </div>
                <div className="flex h-8 items-center justify-end text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Actions
                </div>
              </div>

              {/* Rows */}
              {loading ? (
                <div className="flex items-center justify-center py-24 text-[#8a8a8a] font-mono text-sm">
                  Scanning downloads...
                </div>
              ) : totalRows === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                  <span className="material-symbols-outlined text-[48px] text-[#7a7a7a]">download</span>
                  <span className="text-[#8a8a8a] text-sm font-mono tracking-tight">
                    {settings?.downloadPath
                      ? 'No archives found in the downloads folder'
                      : 'Set a downloads path in Configuration first'}
                  </span>
                  {!settings?.downloadPath && (
                    <button
                      onClick={() => setActiveView('settings')}
                      className="flex items-center gap-2 px-4 py-2 bg-[#fcee09] text-[#050505] rounded-sm text-xs brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors mt-2"
                    >
                      <span className="material-symbols-outlined text-[16px]">settings</span>
                      Configuration
                    </button>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    paddingTop: totalRows > DOWNLOAD_VIRTUALIZATION_THRESHOLD ? virtualizedDownloads.paddingTop : 0,
                    paddingBottom: totalRows > DOWNLOAD_VIRTUALIZATION_THRESHOLD ? virtualizedDownloads.paddingBottom : 0,
                  }}
                >
                  {visibleActiveDownloads.map((dl) => {
                    const pct = dl.totalBytes > 0 ? Math.round((dl.downloadedBytes / dl.totalBytes) * 100) : 0
                    const isDone = dl.status === 'done'
                    const isError = dl.status === 'error'
                    const isPaused = dl.status === 'paused'
                    const accent = isDone ? '#34d399' : isError ? '#f87171' : '#fcee09'
                    const eta = isDone || isError || isPaused ? null : formatETA(dl.downloadedBytes, dl.totalBytes, dl.speedBps)
                    const progressSummary = isError
                      ? dl.error ?? 'Download failed'
                      : isDone
                        ? 'Ready to install'
                        : isPaused
                          ? `${pct}% paused`
                        : `${pct}% complete`
                    const transferSummary = isError
                      ? 'Transfer interrupted'
                      : isDone
                        ? `${formatSize(dl.totalBytes)} downloaded`
                        : `${formatSize(dl.downloadedBytes)} / ${formatSize(dl.totalBytes)}`
                    const speedSummary = isError
                      ? 'Try again'
                      : isDone
                        ? 'Waiting for scan'
                        : isPaused
                          ? 'Paused'
                        : `${formatSpeed(dl.speedBps)}${eta ? ` · ETA ${eta}` : ''}`

                    return (
                      <div
                        key={dl.id}
                        className="relative h-14 overflow-hidden border-b-[0.5px] border-[#1e1a00]"
                        style={{ background: 'rgba(252,238,9,0.035)' }}
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 transition-all duration-500"
                          style={{
                            width: `${Math.max(0, Math.min(pct, 100))}%`,
                            background: isError
                              ? 'linear-gradient(90deg, rgba(248,113,113,0.18) 0%, rgba(248,113,113,0.08) 100%)'
                              : 'linear-gradient(90deg, rgba(252,238,9,0.22) 0%, rgba(252,238,9,0.09) 100%)',
                          }}
                        />
                        {!isError && !isDone && !isPaused && (
                          <div
                            aria-hidden="true"
                            className="absolute inset-y-0 w-[2px] transition-all duration-500"
                            style={{
                              left: `calc(${Math.min(pct, 99.6)}% - 1px)`,
                              background: accent,
                              boxShadow: `0 0 10px ${accent}aa`,
                            }}
                          />
                        )}
                        <div
                          className="absolute inset-y-0 left-0 w-[3px]"
                          style={{ background: accent, boxShadow: `0 0 8px ${accent}55` }}
                        />

                        <div
                          className="relative z-10 grid h-14 gap-4 pl-6 pr-6 py-[5px]"
                          style={{ gridTemplateColumns: DOWNLOADS_GRID_TEMPLATE }}
                        >
                          <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
                                {dl.fileName}
                              </span>
                              <span
                                className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                                style={{ color: accent, borderColor: `${accent}55`, background: `${accent}12` }}
                              >
                                {isError ? 'Error' : isDone ? 'Done' : isPaused ? 'Paused' : 'Downloading'}
                              </span>
                            </div>
                            <span
                              className="text-sm font-mono tracking-tight"
                              style={{ color: isError ? '#fca5a5' : accent }}
                            >
                              {transferSummary}
                            </span>
                          </div>

                          <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
                            <span
                              className="truncate"
                              style={{ color: isError ? '#fca5a5' : isDone ? '#86efac' : '#d6d6d6' }}
                            >
                              {progressSummary}
                            </span>
                            <span className="truncate text-[#9a9a9a]">
                              {speedSummary}
                            </span>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            {!isDone && !isError && (
                              <>
                                {isPaused ? (
                                  <Tooltip content="Resume download">
                                    <button
                                      onClick={() => void resumeDownload(dl.id)}
                                      className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#2f2a05] bg-[#0a0a0a]/90 text-[#fcee09] hover:border-[#fcee09]/60 hover:bg-[#151200] transition-all"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                                    </button>
                                  </Tooltip>
                                ) : (
                                  <Tooltip content="Pause download">
                                    <button
                                      onClick={() => void pauseDownload(dl.id)}
                                      className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0a0a0a]/90 text-[#c9c9c9] hover:border-[#fcee09]/45 hover:text-[#fcee09] transition-all"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">pause</span>
                                    </button>
                                  </Tooltip>
                                )}
                                <Tooltip content="Cancel download">
                                  <button
                                    onClick={() => void cancelDownload(dl.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a]/90 text-[#8a8a8a] hover:border-[#ff4d4f]/45 hover:text-[#ff4d4f] transition-all"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                  </button>
                                </Tooltip>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {visibleLocalFiles.map((entry, visibleIndex) => {
                  const index = visibleLocalStart + visibleIndex
                  const isInstalling = installing && installSourcePath === entry.path
                  const installAppearance = isInstalling
                    ? getInstallProgressAppearance(installStatus)
                    : null
                  const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
                  const isNew = newFilesSet.has(entry.path.toLowerCase())
                  const rowBg = index % 2 === 0
                    ? 'bg-[#050505] hover:bg-[#141414]'
                    : 'bg-[#0a0a0a] hover:bg-[#161616]'

                  if (isInstalling && installAppearance) {
                    const progressSummary = `${installStatus || installAppearance.label} ${installProgress > 0 ? `${installProgress}%` : ''}`.trim()
                    const progressDetail = installCurrentFile || installAppearance.detailFallback

                    return (
                      <div
                        key={entry.path}
                        className="relative h-14 overflow-hidden border-b-[0.5px]"
                        style={{
                          background: installAppearance.rowTint,
                          borderColor: installAppearance.softBorder,
                        }}
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 transition-all duration-500"
                          style={{
                            width: `${Math.max(0, Math.min(installProgress, 100))}%`,
                            background: installAppearance.fill,
                          }}
                        />
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 w-[2px] transition-all duration-500"
                          style={{
                            left: `calc(${Math.max(0, Math.min(installProgress, 99.6))}% - 1px)`,
                            background: installAppearance.accent,
                            boxShadow: `0 0 10px ${installAppearance.accent}aa`,
                          }}
                        />
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[3px]"
                          style={{
                            background: installAppearance.accent,
                            boxShadow: `0 0 8px ${installAppearance.accent}55`,
                          }}
                        />
                        <div
                          className="relative z-10 grid h-14 gap-4 pl-6 pr-6 py-[5px]"
                          style={{ gridTemplateColumns: DOWNLOADS_GRID_TEMPLATE }}
                        >
                          <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
                                {entry.name}
                              </span>
                              <span
                                className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                                style={{
                                  color: installAppearance.accent,
                                  borderColor: `${installAppearance.accent}55`,
                                  background: `${installAppearance.accent}12`,
                                }}
                              >
                                {installAppearance.label}
                              </span>
                            </div>
                            <span
                              className="truncate text-sm font-mono tracking-tight"
                              style={{ color: installAppearance.accent }}
                            >
                              {progressDetail}
                            </span>
                          </div>

                          <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
                            <span className="truncate text-[#d8d8d8]">
                              {progressSummary}
                            </span>
                            <span className="truncate text-[#9a9a9a]">
                              {installAppearance.summary}
                            </span>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <div
                              className="flex h-8 w-8 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
                              style={{
                                borderColor: `${installAppearance.accent}44`,
                                color: installAppearance.accent,
                              }}
                            >
                              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={entry.path}
                      className={`grid h-14 gap-4 pl-6 pr-6 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color] duration-150 ${rowBg} hover:border-[#363636]`}
                      style={{ gridTemplateColumns: DOWNLOADS_GRID_TEMPLATE }}
                    >
                      {/* Hover gradient overlay */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        style={{
                          background: isNew
                            ? 'linear-gradient(90deg, rgba(252,238,9,0.07) 0%, rgba(252,238,9,0.025) 20%, transparent 60%)'
                            : 'linear-gradient(90deg, rgba(252,238,9,0.05) 0%, rgba(252,238,9,0.02) 18%, transparent 60%)',
                        }}
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        style={{ background: isNew ? '#fcee09' : 'rgba(252,238,9,0.55)' }}
                      />
                      {/* Persistent left bar for NEW files */}
                      {isNew && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
                          style={{ background: 'rgba(252,238,9,0.4)' }}
                        />
                      )}

                      {/* Col 1: name + size + NEW badge */}
                      <div className="flex flex-col justify-center gap-1 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium tracking-tight truncate text-[#e5e2e1] group-hover:text-white transition-colors">
                            {entry.name}
                          </span>
                          {isNew && (
                            <span className="shrink-0 px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest bg-[#fcee09] text-[#050505] rounded-sm">
                              NEW
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-mono text-[#9a9a9a] tracking-tight group-hover:text-[#c2c2c2] transition-colors">
                          {formatSize(entry.size)}
                        </span>
                      </div>

                      {/* Col 2: modified date */}
                      <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#bdbdbd] transition-colors">
                        {formatWindowsDateTime(entry.modifiedAt)}
                      </div>

                      {/* Col 3: install + delete */}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void handleInstall(entry)}
                          disabled={isInstalling}
                          className={`group/btn h-7 px-3 rounded-sm text-[10px] brand-font font-bold uppercase tracking-widest transition-all disabled:opacity-50 ${
                            installedMod
                              ? 'bg-[#0a0a0a] border-[0.5px] border-[#7a7a7a] text-white hover:border-[#fcee09] hover:text-[#fcee09]'
                              : 'bg-[#0a0a0a] border-[0.5px] border-[#fcee09]/40 text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]'
                          } disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#fcee09]`}
                        >
                          {isInstalling ? 'Installing' : installedMod ? (
                            <>
                              <span className="group-hover/btn:hidden">Installed</span>
                              <span className="hidden group-hover/btn:inline">Reinstall</span>
                            </>
                          ) : 'Install'}
                        </button>
                        <Tooltip content="Delete download">
                          <button
                            onClick={() => setPendingDeleteDownload(entry)}
                            className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#ff4d4f]/45 hover:text-[#ff4d4f] transition-all"
                          >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  )
                })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {pendingDeleteDownload && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.45)"
          title="Delete Download"
          description={`You are about to permanently delete ${pendingDeleteDownload.name} from your downloads path.`}
          detailLabel="File to delete"
          detailValue={pendingDeleteDownload.name}
          icon="delete"
          primaryLabel="Delete"
          onPrimary={() => void handleDeleteDownload()}
          onCancel={() => setPendingDeleteDownload(null)}
          primaryTextColor="#ffffff"
        />
      )}

      {deleteAllOpen && (
        <ActionPromptDialog
          accentColor="#ff4d4f"
          accentGlow="rgba(255,77,79,0.4)"
          title="Delete All Downloads"
          description="This permanently deletes every archive currently listed in your downloads folder. Files already installed as mods will not be affected."
          detailLabel="Files to delete"
          detailValue={String(localFiles.length)}
          icon="delete_sweep"
          primaryLabel="Delete Everything"
          primaryTextColor="#ffffff"
          onPrimary={() => void handleDeleteAllDownloads()}
          onCancel={() => setDeleteAllOpen(false)}
          submitting={deletingAll}
        />
      )}
    </div>
  )
}
