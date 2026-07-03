import React from 'react'
import { HyperionSortHeader, HyperionSwitch } from '../ui/HyperionPrimitives'
import { Tooltip } from '../ui/Tooltip'
import { LIBRARY_GRID_FALLBACK, type LibraryColumnWidths, type LibraryResizableColumnKey } from './libraryColumns'
import { useTranslation } from '../../i18n/I18nContext'

export type LibrarySortKey = 'name' | 'category' | 'installedAt'
export type SortDirection = 'asc' | 'desc'

export const LIBRARY_GRID_TEMPLATE = `var(--library-grid, ${LIBRARY_GRID_FALLBACK})`

const ColumnResizeHandle: React.FC<{
  columnKey: LibraryResizableColumnKey
  columnWidths: LibraryColumnWidths
  onResize: (key: LibraryResizableColumnKey, deltaPx: number, start: LibraryColumnWidths) => void
}> = ({ columnKey, columnWidths, onResize }) => {
  const { t } = useTranslation()
  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const start = columnWidths
    const onMove = (move: MouseEvent) => {
      onResize(columnKey, move.clientX - startX, start)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={t('library.header.resizeColumn', { column: columnKey })}
      onMouseDown={handleMouseDown}
      onClick={(event) => event.stopPropagation()}
      className="group/resize absolute top-0 z-20 flex h-full w-4 cursor-col-resize items-center justify-center"
      style={{ left: '-24px' }}
    >
      <span className="h-4 w-px bg-[var(--border-strong)] transition-colors group-hover/resize:bg-[var(--accent)]/70" />
    </span>
  )
}

interface LibraryTableHeaderProps {
  sortKey: LibrarySortKey | null
  sortDirection: SortDirection
  showCustomOrderBadge: boolean
  showTopLevelHeaderDrop: boolean
  topLevelDropActive: boolean
  bulkToggleDisabled: boolean
  bulkToggleTooltip: string
  isBulkToggling: boolean
  allVisibleEnabled: boolean
  columnWidths: LibraryColumnWidths
  onColumnResize: (key: LibraryResizableColumnKey, deltaPx: number, start: LibraryColumnWidths) => void
  onSort: (key: LibrarySortKey) => void
  onBulkToggle: () => void
  onTopLevelDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onTopLevelDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void
  onTopLevelDrop?: (event: React.DragEvent<HTMLDivElement>) => void
}

export const LibraryTableHeader: React.FC<LibraryTableHeaderProps> = ({
  sortKey,
  sortDirection,
  showCustomOrderBadge,
  showTopLevelHeaderDrop,
  topLevelDropActive,
  bulkToggleDisabled,
  bulkToggleTooltip,
  isBulkToggling,
  allVisibleEnabled,
  columnWidths,
  onColumnResize,
  onSort,
  onBulkToggle,
  onTopLevelDragOver,
  onTopLevelDragLeave,
  onTopLevelDrop,
}) => {
  const { t } = useTranslation()
  return (
  <div
    className="sticky top-0 z-10 grid w-full gap-4 px-5 border-b border-[var(--border)] bg-[var(--surface)]"
    onDragOver={showTopLevelHeaderDrop ? onTopLevelDragOver : undefined}
    onDragLeave={showTopLevelHeaderDrop ? onTopLevelDragLeave : undefined}
    onDrop={showTopLevelHeaderDrop ? onTopLevelDrop : undefined}
    style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
  >
    {showTopLevelHeaderDrop && (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-[background-color,box-shadow,border-color] duration-150 ${
          topLevelDropActive
            ? 'bg-[rgb(var(--accent-cyber-blue-rgb)/0.14)] shadow-[inset_0_0_0_1px_rgb(var(--accent-cyber-blue-rgb)/0.42)]'
            : 'bg-[rgb(var(--accent-cyber-blue-rgb)/0.05)] shadow-[inset_0_0_0_1px_rgb(var(--accent-cyber-blue-rgb)/0.16)]'
        }`}
      />
    )}
    {showTopLevelHeaderDrop && (
      <div className="pointer-events-none absolute inset-y-0 right-6 z-20 flex items-center">
        <span
          className={`rounded-md border-0 px-2.5 py-[4px] text-[11px] font-semibold transition-colors ${
            topLevelDropActive
              ? 'bg-[rgb(var(--accent-cyber-blue-rgb)/0.16)] text-[var(--accent-cyber-blue)]'
              : 'bg-[var(--surface)] text-[var(--text-secondary)]'
          }`}
        >
          {topLevelDropActive ? t('library.header.releaseTopLevel') : t('library.header.dragTopLevel')}
        </span>
      </div>
    )}
    <div className="flex h-8 items-center pl-2">
      <Tooltip content={bulkToggleDisabled ? bulkToggleTooltip : isBulkToggling ? t('library.header.applying') : allVisibleEnabled ? t('library.header.disableAllVisible') : t('library.header.enableAllVisible')}>
        <span className="inline-flex">
          <HyperionSwitch
            size="sm"
            isSelected={allVisibleEnabled}
            onChange={() => onBulkToggle()}
            isDisabled={bulkToggleDisabled || isBulkToggling}
            aria-label={allVisibleEnabled ? t('library.header.disableAllVisible') : t('library.header.enableAllVisible')}
          />
        </span>
      </Tooltip>
    </div>
    <div className="flex h-8 min-w-0 items-center justify-start text-[11px] uppercase tracking-[0.07em] font-medium text-[var(--text-muted)]">
      #
    </div>
    <HyperionSortHeader
      columnKey="name"
      label={t('library.header.columnName')}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel={t('library.header.sortByName')}
      className="justify-start gap-0.5"
      innerClassName="gap-0.5"
    />
    <div className="relative flex h-8 min-w-0 items-center justify-start text-[11px] uppercase tracking-[0.07em] font-medium text-[var(--text-muted)]">
      <span className="min-w-0 truncate whitespace-nowrap">{t('library.header.columnVersion')}</span>
      <ColumnResizeHandle columnKey="version" columnWidths={columnWidths} onResize={onColumnResize} />
    </div>
    <div className="relative flex min-w-0 items-center">
      <HyperionSortHeader
        columnKey="category"
        label={t('library.header.columnCategory')}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
        ariaLabel={t('library.header.sortByCategory')}
        className="justify-start gap-0.5"
        innerClassName="gap-0.5"
      />
      <ColumnResizeHandle columnKey="category" columnWidths={columnWidths} onResize={onColumnResize} />
    </div>
    <div className="relative flex min-w-0 items-center">
      <HyperionSortHeader
        columnKey="installedAt"
        label={t('library.header.columnDate')}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
        ariaLabel={t('library.header.sortByDate')}
        className="justify-start gap-0.5"
        innerClassName="gap-0.5"
      />
      <ColumnResizeHandle columnKey="date" columnWidths={columnWidths} onResize={onColumnResize} />
    </div>
    <div className="flex h-8 min-w-0 items-center justify-start text-[11px] uppercase tracking-[0.07em] font-medium text-[var(--text-muted)]">{t('library.header.columnActions')}</div>
  </div>
  )
}
