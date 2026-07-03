import React from 'react'
import type { ConflictInfo, ModMetadata } from '@shared/types'
import type { FileTreeNode } from './DetailPanelTypes'
import { getArchiveConflictHash, isUnresolvedArchiveConflict } from '../../utils/archiveConflictDisplay'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

export const detailTitleClass = 'text-[1.12rem] font-bold leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)] sm:text-[1.18rem]'
export const detailToolbarButtonClass = 'group flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 bg-[rgb(var(--accent-rgb)/0.12)] px-4 text-[13px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]'

// Same metrics/treatment as the shared UnderlineTabs in uiKit - one tab pattern app-wide.
export const TabButton: React.FC<{
  active: boolean
  label: string
  onClick: () => void
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={`relative -mb-px inline-flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:transition-colors ${
      active
        ? 'text-[var(--text-primary)] after:bg-[var(--accent)]'
        : 'text-[var(--text-muted)] after:bg-transparent hover:text-[var(--text-primary)]'
    }`}
  >
    {label}
  </button>
)

// ─── Conflicts (flat File | Mod tables) ─────────────────────────────────────

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
  const { t } = useTranslation()
  const isWin = tone === 'win'
  const accent = isWin ? '#34d399' : '#f87171'
  const count = conflicts.length
  // The right-hand column names the mod on the other side of the conflict.
  const otherColumnLabel = t('library.detail.conflictModColumn')

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
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl bg-[var(--surface)] ${className ?? ''}`}
    >
      {/* Section header */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-secondary)] ${
          collapsed ? '' : 'border-b border-[var(--border)]'
        }`}
      >
        <Icon name={isWin ? 'visibility' : 'visibility_off'} className="text-[17px] shrink-0" style={{ color: accent }} />

        <span className="text-[13px] font-semibold" style={{ color: accent }}>
          {title}
        </span>
        <span className="text-[13px] text-[var(--text-support)]">
          {isWin ? t('library.detail.conflictWinsSubtitle') : t('library.detail.conflictLossSubtitle')}
        </span>

        <span
          className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums px-2.5 py-1 rounded-md border-0"
          style={{ color: accent, background: `${accent}22` }}
        >
          {count}
        </span>

        <Icon name="expand_more" className="shrink-0 text-[16px] text-[var(--text-muted)] transition-transform duration-150" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
      </button>

      {/* Table - header lives inside the scroll container so column widths
          (and therefore the header labels) stay aligned with the rows even
          when the vertical scrollbar narrows the content area. */}
      {!collapsed && (count > 0 ? (
        <div className="hyperion-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--surface)]">
          {/* Sticky column headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)] border-b border-[var(--border)] bg-[var(--surface-secondary)]">
            <span className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{t('library.detail.conflictFileColumn')}</span>
            <span className="border-l border-[var(--border)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{otherColumnLabel}</span>
          </div>

          {/* Rows */}
          {sortedConflicts.map((conflict, index) => {
              const opponentName = isWin ? conflict.existingModName : conflict.incomingModName
              const opponentOrder = isWin ? conflict.existingOrder : conflict.incomingOrder
              const opponentTitle = `${opponentName || t('library.detail.conflictUnknownMod')}${typeof opponentOrder === 'number' ? ` #${opponentOrder + 1}` : ''}`
              const archiveHash = getArchiveConflictHash(conflict)
              const unresolved = isUnresolvedArchiveConflict(conflict)
              const displayPath = unresolved && archiveHash
                ? t('library.detail.conflictArchiveHash', { hash: archiveHash })
                : conflict.resourcePath
              return (
                <div
                  key={`${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? index}`}
                  className="grid grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)] border-b border-[var(--border-subtle)] last:border-b-0 bg-transparent transition-colors hover:bg-[var(--surface-secondary)]"
                >
                  {/* File / resource path */}
                  <div className="min-w-0 px-5 py-2 flex items-center">
                    <span
                      className={`font-mono text-[13px] break-all ${unresolved ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}
                    >
                      {displayPath}
                    </span>
                  </div>

                  {/* Other mod - full name, wraps, never truncated */}
                  <div className="min-w-0 border-l border-[var(--border)] px-5 py-2 flex items-center gap-2">
                    <span
                      className="min-w-0 text-[13px] font-medium text-[var(--text-secondary)] break-words leading-snug"
                      title={opponentTitle}
                    >
                      {opponentName || t('library.detail.conflictUnknownMod')}
                    </span>
                    {typeof opponentOrder === 'number' && (
                      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">#{opponentOrder + 1}</span>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      ) : (
        <div className="bg-[var(--surface)] px-5 py-8 text-[13px] text-[var(--text-muted)]">
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
  const { t, tn } = useTranslation()
  const isFolder = node.kind === 'folder'
  const isExpanded = isFolder && expandedIds.has(node.id)
  const selected = selectedId === node.id
  const indent = 12 + depth * 18

  return (
    <div>
      <div
        className={`flex items-center border-b border-[var(--border-subtle)] pr-3 transition-colors ${
          selected ? 'bg-[rgb(var(--accent-rgb)/0.14)]' : 'hover:bg-[var(--surface-secondary)]'
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
            className="flex h-9 w-7 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Icon name="expand_more" className={`text-[16px] transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
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
          <Icon name={isFolder ? 'folder' : 'description'} className={`text-[17px] ${isFolder ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`} />
          <span className={`min-w-0 truncate text-sm ${selected ? 'text-[var(--accent)]' : 'text-[var(--text-primary-alt)]'}`}>
            {node.name}
          </span>
        </button>

        <span className={`shrink-0 pl-4 text-sm ${selected ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
          {isFolder ? tn('library.detail.treeFileCount', node.fileCount) : t('library.detail.treeFile')}
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
