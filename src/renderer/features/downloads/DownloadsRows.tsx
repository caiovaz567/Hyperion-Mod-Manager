import React from 'react'
import type { ActiveDownload, DownloadEntry, ModMetadata } from '@shared/types'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { DELETE_PROGRESS_APPEARANCE, getTransientDeleteProgress } from '../../utils/deleteProgressAppearance'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { Tooltip } from '../ui/Tooltip'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

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
  // Paused is a quiet neutral so it never clashes with the user-selected accent color.
  const accent = isDone ? '#34d399' : isError ? '#f87171' : isPaused ? '#8b93a1' : 'var(--accent)'
  // `accent` may be a var() reference, so pre-built soft/glow variants are needed - hex
  // concatenation like `${accent}18` is invalid CSS for var() and silently renders nothing.
  const accentSoft = isDone
    ? 'rgba(52,211,153,0.14)'
    : isError
      ? 'rgba(248,113,113,0.14)'
      : isPaused
        ? 'rgba(139,147,161,0.16)'
        : 'rgb(var(--accent-rgb) / 0.14)'
  const accentGlow = isDone
    ? 'rgba(52,211,153,0.33)'
    : isError
      ? 'rgba(248,113,113,0.33)'
      : isPaused
        ? 'rgba(139,147,161,0.33)'
        : 'rgb(var(--accent-rgb) / 0.33)'
  const rowTint = isError
    ? 'rgba(248,113,113,0.04)'
    : isPaused
      ? 'rgba(139,147,161,0.05)'
      : 'rgb(var(--accent-rgb)/0.035)'
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
      className="relative h-14 overflow-hidden border-b border-[var(--border-subtle)]"
      style={{ background: rowTint }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{
          width: `${clampPercent(pct)}%`,
          background: isError
            ? 'linear-gradient(90deg, rgba(248,113,113,0.18) 0%, rgba(248,113,113,0.08) 100%)'
            : isPaused
              ? 'linear-gradient(90deg, rgba(139,147,161,0.16) 0%, rgba(139,147,161,0.06) 100%)'
              : 'linear-gradient(90deg, rgb(var(--accent-rgb)/0.22) 0%, rgb(var(--accent-rgb)/0.09) 100%)',
        }}
      />
      {!isError && !isDone && !isPaused && (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-[2px] transition-all duration-500"
          style={{
            left: `calc(${Math.min(pct, 99.6)}% - 1px)`,
            background: accent,
            boxShadow: `0 0 10px ${accentGlow}`,
          }}
        />
      )}
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent, boxShadow: `0 0 8px ${accentGlow}` }}
      />

      <div
        className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium tracking-tight truncate text-[var(--text-primary-alt)]">
              {download.fileName}
            </span>
          </div>
          <span
            className="text-sm tabular-nums"
            style={{ color: isError ? '#fca5a5' : isPaused ? 'var(--text-secondary)' : accent }}
          >
            {transferSummary}
          </span>
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden">
          <span
            className="w-fit rounded-md border-0 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: accent, background: accentSoft }}
          >
            {isError ? t('downloads.status.error') : isDone ? t('downloads.status.downloaded') : isPaused ? t('downloads.status.paused') : t('downloads.status.downloading')}
          </span>
          <span className="truncate text-sm tabular-nums text-[var(--text-support)]">
            {progressSummary}
          </span>
        </div>

        <div className="flex items-center text-sm tabular-nums text-[var(--text-support)]">
          {download.version ?? '—'}
        </div>

        <div className="flex items-center pl-4 text-sm tabular-nums text-[var(--text-primary-alt)]">
          {formatSize(Math.max(download.totalBytes, download.downloadedBytes))}
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm tabular-nums">
          <span className="truncate text-[var(--text-primary-alt)]">{formatWindowsDateTime(download.startedAt)}</span>
          <span className="truncate text-[var(--text-support)]">{speedSummary}</span>
        </div>

        <div className="flex items-center justify-end gap-2">
          {!isDone && !isError && (
            <>
              {isPaused ? (
                <Tooltip content={t('downloads.tooltip.resume')}>
                  <button
                    onClick={() => void onResumeDownload(download.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
                  >
                    <Icon name="play_arrow" className="text-[16px]" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content={t('downloads.tooltip.pause')}>
                  <button
                    onClick={() => void onPauseDownload(download.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-[var(--surface)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
                  >
                    <Icon name="pause" className="text-[16px]" />
                  </button>
                </Tooltip>
              )}
              <Tooltip content={t('downloads.tooltip.cancel')}>
                <button
                  onClick={() => void onCancelDownload(download.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[rgb(248_113_113/0.18)] hover:text-[#ff9b9b]"
                >
                  <Icon name="close" className="text-[16px]" />
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
      className="relative h-14 overflow-hidden border-b border-[var(--border-subtle)]"
      style={{ background: installAppearance.rowTint }}
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
          boxShadow: `0 0 10px ${installAppearance.glow}`,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background: installAppearance.accent,
          boxShadow: `0 0 8px ${installAppearance.glow}`,
        }}
      />
      <div
        className="relative z-10 grid h-14 gap-4 pl-5 pr-5 py-[5px]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex min-w-0 flex-col justify-center gap-1 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium tracking-tight truncate text-[var(--text-primary-alt)]">
              {entry.name}
            </span>
          </div>
          <span
            className="truncate text-sm tabular-nums"
            style={{ color: installAppearance.accent }}
          >
            {progressDetail}
          </span>
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden">
          <span
            className="w-fit rounded-md border-0 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              color: installAppearance.accent,
              background: installAppearance.soft,
            }}
          >
            {installAppearance.label}
          </span>
          <span className="truncate text-sm tabular-nums text-[var(--text-primary-alt)]">
            {progressSummary}
          </span>
        </div>

        <div className="flex items-center text-sm tabular-nums text-[var(--text-primary-alt)]">
          {entry.version ?? '—'}
        </div>

        <div className="flex items-center pl-4 text-sm tabular-nums text-[var(--text-primary-alt)]">
          {formatSize(entry.size)}
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm tabular-nums">
          <span className="truncate text-[var(--text-primary-alt)]">{formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}</span>
          <span className="truncate text-[var(--text-support)]">{installAppearance.summary}</span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg border-0"
            style={{
              color: installAppearance.accent,
              background: installAppearance.soft,
            }}
          >
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
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
      className="relative h-14 overflow-hidden border-b border-[var(--border-subtle)]"
      style={{ background: deleteAppearance.rowTint }}
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
          boxShadow: `0 0 10px ${deleteAppearance.glow}`,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background: deleteAppearance.accent,
          boxShadow: `0 0 8px ${deleteAppearance.glow}`,
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
              className="shrink-0 rounded-md border-0 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{
                color: deleteAppearance.accent,
                background: deleteAppearance.soft,
              }}
            >
              {deleteLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center">
          <span
            className="shrink-0 rounded-md border-0 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              color: deleteAppearance.accent,
              background: deleteAppearance.soft,
            }}
          >
            {t('downloads.delete.label')}
          </span>
        </div>

        <div className="flex items-center text-sm tabular-nums text-[var(--text-primary-alt)]">
          {entry.version ?? '—'}
        </div>

        <div className="flex items-center pl-4 text-sm tabular-nums text-[var(--text-primary-alt)]">
          {formatSize(entry.size)}
        </div>

        <div className="flex flex-col justify-center gap-1 overflow-hidden text-sm tabular-nums">
          <span className="truncate text-[var(--text-primary-alt)]">{formatWindowsDateTime(entry.downloadedAt ?? entry.modifiedAt)}</span>
          <span className="truncate text-[#ffb4ab]">
            {deleteProgress > 0 ? `${deleteProgress}% · ${deleteSummary}` : deleteSummary}
          </span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg border-0"
            style={{
              color: deleteAppearance.accent,
              background: deleteAppearance.soft,
            }}
          >
            <Icon name="delete" className="animate-spin text-[16px]" />
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
      className="grid h-14 gap-4 pl-5 pr-5 py-[5px] border-b border-[var(--border-subtle)] relative overflow-hidden group cursor-default bg-transparent"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: isNew ? 'rgb(var(--accent-rgb)/0.14)' : 'rgb(var(--accent-rgb)/0.1)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: isNew ? 'var(--accent)' : 'rgb(var(--accent-rgb)/0.55)' }}
      />
      {isNew && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
          style={{ background: 'rgb(var(--accent-rgb)/0.4)' }}
        />
      )}

      <div className="flex items-center overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium tracking-tight truncate text-[var(--text-primary-alt)] group-hover:text-[var(--text-primary)] transition-colors">
            {entry.name}
          </span>
          {isNew && (
            <span className="shrink-0 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] bg-[var(--accent)] text-[var(--accent-foreground)] rounded-md">
              {t('downloads.badge.new')}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center">
        <span
          className={`shrink-0 rounded-md border-0 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] ${
            installedMod
              ? 'bg-[rgb(52_211_153/0.14)] text-[var(--status-success)]'
              : 'bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)]'
          }`}
        >
          {installedMod ? t('downloads.status.installed') : t('downloads.status.downloaded')}
        </span>
      </div>

      <div className="flex items-center text-sm tabular-nums text-[var(--text-support)] group-hover:text-[#c4c4c4] transition-colors">
        {entry.version ?? '—'}
      </div>

      <div className="flex items-center pl-4 text-sm tabular-nums text-[var(--text-support)] group-hover:text-[#c4c4c4] transition-colors">
        {formatSize(entry.size)}
      </div>

      <div className="flex items-center text-sm tabular-nums text-[var(--text-support)] group-hover:text-[#bdbdbd] transition-colors">
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
            className={`flex h-8 w-8 items-center justify-center rounded-lg border-0 transition-colors disabled:opacity-50 ${
              installedMod
                ? 'bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[rgb(var(--accent-rgb)/0.12)] hover:text-[var(--accent)]'
                : 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]'
            } disabled:hover:bg-[var(--surface)] disabled:hover:text-[var(--accent)]`}
          >
            <Icon name={installedMod ? 'restart_alt' : 'deployed_code'} className="text-[18px]" />
          </button>
        </Tooltip>
        <Tooltip content={t('downloads.tooltip.delete')}>
          <button
            onClick={(event) => {
              event.stopPropagation()
              onDeleteRequest(entry)
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-[rgb(248_113_113/0.13)] text-[var(--status-error)] transition-colors hover:bg-[var(--status-error)] hover:text-[#190505]"
          >
            <Icon name="delete" className="text-[16px]" />
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
