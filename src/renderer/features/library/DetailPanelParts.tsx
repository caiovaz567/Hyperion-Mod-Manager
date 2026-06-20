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
  const headerText = isWin
    ? 'This mod has priority for these resources.'
    : 'Another mod currently has priority here.'
  const countLabel = showArchiveDetails
    ? `${conflicts.length} resource${conflicts.length === 1 ? '' : 's'}`
    : `${conflicts.length} path${conflicts.length === 1 ? '' : 's'}`

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden border-[0.5px] bg-[#0c0c0c] ${className ?? ''}`}
      style={{
        borderColor: isWin ? 'rgba(52,211,153,0.22)' : 'rgba(248,113,113,0.22)',
      }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[#111] ${
          collapsed ? '' : 'border-b border-[#171717]'
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={`material-symbols-outlined text-[18px] text-[#8d8d8d] transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}>
              expand_more
            </span>
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: accent, boxShadow: `0 0 10px ${accent}55` }}
            />
            <h3 className="brand-font text-[0.92rem] font-bold uppercase tracking-[0.1em] text-[#f4f1ee]">
              {title}
            </h3>
          </div>
          <div className="mt-1 pl-[52px] text-sm text-[#9a9a9a]">
            {headerText}
          </div>
        </div>
        <span
          className="shrink-0 rounded-sm border-[0.5px] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{
            color: accent,
            borderColor: `${accent}55`,
            background: `${accent}14`,
          }}
        >
          {countLabel}
        </span>
      </button>

      {!collapsed && (conflicts.length > 0 ? (
        <div className="hyperion-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {conflicts.map((conflict, index) => {
            const otherModName = isWin ? conflict.existingModName : conflict.incomingModName
            const otherOrder = isWin ? conflict.existingOrder : conflict.incomingOrder
            const archiveHash = getArchiveConflictHash(conflict)
            const showArchiveHash = Boolean(showArchiveDetails && archiveHash && archiveHash !== conflict.resourcePath)
            const unresolvedArchiveHash = isUnresolvedArchiveConflict(conflict)
            const currentMod = modsById?.get(mod.uuid) ?? mod
            const otherModId = isWin ? conflict.existingModId : conflict.incomingModId
            const otherMod = otherModId ? modsById?.get(otherModId) : undefined
            const currentArchiveFile = resolveConflictArchiveFile(currentMod, conflict, archiveHash)
            const otherArchiveFile = resolveConflictArchiveFile(otherMod, conflict, archiveHash)
            const rowKind = conflict.kind === 'archive-resource' && showArchiveDetails
              ? 'Archive resource'
              : 'File path'
            const outcomeText = isWin ? 'This mod wins' : 'Other mod wins'

            return (
              <div
                key={`${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? index}`}
                className="group relative border-b border-[#151515] px-5 py-3.5 transition-colors last:border-b-0 hover:bg-[#101010]"
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-y-3 left-0 w-[2px] opacity-70 transition-opacity group-hover:opacity-100"
                  style={{ background: accent, boxShadow: `0 0 10px ${accent}44` }}
                />
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(230px,280px)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-sm border-[0.5px] px-2 py-[3px] text-[9px] brand-font font-bold uppercase tracking-[0.14em]"
                        style={{
                          color: accent,
                          borderColor: `${accent}55`,
                          background: `${accent}12`,
                        }}
                      >
                        {outcomeText}
                      </span>
                      <span className="text-[10px] brand-font font-bold uppercase tracking-[0.16em] text-[#777]">
                        {rowKind}
                      </span>
                    </div>

                    <div className="mt-2 break-all font-mono text-[13px] leading-relaxed text-[#f1eeea]">
                      {conflict.resourcePath}
                    </div>

                    {(showArchiveHash || currentArchiveFile) ? (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-[#a7a7a7]">
                        {showArchiveHash ? (
                          <span className="min-w-0 break-all">
                            <span className="text-[#d0d0d0]">
                              {unresolvedArchiveHash ? 'Unresolved hash' : 'Hash'}:
                            </span>{' '}
                            {archiveHash}
                          </span>
                        ) : null}
                        {currentArchiveFile ? (
                          <span className="min-w-0 break-words">
                            <span className="text-[#d0d0d0]">This archive:</span>{' '}
                            {currentArchiveFile}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 border-l border-[#1b1b1b] pl-4">
                    <div className="text-[10px] brand-font font-bold uppercase tracking-[0.16em] text-[#777]">
                      Against
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-[#f1eeea]">
                      {otherModName || 'Unknown mod'}
                    </div>
                    {typeof otherOrder === 'number' ? (
                      <div className="mt-0.5 text-xs text-[#9a9a9a]">
                        Load order #{otherOrder + 1}
                      </div>
                    ) : null}

                    {showArchiveDetails && (currentArchiveFile || otherArchiveFile) ? (
                      <div className="mt-3 grid gap-1.5 text-xs text-[#a7a7a7]">
                        <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                          <span className="text-[#777]">This</span>
                          <span className="truncate text-[#d8d8d8]">{currentArchiveFile ?? 'Unknown archive'}</span>
                        </div>
                        <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                          <span className="text-[#777]">Other</span>
                          <span className="truncate text-[#d8d8d8]">{otherArchiveFile ?? 'Unknown archive'}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center px-5 py-8 text-sm text-[#8d8d8d]">
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
