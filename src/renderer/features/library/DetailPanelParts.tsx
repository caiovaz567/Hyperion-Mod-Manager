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
}> = ({ conflicts, emptyMessage, mod, tone, title, collapsed, onToggleCollapsed, className, showArchiveDetails = true, modsById }) => (
  <section className={`flex min-h-0 flex-col overflow-hidden border border-[#232323] bg-[#101010] ${className ?? ''}`}>
    <button
      type="button"
      onClick={onToggleCollapsed}
      className={`flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[#141414] ${
        collapsed ? '' : 'border-b border-[#1a1a1a]'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className={`material-symbols-outlined text-[18px] text-[#8d8d8d] transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}>
            expand_more
          </span>
          <h3 className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.08em] text-[#f4f1ee]">
            {title}
          </h3>
        </div>
        <div className="mt-1 pl-8 text-sm text-[#8f8f8f]">
          {tone === 'win'
            ? 'Arquivos em que este mod vence a ordem de conflito.'
            : 'Arquivos em que outro mod vence este mod.'}
        </div>
      </div>
      <span className={`shrink-0 rounded-sm border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
        tone === 'win'
          ? 'border-[#1f5133] bg-[rgba(52,211,153,0.1)] text-[#34d399]'
          : 'border-[#5a2020] bg-[rgba(248,113,113,0.1)] text-[#f87171]'
      }`}>
        {conflicts.length} file{conflicts.length === 1 ? '' : 's'}
      </span>
    </button>

    {!collapsed && (conflicts.length > 0 ? (
      <div className="hyperion-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {conflicts.map((conflict, index) => {
          const otherModName = tone === 'win' ? conflict.existingModName : conflict.incomingModName
          const otherOrder = tone === 'win' ? conflict.existingOrder : conflict.incomingOrder
          const archiveHash = getArchiveConflictHash(conflict)
          const showArchiveHash = Boolean(showArchiveDetails && archiveHash && archiveHash !== conflict.resourcePath)
          const unresolvedArchiveHash = isUnresolvedArchiveConflict(conflict)
          const toneChipClass = tone === 'win'
            ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
            : 'border-[#5a2020] bg-[#140909] text-[#f87171]'
          const currentMod = modsById?.get(mod.uuid)
          const otherModId = tone === 'win' ? conflict.existingModId : conflict.incomingModId
          const otherMod = otherModId ? modsById?.get(otherModId) : undefined
          const currentArchiveFile = resolveConflictArchiveFile(currentMod, conflict, archiveHash)
          const otherArchiveFile = resolveConflictArchiveFile(otherMod, conflict, archiveHash)

          return (
            <div
              key={`${conflict.kind}:${conflict.resourcePath}:${conflict.existingModId}:${conflict.incomingModId ?? index}`}
              className="border-b border-[#161616] px-5 py-4 last:border-b-0"
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${toneChipClass}`}>
                      {(conflict.kind === 'archive-resource' && showArchiveDetails) ? 'Archive' : (tone === 'win' ? '+ Win' : '- Loss')}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9a9a9a]">
                      {tone === 'win' ? 'This mod wins this resource' : 'Another mod wins this resource'}
                    </span>
                  </div>

                  <div className="mt-3 border border-[#1b1b1b] bg-[#0c0c0c] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a9a9a]">
                      Resource Path
                    </div>
                    <div className="mt-2 break-all font-mono text-[13px] text-[#f1eeea]">
                      {conflict.resourcePath}
                    </div>

                    {(showArchiveHash || (showArchiveDetails && currentArchiveFile)) ? (
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#a7a7a7]">
                        {showArchiveHash ? (
                          <div className="min-w-0 break-all">
                            <span className="font-semibold text-[#d0d0d0]">
                              {unresolvedArchiveHash ? 'Unresolved archive hash' : 'Archive hash'}:
                            </span>{' '}
                            {archiveHash}
                          </div>
                        ) : null}
                        {showArchiveDetails && currentArchiveFile ? (
                          <div className="min-w-0 break-words">
                            <span className="font-semibold text-[#d0d0d0]">This archive:</span>{' '}
                            {currentArchiveFile}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="min-w-0 border border-[#1b1b1b] bg-[#0d0d0d] px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a9a9a]">
                    Other Mod
                  </div>
                  <div className="mt-2 break-words text-sm font-semibold text-[#f1eeea]">
                    {otherModName}
                  </div>
                  {typeof otherOrder === 'number' ? (
                    <div className="mt-1 text-sm text-[#9a9a9a]">
                      Position #{otherOrder + 1}
                    </div>
                  ) : null}

                  {showArchiveDetails ? (
                    <div className="mt-4 border-t border-[#1a1a1a] pt-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a9a9a]">
                        Archive Pair
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="border border-[#191919] bg-[#090909] px-3 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a8a8a]">
                            This Mod
                          </div>
                          <div className="mt-2 break-words text-sm text-[#e7e2de]">
                            {currentArchiveFile ?? 'Could not resolve archive file'}
                          </div>
                        </div>
                        <div className="border border-[#191919] bg-[#090909] px-3 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a8a8a]">
                            Other Mod
                          </div>
                          <div className="mt-2 break-words text-sm text-[#e7e2de]">
                            {otherArchiveFile ?? 'Could not resolve archive file'}
                          </div>
                        </div>
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
      <div className="flex min-h-0 flex-1 items-center px-5 py-10 text-sm text-[#8d8d8d]">
        {emptyMessage}
      </div>
    ))}
  </section>
)

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
