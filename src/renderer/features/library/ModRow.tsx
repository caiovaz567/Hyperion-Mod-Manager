import React from 'react'
import type { ModMetadata } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { Tooltip } from '../ui/Tooltip'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { getModCategoryLabel } from '../../utils/modCategoryDisplay'
import { LIBRARY_GRID_TEMPLATE } from './LibraryTableHeader'

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

const ACTIVE_COLOR = '#fcee09'
const NESTED_ACCENT_COLOR = '#2f3f45'

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
  const {
    enableMod,
    disableMod,
    addToast,
    recentBadge,
    conflictHighlight,
    modUpdate,
    updateMod,
    activeDownloads,
    detecting,
    installing,
    installTargetModId,
  } = useAppStore((state) => ({
    enableMod: state.enableMod,
    disableMod: state.disableMod,
    addToast: state.addToast,
    recentBadge: state.recentLibraryBadges[mod.uuid],
    conflictHighlight: state.conflictHighlight,
    modUpdate: state.modUpdates[mod.uuid],
    updateMod: state.updateMod,
    activeDownloads: state.activeDownloads,
    detecting: state.detecting,
    installing: state.installing,
    installTargetModId: state.installTargetModId,
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
              className="allow-text-selection h-9 w-full border-[0.5px] border-[#3d3d3d] bg-[#0a0a0a] px-3 text-[13px] font-semibold tracking-[0.01em] leading-none text-white focus:border-[#4fd8ff]/55 focus:outline-none"
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
                className={`truncate text-[13px] font-semibold tracking-[0.01em] transition-colors duration-150 ${
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
                <span className="shrink-0 rounded-sm border-0 bg-[#101719] px-2 py-[3px] text-[11px] font-mono uppercase tracking-[0.12em] text-[#8aa6af] transition-colors duration-150 group-hover:bg-[#142024] group-hover:text-[#c6edf8]">
                  {separatorChildCount} {separatorChildCount === 1 ? 'mod' : 'mods'}
                </span>
              ) : null}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3">
              {separatorMoveHint ? (
                <span
                  className={`rounded-sm border-0 px-2.5 py-[4px] text-[11px] brand-font font-bold uppercase tracking-[0.14em] ${
                    separatorDropTarget
                    ? 'bg-[rgba(79,216,255,0.13)] text-[#7fe6ff]'
                    : 'bg-[#151515] text-[#a4a4a4]'
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

  const categoryLabel = getModCategoryLabel(mod)
  const rowAccentColor = nested ? NESTED_ACCENT_COLOR : ACTIVE_COLOR
  const conflictSummary = mod.conflictSummary ?? { overwrites: 0, overwrittenBy: 0, redundant: false }
  const isRedundant = mod.enabled && Boolean(conflictSummary.redundant)
  // Conflicts only exist between enabled mods in the active deployment stack — a disabled
  // mod deploys nothing, so its conflict icon would be misleading.
  const hasConflictSummary = mod.enabled && (conflictSummary.overwrites > 0 || conflictSummary.overwrittenBy > 0 || isRedundant)
  const hasModUpdate = modUpdate?.state === 'update-available'
  const updatingThisMod =
    activeDownloads.some((download) => download.intent?.kind === 'mod-update' && download.intent.targetModId === mod.uuid) ||
    ((detecting || installing) && installTargetModId === mod.uuid)
  const modUpdateTooltip = [
    modUpdate?.currentVersion ? `Installed: ${modUpdate.currentVersion}` : null,
    modUpdate?.latestVersion ? `Latest: ${modUpdate.latestVersion}` : null,
    updatingThisMod ? 'Updating in the library.' : 'New version on Nexus. Click to update.',
  ].filter(Boolean).join(' · ')
  const conflictAriaLabel = [
    conflictSummary.overwrites > 0 ? `Overwrites ${conflictSummary.overwrites} file${conflictSummary.overwrites === 1 ? '' : 's'}` : null,
    conflictSummary.overwrittenBy > 0 ? `Overwritten by ${conflictSummary.overwrittenBy} file${conflictSummary.overwrittenBy === 1 ? '' : 's'}` : null,
    isRedundant ? 'Redundant: every deployed file is overwritten.' : null,
    'Click to inspect conflicts.',
  ].filter(Boolean).join(' · ')
  const conflictTooltipContent = (
    <div className="flex min-w-[210px] flex-col gap-1.5">
      {conflictSummary.overwrites > 0 ? (
        <div className="flex items-center gap-2 text-[#34d399]">
          <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-sm bg-[rgba(52,211,153,0.14)] px-1.5 font-mono text-[11px] font-bold leading-none">
            +{conflictSummary.overwrites}
          </span>
          <span>Overwrites {conflictSummary.overwrites} file{conflictSummary.overwrites === 1 ? '' : 's'}</span>
        </div>
      ) : null}
      {conflictSummary.overwrittenBy > 0 ? (
        <div className="flex items-center gap-2 text-[#f87171]">
          <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-sm bg-[rgba(248,113,113,0.14)] px-1.5 font-mono text-[11px] font-bold leading-none">
            -{conflictSummary.overwrittenBy}
          </span>
          <span>Overwritten by {conflictSummary.overwrittenBy} file{conflictSummary.overwrittenBy === 1 ? '' : 's'}</span>
        </div>
      ) : null}
      {isRedundant ? (
        <div className="flex items-center gap-2 text-[#fcee09]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-[rgba(252,238,9,0.14)] font-mono text-[12px] font-bold leading-none">
            !
          </span>
          <span>Redundant: fully overwritten</span>
        </div>
      ) : null}
      <div className="border-t border-[#242424] pt-1 text-[#858585]">
        Click to inspect conflicts
      </div>
    </div>
  )
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
    <div className={`relative ${animateOnEnter ? 'fade-up' : ''}`}>
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
        className={`library-mod-row grid h-[38px] w-full gap-4 pl-5 pr-5 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ${rowBackgroundClass} ${rowHoverClass} ${selectedRingClass} ${
          dragEnabled ? 'active:cursor-grabbing' : ''
        } ${dragging ? 'opacity-45 translate-x-1' : ''}`}
        style={{
          gridTemplateColumns: LIBRARY_GRID_TEMPLATE,
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
            className={`relative h-4 w-8 rounded-full border-0 transition-all ${
              mod.enabled
                ? 'bg-[rgba(252,238,9,0.28)]'
                : 'bg-[#1d1d1d] group-hover:bg-[#262626]'
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
                  className="shrink-0 rounded-sm border-0 px-1.5 py-[2px] text-[9px] brand-font font-bold uppercase tracking-widest"
                  style={{
                    color: recentBadge === 'downgraded'
                      ? '#f87171'
                      : recentBadge === 'updated'
                        ? '#60a5fa'
                        : '#34d399',
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
                    className="inline-flex shrink-0 items-center gap-1"
                    aria-label={conflictAriaLabel}
                  >
                    {conflictSummary.overwrites > 0 && (
                      <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-sm bg-[rgba(52,211,153,0.12)] px-1.5 font-mono text-[11px] font-bold leading-none tracking-tight text-[#34d399]">
                        +{conflictSummary.overwrites}
                      </span>
                    )}
                    {conflictSummary.overwrittenBy > 0 && (
                      <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-sm bg-[rgba(248,113,113,0.12)] px-1.5 font-mono text-[11px] font-bold leading-none tracking-tight text-[#f87171]">
                        -{conflictSummary.overwrittenBy}
                      </span>
                    )}
                    {isRedundant && (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-[rgba(252,238,9,0.12)] text-[#fcee09]">
                        <span className="material-symbols-outlined text-[15px] leading-none">priority_high</span>
                      </span>
                    )}
                  </button>
                </Tooltip>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm font-mono tracking-tight">
          <span className={`truncate transition-colors ${hasModUpdate ? 'text-[#f87171]' : secondaryTextClass}`}>
            {mod.version ?? '—'}
          </span>
          {hasModUpdate ? (
            <Tooltip content={modUpdateTooltip} side="bottom" variant="help">
              <button
                type="button"
                disabled={updatingThisMod}
                onClick={(event) => {
                  event.stopPropagation()
                  if (updatingThisMod) return
                  void updateMod(mod.uuid)
                }}
                className="inline-flex shrink-0 items-center justify-center text-[#4fd8ff] transition-colors hover:text-[#c6f4ff] disabled:cursor-wait disabled:text-[#8fb8c4]"
              >
                <span className={`material-symbols-outlined text-[16px] ${updatingThisMod ? 'animate-spin' : ''}`}>
                  {updatingThisMod ? 'progress_activity' : 'upgrade'}
                </span>
              </button>
            </Tooltip>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center overflow-hidden">
          <Tooltip content={`Category: ${categoryLabel}`} side="bottom" wrapperClassName="block w-full min-w-0">
            <span className={`block truncate text-sm transition-colors ${secondaryTextClass}`}>
              {categoryLabel}
            </span>
          </Tooltip>
        </div>

        <div className={`flex min-w-0 items-center overflow-hidden text-sm font-mono tracking-tight transition-colors ${secondaryTextClass}`}>
          <span className="truncate whitespace-nowrap">{formatWindowsDateTime(mod.installedAt)}</span>
        </div>

        <div className="flex items-center justify-start gap-2">
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
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-0 bg-[rgba(52,211,153,0.13)] text-[#6fe3b1] transition-colors hover:bg-[#34d399] hover:text-[#04120d]"
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
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-0 bg-[#151515] text-[#9a9a9a] transition-colors hover:bg-[#222] hover:text-white"
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
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-0 bg-[#151515] text-[#8a8a8a] transition-colors hover:bg-[rgba(252,238,9,0.12)] hover:text-[#fcee09]"
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
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-0 bg-[rgba(248,113,113,0.13)] text-[#ff9b9b] transition-colors hover:bg-[#f87171] hover:text-[#190505]"
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
