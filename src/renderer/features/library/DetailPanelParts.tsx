import React from 'react'
import type { ConflictInfo, ModMetadata } from '@shared/types'
import type { FileTreeNode } from './DetailPanelTypes'
import { getArchiveConflictHash, isUnresolvedArchiveConflict } from '../../utils/archiveConflictDisplay'

export const detailTitleClass = 'text-[1.12rem] font-bold leading-[1.08] tracking-[0.01em] text-[#f4f1ee] sm:text-[1.18rem]'
export const detailToolbarButtonClass = 'group flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-0 bg-[rgba(252,238,9,0.10)] px-4 text-[10px] brand-font font-bold uppercase tracking-widest text-[#d8d19a] transition-colors hover:bg-[#fcee09] hover:text-[#050505] [&_.material-symbols-outlined]:!text-current [&_.material-symbols-outlined]:transition-colors'

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

// ─── Conflicts (MO2-style: flat File | Mod tables) ───────────────────────────

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
}> = ({ conflicts, emptyMessage, tone, title, collapsed, onToggleCollapsed, className }) => {
  const isWin = tone === 'win'
  const accent = isWin ? '#34d399' : '#f87171'
  const count = conflicts.length
  // The right-hand column names the mod on the other side of the conflict.
  const otherColumnLabel = 'Mod'

  // Cluster rows by the opposing mod (in load-order priority), then by path,
  // so every conflict against the same mod sits together.
  const sortedConflicts = React.useMemo(() => {
    const otherOf = (c: ConflictInfo) => ({
      name: (isWin ? c.existingModName : c.incomingModName) ?? '',
      order: (isWin ? c.existingOrder : c.incomingOrder) ?? Number.MAX_SAFE_INTEGER,
    })

    return [...conflicts].sort((a, b) => {
      const oa = otherOf(a)
      const ob = otherOf(b)
      if (oa.order !== ob.order) return oa.order - ob.order
      if (oa.name !== ob.name) return oa.name.localeCompare(ob.name)
      return String(a.resourcePath).localeCompare(String(b.resourcePath), undefined, { numeric: true })
    })
  }, [conflicts, isWin])

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-sm border-[0.5px] border-[#1a1a1a] ${className ?? ''}`}
    >
      {/* Section header */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#0e0e0e] ${
          collapsed ? 'bg-[#0a0a0a]' : 'bg-[#0b0b0b] border-b border-[#161616]'
        }`}
      >
        <span className="material-symbols-outlined text-[17px] shrink-0" style={{ color: accent }}>
          {isWin ? 'visibility' : 'visibility_off'}
        </span>

        <span className="brand-font text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>
          {title}
        </span>
        <span className="text-[13px] text-[#8f8b87]">
          {isWin ? 'This mod loads over these.' : 'These load over this mod.'}
        </span>

        <span
          className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums px-2.5 py-1 rounded-sm border-0"
          style={{ color: accent, background: `${accent}18` }}
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

      {/* Table — header lives inside the scroll container so column widths
          (and therefore the header labels) stay aligned with the rows even
          when the vertical scrollbar narrows the content area. */}
      {!collapsed && (count > 0 ? (
        <div className="hyperion-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#090909]">
          {/* Sticky column headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)] border-b border-[#161616] bg-[#080808]">
            <span className="px-5 py-2.5 brand-font text-[11px] font-bold uppercase tracking-widest text-[#7a7672]">File</span>
            <span className="border-l border-[#141414] px-5 py-2.5 brand-font text-[11px] font-bold uppercase tracking-widest text-[#7a7672]">{otherColumnLabel}</span>
          </div>

          {/* Rows */}
          {sortedConflicts.map((conflict, index) => {
              const opponentName = isWin ? conflict.existingModName : conflict.incomingModName
              const opponentOrder = isWin ? conflict.existingOrder : conflict.incomingOrder
              const opponentTitle = `${opponentName || 'Unknown mod'}${typeof opponentOrder === 'number' ? ` #${opponentOrder + 1}` : ''}`
              const archiveHash = getArchiveConflictHash(conflict)
              const unresolved = isUnresolvedArchiveConflict(conflict)
              const displayPath = unresolved && archiveHash
                ? `Archive hash - ${archiveHash}`
                : conflict.resourcePath
              // Zebra striping helps the eye track a file across the gap to its mod.
              const zebra = index % 2 === 1

              return (
                <div
                  key={`${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? index}`}
                  className={`grid grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)] border-b border-[#101010] last:border-b-0 transition-colors hover:!bg-[#13130c] ${
                    zebra ? 'bg-[#0b0b0b]' : 'bg-transparent'
                  }`}
                >
                  {/* File / resource path */}
                  <div className="min-w-0 px-5 py-2 flex items-center">
                    <span
                      className="font-mono text-[13px] break-all"
                      style={{ color: unresolved ? '#777' : '#cfcbc7' }}
                    >
                      {displayPath}
                    </span>
                  </div>

                  {/* Other mod — full name, wraps, never truncated */}
                  <div className="min-w-0 border-l border-[#141414] px-5 py-2 flex items-center gap-2">
                    <span
                      className="min-w-0 text-[13px] font-medium text-[#d2cec9] break-words leading-snug"
                      title={opponentTitle}
                    >
                      {opponentName || 'Unknown mod'}
                    </span>
                    {typeof opponentOrder === 'number' && (
                      <span className="shrink-0 text-[12px] text-[#6f6b67]">#{opponentOrder + 1}</span>
                    )}
                  </div>
                </div>
              )
            })}
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
          onClick={() => {
            onSelect(node.id)
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
