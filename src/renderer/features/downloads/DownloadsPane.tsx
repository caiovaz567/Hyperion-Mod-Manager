import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import type { DownloadEntry, IpcResult, ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { Tooltip } from '../ui/Tooltip'

const DOWNLOADS_GRID_TEMPLATE = 'minmax(280px,1fr) 156px 184px 130px'

const FORMAT_COLOR: Record<string, string> = {
  zip: '#60A5FA',
  rar: '#A78BFA',
  '7z': '#fbbf24',
}
const formatColor = (ext: string) => FORMAT_COLOR[ext.replace('.', '').toLowerCase()] ?? '#64748B'

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

const formatDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`
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
    refreshLocalFiles,
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
    refreshLocalFiles: state.refreshLocalFiles,
    cancelDownload: state.cancelDownload,
    newFiles: state.newFiles,
    markFileAsOld: state.markFileAsOld,
  }), shallow)

  const hasRequiredPaths = Boolean(
    settings?.gamePath?.trim() && settings?.libraryPath?.trim() && gamePathValid && libraryPathValid
  )

  const [loading, setLoading] = useState(true)
  const [installingPath, setInstallingPath] = useState<string | null>(null)
  const [pendingDeleteDownload, setPendingDeleteDownload] = useState<DownloadEntry | null>(null)

  const doRefresh = async () => {
    setLoading(true)
    await refreshLocalFiles().catch(() => undefined)
    setLoading(false)
  }

  useEffect(() => {
    doRefresh().catch(() => setLoading(false))
  }, [settings?.downloadPath])

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

    setInstallingPath(entry.path)
    const installResult = await installMod(entry.path)
    if (!installResult.ok || !installResult.data) {
      addToast(installResult.error ?? 'Install failed', 'error')
      setInstallingPath(null)
      return
    }
    setInstallingPath(null)

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

  const totalRows = activeDownloads.length + localFiles.length

  return (
    <div className="h-full animate-settings-in">
      <div className="flex flex-col h-full overflow-hidden">

        {/* Fixed header */}
        <div className="shrink-0 px-8 pt-6 pb-3 w-full">
          <h1 className="brand-font text-xl text-white font-bold tracking-widest uppercase">
            Downloads
          </h1>
          <p className="text-[#9a9a9a] text-xs mt-1 flex items-center gap-2 font-mono tracking-tight">
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
          </div>
        </div>

        {/* Unified table */}
        <div className="flex-1 overflow-hidden px-8 pb-6 w-full">
          <div className="h-full bg-[#050505] rounded-sm border-[0.5px] border-[#1a1a1a] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
            <div className="hyperion-scrollbar h-full overflow-y-auto">

              {/* Sticky column headers */}
              <div
                className="sticky top-0 z-10 grid gap-4 px-6 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
                style={{ gridTemplateColumns: DOWNLOADS_GRID_TEMPLATE }}
              >
                <div className="flex h-8 items-center text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Archive Name
                </div>
                <div className="flex h-8 items-center text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Format
                </div>
                <div className="flex h-8 items-center text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Modified
                </div>
                <div className="flex h-8 items-center justify-end text-xs uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
                  Actions
                </div>
              </div>

              {/* Active download rows — inline at the top */}
              {activeDownloads.map((dl) => {
                const pct = dl.totalBytes > 0 ? Math.round((dl.downloadedBytes / dl.totalBytes) * 100) : 0
                const isDone = dl.status === 'done'
                const isError = dl.status === 'error'
                const accent = isDone ? '#34d399' : isError ? '#f87171' : '#fcee09'
                const eta = isDone || isError ? null : formatETA(dl.downloadedBytes, dl.totalBytes, dl.speedBps)
                const dlExt = dl.fileName.split('.').pop()?.toLowerCase() ?? ''
                const dlColor = FORMAT_COLOR[dlExt] ?? '#64748B'

                return (
                  <div
                    key={dl.id}
                    className="grid gap-4 pl-6 pr-6 py-[5px] border-b-[0.5px] border-[#1e1a00] relative overflow-hidden"
                    style={{ gridTemplateColumns: DOWNLOADS_GRID_TEMPLATE, background: 'rgba(252,238,9,0.03)' }}
                  >
                    {/* Left accent bar */}
                    <div
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ background: accent, boxShadow: `0 0 8px ${accent}55` }}
                    />

                    {/* Col 1: name + progress bar + sizes + % */}
                    <div className="flex flex-col justify-center gap-[3px] overflow-hidden pl-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium tracking-tight truncate text-sm" style={{ color: accent }}>
                          {dl.fileName}
                        </span>
                        {isDone && (
                          <span className="shrink-0 flex items-center gap-1 text-[#34d399] text-[10px] font-mono">
                            <span className="material-symbols-outlined text-[13px]">check_circle</span>
                            Done
                          </span>
                        )}
                        {isError && (
                          <span className="shrink-0 text-[#f87171] text-[10px] font-mono truncate">
                            {dl.error ?? 'Failed'}
                          </span>
                        )}
                      </div>
                      {!isDone && !isError && (
                        <>
                          <div className="h-[2px] bg-[#1a1a1a] rounded-full overflow-hidden">
                            <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: accent }} />
                          </div>
                          <span className="text-[10px] font-mono text-[#7a7a7a]">
                            {formatSize(dl.downloadedBytes)} / {formatSize(dl.totalBytes)} · {pct}%
                          </span>
                        </>
                      )}
                    </div>

                    {/* Col 2: format badge (same as local files) */}
                    <div className="flex items-center">
                      <span
                        className="inline-flex h-5 items-center px-1.5 rounded-sm text-[10px] font-bold font-mono tracking-wide uppercase border-[0.5px]"
                        style={{ color: dlColor, borderColor: `${dlColor}40`, background: `${dlColor}12` }}
                      >
                        {dlExt || '?'}
                      </span>
                    </div>

                    {/* Col 3: speed + ETA */}
                    <div className="flex flex-col justify-center gap-[3px]">
                      {!isDone && !isError && (
                        <>
                          <span className="text-[11px] font-mono text-[#9a9a9a]">{formatSpeed(dl.speedBps)}</span>
                          {eta && <span className="text-[10px] font-mono text-[#6a6a6a]">ETA {eta}</span>}
                        </>
                      )}
                    </div>

                    {/* Col 4: cancel */}
                    <div className="flex items-center justify-end">
                      {!isDone && !isError && (
                        <Tooltip content="Cancel download">
                          <button
                            onClick={() => void cancelDownload(dl.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#ff4d4f]/45 hover:text-[#ff4d4f] transition-all"
                          >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Local file rows */}
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
                localFiles.map((entry, index) => {
                  const isInstalling = installingPath === entry.path
                  const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
                  const isNew = newFilesSet.has(entry.path.toLowerCase())
                  const ext = entry.extension.replace('.', '').toUpperCase()
                  const color = formatColor(entry.extension)
                  const rowBg = index % 2 === 0
                    ? 'bg-[#050505] hover:bg-[#141414]'
                    : 'bg-[#0a0a0a] hover:bg-[#161616]'

                  return (
                    <div
                      key={entry.path}
                      className={`grid gap-4 pl-6 pr-6 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color] duration-150 ${rowBg} hover:border-[#363636]`}
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
                      <div className="flex flex-col justify-center gap-0.5 overflow-hidden">
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
                        <span className="text-xs font-mono text-[#7a7a7a] tracking-tight">
                          {formatSize(entry.size)}
                        </span>
                      </div>

                      {/* Col 2: format badge with color */}
                      <div className="flex items-center">
                        <span
                          className="px-2.5 py-[3px] border-[0.5px] bg-[#111] group-hover:border-[#343434] text-[10px] uppercase tracking-widest rounded-sm transition-colors"
                          style={{ color, borderColor: `${color}33` }}
                        >
                          {ext}
                        </span>
                      </div>

                      {/* Col 3: modified date */}
                      <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#bdbdbd] transition-colors">
                        {formatDate(entry.modifiedAt)}
                      </div>

                      {/* Col 4: install + delete */}
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
                })
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
          detailLabel="Target file"
          detailValue={pendingDeleteDownload.name}
          icon="delete"
          primaryLabel="Delete"
          onPrimary={() => void handleDeleteDownload()}
          onCancel={() => setPendingDeleteDownload(null)}
          primaryTextColor="#ffffff"
        />
      )}
    </div>
  )
}
