import React from 'react'
import { HyperionSortHeader, HyperionSwitch } from '../ui/HyperionPrimitives'
import { Tooltip } from '../ui/Tooltip'
import { LIBRARY_GRID_FALLBACK } from './libraryColumns'
import { useTranslation } from '../../i18n/I18nContext'

export type LibrarySortKey = 'name' | 'category' | 'installedAt'
export type SortDirection = 'asc' | 'desc'

export const LIBRARY_GRID_TEMPLATE = LIBRARY_GRID_FALLBACK

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
    </div>
    <div className="flex h-8 min-w-0 items-center justify-start text-[11px] uppercase tracking-[0.07em] font-medium text-[var(--text-muted)]">{t('library.header.columnActions')}</div>
  </div>
  )
}
