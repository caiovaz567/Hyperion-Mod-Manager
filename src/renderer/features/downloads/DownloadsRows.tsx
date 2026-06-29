import React from 'react'
import type { ActiveDownload, DownloadEntry, ModMetadata } from '@shared/types'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { DELETE_PROGRESS_APPEARANCE, getTransientDeleteProgress } from '../../utils/deleteProgressAppearance'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { Tooltip } from '../ui/Tooltip'
import { useTranslation } from '../../i18n/I18nContext'

export type DownloadListRow =
  | { kind: 'active'; key: string; orderTs: number; active: ActiveDownload }
  | { kind: 'local'; key: string; orderTs: number; entry: DownloadEntry }

export const getDownloadRowTimestamp = (row: DownloadListRow): string =>
  row.kind === 'active'
    ? row.active.startedAt
    : row.entry.downloadedAt ?? row.entry.modifiedAt

export const getDownloadRowSize = (row: DownloadListRow): number =>
  row.kind === 'active'
    ? Math.max(row.active.totalBytes, row.active.downloadedBytes)
    : row.entry.size

const clampPercent = (value: number, max = 100): number => Math.max(0, Math.min(value, max))

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

interface DownloadsRowProps {
  row: DownloadListRow
  rowIndex: number
  gridTemplate: string
  installedMod?: ModMetadata | null
  isNew?: boolean
  isInstalling?: boolean
  isDeleting?: boolean
  installProgress: number
  installStatus: string
  installCurrentFile: string
  deleteStartedAt?: number
  deleteProgressTick: number
  onContextMenu: (event: React.MouseEvent, row: DownloadListRow) => void
  onInstall: (entry: DownloadEntry) => void | Promise<void>
  onDeleteRequest: (entry: DownloadEntry) => void
  onMarkOld: (entry: DownloadEntry) => void
  onPauseDownload: (id: string) => void | Promise<void>
  onResumeDownload: (id: string) => void | Promise<void>
  onCancelDownload: (id: string) => void | Promise<void>
}

