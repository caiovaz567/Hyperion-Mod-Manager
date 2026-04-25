import React from 'react'
import type { ModMetadata } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { Tooltip } from '../ui/Tooltip'
import { formatWindowsDateTime } from '../../utils/dateFormat'

interface ModRowProps {
  mod: ModMetadata
  index: number
  selected: boolean
  nested?: boolean
  animateOnEnter?: boolean
  dragging?: boolean
  dragEnabled?: boolean
  separatorDropTarget?: boolean
  separatorCollapsed?: boolean
  separatorChildCount?: number
  separatorMoveHint?: string | null
  rowDropPosition?: 'before' | 'after' | null
  onSelect: (event: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent, mod: ModMetadata) => void
  onRename: (mod: ModMetadata) => void
  onDelete: (mod: ModMetadata) => void
  onOpenDetails: (mod: ModMetadata, initialTab?: 'files' | 'conflicts') => void
  isRenaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  onDragStart?: (event: React.DragEvent, mod: ModMetadata) => void
  onDragEnd?: (event: React.DragEvent, mod: ModMetadata) => void
  onRowDragOver?: (event: React.DragEvent, mod: ModMetadata) => void
  onRowDragLeave?: (event: React.DragEvent, mod: ModMetadata) => void
  onRowDrop?: (event: React.DragEvent, mod: ModMetadata) => void
  onSeparatorDragOver?: (event: React.DragEvent, separator: ModMetadata) => void
  onSeparatorDragLeave?: (event: React.DragEvent, separator: ModMetadata) => void
  onSeparatorDrop?: (event: React.DragEvent, separator: ModMetadata) => void
}

const TYPE_COLOR: Record<string, string> = {
  archive: '#60A5FA',
  redmod: '#34D399',
  cet: '#40dbdb',
  redscript: '#A78BFA',
  tweakxl: '#fbbf24',
  red4ext: '#F87171',
  bin: '#94A3B8',
  engine: '#C084FC',
  r6: '#60A5FA',
  unknown: '#64748B',
}

const TYPE_LABEL: Record<string, string> = {
  archive: 'ARCHIVE',
  redmod: 'REDMOD',
  cet: 'CET',
  redscript: 'REDSCRIPT',
  tweakxl: 'TWEAKXL',
  red4ext: 'RED4EXT',
  bin: 'BINARY',
  engine: 'ENGINE',
  r6: 'R6SCRIPTS',
  unknown: 'UNKNOWN',
}

const ACTIVE_COLOR = '#fcee09'
const NESTED_ACCENT_COLOR = '#4fd8ff'

