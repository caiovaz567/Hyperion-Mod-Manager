import React from 'react'
import type { ModMetadata } from '@shared/types'
import { DELETE_PROGRESS_APPEARANCE, getTransientDeleteProgress } from '../../utils/deleteProgressAppearance'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { LIBRARY_GRID_TEMPLATE } from './LibraryTableHeader'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

const clampPercent = (value: number, max = 100): number => Math.max(0, Math.min(value, max))

const getInstallDisplayName = (sourcePath: string, currentFile: string, targetName?: string): string => {
  if (targetName) return targetName

  const raw = currentFile || sourcePath
  if (!raw) return ''
  const normalized = raw.replace(/\//g, '\\')
  const parts = normalized.split('\\').filter(Boolean)
  return parts[parts.length - 1] ?? raw
}

const NestedProgressFrame: React.FC<React.PropsWithChildren<{ nested?: boolean }>> = ({
  children,
}) => (
  <div className="relative">
    {children}
  </div>
)

interface LibraryInstallProgressRowProps {
  nested?: boolean
  targetName?: string
  sourcePath: string
  progress: number
  status: string
  currentFile: string
}

export const LibraryInstallProgressRow: React.FC<LibraryInstallProgressRowProps> = ({
  nested = false,
  targetName,
  sourcePath,
  progress,
  status,
  currentFile,
}) => {
  const { t } = useTranslation()
  const appearance = getInstallProgressAppearance(status)
  const displayName = getInstallDisplayName(sourcePath, currentFile, targetName) || t('library.progress.installingMod')

  return (
    <NestedProgressFrame nested={nested}>
      <div
        className="relative h-[38px] overflow-hidden border-b-[0.5px]"
        style={{
          background: appearance.rowTint,
          borderColor: 'var(--bg-subtle)',
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 transition-all duration-500"
          style={{
            width: `${clampPercent(progress)}%`,
            background: appearance.fill,
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-[2px] transition-all duration-500"
          style={{
            left: `calc(${clampPercent(progress, 99.6)}% - 1px)`,
            background: appearance.accent,
            boxShadow: `0 0 10px ${appearance.accent}aa`,
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{
            background: appearance.accent,
            boxShadow: `0 0 8px ${appearance.accent}55`,
          }}
        />
        <div
          className="relative z-10 grid h-[38px] gap-4 pl-5 pr-5 py-[5px]"
          style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 flex items-center justify-center rounded-lg border-0"
                style={{ background: `${appearance.accent}18` }}
              >
                <Icon name="progress_activity" style={{ color: appearance.accent }} />
              </div>
            </div>
          </div>
          <div className="flex items-center text-[13px] font-mono text-[var(--text-support)]">
            ...
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium tracking-tight truncate text-[var(--text-primary-alt)]">
                {displayName}
              </span>
              <span
                className="shrink-0 rounded-md border-0 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  color: appearance.accent,
                  background: `${appearance.accent}18`,
                }}
              >
                {appearance.label}
              </span>
            </div>
            <span
              className="truncate text-[15px] font-mono tracking-tight"
              style={{ color: appearance.accent }}
            >
              {currentFile || appearance.detailFallback}
            </span>
          </div>
          <div className="flex items-center text-[15px] font-mono tracking-tight text-[var(--text-secondary)]">
            {progress > 0 ? `${progress}%` : '...'}
          </div>
          <div className="flex items-center">
            <span
              className="px-2.5 py-[3px] border-0 text-[10px] font-semibold uppercase tracking-[0.08em] rounded-md"
              style={{
                color: appearance.accent,
                background: `${appearance.accent}18`,
              }}
            >
              {appearance.label}
            </span>
          </div>
          <div className="flex items-center text-[15px] font-mono tracking-tight text-[var(--text-secondary)]">
            {status || appearance.summary}
          </div>
          <div className="flex items-center justify-start">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg border-0"
              style={{
                color: appearance.accent,
                background: `${appearance.accent}18`,
              }}
            >
              <Icon name="progress_activity" className="animate-spin text-[15px]" />
            </div>
          </div>
        </div>
      </div>
    </NestedProgressFrame>
  )
}

interface LibraryDeleteProgressRowProps {
  mod: ModMetadata
  nested?: boolean
  loadOrder?: number
  startedAt?: number
  tick: number
}

export const LibraryDeleteProgressRow: React.FC<LibraryDeleteProgressRowProps> = ({
  mod,
  nested = false,
  loadOrder,
  startedAt,
  tick,
}) => {
  const { t } = useTranslation()
  const appearance = DELETE_PROGRESS_APPEARANCE
  const progress = getTransientDeleteProgress(startedAt ?? tick, tick)
  const summary = mod.kind === 'separator'
    ? t('library.progress.removingSeparator')
    : t('library.progress.removingFiles')

  return (
    <NestedProgressFrame nested={nested}>
      <div
        className="relative h-[38px] overflow-hidden border-b-[0.5px]"
        style={{
          background: appearance.rowTint,
          borderColor: 'var(--bg-subtle)',
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 transition-all duration-500"
          style={{
            width: `${clampPercent(progress)}%`,
            background: appearance.fill,
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-[2px] transition-all duration-500"
          style={{
            left: `calc(${clampPercent(progress, 99.6)}% - 1px)`,
            background: appearance.accent,
            boxShadow: `0 0 10px ${appearance.accent}aa`,
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{
            background: appearance.accent,
            boxShadow: `0 0 8px ${appearance.accent}55`,
          }}
        />
        <div
          className="relative z-10 grid h-[38px] gap-4 pl-5 pr-5 py-[5px]"
          style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg border-0"
              style={{ background: `${appearance.accent}18` }}
            >
              <Icon name="progress_activity" className="animate-spin text-[15px]" style={{ color: appearance.accent }} />
            </div>
          </div>
          <div className="flex items-center text-[13px] font-mono text-[var(--text-secondary)]">
            {mod.kind === 'separator' ? '...' : loadOrder ?? '...'}
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="font-medium tracking-tight truncate text-[var(--status-error-text)]">
              {mod.name}
            </span>
            <span
              className="shrink-0 rounded-md border-0 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{
                color: appearance.accent,
                background: `${appearance.accent}18`,
              }}
            >
              {t('library.progress.deleting')}
            </span>
          </div>
          <div className="flex items-center text-[15px] font-mono tracking-tight text-[var(--text-secondary)]">
            {progress > 0 ? `${progress}%` : '...'}
          </div>
          <div className="flex items-center">
            <span
              className="px-2.5 py-[3px] border-0 text-[10px] font-semibold uppercase tracking-[0.08em] rounded-md truncate"
              style={{
                color: appearance.accent,
                background: `${appearance.accent}18`,
              }}
            >
              {mod.kind === 'separator' ? t('library.progress.deleting') : t('library.progress.deletingMod')}
            </span>
          </div>
          <div className="flex items-center min-w-0 text-[15px] font-mono tracking-tight text-[var(--status-error-text)]">
            <span className="truncate">{summary}</span>
          </div>
          <div className="flex items-center justify-start">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg border-0"
              style={{
                color: appearance.accent,
                background: `${appearance.accent}18`,
              }}
            >
              <Icon name="delete" className="animate-spin text-[15px]" />
            </div>
          </div>
        </div>
      </div>
    </NestedProgressFrame>
  )
}
