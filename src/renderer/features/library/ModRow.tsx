import React from 'react'
import { Button } from '@heroui/react'
import { HyperionBadge, HyperionSwitch } from '../ui/HyperionPrimitives'
import type { ModMetadata } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { Tooltip } from '../ui/Tooltip'
import { formatWindowsDateTime } from '../../utils/dateFormat'
import { getModCategoryLabel } from '../../utils/modCategoryDisplay'
import { LIBRARY_GRID_TEMPLATE } from './LibraryTableHeader'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

interface ModRowProps {
  mod: ModMetadata
  index: number
  selected: boolean
  nested?: boolean
  animateOnEnter?: boolean
  navigationHighlight?: boolean
  dragging?: boolean
  dragEnabled?: boolean
  separatorDropTarget?: boolean
  separatorCollapsed?: boolean
  separatorChildCount?: number
  separatorUpdateCount?: number
  separatorMoveHint?: string | null
  conflictSeparatorTone?: 'win' | 'loss' | 'mixed' | null
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

const ACTIVE_COLOR = 'var(--accent)'
const NESTED_ACCENT_COLOR = '#2f3f45'

export const ModRow: React.FC<ModRowProps> = ({
  mod,
  index,
  selected,
  nested = false,
  animateOnEnter = false,
  navigationHighlight = false,
  dragging = false,
  dragEnabled = false,
  separatorDropTarget = false,
  separatorCollapsed = false,
  separatorChildCount = 0,
  separatorUpdateCount = 0,
  separatorMoveHint = null,
  conflictSeparatorTone = null,
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
  const { t, tn } = useTranslation()
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
        data-mod-id={mod.uuid}
        draggable={dragEnabled && !isRenaming}
        onDragStart={(event) => onDragStart?.(event, mod)}
        onDragEnd={(event) => onDragEnd?.(event, mod)}
        onClick={onSelect}
        onContextMenu={(event) => onContextMenu(event, mod)}
        onDragOver={(event) => onSeparatorDragOver?.(event, mod)}
        onDragLeave={(event) => onSeparatorDragLeave?.(event, mod)}
        onDrop={(event) => onSeparatorDrop?.(event, mod)}
        className={`group relative overflow-hidden border-y border-[var(--border)] transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ${
          separatorDropTarget
            ? 'bg-[rgb(var(--accent-cyber-blue-rgb)/0.14)] shadow-[inset_0_0_0_1px_rgb(var(--accent-cyber-blue-rgb)/0.34)]'
            : selected
              ? 'bg-[rgb(var(--accent-rgb)/0.18)]'
              : conflictSeparatorTone === 'win'
                ? 'bg-[rgba(52,211,153,0.05)] hover:bg-[rgba(52,211,153,0.08)] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.13)] hover:shadow-[inset_0_0_0_1px_rgba(52,211,153,0.22)]'
                : conflictSeparatorTone === 'loss'
                  ? 'bg-[rgba(248,113,113,0.05)] hover:bg-[rgba(248,113,113,0.08)] shadow-[inset_0_0_0_1px_rgba(248,113,113,0.13)] hover:shadow-[inset_0_0_0_1px_rgba(248,113,113,0.22)]'
                  : conflictSeparatorTone === 'mixed'
                    ? 'bg-[rgba(252,238,9,0.04)] hover:bg-[rgba(252,238,9,0.07)] shadow-[inset_0_0_0_1px_rgba(252,238,9,0.11)] hover:shadow-[inset_0_0_0_1px_rgba(252,238,9,0.19)]'
                    : 'bg-[var(--surface-secondary)] hover:bg-[color-mix(in_srgb,var(--surface-secondary),var(--text-primary)_5%)]'
        } ${dragEnabled ? 'cursor-default active:cursor-grabbing' : ''} ${dragging ? 'opacity-45 translate-x-1' : ''}`}
      >
        {rowDropPosition ? (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 z-20 h-[2px] ${
              rowDropPosition === 'before' ? 'top-0' : 'bottom-0'
            }`}
            style={{
              background: 'var(--accent-cyber-blue)',
              boxShadow: '0 0 10px rgb(var(--accent-cyber-blue-rgb)/0.55)',
            }}
          />
        ) : null}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-px opacity-70 transition-opacity duration-150 group-hover:opacity-100"
          style={{
            background: separatorDropTarget
              ? 'rgb(var(--accent-cyber-blue-rgb)/0.7)'
              : 'rgb(var(--accent-rgb)/0.22)',
            boxShadow: separatorDropTarget ? '0 0 8px rgb(var(--accent-cyber-blue-rgb)/0.28)' : 'none',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] transition-[background-color,box-shadow] duration-150"
          style={{
            background: separatorDropTarget ? 'var(--accent-cyber-blue)' : 'rgb(var(--accent-rgb)/0.7)',
          }}
        />
        {!separatorDropTarget && !selected ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            style={{
              background: 'rgb(var(--accent-rgb)/0.06)',
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
              onContextMenu={(event) => event.stopPropagation()}
              onBlur={onRenameSave}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRenameSave()
                if (event.key === 'Escape') onRenameCancel()
              }}
              className="allow-text-selection h-9 w-full rounded-lg border-0 bg-[var(--surface-secondary)] px-3 text-[13px] font-semibold tracking-[0.01em] leading-none text-[var(--text-primary)] focus:shadow-[inset_0_0_0_1px_rgb(var(--accent-cyber-blue-rgb)/0.5)] focus:outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-3 pl-[32px]">
              <Icon name="expand_more" className={`absolute left-[16px] top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-muted)] transition-[transform,color] duration-200 group-hover:text-[var(--text-primary)] ${ separatorCollapsed ? '-rotate-90' : 'rotate-0' }`} />
              <span
                aria-hidden="true"
                className="h-[8px] w-[8px] shrink-0 rounded-full transition-[background-color,box-shadow] duration-150"
                style={{ background: separatorDropTarget ? 'var(--accent-cyber-blue)' : 'var(--accent)' }}
              />
              <span
                className={`truncate text-[13px] font-semibold tracking-[0.01em] transition-colors duration-150 ${
                  separatorDropTarget
                    ? 'text-[var(--accent-cyber-blue)]'
                    : selected
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-primary)]'
                }`}
              >
                {mod.name}
              </span>
              {separatorChildCount > 0 ? (
                // Real HeroUI chip in the accent tone: the old --surface-secondary span sat
                // on a row that IS --surface-secondary, so the "N mods" tag melted into the
                // separator bar; the accent tint keeps it visible and follows the user's color.
                <HyperionBadge tone="accent" size="sm" className="shrink-0 normal-case tracking-normal">
                  {tn('library.row.modCount', separatorChildCount)}
                </HyperionBadge>
              ) : null}
              {separatorCollapsed && separatorUpdateCount > 0 ? (
                <span
                  className="flex shrink-0 items-center gap-[3px] rounded-md bg-[rgb(var(--accent-cyber-blue-rgb)/0.14)] px-[6px] py-[3px] text-[11px] font-semibold tabular-nums text-[var(--accent-cyber-blue)]"
                  title={tn('library.row.separatorUpdateTitle', separatorUpdateCount)}
                >
                  <Icon name="upgrade" className="text-[13px] leading-none" />
                  {separatorUpdateCount}
                </span>
              ) : null}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3">
              {separatorMoveHint ? (
                <span
                  className={`rounded-md border-0 px-2.5 py-[4px] text-[11px] font-medium ${
                    separatorDropTarget
                    ? 'bg-[rgb(var(--accent-cyber-blue-rgb)/0.16)] text-[var(--accent-cyber-blue)]'
                    : 'bg-[var(--surface)] text-[var(--text-secondary)]'
                }`}
              >
                {separatorDropTarget ? t('library.row.dropSelectedHere') : separatorMoveHint}
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
    modUpdate?.currentVersion ? t('library.update.installed', { version: modUpdate.currentVersion }) : null,
    modUpdate?.latestVersion ? t('library.update.latest', { version: modUpdate.latestVersion }) : null,
    updatingThisMod ? t('library.update.updatingInLibrary') : t('library.update.newVersion'),
  ].filter(Boolean).join(' · ')
  const conflictAriaLabel = [
    conflictSummary.overwrites > 0 ? tn('library.conflict.overwrites', conflictSummary.overwrites) : null,
    conflictSummary.overwrittenBy > 0 ? tn('library.conflict.overwrittenBy', conflictSummary.overwrittenBy) : null,
    isRedundant ? t('library.conflict.redundantAria') : null,
    t('library.conflict.clickToInspectAria'),
  ].filter(Boolean).join(' · ')
  const conflictTooltipContent = (
    <div className="flex min-w-[210px] flex-col gap-1.5">
      {conflictSummary.overwrites > 0 ? (
        <div className="flex items-center gap-2 text-[#34d399]">
          <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-sm bg-[rgba(52,211,153,0.14)] px-1.5 font-mono text-[11px] font-bold leading-none">
            +{conflictSummary.overwrites}
          </span>
          <span>{tn('library.conflict.overwrites', conflictSummary.overwrites)}</span>
        </div>
      ) : null}
      {conflictSummary.overwrittenBy > 0 ? (
        <div className="flex items-center gap-2 text-[#f87171]">
          <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-sm bg-[rgba(248,113,113,0.14)] px-1.5 font-mono text-[11px] font-bold leading-none">
            -{conflictSummary.overwrittenBy}
          </span>
          <span>{tn('library.conflict.overwrittenBy', conflictSummary.overwrittenBy)}</span>
        </div>
      ) : null}
      {isRedundant ? (
        <div className="flex items-center gap-2 text-[var(--status-warning-text)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-[rgba(252,238,9,0.14)] font-mono text-[12px] font-bold leading-none">
            !
          </span>
          <span>{t('library.conflict.redundantFull')}</span>
        </div>
      ) : null}
      <div className="border-t border-[var(--border-strong)] pt-1 text-[var(--text-support)]">
        {t('library.conflict.clickToInspect')}
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

  // Rows are transparent so the lighter HeroUI --surface panel shows through (the "zinc card"
  // look from the mockup). Selection uses a slightly lighter surface; hover is the rounded
  // overlay below. No more near-black zebra — the table reads as one elevated card.
  const baseRowBackgroundClass = selected
    ? 'bg-[rgb(var(--accent-rgb)/0.2)]'
    : 'bg-transparent'
  const rowBackgroundClass = conflictTone === 'focus'
    ? 'bg-[rgb(var(--accent-rgb)/0.1)]'
    : conflictTone === 'win'
      ? 'bg-[rgba(52,211,153,0.1)]'
      : conflictTone === 'loss'
        ? 'bg-[rgba(248,113,113,0.1)]'
        : conflictTone === 'mixed'
          ? 'bg-[rgba(252,238,9,0.08)]'
          : baseRowBackgroundClass
  // Hover border follows each tone's own semantic color. The focused row is
  // accent-tinted — the old #5a5714 olive was a leftover from the yellow-accent
  // era and read as a stray yellow hairline between the selected mod and its
  // conflict-highlighted neighbors. Yellow remains only on 'mixed' (redundant).
  const rowHoverClass = conflictTone === 'focus'
    ? 'hover:border-[rgb(var(--accent-rgb)/0.35)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_0_1px_rgb(var(--accent-rgb)/0.12)]'
    : conflictTone === 'win'
      ? 'hover:border-[rgba(52,211,153,0.35)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.035),inset_0_0_0_1px_rgba(52,211,153,0.11)]'
      : conflictTone === 'loss'
        ? 'hover:border-[rgba(248,113,113,0.35)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(248,113,113,0.1)]'
        : conflictTone === 'mixed'
          ? 'hover:border-[rgba(252,238,9,0.3)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(252,238,9,0.1)]'
          : mod.enabled
            ? 'hover:border-[var(--border-strong)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.025),inset_0_0_0_1px_rgb(var(--accent-rgb)/0.09)]'
            : 'hover:border-[var(--border-strong)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
  // NOTE: Tailwind can't apply an opacity modifier (/50) to a var() color, so the ring must be
  // written as rgb(var(--accent-rgb)/X) to actually render a visible accent ring.
  // Selection reads through the accent fill + left accent bar (below), not a full-perimeter
  // ring — a ring collides with the per-row separator lines and looks like a doubled border.
  const selectedRingClass = ''
  const hoverGradient = conflictTone === 'focus'
    ? 'linear-gradient(90deg, rgb(var(--accent-rgb)/0.12) 0%, rgb(var(--accent-rgb)/0.05) 18%, rgba(255,255,255,0.012) 34%, rgba(255,255,255,0) 66%)'
    : conflictTone === 'win'
      ? 'linear-gradient(90deg, rgba(52,211,153,0.12) 0%, rgba(52,211,153,0.045) 18%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 68%)'
      : conflictTone === 'loss'
        ? 'linear-gradient(90deg, rgba(248,113,113,0.12) 0%, rgba(248,113,113,0.045) 18%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 68%)'
        : conflictTone === 'mixed'
          ? 'linear-gradient(90deg, rgba(252,238,9,0.11) 0%, rgba(252,238,9,0.04) 18%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 68%)'
          : mod.enabled
            ? 'rgb(var(--accent-rgb)/0.12)'
            : 'rgba(255,255,255,0.06)'
  const indexTextClass = conflictTone === 'none'
    ? 'text-[var(--text-support)] group-hover:text-[var(--text-secondary)]'
    : 'text-[var(--text-secondary)]'
  const primaryTextClass = mod.enabled
    ? conflictTone === 'focus'
      ? 'text-[var(--accent)]'
      : conflictTone === 'none'
        ? 'text-[var(--text-primary-alt)] group-hover:text-[var(--text-primary)]'
        : 'text-[var(--text-primary)]'
    : conflictTone === 'none'
      ? 'text-[var(--text-support)] line-through group-hover:text-[var(--text-secondary)]'
      : 'text-[var(--text-secondary)] line-through'
  const secondaryTextClass = conflictTone === 'none'
    ? 'text-[var(--text-support)] group-hover:text-[var(--text-secondary)]'
    : 'text-[var(--text-secondary)]'
  const leftRailColor = conflictTone === 'focus'
    ? 'var(--accent)'
    : conflictTone === 'win'
      ? '#34D399'
      : conflictTone === 'loss'
        ? '#F87171'
        : conflictTone === 'mixed'
          ? '#FCEE09'
          : rowAccentColor
  // rowAccentColor/leftRailColor may hold a CSS var() reference (e.g. var(--accent)) rather
  // than a raw hex string, so alpha blends can't use hex-suffix string concatenation
  // (`${color}55`) — that would emit an invalid `var(--accent)55`. Use explicit rgb()-with-
  // opacity blends per branch instead.
  const leftRailFadedColor = nested
    ? `${NESTED_ACCENT_COLOR}88`
    : 'rgb(var(--accent-rgb)/0.533)'
  const leftRailToneFadedColor = conflictTone === 'focus'
    ? 'rgb(var(--accent-rgb)/0.667)'
    : conflictTone === 'win'
      ? 'rgba(52,211,153,0.667)'
      : conflictTone === 'loss'
        ? 'rgba(248,113,113,0.667)'
        : conflictTone === 'mixed'
          ? 'rgba(252,238,9,0.667)'
          : leftRailFadedColor
  const leftRailShadow = conflictTone === 'focus'
    ? '0 0 12px rgb(var(--accent-rgb)/0.24)'
    : conflictTone === 'win'
      ? '0 0 12px rgba(52,211,153,0.24)'
      : conflictTone === 'loss'
        ? '0 0 12px rgba(248,113,113,0.24)'
        : conflictTone === 'mixed'
          ? '0 0 12px rgba(252,238,9,0.2)'
          : nested
            ? `0 0 10px ${NESTED_ACCENT_COLOR}55`
            : '0 0 10px rgb(var(--accent-rgb)/0.333)'

  const doToggle = async () => {
    const result = mod.enabled ? await disableMod(mod.uuid) : await enableMod(mod.uuid)
    if (!result.ok) addToast(result.error ?? t('library.row.toggleFailed'), 'error')
  }
  // Swallow click/dblclick inside interactive cells (switch, action buttons) so the row's
  // own onClick(select)/onDoubleClick(open) never fires when the user hits a control. These
  // are HeroUI (React Aria) controls whose press doesn't carry the old stopPropagation, so
  // the wrapper does it.
  const stopRowActivation = (event: React.MouseEvent) => event.stopPropagation()

  return (
    <div className={`relative ${animateOnEnter ? 'fade-up' : ''}`}>
      <div
        data-mod-row="true"
        data-mod-id={mod.uuid}
        draggable={dragEnabled && !isRenaming}
        onDragStart={(event) => onDragStart?.(event, mod)}
        onDragEnd={(event) => onDragEnd?.(event, mod)}
        onDragOver={(event) => onRowDragOver?.(event, mod)}
        onDragLeave={(event) => onRowDragLeave?.(event, mod)}
        onDrop={(event) => onRowDrop?.(event, mod)}
        onClick={onSelect}
        onDoubleClick={() => onOpenDetails(mod)}
        onContextMenu={(event) => onContextMenu(event, mod)}
        className={`library-mod-row grid h-[48px] w-full gap-4 pl-5 pr-5 py-[5px] border-b-[0.5px] border-[var(--border-subtle)] relative overflow-hidden group cursor-default transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ${rowBackgroundClass} ${rowHoverClass} ${selectedRingClass} ${
          navigationHighlight ? 'hyperion-row-attention' : ''
        } ${
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
              background: 'var(--accent-cyber-blue)',
              boxShadow: '0 0 10px rgb(var(--accent-cyber-blue-rgb)/0.55)',
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
          className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] transition-opacity duration-150 group-hover:opacity-100 ${
            selected || navigationHighlight ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: selected && conflictTone === 'none' ? 'var(--accent)' : conflictTone === 'none' ? leftRailFadedColor : leftRailToneFadedColor,
            boxShadow: selected && conflictTone === 'none' ? '0 0 10px rgb(var(--accent-rgb)/0.5)' : undefined,
          }}
        />

        <div className="flex items-center pl-2" onClick={stopRowActivation} onDoubleClick={stopRowActivation}>
          <HyperionSwitch
            size="sm"
            isSelected={mod.enabled}
            onChange={() => { void doToggle() }}
            aria-label={mod.enabled ? t('library.row.disableMod') : t('library.row.enableMod')}
          />
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
              onContextMenu={(event) => event.stopPropagation()}
              onBlur={onRenameSave}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRenameSave()
                if (event.key === 'Escape') onRenameCancel()
              }}
              className="allow-text-selection h-8 w-full rounded-lg border-0 bg-[var(--surface-secondary)] px-3 font-medium tracking-tight leading-none text-[var(--text-primary)] focus:shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.45)] focus:outline-none"
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
                  {recentBadge === 'downgraded' ? t('library.row.recentDowngraded') : recentBadge === 'updated' ? t('library.row.recentUpdated') : t('library.row.recentInstalled')}
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
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-[rgba(252,238,9,0.12)] text-[var(--status-warning-text)]">
                        <Icon name="priority_high" className="text-[15px] leading-none" />
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
                className="inline-flex shrink-0 items-center justify-center text-[rgb(var(--accent-cyber-blue-rgb)/0.9)] transition-colors hover:text-[var(--accent-cyber-blue)] disabled:cursor-wait disabled:text-[rgb(var(--accent-cyber-blue-rgb)/0.5)]"
              >
                <Icon name={updatingThisMod ? 'progress_activity' : 'upgrade'} className={`text-[16px] ${updatingThisMod ? 'animate-spin' : ''}`} />
              </button>
            </Tooltip>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center overflow-hidden">
          <Tooltip content={t('library.row.categoryTooltip', { category: categoryLabel })} side="bottom" wrapperClassName="block w-full min-w-0">
            <span className={`block truncate text-sm transition-colors ${secondaryTextClass}`}>
              {categoryLabel}
            </span>
          </Tooltip>
        </div>

        <div className={`flex min-w-0 items-center overflow-hidden text-sm font-mono tracking-tight transition-colors ${secondaryTextClass}`}>
          <span className="truncate whitespace-nowrap">{formatWindowsDateTime(mod.installedAt)}</span>
        </div>

        <div className="flex items-center justify-start gap-2" onClick={stopRowActivation} onDoubleClick={stopRowActivation}>
          {isRenaming ? (
            <>
              <Tooltip content={t('library.row.saveName')}>
                <button
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRenameSave()
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border-0 bg-[rgba(52,211,153,0.13)] text-[var(--status-success-text)] transition-colors hover:bg-[#34d399] hover:text-[#04120d]"
                >
                  <Icon name="check" className="text-[15px]" />
                </button>
              </Tooltip>
              <Tooltip content={t('library.row.cancelRename')}>
                <button
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRenameCancel()
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-[var(--surface-secondary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  <Icon name="close" className="text-[15px]" />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content={t('library.row.renameMod')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={() => onRename(mod)}
                  aria-label={t('library.row.renameMod')}
                  className="h-7 w-7 min-w-0 rounded-md"
                >
                  <Icon name="edit" className="text-[15px]" />
                </Button>
              </Tooltip>
              <Tooltip content={t('library.row.removeMod')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="danger-soft"
                  onPress={() => onDelete(mod)}
                  aria-label={t('library.row.removeMod')}
                  className="h-7 w-7 min-w-0 rounded-md"
                >
                  <Icon name="delete" className="text-[15px]" />
                </Button>
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
    prev.navigationHighlight === next.navigationHighlight &&
    prev.dragging === next.dragging &&
    prev.dragEnabled === next.dragEnabled &&
    prev.separatorDropTarget === next.separatorDropTarget &&
    prev.separatorCollapsed === next.separatorCollapsed &&
    prev.separatorChildCount === next.separatorChildCount &&
    prev.separatorUpdateCount === next.separatorUpdateCount &&
    prev.separatorMoveHint === next.separatorMoveHint &&
    prev.conflictSeparatorTone === next.conflictSeparatorTone &&
    prev.rowDropPosition === next.rowDropPosition &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue
  )
}

export const MemoModRow = React.memo(ModRow, areModRowPropsEqual)
