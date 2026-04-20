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
  onSelect: (event: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent, mod: ModMetadata) => void
  onRename: (mod: ModMetadata) => void
  onDelete: (mod: ModMetadata) => void
  onOpenDetails: (mod: ModMetadata) => void
  isRenaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
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

export const ModRow: React.FC<ModRowProps> = ({
  mod,
  index,
  selected,
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
}) => {
  const { enableMod, disableMod, addToast, recentBadge } = useAppStore((state) => ({
    enableMod: state.enableMod,
    disableMod: state.disableMod,
    addToast: state.addToast,
    recentBadge: state.recentLibraryBadges[mod.uuid],
  }), shallow)

  if (mod.kind === 'separator') {
    return (
      <div
        onClick={onSelect}
        className="flex items-center gap-4 px-6 py-1 cursor-pointer border-b-[0.5px] border-[#1a1a1a] hover:bg-[#0a0a0a] transition-colors"
      >
        <div className="flex-1 h-px bg-[#1a1a1a]" />
        <span className="text-[10px] brand-font font-bold text-[#8a8a8a] uppercase tracking-widest whitespace-nowrap flex-shrink-0">
          {mod.name}
        </span>
        <div className="flex-1 h-px bg-[#1a1a1a]" />
      </div>
    )
  }

  const color = TYPE_COLOR[mod.type] ?? '#64748B'
  const label = TYPE_LABEL[mod.type] ?? 'UNKNOWN'
  const rowBackgroundClass = selected
    ? 'bg-[#0a0a0a]'
    : mod.enabled
      ? index % 2 === 0
        ? 'bg-[#050505] hover:bg-[#141414]'
        : 'bg-[#0a0a0a] hover:bg-[#161616]'
      : index % 2 === 0
        ? 'bg-[#040404] hover:bg-[#101010]'
        : 'bg-[#080808] hover:bg-[#121212]'

  const handleToggle = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const result = mod.enabled ? await disableMod(mod.uuid) : await enableMod(mod.uuid)
    if (!result.ok) addToast(result.error ?? 'Operation failed', 'error')
  }

  return (
    <div
      data-mod-row="true"
      onClick={onSelect}
      onDoubleClick={() => onOpenDetails(mod)}
      onContextMenu={(event) => onContextMenu(event, mod)}
      className={`library-mod-row grid h-[38px] gap-4 pl-6 pr-6 py-[5px] border-b-[0.5px] border-[#1a1a1a] relative overflow-hidden group cursor-default transition-[background-color,border-color,box-shadow,opacity] duration-150 ${rowBackgroundClass} ${
        mod.enabled
          ? 'hover:border-[#363636] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.025),inset_0_0_0_1px_rgba(252,238,9,0.09)]'
          : 'opacity-50 hover:opacity-86 hover:border-[#2c2c2c] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
      } ${selected ? 'ring-1 ring-inset ring-[#fcee09]/50' : ''}`}
      style={{
        gridTemplateColumns: '72px 80px minmax(280px,1fr) 110px 156px 184px 96px',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{
          background: mod.enabled
            ? 'linear-gradient(90deg, rgba(252,238,9,0.08) 0%, rgba(252,238,9,0.036) 15%, rgba(255,255,255,0.018) 34%, rgba(255,255,255,0) 66%)'
            : 'linear-gradient(90deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 20%, rgba(255,255,255,0) 62%)',
        }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[#fcee09]/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
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

      <div className="flex items-center text-[#8a8a8a] text-[12px] font-mono group-hover:text-[#d0d0d0] transition-colors">
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
            className="allow-text-selection h-6 w-full border-[0.5px] border-[#333] bg-[#0a0a0a] px-3 text-[12px] text-white focus:border-[#fcee09]/50 focus:outline-none"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`font-medium tracking-tight truncate transition-colors ${
                mod.enabled ? 'text-[#e5e2e1] group-hover:text-[#ffffff]' : 'text-[#8a8a8a] line-through group-hover:text-[#b0b0b0]'
              }`}
            >
              {mod.name}
            </span>
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
          </div>
        )}
      </div>

      <div className={`flex items-center text-sm font-mono tracking-tight transition-colors ${mod.enabled ? 'text-[#9a9a9a] group-hover:text-[#c4c4c4]' : 'text-[#8a8a8a] group-hover:text-[#aaaaaa]'}`}>
        {mod.version ?? '—'}
      </div>

      <div className="flex items-center">
        <span
          className={`px-2.5 py-[3px] border-[0.5px] text-[10px] uppercase tracking-widest rounded-sm transition-colors ${
            mod.enabled ? 'bg-[#111] border-[#222] group-hover:border-[#343434]' : 'bg-[#050505] border-[#222] group-hover:border-[#2e2e2e]'
          }`}
          style={{ color: mod.enabled ? color : '#8a8a8a' }}
        >
          {label}
        </span>
      </div>

      <div className={`flex items-center text-sm font-mono tracking-tight transition-colors ${mod.enabled ? 'text-[#9a9a9a] group-hover:text-[#bdbdbd]' : 'text-[#8a8a8a] group-hover:text-[#9d9d9d]'}`}>
        {mod.enabled ? formatWindowsDateTime(mod.installedAt) : '---'}
      </div>

      <div className="flex items-center justify-end gap-2">
        {isRenaming ? (
          <>
            <Tooltip content="Save name">
              <button
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
                className="flex h-7 w-7 items-center justify-center rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#ff4d4f]/45 hover:text-[#ff4d4f] transition-all"
              >
                <span className="material-symbols-outlined text-[15px]">delete</span>
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {mod.enabled && (
        <div
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: ACTIVE_COLOR, boxShadow: `0 0 10px ${ACTIVE_COLOR}55` }}
        />
      )}
    </div>
  )
}

function areModRowPropsEqual(prev: ModRowProps, next: ModRowProps): boolean {
  return (
    prev.mod === next.mod &&
    prev.index === next.index &&
    prev.selected === next.selected &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue
  )
}

export const MemoModRow = React.memo(ModRow, areModRowPropsEqual)
