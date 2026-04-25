import React from 'react'
import type { ModMetadata } from '@shared/types'
import { DELETE_PROGRESS_APPEARANCE, getTransientDeleteProgress } from '../../utils/deleteProgressAppearance'
import { getInstallProgressAppearance } from '../../utils/installProgressAppearance'
import { LIBRARY_GRID_TEMPLATE } from './LibraryTableHeader'

const clampPercent = (value: number, max = 100): number => Math.max(0, Math.min(value, max))

const getInstallDisplayName = (sourcePath: string, currentFile: string, targetName?: string): string => {
  if (targetName) return targetName

  const raw = currentFile || sourcePath
  if (!raw) return 'Installing mod'
  const normalized = raw.replace(/\//g, '\\')
  const parts = normalized.split('\\').filter(Boolean)
  return parts[parts.length - 1] ?? raw
}

const NestedProgressFrame: React.FC<React.PropsWithChildren<{ nested?: boolean }>> = ({
  nested = false,
  children,
}) => (
  <div className={`relative ${nested ? 'pl-6' : ''}`}>
    {nested ? (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-[12px] top-0 w-px"
        style={{
          background: 'linear-gradient(180deg, rgba(79,216,255,0.12), rgba(79,216,255,0.34), rgba(79,216,255,0.12))',
        }}
      />
    ) : null}
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
  const appearance = getInstallProgressAppearance(status)
  const displayName = getInstallDisplayName(sourcePath, currentFile, targetName)

  return (
    <NestedProgressFrame nested={nested}>
      <div
        className="relative h-[38px] overflow-hidden border-b-[0.5px]"
        style={{
          background: appearance.rowTint,
          borderColor: appearance.softBorder,
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
                className="h-8 w-8 flex items-center justify-center rounded-sm border-[0.5px]"
                style={{ borderColor: `${appearance.accent}22`, background: `${appearance.accent}08` }}
              >
                <span className="material-symbols-outlined" style={{ color: appearance.accent }}>
                  progress_activity
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center text-[12px] font-mono text-[#9a9a9a]">
            ...
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium tracking-tight truncate text-[#e5e2e1]">
                {displayName}
              </span>
              <span
                className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                style={{
                  color: appearance.accent,
                  borderColor: `${appearance.accent}55`,
                  background: `${appearance.accent}12`,
                }}
              >
                {appearance.label}
              </span>
            </div>
            <span
              className="truncate text-sm font-mono tracking-tight"
              style={{ color: appearance.accent }}
            >
              {currentFile || appearance.detailFallback}
            </span>
          </div>
          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
            {progress > 0 ? `${progress}%` : '...'}
          </div>
          <div className="flex items-center">
            <span
              className="px-2.5 py-[3px] border-[0.5px] text-[10px] uppercase tracking-widest rounded-sm"
              style={{
                color: appearance.accent,
                borderColor: `${appearance.accent}40`,
                background: '#0a0a0a',
              }}
            >
              {appearance.label}
            </span>
          </div>
          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
            {status || appearance.summary}
          </div>
          <div className="flex items-center justify-end">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
              style={{
                borderColor: `${appearance.accent}44`,
                color: appearance.accent,
              }}
            >
              <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
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
  const appearance = DELETE_PROGRESS_APPEARANCE
  const progress = getTransientDeleteProgress(startedAt ?? tick, tick)
  const summary = mod.kind === 'separator'
    ? 'Removing separator from library'
    : 'Removing files from disk'

  return (
    <NestedProgressFrame nested={nested}>
      <div
        className="relative h-[38px] overflow-hidden border-b-[0.5px]"
        style={{
          background: appearance.rowTint,
          borderColor: appearance.softBorder,
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
              className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px]"
              style={{ borderColor: `${appearance.accent}22`, background: `${appearance.accent}08` }}
            >
              <span
                className="material-symbols-outlined animate-spin text-[15px]"
                style={{ color: appearance.accent }}
              >
                progress_activity
              </span>
            </div>
          </div>
          <div className="flex items-center text-[12px] font-mono text-[#d8d8d8]">
            {mod.kind === 'separator' ? '...' : loadOrder ?? '...'}
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="font-medium tracking-tight truncate text-[#ffe1e1]">
              {mod.name}
            </span>
            <span
              className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
              style={{
                color: appearance.accent,
                borderColor: `${appearance.accent}55`,
                background: `${appearance.accent}12`,
              }}
            >
              {appearance.label}
            </span>
          </div>
          <div className="flex items-center text-sm font-mono tracking-tight text-[#d8d8d8]">
            {progress > 0 ? `${progress}%` : '...'}
          </div>
          <div className="flex items-center">
            <span
              className="px-2.5 py-[3px] border-[0.5px] text-[10px] uppercase tracking-widest rounded-sm truncate"
              style={{
                color: appearance.accent,
                borderColor: `${appearance.accent}40`,
                background: '#0a0a0a',
              }}
            >
              {mod.kind === 'separator' ? 'Deleting' : 'Deleting mod'}
            </span>
          </div>
          <div className="flex items-center min-w-0 text-sm font-mono tracking-tight text-[#ffb4ab]">
            <span className="truncate">{summary}</span>
          </div>
          <div className="flex items-center justify-end">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]/90"
              style={{
                borderColor: `${appearance.accent}44`,
                color: appearance.accent,
              }}
            >
              <span className="material-symbols-outlined animate-spin text-[15px]">delete</span>
            </div>
          </div>
        </div>
      </div>
    </NestedProgressFrame>
  )
}
