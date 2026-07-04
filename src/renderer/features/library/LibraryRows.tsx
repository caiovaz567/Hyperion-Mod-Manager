import React, { useMemo } from 'react'
import type { ModMetadata } from '@shared/types'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import { MemoModRow } from './ModRow'
import type { LibrarySortKey } from './LibraryTableHeader'
import { useVirtualRows } from '../../hooks/useVirtualRows'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

interface LibraryRowsProps {
  rowsRef: React.RefObject<HTMLDivElement | null>
  displayedMods: ModMetadata[]
  // The list windows itself here (not in the parent ModList) so scrolling only
  // re-renders this row list, never the whole ModList - that's what keeps scroll
  // cheap even with windowing enabled.
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  rowHeight: number
  virtualizationEnabled: boolean
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
  hasAppendInstallRow: boolean
  loadOrderMap: Map<string, number>
  selectedSet: Set<string>
  nestedModIds: Set<string>
  separatorParentByModId: Map<string, string>
  recentlyRevealedSeparatorId: string | null
  navigationHighlightModId: string | null
  conflictSeparatorTones: Map<string, 'win' | 'loss' | 'mixed'>
  draggedModIds: string[]
  sortKey: LibrarySortKey | null
  dropSeparatorId: string | null
  collapsedSeparatorSet: Set<string>
  separatorSummaryTotal: Map<string, number>
  separatorUpdateCounts: Map<string, number>
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
  scrollContainerRef,
  rowHeight,
  virtualizationEnabled,
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
  hasAppendInstallRow,
  loadOrderMap,
  selectedSet,
  nestedModIds,
  separatorParentByModId,
  recentlyRevealedSeparatorId,
  navigationHighlightModId,
  conflictSeparatorTones,
  draggedModIds,
  sortKey,
  dropSeparatorId,
  collapsedSeparatorSet,
  separatorSummaryTotal,
  separatorUpdateCounts,
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
}) => {
  const { t, tn } = useTranslation()

  // Windowing lives here so the scroll-position state that drives it re-renders
  // only this component, not the parent ModList. The +1 reserves a slot for the
  // trailing append/insert install-progress row so its height is accounted for.
  const virtual = useVirtualRows({
    containerRef: scrollContainerRef,
    count: displayedMods.length + (hasAppendInstallRow || hasInsertAfterInstallRow ? 1 : 0),
    rowHeight,
    overscan: 14,
    enabled: virtualizationEnabled,
  })
  const visibleMods = useMemo(
    () => displayedMods.slice(virtual.startIndex, Math.min(virtual.endIndex, displayedMods.length)),
    [displayedMods, virtual.endIndex, virtual.startIndex]
  )
  const virtualStartIndex = virtual.startIndex
  const paddingTop = virtualizationEnabled ? virtual.paddingTop : 0
  const paddingBottom = virtualizationEnabled ? virtual.paddingBottom : 0
  const showAppendInstallRow = hasAppendInstallRow
    && virtual.startIndex <= displayedMods.length
    && virtual.endIndex > displayedMods.length

  return (
  <div
    ref={rowsRef}
    onContextMenu={onContextMenu}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className="w-full"
    style={{ minHeight: 'calc(100% - 32px)' }}
  >
    {displayedMods.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Icon name="inventory_2" className="text-[48px] text-[var(--text-muted)]" />
        <span className="text-[var(--text-support)] text-[15px] font-mono tracking-tight">
          {filter
            ? t('library.empty.noMatch')
            : totalCount === 0
              ? t('library.empty.noneInstalled')
              : libraryStatusFilter === 'disabled' && disabledVisibleCount === 0
                ? t('library.empty.noneDisabled')
                : libraryStatusFilter === 'enabled' && enabledVisibleCount === 0
                  ? t('library.empty.noneEnabled')
                  : t('library.empty.noneAvailable')}
        </span>
        {totalCount === 0 && !filter && (
          <button
            onClick={onOpenDownloads}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--bg-base-deep)] rounded-sm text-xs brand-font font-bold uppercase tracking-widest hover:bg-white transition-colors mt-2"
          >
            <Icon name="download" className="text-[16px]" />
            {t('library.empty.downloads')}
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
                navigationHighlight={mod.uuid === navigationHighlightModId}
                conflictSeparatorTone={mod.kind === 'separator' ? (conflictSeparatorTones.get(mod.uuid) ?? null) : null}
                dragging={draggedModIds.includes(mod.uuid)}
                dragEnabled={sortKey === null}
                separatorDropTarget={mod.kind === 'separator' && dropSeparatorId === mod.uuid}
                separatorCollapsed={mod.kind === 'separator' && collapsedSeparatorSet.has(mod.uuid)}
                separatorChildCount={mod.kind === 'separator' ? (separatorSummaryTotal.get(mod.uuid) ?? 0) : 0}
                separatorUpdateCount={mod.kind === 'separator' ? (separatorUpdateCounts.get(mod.uuid) ?? 0) : 0}
                separatorMoveHint={mod.kind === 'separator' && sortKey === null && draggedModCount > 0
                  ? tn('library.separator.dropHint', draggedModCount)
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
}
