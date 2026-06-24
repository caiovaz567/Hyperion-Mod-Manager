import React from 'react'
import type { ConflictInfo, ModMetadata } from '@shared/types'
import type { FileTreeNode } from './DetailPanelTypes'
import { getArchiveConflictHash, isUnresolvedArchiveConflict } from '../../utils/archiveConflictDisplay'

function getArchiveFileName(archivePath?: string): string | null {
  if (!archivePath) return null

  const normalized = archivePath.trim()
  if (!normalized) return null

  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  return segments[segments.length - 1] ?? normalized
}

function resolveConflictArchiveFile(
  mod: ModMetadata | undefined,
  conflict: ConflictInfo,
  archiveHash: string | null
): string | null {
  if (!mod || conflict.kind !== 'archive-resource') return null

  const normalizedResourcePath = conflict.resourcePath?.toLowerCase()

  for (const resource of mod.archiveResources ?? []) {
    if (resource.hash && archiveHash && resource.hash.toLowerCase() === archiveHash.toLowerCase()) {
      return getArchiveFileName(resource.archivePath)
    }

    if (
      resource.resourcePath
      && normalizedResourcePath
      && resource.resourcePath.toLowerCase() === normalizedResourcePath
    ) {
      return getArchiveFileName(resource.archivePath)
    }
  }

  return null
}

export const detailTitleClass = 'text-[1.12rem] font-bold leading-[1.08] tracking-[0.01em] text-[#f4f1ee] sm:text-[1.18rem]'
export const detailToolbarButtonClass = 'group flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-[0.5px] border-[#fcee09]/50 bg-[#0a0a0a] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#cccccc] transition-colors hover:bg-[#fcee09] hover:text-[#050505] [&_.material-symbols-outlined]:!text-[#fcee09] [&_.material-symbols-outlined]:transition-colors hover:[&_.material-symbols-outlined]:!text-[#050505]'

