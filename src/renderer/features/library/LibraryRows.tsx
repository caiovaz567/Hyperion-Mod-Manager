import React from 'react'
import type { ModMetadata } from '@shared/types'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import { MemoModRow } from './ModRow'
import type { LibrarySortKey } from './LibraryTableHeader'

interface LibraryRowsProps {
  rowsRef: React.RefObject<HTMLDivElement>
  displayedMods: ModMetadata[]
  visibleMods: ModMetadata[]
  virtualStartIndex: number
  paddingTop: number
  paddingBottom: number
  filter: string
  totalCount: number
  libraryStatusFilter: LibraryStatusFilter
  disabledVisibleCount: number
  enabledVisibleCount: number
  deletingRows: Record<string, { startedAt: number }>
  installing: boolean
  installPlacement: string
  installTargetModId: string | null
  installTargetNested: boolean
  hasInsertAfterInstallRow: boolean
  showAppendInstallRow: boolean
  loadOrderMap: Map<string, number>
  selectedSet: Set<string>
  nestedModIds: Set<string>
  separatorParentByModId: Map<string, string>
  recentlyRevealedSeparatorId: string | null
  draggedModIds: string[]
  sortKey: LibrarySortKey | null
  dropSeparatorId: string | null
  collapsedSeparatorSet: Set<string>
  separatorSummaryTotal: Map<string, number>
  draggedModCount: number
  rowDropTarget: { targetId: string; position: 'before' | 'after' } | null
  renamingModId: string | null
  renameValue: string
  onContextMenu: (event: React.MouseEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  onOpenDownloads: () => void
  onRowSelect: (event: React.MouseEvent, mod: ModMetadata, index: number) => void
  onRowContextMenu: (event: React.MouseEvent, mod: ModMetadata) => void
  onRename: (mod: ModMetadata) => void
  onDelete: (mod: ModMetadata) => void
  onOpenDetails: (mod: ModMetadata, initialTab?: 'files' | 'conflicts') => void
  onRenameChange: (value: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  onDragStart: (event: React.DragEvent, mod: ModMetadata) => void
  onDragEnd: (event: React.DragEvent, mod: ModMetadata) => void
  onRowDragOver: (event: React.DragEvent, mod: ModMetadata) => void
  onRowDragLeave: (event: React.DragEvent, mod: ModMetadata) => void
  onRowDrop: (event: React.DragEvent, mod: ModMetadata) => void
  onSeparatorDragOver: (event: React.DragEvent, separator: ModMetadata) => void
  onSeparatorDragLeave: (event: React.DragEvent, separator: ModMetadata) => void
  onSeparatorDrop: (event: React.DragEvent, separator: ModMetadata) => void
  renderInstallRow: (nestedRow?: boolean) => React.ReactNode
  renderDeleteRow: (mod: ModMetadata, nestedRow?: boolean) => React.ReactNode
}

export const LibraryRows: React.FC<LibraryRowsProps> = ({
  rowsRef,
  displayedMods,
  visibleMods,
  virtualStartIndex,
  paddingTop,
  paddingBottom,
  filter,
  totalCount,
  libraryStatusFilter,
  disabledVisibleCount,
  enabledVisibleCount,
  deletingRows,
  installing,
  installPlacement,
  installTargetModId,
  installTargetNested,
  hasInsertAfterInstallRow,
  showAppendInstallRow,
  loadOrderMap,
  selectedSet,
  nestedModIds,
  separatorParentByModId,
  recentlyRevealedSeparatorId,
  draggedModIds,
  sortKey,
  dropSeparatorId,
  collapsedSeparatorSet,
  separatorSummaryTotal,
  draggedModCount,
  rowDropTarget,
  renamingModId,
  renameValue,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpenDownloads,
  onRowSelect,
  onRowContextMenu,
  onRename,
  onDelete,
  onOpenDetails,
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
  renderInstallRow,
  renderDeleteRow,
}) => (
  <div
    ref={rowsRef}
    onContextMenu={onContextMenu}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    style={{ minHeight: 'calc(100% - 32px)' }}
  >
    {displayedMods.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <span className="material-symbols-outlined text-[48px] text-[#7a7a7a]">inventory_2</span>
        <span className="text-[#8a8a8a] text-sm font-mono tracking-tight">
          {filter
            ? 'No mods match the search'
            : totalCount === 0
              ? 'No mods installed'
              : libraryStatusFilter === 'disabled' && disabledVisibleCount === 0
                ? 'No disabled mods'
                : libraryStatusFilter === 'enabled' && enabledVisibleCount === 0
                  ? 'No enabled mods'
                  : 'No mods available'}
        </span>
        {totalCount === 0 && !filter && (
          <button
            onClick={onOpenDownloads}
            className="flex items-center gap-2 px-4 py-2 bg-[#fcee09] text-[#050505] rounded-sm text-xs brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors mt-2"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Downloads
          </button>
        )}
      </div>
    ) : (
      <div style={{ paddingTop, paddingBottom }}>
        {visibleMods.map((mod, visibleIndex) => {
          const index = virtualStartIndex + visibleIndex
          const isDeletingRow = Boolean(deletingRows[mod.uuid])
          if (installing && installPlacement === 'replace' && mod.uuid === installTargetModId) {
            return <React.Fragment key={`install-${mod.uuid}`}>{renderInstallRow(installTargetNested)}</React.Fragment>
          }
          if (isDeletingRow) {
            return <React.Fragment key={`delete-${mod.uuid}`}>{renderDeleteRow(mod, nestedModIds.has(mod.uuid))}</React.Fragment>
          }

          const showInsertAfterRow = hasInsertAfterInstallRow && mod.uuid === installTargetModId
          return (
            <React.Fragment key={mod.uuid}>
              <MemoModRow
                mod={mod}
                index={loadOrderMap.get(mod.uuid) ?? index + 1}
                selected={selectedSet.has(mod.uuid)}
                nested={nestedModIds.has(mod.uuid)}
                animateOnEnter={mod.kind === 'mod' && separatorParentByModId.get(mod.uuid) === recentlyRevealedSeparatorId}
                dragging={draggedModIds.includes(mod.uuid)}
                dragEnabled={sortKey === null}
                separatorDropTarget={mod.kind === 'separator' && dropSeparatorId === mod.uuid}
                separatorCollapsed={mod.kind === 'separator' && collapsedSeparatorSet.has(mod.uuid)}
                separatorChildCount={mod.kind === 'separator' ? (separatorSummaryTotal.get(mod.uuid) ?? 0) : 0}
                separatorMoveHint={mod.kind === 'separator' && sortKey === null && draggedModCount > 0
                  ? `Drop ${draggedModCount} ${draggedModCount === 1 ? 'mod' : 'mods'} here`
                  : null}
                rowDropPosition={rowDropTarget?.targetId === mod.uuid ? rowDropTarget.position : null}
                onSelect={(event) => onRowSelect(event, mod, index)}
                onContextMenu={onRowContextMenu}
                onRename={onRename}
                onDelete={onDelete}
                onOpenDetails={onOpenDetails}
                isRenaming={renamingModId === mod.uuid}
                renameValue={renameValue}
                onRenameChange={onRenameChange}
                onRenameSave={onRenameSave}
                onRenameCancel={onRenameCancel}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRowDragOver={onRowDragOver}
                onRowDragLeave={onRowDragLeave}
                onRowDrop={onRowDrop}
                onSeparatorDragOver={onSeparatorDragOver}
                onSeparatorDragLeave={onSeparatorDragLeave}
                onSeparatorDrop={onSeparatorDrop}
              />
              {showInsertAfterRow ? renderInstallRow(installTargetNested) : null}
            </React.Fragment>
          )
        })}
        {showAppendInstallRow ? renderInstallRow() : null}
      </div>
    )}
  </div>
)