const ActiveDownloadRow: React.FC<{
  row: DownloadListRow
  download: ActiveDownload
  gridTemplate: string
  onContextMenu: DownloadsRowProps['onContextMenu']
  onPauseDownload: DownloadsRowProps['onPauseDownload']
  onResumeDownload: DownloadsRowProps['onResumeDownload']
  onCancelDownload: DownloadsRowProps['onCancelDownload']
}> = ({
  row,
  download,
  gridTemplate,
  onContextMenu,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}) => {
  const { t } = useTranslation()
  const pct = download.totalBytes > 0 ? Math.round((download.downloadedBytes / download.totalBytes) * 100) : 0
  const isDone = download.status === 'done'
  const isError = download.status === 'error'
  const isPaused = download.status === 'paused'
  const accent = isDone ? '#34d399' : isError ? '#f87171' : isPaused ? '#60a5fa' : '#fcee09'
  const rowTint = isError
    ? 'rgba(248,113,113,0.04)'
    : isPaused
      ? 'rgba(96,165,250,0.05)'
      : 'rgba(252,238,9,0.035)'
  const eta = isDone || isError || isPaused ? null : formatETA(download.downloadedBytes, download.totalBytes, download.speedBps)
  const progressSummary = isError
    ? download.error ?? t('downloads.active.downloadFailed')
    : isDone
      ? t('downloads.active.readyToInstall')
      : isPaused
        ? t('downloads.active.pausedAt', { pct })
        : t('downloads.active.percentComplete', { pct })
  const transferSummary = isError
    ? t('downloads.active.interrupted')
    : isDone
      ? t('downloads.active.downloaded', { size: formatSize(download.totalBytes) })
      : `${formatSize(download.downloadedBytes)} / ${formatSize(download.totalBytes)}`
  const speedSummary = isError
    ? t('downloads.active.tryAgain')
    : isDone
      ? t('downloads.active.waitingForScan')
      : isPaused
        ? t('downloads.active.resumeToContinue')
        : `${formatSpeed(download.speedBps)}${eta ? ` · ${t('downloads.active.eta')} ${eta}` : ''}`

  return (
    <div
      data-download-row="true"
      onContextMenu={(event) => onContextMenu(event, row)}
      className="relative h-14 overflow-hidden border-b-[0.5px] border-[#1e1a00]"
      style={{ background: rowTint, borderColor: '#1a1a1a' }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{
          width: `${clampPercent(pct)}%`,
          background: isError
            ? 'linear-gradient(90deg, rgba(248,113,113,0.18) 0%, rgba(248,113,113,0.08) 100%)'
            : isPaused
              ? 'linear-gradient(90deg, rgba(96,165,250,0.18) 0%, rgba(96,165,250,0.07) 100%)'
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
        className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
              {download.fileName}
            </span>
          </div>
          <span
            className="text-sm font-mono tracking-tight"
            style={{ color: isError ? '#fca5a5' : isPaused ? '#93c5fd' : accent }}
          >
            {transferSummary}
          </span>
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden">
          <span
            className="w-fit rounded-sm border-0 px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest"
            style={{ color: accent, background: `${accent}18` }}
          >
            {isError ? t('downloads.status.error') : isDone ? t('downloads.status.downloaded') : isPaused ? t('downloads.status.paused') : t('downloads.status.downloading')}
          </span>
          <span className={`truncate text-sm font-mono tracking-tight ${isPaused ? 'text-[#93a8c8]' : 'text-[#9a9a9a]'}`}>
            {progressSummary}
          </span>
        </div>

        <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a]">
          {download.version ?? '—'}
        </div>

        <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#d8d8d8]">
          {formatSize(Math.max(download.totalBytes, download.downloadedBytes))}
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
          <span className="truncate text-[#d8d8d8]">{formatWindowsDateTime(download.startedAt)}</span>
          <span className={`truncate ${isPaused ? 'text-[#93a8c8]' : 'text-[#9a9a9a]'}`}>{speedSummary}</span>
        </div>

        <div className="flex items-center justify-end gap-2">
          {!isDone && !isError && (
            <>
              {isPaused ? (
                <Tooltip content={t('downloads.tooltip.resume')}>
                  <button
                    onClick={() => void onResumeDownload(download.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-sm border-0 bg-[rgba(96,165,250,0.14)] text-[#8dbdff] transition-colors hover:bg-[#60a5fa] hover:text-[#051017]"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content={t('downloads.tooltip.pause')}>
                  <button
                    onClick={() => void onPauseDownload(download.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-sm border-0 bg-[#151515] text-[#c9c9c9] transition-colors hover:bg-[#fcee09] hover:text-[#050505]"
                  >
                    <span className="material-symbols-outlined text-[16px]">pause</span>
                  </button>
                </Tooltip>
              )}
              <Tooltip content={t('downloads.tooltip.cancel')}>
                <button
                  onClick={() => void onCancelDownload(download.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-sm border-0 bg-[#151515] text-[#8a8a8a] transition-colors hover:bg-[rgba(248,113,113,0.18)] hover:text-[#ff9b9b]"
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
}

const InstallingDownloadRow: React.FC<{
  row: DownloadListRow
  entry: DownloadEntry
  gridTemplate: string
  installProgress: number
  installStatus: string
  installCurrentFile: string
  onContextMenu: DownloadsRowProps['onContextMenu']
}> = ({
  row,
  entry,
  gridTemplate,
  installProgress,
  installStatus,
  installCurrentFile,
  onContextMenu,
}) => {
  const installAppearance = getInstallProgressAppearance(installStatus)
  const progressSummary = `${installStatus || installAppearance.label} ${installProgress > 0 ? `${installProgress}%` : ''}`.trim()
  const progressDetail = installCurrentFile || installAppearance.detailFallback

  return (
    <div
      data-download-row="true"
      onContextMenu={(event) => onContextMenu(event, row)}
      className="relative h-14 overflow-hidden border-b-[0.5px]"
      style={{
        background: installAppearance.rowTint,
        borderColor: '#1a1a1a',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{
          width: `${clampPercent(installProgress)}%`,
          background: installAppearance.fill,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 w-[2px] transition-all duration-500"
        style={{
          left: `calc(${clampPercent(installProgress, 99.6)}% - 1px)`,
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
        className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
              {entry.name}
            </span>
          </div>
          <span
            className="truncate text-sm font-mono tracking-tight"
            style={{ color: installAppearance.accent }}
          >
            {progressDetail}
          </span>
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden">
          <span
            className="w-fit rounded-sm border-0 px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest"
            style={{
              color: installAppearance.accent,
              background: `${installAppearance.accent}18`,
            }}
          >
            {installAppearance.label}
          </span>
          <span className="truncate text-sm font-mono tracking-tight text-[#d8d8d8]">
            {progressSummary}
          </span>
        </div>

        <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
          {entry.version ?? '—'}
        </div>

        <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#d8d8d8]">
          {formatSize(entry.size)}
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
          <span className="truncate text-[#d8d8d8]">{formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}</span>
          <span className="truncate text-[#9a9a9a]">{installAppearance.summary}</span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-sm border-0"
            style={{
              color: installAppearance.accent,
              background: `${installAppearance.accent}18`,
            }}
          >
            <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const DeletingDownloadRow: React.FC<{
  entry: DownloadEntry
  gridTemplate: string
  deleteStartedAt?: number
  deleteProgressTick: number
}> = ({ entry, gridTemplate, deleteStartedAt, deleteProgressTick }) => {
  const { t } = useTranslation()
  const deleteAppearance = DELETE_PROGRESS_APPEARANCE
  const deleteLabel = t('downloads.delete.label')
  const deleteSummary = t('downloads.delete.summary')
  const deleteProgress = getTransientDeleteProgress(deleteStartedAt ?? deleteProgressTick, deleteProgressTick)

  return (
    <div
      data-download-row="true"
      className="relative h-14 overflow-hidden border-b-[0.5px]"
      style={{
        background: deleteAppearance.rowTint,
        borderColor: '#1a1a1a',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{
          width: `${clampPercent(deleteProgress)}%`,
          background: deleteAppearance.fill,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 w-[2px] transition-all duration-500"
        style={{
          left: `calc(${clampPercent(deleteProgress, 99.6)}% - 1px)`,
          background: deleteAppearance.accent,
          boxShadow: `0 0 10px ${deleteAppearance.accent}aa`,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background: deleteAppearance.accent,
          boxShadow: `0 0 8px ${deleteAppearance.accent}55`,
        }}
      />
      <div
        className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium tracking-tight truncate text-[#ffe1e1]">
              {entry.name}
            </span>
            <span
              className="shrink-0 rounded-sm border-0 px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
              style={{
                color: deleteAppearance.accent,
                background: `${deleteAppearance.accent}18`,
              }}
            >
              {deleteLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center">
          <span
            className="shrink-0 rounded-sm border-0 px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest"
            style={{
              color: deleteAppearance.accent,
              background: `${deleteAppearance.accent}18`,
            }}
          >
            {t('downloads.delete.label')}
          </span>
        </div>

        <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
          {entry.version ?? '—'}
        </div>

        <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#d8d8d8]">
          {formatSize(entry.size)}
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm font-mono tracking-tight">
          <span className="truncate text-[#d8d8d8]">{formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}</span>
          <span className="truncate text-[#ffb4ab]">
            {deleteProgress > 0 ? `${deleteProgress}% · ${deleteSummary}` : deleteSummary}
          </span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-sm border-0"
            style={{
              color: deleteAppearance.accent,
              background: `${deleteAppearance.accent}18`,
            }}
          >
            <span className="material-symbols-outlined animate-spin text-[16px]">delete</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const LocalDownloadRow: React.FC<{
  row: DownloadListRow
  entry: DownloadEntry
  rowIndex: number
  gridTemplate: string
  installedMod?: ModMetadata | null
  isNew: boolean
  isInstalling: boolean
  onContextMenu: DownloadsRowProps['onContextMenu']
  onInstall: DownloadsRowProps['onInstall']
  onDeleteRequest: DownloadsRowProps['onDeleteRequest']
  onMarkOld: DownloadsRowProps['onMarkOld']
}> = ({
  row,
  entry,
  rowIndex,
  gridTemplate,
  installedMod,
  isNew,
  isInstalling,
  onContextMenu,
  onInstall,
  onDeleteRequest,
  onMarkOld,
}) => {
  const { t } = useTranslation()
  const rowBg = rowIndex % 2 === 0
    ? 'bg-[#050505] hover:bg-[#141414]'
    : 'bg-[#0a0a0a] hover:bg-[#161616]'

  return (
    <div
      data-download-row="true"
      onContextMenu={(event) => onContextMenu(event, row)}
      onClick={() => {
        if (isNew) onMarkOld(entry)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        void onInstall(entry)
      }}
      className={`grid h-14 gap-4 pl-5 pr-5 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color] duration-150 ${rowBg} hover:border-[#363636]`}
      style={{ gridTemplateColumns: gridTemplate }}
    >
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
      {isNew && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
          style={{ background: 'rgba(252,238,9,0.4)' }}
        />
      )}

      <div className="flex items-center overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium tracking-tight truncate text-[#e5e2e1] group-hover:text-white transition-colors">
            {entry.name}
          </span>
          {isNew && (
            <span className="shrink-0 px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest bg-[#fcee09] text-[#050505] rounded-sm">
              {t('downloads.badge.new')}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center">
        <span
          className={`shrink-0 rounded-sm border-0 px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-widest ${
            installedMod
              ? 'bg-[#171717] text-[#f0f0f0]'
              : 'bg-[rgba(252,238,9,0.10)] text-[#d8d19a]'
          }`}
        >
          {installedMod ? t('downloads.status.installed') : t('downloads.status.downloaded')}
        </span>
      </div>

      <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#c4c4c4] transition-colors">
        {entry.version ?? '—'}
      </div>

      <div className="flex items-center pl-4 text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#c4c4c4] transition-colors">
        {formatSize(entry.size)}
      </div>

      <div className="flex items-center text-sm font-mono tracking-tight text-[#9a9a9a] group-hover:text-[#bdbdbd] transition-colors">
        {formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Tooltip content={installedMod ? t('downloads.tooltip.reinstallArchive') : t('downloads.tooltip.installArchive')}>
          <button
            onClick={(event) => {
              event.stopPropagation()
              void onInstall(entry)
            }}
            disabled={isInstalling}
            className={`flex h-8 w-8 items-center justify-center rounded-sm border-0 transition-colors disabled:opacity-50 ${
              installedMod
                ? 'bg-[#151515] text-[#f0f0f0] hover:bg-[rgba(252,238,9,0.12)] hover:text-[#fcee09]'
                : 'bg-[rgba(252,238,9,0.12)] text-[#fcee09] hover:bg-[#fcee09] hover:text-[#050505]'
            } disabled:hover:bg-[#151515] disabled:hover:text-[#fcee09]`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {installedMod ? 'restart_alt' : 'deployed_code'}
            </span>
          </button>
        </Tooltip>
        <Tooltip content={t('downloads.tooltip.delete')}>
          <button
            onClick={(event) => {
              event.stopPropagation()
              onDeleteRequest(entry)
            }}
            className="flex h-8 w-8 items-center justify-center rounded-sm border-0 bg-[rgba(248,113,113,0.13)] text-[#ff9b9b] transition-colors hover:bg-[#f87171] hover:text-[#190505]"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export const DownloadsRow: React.FC<DownloadsRowProps> = ({
  row,
  rowIndex,
  gridTemplate,
  installedMod,
  isNew = false,
  isInstalling = false,
  isDeleting = false,
  installProgress,
  installStatus,
  installCurrentFile,
  deleteStartedAt,
  deleteProgressTick,
  onContextMenu,
  onInstall,
  onDeleteRequest,
  onMarkOld,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}) => {
  if (row.kind === 'active') {
    return (
      <ActiveDownloadRow
        row={row}
        download={row.active}
        gridTemplate={gridTemplate}
        onContextMenu={onContextMenu}
        onPauseDownload={onPauseDownload}
        onResumeDownload={onResumeDownload}
        onCancelDownload={onCancelDownload}
      />
    )
  }

  if (isInstalling) {
    return (
      <InstallingDownloadRow
        row={row}
        entry={row.entry}
        gridTemplate={gridTemplate}
        installProgress={installProgress}
        installStatus={installStatus}
        installCurrentFile={installCurrentFile}
        onContextMenu={onContextMenu}
      />
    )
  }

  if (isDeleting) {
    return (
      <DeletingDownloadRow
        entry={row.entry}
        gridTemplate={gridTemplate}
        deleteStartedAt={deleteStartedAt}
        deleteProgressTick={deleteProgressTick}
      />
    )
  }

  return (
    <LocalDownloadRow
      row={row}
      entry={row.entry}
      rowIndex={rowIndex}
      gridTemplate={gridTemplate}
      installedMod={installedMod}
      isNew={isNew}
      isInstalling={isInstalling}
      onContextMenu={onContextMenu}
      onInstall={onInstall}
      onDeleteRequest={onDeleteRequest}
      onMarkOld={onMarkOld}
    />
  )
}