export const TabButton: React.FC<{
  active: boolean
  label: string
  onClick: () => void
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative px-2 pb-3 pt-1 text-[0.88rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
      active
        ? 'text-[#f5f1ee]'
        : 'text-[#848484] hover:text-[#efebe8]'
    }`}
  >
    {label}
    {active ? (
      <span className="absolute inset-x-0 bottom-0 h-px bg-[#fcee09] shadow-[0_0_10px_rgba(252,238,9,0.28)]" />
    ) : null}
  </button>
)

// ─── Conflict overview / summary ─────────────────────────────────────────────

interface OpponentStat {
  key: string
  name: string
  order?: number
  wins: number
  losses: number
}

function aggregateOpponents(
  winConflicts: ConflictInfo[],
  lossConflicts: ConflictInfo[],
): OpponentStat[] {
  const map = new Map<string, OpponentStat>()

  const bump = (id: string | undefined, name: string, order: number | undefined, field: 'wins' | 'losses') => {
    const safeName = name || 'Unknown mod'
    const key = id ?? `${safeName}:${order ?? '?'}`
    const existing = map.get(key)
    if (existing) existing[field] += 1
    else map.set(key, { key, name: safeName, order, wins: field === 'wins' ? 1 : 0, losses: field === 'losses' ? 1 : 0 })
  }

  for (const c of winConflicts) bump(c.existingModId, c.existingModName, c.existingOrder, 'wins')
  for (const c of lossConflicts) bump(c.incomingModId, c.incomingModName, c.incomingOrder, 'losses')

  // Opponents that steal the most (highest losses) read first.
  return Array.from(map.values()).sort((a, b) => (b.losses - a.losses) || (b.wins - a.wins))
}

export const ConflictSummary: React.FC<{
  mod: ModMetadata
  winConflicts: ConflictInfo[]
  lossConflicts: ConflictInfo[]
}> = ({ winConflicts, lossConflicts }) => {
  const opponents = React.useMemo(
    () => aggregateOpponents(winConflicts, lossConflicts),
    [winConflicts, lossConflicts],
  )
  const totalWins = winConflicts.length
  const totalLosses = lossConflicts.length

  if (opponents.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-sm border-[0.5px] border-[#1a3a2e] bg-[#08120d] px-5 py-4">
        <span className="material-symbols-outlined text-[18px] text-[#34d399]">check_circle</span>
        <div className="text-[13px] text-[#9a9a9a]">
          No other enabled mod shares files or archive resources with this mod.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-sm border-[0.5px] border-[#1c1c1c] bg-[#0b0b0b] overflow-hidden">
      {/* Verdict line */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b-[0.5px] border-[#161616] px-5 py-4">
        <span className="brand-font text-[11px] font-bold uppercase tracking-[0.16em] text-[#666]">
          Conflict overview
        </span>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-[#34d399]">visibility</span>
          <span className="text-[14px] text-[#cfcbc7]">
            <span className="font-bold text-[#34d399]">{totalWins}</span> won
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-[#f87171]">visibility_off</span>
          <span className="text-[14px] text-[#cfcbc7]">
            <span className="font-bold text-[#f87171]">{totalLosses}</span> lost
          </span>
        </div>
        <span className="text-[13px] text-[#555]">
          across {opponents.length} {opponents.length === 1 ? 'mod' : 'mods'}
        </span>
      </div>

      {/* Per-opponent breakdown */}
      <div className="divide-y divide-[#141414]">
        {opponents.map((opp) => {
          const total = opp.wins + opp.losses
          const winPct = total > 0 ? (opp.wins / total) * 100 : 0
          return (
            <div key={opp.key} className="px-5 py-3.5">
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-[#e6e2de] break-words">
                  {opp.name}
                </span>
                {typeof opp.order === 'number' && (
                  <span className="shrink-0 text-[12px] text-[#555]">#{opp.order + 1}</span>
                )}
              </div>

              {/* Win/loss split bar */}
              <div className="mt-2 flex items-center gap-3">
                <div className="flex h-[6px] flex-1 overflow-hidden rounded-sm bg-[#161616]">
                  {opp.wins > 0 && (
                    <div className="h-full" style={{ width: `${winPct}%`, background: '#34d399' }} />
                  )}
                  {opp.losses > 0 && (
                    <div className="h-full" style={{ width: `${100 - winPct}%`, background: '#f87171' }} />
                  )}
                </div>
                <div className="shrink-0 text-[12px]">
                  <span className="font-semibold text-[#34d399]">{opp.wins}</span>
                  <span className="text-[#444]"> won · </span>
                  <span className="font-semibold text-[#f87171]">{opp.losses}</span>
                  <span className="text-[#444]"> lost</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface OpponentGroup {
  key: string
  modName: string
  order?: number
  conflicts: ConflictInfo[]
}

function groupConflictsByOpponent(conflicts: ConflictInfo[], isWin: boolean): OpponentGroup[] {
  const groups = new Map<string, OpponentGroup>()

  for (const conflict of conflicts) {
    const modName = (isWin ? conflict.existingModName : conflict.incomingModName) || 'Unknown mod'
    const order = isWin ? conflict.existingOrder : conflict.incomingOrder
    const modId = isWin ? conflict.existingModId : conflict.incomingModId
    const key = modId ?? `${modName}:${order ?? '?'}`

    const existing = groups.get(key)
    if (existing) {
      existing.conflicts.push(conflict)
    } else {
      groups.set(key, { key, modName, order, conflicts: [conflict] })
    }
  }

  // Sort groups by load order (so the highest-priority opponent reads first)
  return Array.from(groups.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

const ConflictResourceRow: React.FC<{
  conflict: ConflictInfo
  mod: ModMetadata
  isWin: boolean
  accent: string
  showArchiveDetails: boolean
  modsById?: Map<string, ModMetadata>
}> = ({ conflict, mod, isWin, accent, showArchiveDetails, modsById }) => {
  const archiveHash = getArchiveConflictHash(conflict)
  const showHash = Boolean(showArchiveDetails && archiveHash && archiveHash !== conflict.resourcePath)
  const unresolved = isUnresolvedArchiveConflict(conflict)
  const currentMod = modsById?.get(mod.uuid) ?? mod
  const otherModId = isWin ? conflict.existingModId : conflict.incomingModId
  const otherMod = otherModId ? modsById?.get(otherModId) : undefined
  const thisArchive = resolveConflictArchiveFile(currentMod, conflict, archiveHash)
  const otherArchive = resolveConflictArchiveFile(otherMod, conflict, archiveHash)

  return (
    <div className="group flex items-stretch border-b border-[#111] last:border-b-0 transition-colors hover:bg-[#0d0d0d]">
      <div className="w-[3px] shrink-0" style={{ background: `${accent}3a` }} />
      <div className="min-w-0 flex-1 px-5 py-3">
        <div
          className="font-mono text-[13px] leading-relaxed break-all"
          style={{ color: unresolved ? '#555' : '#cfcbc7' }}
        >
          {unresolved ? `Unresolved archive hash — ${archiveHash}` : conflict.resourcePath}
        </div>

        {(showHash || thisArchive || otherArchive) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {showHash && !unresolved && (
              <span className="font-mono text-[#4a4a4a]">{archiveHash}</span>
            )}
            {(thisArchive || otherArchive) && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {isWin ? (
                  <>
                    <span className="font-medium" style={{ color: `${accent}cc` }}>{thisArchive ?? mod.name}</span>
                    <span className="text-[#555]">overrides</span>
                    <span className="text-[#5a5a5a] line-through decoration-[#444]">{otherArchive ?? 'other archive'}</span>
                  </>
                ) : (
                  <>
                    <span className="text-[#5a5a5a] line-through decoration-[#444]">{thisArchive ?? mod.name}</span>
                    <span className="text-[#555]">overridden by</span>
                    <span className="font-medium" style={{ color: `${accent}cc` }}>{otherArchive ?? 'other archive'}</span>
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export const ConflictSection: React.FC<{
  conflicts: ConflictInfo[]
  emptyMessage: string
  mod: ModMetadata
  tone: 'win' | 'loss'
  title: string
  collapsed: boolean
  onToggleCollapsed: () => void
  className?: string
  showArchiveDetails?: boolean
  modsById?: Map<string, ModMetadata>
}> = ({ conflicts, emptyMessage, mod, tone, title, collapsed, onToggleCollapsed, className, showArchiveDetails = true, modsById }) => {
  const isWin = tone === 'win'
  const accent = isWin ? '#34d399' : '#f87171'
  const count = conflicts.length
  const groups = React.useMemo(() => groupConflictsByOpponent(conflicts, isWin), [conflicts, isWin])

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-sm border-[0.5px] ${className ?? ''}`}
      style={{ borderColor: `${accent}28` }}
    >
      {/* Section header */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#0e0e0e] ${
          collapsed ? 'bg-[#0a0a0a]' : 'bg-[#0b0b0b] border-b border-[#161616]'
        }`}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border-[0.5px]"
          style={{ borderColor: `${accent}28`, background: `${accent}0e` }}
        >
          <span className="material-symbols-outlined text-[15px]" style={{ color: accent }}>
            {isWin ? 'visibility' : 'visibility_off'}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <span className="brand-font text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>
            {title}
          </span>
          <span className="ml-3 text-[12px] text-[#555]">
            {isWin ? 'This mod has priority.' : 'Another mod has priority.'}
          </span>
        </div>

        <span
          className="shrink-0 brand-font text-[11px] font-bold px-2.5 py-1 rounded-sm border-[0.5px]"
          style={{ color: accent, borderColor: `${accent}30`, background: `${accent}10` }}
        >
          {count}
        </span>

        <span
          className="material-symbols-outlined shrink-0 text-[16px] text-[#444] transition-transform duration-150"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>

      {/* Grouped rows */}
      {!collapsed && (count > 0 ? (
        <div className="hyperion-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#090909]">
          {groups.map((group) => (
            <div key={group.key} className="border-b border-[#151515] last:border-b-0">
              {/* Opponent header — full width, no truncation */}
              <div className="flex items-baseline gap-3 bg-[#0c0c0c] px-5 py-3">
                <span className="brand-font text-[11px] font-bold uppercase tracking-[0.16em] text-[#555]">
                  {isWin ? 'Beats' : 'Beaten by'}
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-[#e6e2de] break-words">
                  {group.modName}
                </span>
                {typeof group.order === 'number' && (
                  <span className="shrink-0 text-[12px] text-[#555]">
                    Load order #{group.order + 1}
                  </span>
                )}
                <span
                  className="shrink-0 brand-font text-[11px] font-bold px-2 py-0.5 rounded-sm"
                  style={{ color: `${accent}cc`, background: `${accent}10` }}
                >
                  {group.conflicts.length} {group.conflicts.length === 1 ? 'resource' : 'resources'}
                </span>
              </div>

              {/* Resources for this opponent — full width */}
              {group.conflicts.map((conflict, index) => (
                <ConflictResourceRow
                  key={`${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? index}`}
                  conflict={conflict}
                  mod={mod}
                  isWin={isWin}
                  accent={accent}
                  showArchiveDetails={showArchiveDetails}
                  modsById={modsById}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[#090909] px-5 py-8 text-[13px] text-[#555]">
          {emptyMessage}
        </div>
      ))}
    </section>
  )
}

export const FileTreeBranch: React.FC<{
  node: FileTreeNode
  depth: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onContextMenu: (event: React.MouseEvent, node: FileTreeNode) => void
}> = ({ node, depth, expandedIds, onToggle, selectedId, onSelect, onContextMenu }) => {
  const isFolder = node.kind === 'folder'
  const isExpanded = isFolder && expandedIds.has(node.id)
  const selected = selectedId === node.id
  const indent = 12 + depth * 18

  return (
    <div>
      <div
        className={`flex items-center border-b border-[#171717] pr-3 transition-colors ${
          selected ? 'bg-[#191808]' : 'hover:bg-[#141414]'
        }`}
        style={{ paddingLeft: `${indent}px` }}
        onContextMenu={(event) => onContextMenu(event, node)}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node.id)
            }}
            className="flex h-9 w-7 shrink-0 items-center justify-center text-[#8a8a8a] transition-colors hover:text-white"
          >
            <span className={`material-symbols-outlined text-[16px] transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
              expand_more
            </span>
          </button>
        ) : (
          <span className="block h-9 w-7 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => {
            if (isFolder) onToggle(node.id)
          }}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
        >
          <span className={`material-symbols-outlined text-[17px] ${isFolder ? 'text-[#fcee09]' : 'text-[#cfcfcf]'}`}>
            {isFolder ? 'folder' : 'description'}
          </span>
          <span className={`min-w-0 truncate text-sm ${selected ? 'text-[#fff6b8]' : 'text-[#f0ece8]'}`}>
            {node.name}
          </span>
        </button>

        <span className={`shrink-0 pl-4 text-sm ${selected ? 'text-[#f5efc4]' : 'text-[#979797]'}`}>
          {isFolder ? `${node.fileCount} file${node.fileCount === 1 ? '' : 's'}` : 'file'}
        </span>
      </div>

      {isExpanded ? (
        <div>
          {node.children.map((child) => (
            <FileTreeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