export const ModRow: React.FC<ModRowProps> = ({
  mod,
  index,
  selected,
  nested = false,
  animateOnEnter = false,
  dragging = false,
  dragEnabled = false,
  separatorDropTarget = false,
  separatorCollapsed = false,
  separatorChildCount = 0,
  separatorMoveHint = null,
  rowDropPosition = null,
  onSelect,
  onContextMenu,
  onOpenDetails,
  onRename,
  onDelete,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSave,
  onRenameCancel,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  onSeparatorDragOver,
  onSeparatorDragLeave,
  onSeparatorDrop,
}) => {
  const { enableMod, disableMod, addToast, recentBadge, conflictHighlight } = useAppStore((state) => ({
    enableMod: state.enableMod,
    disableMod: state.disableMod,
    addToast: state.addToast,
    recentBadge: state.recentLibraryBadges[mod.uuid],
    conflictHighlight: state.conflictHighlight,
  }), shallow)

  if (mod.kind === 'separator') {
    return (
      <div
        data-mod-row="true"
        draggable={dragEnabled && !isRenaming}
        onDragStart={(event) => onDragStart?.(event, mod)}
        onDragEnd={(event) => onDragEnd?.(event, mod)}
        onClick={onSelect}
        onContextMenu={(event) => onContextMenu(event, mod)}
        onDragOver={(event) => onSeparatorDragOver?.(event, mod)}
        onDragLeave={(event) => onSeparatorDragLeave?.(event, mod)}
        onDrop={(event) => onSeparatorDrop?.(event, mod)}
        className={`group relative overflow-hidden border-b-[0.5px] border-[#1a1a1a] transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ${
          separatorDropTarget
            ? 'bg-[#04141b] shadow-[inset_0_0_0_1px_rgba(79,216,255,0.34)]'
            : selected
              ? 'bg-[#0b0f11]'
              : 'bg-[#070707] hover:border-[#19333c] hover:bg-[#0c1114] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(79,216,255,0.14)]'
        } ${dragEnabled ? 'cursor-default active:cursor-grabbing' : ''} ${dragging ? 'opacity-45 translate-x-1' : ''}`}
      >
        {rowDropPosition ? (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 z-20 h-[2px] ${
              rowDropPosition === 'before' ? 'top-0' : 'bottom-0'
            }`}
            style={{
              background: '#4fd8ff',
              boxShadow: '0 0 10px rgba(79,216,255,0.55)',
            }}
          />
        ) : null}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-px opacity-70 transition-opacity duration-150 group-hover:opacity-100"
          style={{
            background: separatorDropTarget
              ? 'rgba(79,216,255,0.7)'
              : 'rgba(79,216,255,0.28)',
            boxShadow: separatorDropTarget ? '0 0 8px rgba(79,216,255,0.28)' : 'none',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] transition-[background-color,box-shadow] duration-150"
          style={{
            background: separatorDropTarget ? '#4fd8ff' : 'rgba(79,216,255,0.72)',
            boxShadow: separatorDropTarget ? '0 0 10px rgba(79,216,255,0.45)' : '0 0 10px rgba(79,216,255,0.16)',
          }}
        />
        {!separatorDropTarget && !selected ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            style={{
              background: 'linear-gradient(90deg, rgba(79,216,255,0.08) 0%, rgba(79,216,255,0.03) 18%, rgba(255,255,255,0.012) 38%, rgba(255,255,255,0) 68%)',
            }}
          />
        ) : null}
        <div className="relative flex h-[40px] items-center justify-between gap-6 px-5">
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => onRenameChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onBlur={onRenameSave}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRenameSave()
                if (event.key === 'Escape') onRenameCancel()
              }}
              className="allow-text-selection h-9 min-w-[220px] max-w-[340px] border-[0.5px] border-[#3d3d3d] bg-[#0a0a0a] px-3 text-[13px] brand-font font-bold uppercase tracking-[0.14em] leading-none text-white focus:border-[#4fd8ff]/55 focus:outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-3 pl-[32px]">
              <span className={`absolute left-[16px] top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-[#8fb8c4] transition-[transform,color] duration-200 group-hover:text-[#dff7ff] ${
                separatorCollapsed ? '-rotate-90' : 'rotate-0'
              }`}>
                expand_more
              </span>
              <span
                aria-hidden="true"
                className="h-[8px] w-[8px] shrink-0 rounded-full transition-[background-color,box-shadow] duration-150"
                style={{
                  background: '#4fd8ff',
                  boxShadow: separatorDropTarget ? '0 0 10px rgba(79,216,255,0.45)' : '0 0 8px rgba(79,216,255,0.2)',
                }}
              />
              <span
                className={`truncate text-[13px] brand-font font-bold uppercase tracking-[0.14em] transition-colors duration-150 ${
                  separatorDropTarget
                    ? 'text-[#4fd8ff]'
                    : selected
                      ? 'text-[#ffffff]'
                      : 'text-[#f2f2f2] group-hover:text-[#ffffff]'
                }`}
              >
                {mod.name}
              </span>
              {separatorChildCount > 0 ? (
                <span className="shrink-0 rounded-sm border-[0.5px] border-[#202a2e] bg-[#0a0d0f] px-2 py-[3px] text-[11px] font-mono uppercase tracking-[0.12em] text-[#8aa6af] transition-colors duration-150 group-hover:border-[#29444e] group-hover:text-[#c6edf8]">
                  {separatorChildCount} {separatorChildCount === 1 ? 'mod' : 'mods'}
                </span>
              ) : null}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3">
              {separatorMoveHint ? (
                <span
                  className={`rounded-sm border-[0.5px] px-2.5 py-[4px] text-[11px] brand-font font-bold uppercase tracking-[0.14em] ${
                    separatorDropTarget
                    ? 'border-[#4fd8ff]/45 bg-[#04131b] text-[#4fd8ff]'
                    : 'border-[#2a2a2a] bg-[#0a0a0a] text-[#a4a4a4]'
                }`}
              >
                {separatorDropTarget ? 'Drop Selected Here' : separatorMoveHint}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  const color = TYPE_COLOR[mod.type] ?? '#64748B'
  const label = TYPE_LABEL[mod.type] ?? 'UNKNOWN'
  const rowAccentColor = nested ? NESTED_ACCENT_COLOR : ACTIVE_COLOR
  const conflictSummary = mod.conflictSummary ?? { overwrites: 0, overwrittenBy: 0 }
  const hasConflictSummary = conflictSummary.overwrites > 0 || conflictSummary.overwrittenBy > 0
  const conflictTooltipContent = [
    conflictSummary.overwrites > 0 ? `Wins ${conflictSummary.overwrites} file${conflictSummary.overwrites === 1 ? '' : 's'}` : null,
    conflictSummary.overwrittenBy > 0 ? `Loses ${conflictSummary.overwrittenBy} file${conflictSummary.overwrittenBy === 1 ? '' : 's'}` : null,
    'Click to inspect conflicts.',
  ].filter(Boolean).join(' · ')
  const isConflictFocused = conflictHighlight.active && conflictHighlight.focusModId === mod.uuid
  const isWinHighlighted = conflictHighlight.active && conflictHighlight.wins.includes(mod.uuid)
  const isLossHighlighted = conflictHighlight.active && conflictHighlight.losses.includes(mod.uuid)
  const conflictTone = isConflictFocused
    ? 'focus'
    : isWinHighlighted && isLossHighlighted
      ? 'mixed'
      : isWinHighlighted
        ? 'win'
        : isLossHighlighted
          ? 'loss'
          : 'none'

  const baseRowBackgroundClass = selected
    ? 'bg-[#0a0a0a]'
    : mod.enabled
      ? index % 2 === 0
        ? 'bg-[#050505] hover:bg-[#141414]'
        : 'bg-[#0a0a0a] hover:bg-[#161616]'
      : index % 2 === 0
        ? 'bg-[#040404] hover:bg-[#101010]'
        : 'bg-[#080808] hover:bg-[#121212]'
  const rowBackgroundClass = conflictTone === 'focus'
    ? 'bg-[rgba(252,238,9,0.1)]'
    : conflictTone === 'win'
      ? 'bg-[rgba(52,211,153,0.1)]'
      : conflictTone === 'loss'
        ? 'bg-[rgba(248,113,113,0.1)]'
        : conflictTone === 'mixed'
          ? 'bg-[rgba(252,238,9,0.08)]'
          : baseRowBackgroundClass
  const rowHoverClass = conflictTone === 'focus'
    ? 'hover:border-[#5a5714] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_0_1px_rgba(252,238,9,0.12)]'
    : conflictTone === 'win'
      ? 'hover:border-[#1f5133] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.035),inset_0_0_0_1px_rgba(52,211,153,0.11)]'
      : conflictTone === 'loss'
        ? 'hover:border-[#5a2020] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(248,113,113,0.1)]'
        : conflictTone === 'mixed'
          ? 'hover:border-[#4b470d] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(252,238,9,0.1)]'
          : mod.enabled
            ? 'hover:border-[#363636] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.025),inset_0_0_0_1px_rgba(252,238,9,0.09)]'
            : 'hover:border-[#2c2c2c] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
  const selectedRingClass = conflictTone === 'focus'
    ? 'ring-1 ring-inset ring-[#fcee09]/42'
    : selected
      ? 'ring-1 ring-inset ring-[#fcee09]/50'
      : ''
  const hoverGradient = conflictTone === 'focus'
    ? 'linear-gradient(90deg, rgba(252,238,9,0.12) 0%, rgba(252,238,9,0.05) 18%, rgba(255,255,255,0.012) 34%, rgba(255,255,255,0) 66%)'
    : conflictTone === 'win'
      ? 'linear-gradient(90deg, rgba(52,211,153,0.12) 0%, rgba(52,211,153,0.045) 18%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 68%)'
      : conflictTone === 'loss'
        ? 'linear-gradient(90deg, rgba(248,113,113,0.12) 0%, rgba(248,113,113,0.045) 18%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 68%)'
        : conflictTone === 'mixed'
          ? 'linear-gradient(90deg, rgba(252,238,9,0.11) 0%, rgba(252,238,9,0.04) 18%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 68%)'
          : mod.enabled
            ? 'linear-gradient(90deg, rgba(252,238,9,0.08) 0%, rgba(252,238,9,0.036) 15%, rgba(255,255,255,0.018) 34%, rgba(255,255,255,0) 66%)'
            : 'linear-gradient(90deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 20%, rgba(255,255,255,0) 62%)'
  const indexTextClass = conflictTone === 'none'
    ? 'text-[#8a8a8a] group-hover:text-[#d0d0d0]'
    : 'text-[#c9c9c9]'
  const primaryTextClass = mod.enabled
    ? conflictTone === 'focus'
      ? 'text-[#fcee09]'
      : conflictTone === 'none'
        ? 'text-[#e5e2e1] group-hover:text-[#ffffff]'
        : 'text-[#f2f2f2]'
    : conflictTone === 'none'
      ? 'text-[#8a8a8a] line-through group-hover:text-[#b0b0b0]'
      : 'text-[#b9b9b9] line-through'
  const secondaryTextClass = conflictTone === 'none'
    ? 'text-[#9a9a9a] group-hover:text-[#c4c4c4]'
    : 'text-[#c7c7c7]'
  const typeChipClass = conflictTone === 'none'
    ? 'bg-[#111] border-[#222] group-hover:border-[#343434]'
    : 'bg-[rgba(17,17,17,0.84)] border-[rgba(255,255,255,0.09)]'
  const leftRailColor = conflictTone === 'focus'
    ? '#FCEE09'
    : conflictTone === 'win'
      ? '#34D399'
      : conflictTone === 'loss'
        ? '#F87171'
        : conflictTone === 'mixed'
          ? '#FCEE09'
          : rowAccentColor
  const leftRailShadow = conflictTone === 'focus'
    ? '0 0 12px rgba(252,238,9,0.24)'
    : conflictTone === 'win'
      ? '0 0 12px rgba(52,211,153,0.24)'
      : conflictTone === 'loss'
        ? '0 0 12px rgba(248,113,113,0.24)'
        : conflictTone === 'mixed'
          ? '0 0 12px rgba(252,238,9,0.2)'
          : `0 0 10px ${rowAccentColor}55`

  const handleToggle = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const result = mod.enabled ? await disableMod(mod.uuid) : await enableMod(mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Operation failed', 'error')
  }

  return (
    <div className={`relative ${nested ? 'pl-6' : ''} ${animateOnEnter ? 'fade-up' : ''}`}>
      <div
        data-mod-row="true"
        draggable={dragEnabled && !isRenaming}
        onDragStart={(event) => onDragStart?.(event, mod)}
        onDragEnd={(event) => onDragEnd?.(event, mod)}
        onDragOver={(event) => onRowDragOver?.(event, mod)}
        onDragLeave={(event) => onRowDragLeave?.(event, mod)}
        onDrop={(event) => onRowDrop?.(event, mod)}
        onClick={onSelect}
        onDoubleClick={() => onOpenDetails(mod)}
        onContextMenu={(event) => onContextMenu(event, mod)}
        className={`library-mod-row grid h-[38px] gap-4 pl-5 pr-5 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ${rowBackgroundClass} ${rowHoverClass} ${selectedRingClass} ${
          dragEnabled ? 'active:cursor-grabbing' : ''
        } ${dragging ? 'opacity-45 translate-x-1' : ''}`}
        style={{
          gridTemplateColumns: '64px 56px minmax(320px,1fr) 110px 156px 184px 96px',
        }}
      >
        {rowDropPosition ? (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 z-20 h-[2px] ${
              rowDropPosition === 'before' ? 'top-0' : 'bottom-0'
            }`}
            style={{
              background: '#4fd8ff',
              boxShadow: '0 0 10px rgba(79,216,255,0.55)',
            }}
          />
        ) : null}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{ background: hoverGradient }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{ background: conflictTone === 'none' ? `${rowAccentColor}88` : `${leftRailColor}aa` }}
        />

        <div className="flex items-center pl-2" onClick={handleToggle}>
          <div
            className={`relative h-4 w-8 rounded-full border-[0.5px] transition-all ${
              mod.enabled
                ? 'border-[#fcee09]/45 bg-[#2a2604] group-hover:border-[#fcee09]/65'
                : 'border-[#222] bg-[#111] group-hover:border-[#333]'
            }`}
          >
            <div
              className={`absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full ${
                mod.enabled
                  ? 'right-[1px] bg-[#fcee09]'
                  : 'left-[1px] bg-[#7a7a7a]'
              }`}
            />
          </div>
        </div>

        <div className={`flex items-center text-[12px] font-mono transition-colors ${indexTextClass}`}>
          {index}
        </div>

        <div className="flex flex-col justify-center gap-0.5 overflow-hidden">
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => onRenameChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRenameSave()
                if (event.key === 'Escape') onRenameCancel()
              }}
              className="allow-text-selection h-8 w-full border-[0.5px] border-[#333] bg-[#0a0a0a] px-3 font-medium tracking-tight leading-none text-white focus:border-[#fcee09]/50 focus:outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`font-medium tracking-tight truncate transition-colors ${primaryTextClass}`}
                >
                  {mod.name}
                </span>
              </div>
              {recentBadge ? (
                <span
                  className="shrink-0 rounded-sm border-[0.5px] px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                  style={{
                    color: recentBadge === 'downgraded'
                      ? '#f87171'
                      : recentBadge === 'updated'
                        ? '#60a5fa'
                        : '#34d399',
                    borderColor: recentBadge === 'downgraded'
                      ? 'rgba(248,113,113,0.35)'
                      : recentBadge === 'updated'
                        ? 'rgba(96,165,250,0.35)'
                        : 'rgba(52,211,153,0.35)',
                    background: recentBadge === 'downgraded'
                      ? 'rgba(248,113,113,0.12)'
                      : recentBadge === 'updated'
                        ? 'rgba(96,165,250,0.12)'
                        : 'rgba(52,211,153,0.12)',
                  }}
                >
                  {recentBadge === 'downgraded' ? 'Downgraded' : recentBadge === 'updated' ? 'Updated' : 'Installed'}
                </span>
              ) : null}
              {hasConflictSummary ? (
                <Tooltip content={conflictTooltipContent} side="bottom" variant="help">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenDetails(mod, 'conflicts')
                    }}
                    className="inline-flex shrink-0 items-center justify-center"
                  >
                    <span
                      className="material-symbols-outlined text-[16px]"
                      style={{
                        color: conflictSummary.overwrittenBy > 0 && conflictSummary.overwrites > 0
                          ? '#fcee09'
                          : conflictSummary.overwrittenBy > 0
                            ? '#f87171'
                            : '#34d399',
                      }}
                    >
                      warning
                    </span>
                  </button>
                </Tooltip>
              ) : null}
            </div>
          )}
        </div>

        <div className={`flex items-center text-sm font-mono tracking-tight transition-colors ${secondaryTextClass}`}>
          {mod.version ?? '—'}
        </div>

        <div className="flex items-center">
          <span
            className={`px-2.5 py-[3px] border-[0.5px] text-[10px] uppercase tracking-widest rounded-sm transition-colors ${typeChipClass}`}
            style={{ color }}
          >
            {label}
          </span>
        </div>

        <div className={`flex items-center text-sm font-mono tracking-tight transition-colors ${secondaryTextClass}`}>
          {formatWindowsDateTime(mod.installedAt)}
        </div>

        <div className="flex items-center justify-end gap-2">
          {isRenaming ? (
            <>
              <Tooltip content="Save name">
                <button
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRenameSave()
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#2b4f2f] bg-[#0a0a0a] text-[#6fe3b1] hover:border-[#6fe3b1]/45 transition-all"
                >
                  <span className="material-symbols-outlined text-[15px]">check</span>
                </button>
              </Tooltip>
              <Tooltip content="Cancel rename">
                <button
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRenameCancel()
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#9a9a9a] hover:border-[#8a8a8a] hover:text-white transition-all"
                >
                  <span className="material-symbols-outlined text-[15px]">close</span>
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content="Rename mod">
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    onRename(mod)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#fcee09]/45 hover:text-[#fcee09] transition-all"
                >
                  <span className="material-symbols-outlined text-[15px]">edit</span>
                </button>
              </Tooltip>
              <Tooltip content="Remove mod">
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    onDelete(mod)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#3a1010] bg-[#0d0404] text-[#f18d8d] transition-colors hover:border-[#f87171] hover:bg-[#1a0505] hover:text-[#ffe1e1]"
                >
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                </button>
              </Tooltip>
            </>
          )}
        </div>

        {(mod.enabled || conflictTone !== 'none') && (
          <div
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ background: leftRailColor, boxShadow: leftRailShadow }}
          />
        )}
      </div>
    </div>
  )
}

function areModRowPropsEqual(prev: ModRowProps, next: ModRowProps): boolean {
  return (
    prev.mod === next.mod &&
    prev.index === next.index &&
    prev.selected === next.selected &&
    prev.nested === next.nested &&
    prev.animateOnEnter === next.animateOnEnter &&
    prev.dragging === next.dragging &&
    prev.dragEnabled === next.dragEnabled &&
    prev.separatorDropTarget === next.separatorDropTarget &&
    prev.separatorCollapsed === next.separatorCollapsed &&
    prev.separatorChildCount === next.separatorChildCount &&
    prev.separatorMoveHint === next.separatorMoveHint &&
    prev.rowDropPosition === next.rowDropPosition &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue
  )
}

export const MemoModRow = React.memo(ModRow, areModRowPropsEqual)
