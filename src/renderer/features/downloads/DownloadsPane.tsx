import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import type { DownloadEntry, IpcResult, ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { ActionPromptDialog } from '../ui/ActionPromptDialog'
import { Tooltip } from '../ui/Tooltip'

const formatSpeed = (bps: number): string => {
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

const formatSize = (bytes: number): string => {
  if (bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
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
  } = useAppStore()

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

  const handleInstall = async (entry: DownloadEntry) => {
    if (!hasRequiredPaths) {
      addToast('Set Game Path and Mod Library before installing mods', 'warning')
      setActiveView('settings')
      return
    }

    const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
    if (installedMod) {
      openReinstallPrompt(installedMod)
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
    setPendingDeleteDownload(null)
    addToast(`${pendingDeleteDownload.name} deleted`, 'success')
    await doRefresh()
  }

  const LABEL = 'text-[9px] uppercase tracking-widest text-[#8a8a8a] brand-font font-bold'

  return (
    <div className="h-full flex flex-col animate-settings-in">
      {/* Fixed header */}
      <div className="shrink-0 px-8 pt-6 pb-3 w-full">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 className="brand-font text-xl font-bold tracking-[0.18em] uppercase text-white leading-none">
              Downloads
            </h1>
            <p className="mt-1 text-[10px] text-[#8a8a8a] font-mono tracking-[0.15em] uppercase">
              {activeDownloads.length > 0 ? `${activeDownloads.length} active · ` : ''}{localFiles.length} local
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void doRefresh()}
              className="h-10 px-4 bg-[#0a0a0a] border-[0.5px] border-[#1a1a1a] text-[#9a9a9a] rounded-sm text-[10px] brand-font font-semibold uppercase tracking-widest hover:text-white hover:border-[#7a7a7a] transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={openDownloadsFolder}
              className="h-10 px-4 bg-[#fcee09] text-[#050505] rounded-sm text-[10px] brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors"
            >
              Open Folder
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto hyperion-scrollbar px-8 pb-6">

        {/* Active Downloads */}
        {activeDownloads.length > 0 && (
          <div className="mb-6">
            <div className={`${LABEL} mb-2`}>Active Downloads</div>
            <div className="bg-[#050505] border-[0.5px] border-[#1a1a1a] rounded-sm overflow-hidden">
              {activeDownloads.map((dl) => {
                const pct = dl.totalBytes > 0 ? Math.round((dl.downloadedBytes / dl.totalBytes) * 100) : 0
                const isDone = dl.status === 'done'
                const isError = dl.status === 'error'
                return (
                  <div
                    key={dl.id}
                    className="grid px-5 py-[5px] border-b-[0.5px] border-[#111] last:border-b-0"
                    style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 32px' }}
                  >
                    {/* Col 1: name + progress bar + size */}
                    <div className="min-w-0 pr-4">
                      <div className="truncate text-[#e5e2e1] text-[12px] leading-tight">{dl.fileName}</div>
                      <div className="mt-[3px] h-[3px] bg-[#111] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${isDone ? 'bg-[#34d399]' : isError ? 'bg-[#f87171]' : 'bg-[#fcee09]'}`}
                          style={{ width: `${isDone ? 100 : pct}%` }}
                        />
                      </div>
                      <div className="mt-[2px] text-[10px] font-mono text-[#6a6a6a]">
                        {dl.totalBytes > 0
                          ? `${formatSize(dl.downloadedBytes)} / ${formatSize(dl.totalBytes)}`
                          : dl.downloadedBytes > 0 ? formatSize(dl.downloadedBytes) : '—'}
                      </div>
                    </div>

                    {/* Col 2: speed / status */}
                    <div className="flex items-center justify-end">
                      {isDone ? (
                        <span className="text-[10px] font-mono text-[#34d399] uppercase tracking-wider">Done</span>
                      ) : isError ? (
                        <span className="text-[10px] font-mono text-[#f87171] uppercase tracking-wider">Error</span>
                      ) : dl.speedBps > 0 ? (
                        <span className="text-[10px] font-mono text-[#9a9a9a]">{formatSpeed(dl.speedBps)}</span>
                      ) : (
                        <span className="text-[10px] font-mono text-[#6a6a6a]">Starting…</span>
                      )}
                    </div>

                    {/* Col 3: cancel button */}
                    <div className="flex items-center justify-end">
                      {(dl.status === 'queued' || dl.status === 'downloading') && (
                        <Tooltip content="Cancel download">
                          <button
                            onClick={() => void cancelDownload(dl.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-sm text-[#6a6a6a] hover:text-[#ff4d4f] transition-colors"
                          >
                            <span className="material-symbols-outlined text-[15px]">close</span>
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Local Files */}
        <div>
          <div className={`${LABEL} mb-2`}>Local Files</div>
          <div className="border-[0.5px] border-[#1a1a1a] bg-[#050505] overflow-hidden">
            {/* Column headers */}
            <div
              className="grid px-5 h-8 items-center border-b-[0.5px] border-[#1a1a1a] bg-[#0a0a0a]"
              style={{ gridTemplateColumns: 'minmax(300px,1fr) 80px 120px auto' }}
            >
              <span className={LABEL}>Name</span>
              <span className={LABEL}>Format</span>
              <span className={LABEL}>Modified</span>
              <span className={LABEL}>Actions</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-[#8a8a8a] font-mono text-sm">
                Scanning downloads...
              </div>
            ) : localFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-[#4a4a4a]">download</span>
                <div className="text-[#6a6a6a] text-[11px] font-mono tracking-tight">
                  {settings?.downloadPath
                    ? 'No archives found in the downloads folder'
                    : 'Set a downloads path in Configuration first'}
                </div>
              </div>
            ) : (
              localFiles.map((entry) => {
                const isInstalling = installingPath === entry.path
                const installedMod = installedBySourcePath.get(entry.path.toLowerCase())
                return (
                  <div
                    key={entry.path}
                    className="grid px-5 py-[5px] border-b-[0.5px] border-[#111] hover:bg-[#080808] transition-colors"
                    style={{ gridTemplateColumns: 'minmax(300px,1fr) 80px 120px auto' }}
                  >
                    <div className="min-w-0 flex flex-col justify-center">
                      <div className="truncate text-[#e5e2e1] text-[12px]">{entry.name}</div>
                      <div className="text-[#6a6a6a] text-[10px] font-mono">{formatSize(entry.size)}</div>
                    </div>
                    <div className="flex items-center text-[#7a7a7a] text-[10px] font-mono uppercase">
                      {entry.extension.replace('.', '')}
                    </div>
                    <div className="flex items-center text-[#6a6a6a] text-[10px] font-mono">
                      {formatDate(entry.modifiedAt)}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => void handleInstall(entry)}
                        disabled={isInstalling}
                        className={`group px-3 py-1 rounded-sm text-[10px] brand-font font-bold uppercase tracking-widest transition-all disabled:opacity-50 ${
                          installedMod
                            ? 'bg-[#0a0a0a] border-[0.5px] border-[#7a7a7a] text-white hover:border-[#fcee09] hover:text-[#fcee09]'
                            : 'bg-[#0a0a0a] border-[0.5px] border-[#fcee09]/40 text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]'
                        } disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#fcee09]`}
                      >
                        {isInstalling ? (
                          'Installing'
                        ) : installedMod ? (
                          <>
                            <span className="group-hover:hidden">Installed</span>
                            <span className="hidden group-hover:inline">Reinstall</span>
                          </>
                        ) : (
                          'Install'
                        )}
                      </button>
                      <Tooltip content="Delete download">
                        <button
                          onClick={() => setPendingDeleteDownload(entry)}
                          className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#1a1a1a] text-[#6a6a6a] hover:border-[#ff4d4f]/50 hover:text-[#ff4d4f] transition-colors"
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
