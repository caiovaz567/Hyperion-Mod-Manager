import React from 'react'
import { HyperionSortHeader } from '../ui/HyperionPrimitives'
import { Tooltip } from '../ui/Tooltip'

export type LibrarySortKey = 'name' | 'type' | 'installedAt'
export type SortDirection = 'asc' | 'desc'

export const LIBRARY_GRID_TEMPLATE = '64px 56px minmax(320px,1fr) 110px 156px 184px 96px'

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
}) => (
  <div
    className="sticky top-0 z-10 grid gap-4 px-5 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
    onDragOver={showCustomOrderBadge ? onTopLevelDragOver : undefined}
    onDragLeave={showCustomOrderBadge ? onTopLevelDragLeave : undefined}
    onDrop={showCustomOrderBadge ? onTopLevelDrop : undefined}
    style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
  >
    {showTopLevelHeaderDrop && (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-[background-color,box-shadow,border-color] duration-150 ${
          topLevelDropActive
            ? 'bg-[#06141a]/94 shadow-[inset_0_0_0_1px_rgba(79,216,255,0.42)]'
            : 'bg-[#070707]/82 shadow-[inset_0_0_0_1px_rgba(79,216,255,0.16)]'
        }`}
      />
    )}
    {showTopLevelHeaderDrop && (
      <div className="pointer-events-none absolute inset-y-0 right-6 z-20 flex items-center">
        <span
          className={`rounded-sm border-[0.5px] px-2.5 py-[4px] text-[10px] brand-font font-bold uppercase tracking-[0.16em] transition-colors ${
            topLevelDropActive
              ? 'border-[#4fd8ff]/55 bg-[#04141b] text-[#4fd8ff]'
              : 'border-[#2b2b2b] bg-[#0b0b0b] text-[#8a8a8a]'
          }`}
        >
          {topLevelDropActive ? 'Release For Top Level' : 'Drag Here For Top Level'}
        </span>
      </div>
    )}
    <div className="flex h-8 items-center pl-2">
      <Tooltip content={bulkToggleDisabled ? bulkToggleTooltip : isBulkToggling ? 'Applying...' : allVisibleEnabled ? 'Disable all visible mods' : 'Enable all visible mods'}>
        <span className="inline-flex">
          <button
            type="button"
            onClick={onBulkToggle}
            disabled={bulkToggleDisabled || isBulkToggling}
            className={`relative h-4 w-8 rounded-full border-[0.5px] transition-all duration-200 ${
              bulkToggleDisabled
                ? 'cursor-not-allowed border-[#1a1a1a] bg-[#0a0a0a]'
                : isBulkToggling
                  ? 'cursor-wait border-[#fcee09]/50 bg-[#2a2604]'
                  : allVisibleEnabled
                    ? 'border-[#fcee09]/45 bg-[#2a2604] hover:border-[#fcee09]/65'
                    : 'border-[#222] bg-[#111] hover:border-[#333]'
            }`}
          >
            <div className={`absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full transition-all duration-200 ${
              bulkToggleDisabled
                ? 'left-[2px] bg-[#2a2a2a]'
                : allVisibleEnabled
                  ? 'right-[1px] bg-[#fcee09]'
                  : 'left-[2px] bg-[#5a5a5a]'
            }`} />
          </button>
        </span>
      </Tooltip>
    </div>
    <div className="flex h-8 items-center justify-start text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">#</div>
    <HyperionSortHeader
      columnKey="name"
      label="Mod Name"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by mod name"
      className="justify-start gap-0.5"
      innerClassName="gap-0.5"
    />
    <div className="flex h-8 items-center justify-start text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">Version</div>
    <HyperionSortHeader
      columnKey="type"
      label="Type"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by type"
      className="justify-start gap-0.5"
      innerClassName="gap-0.5"
    />
    <HyperionSortHeader
      columnKey="installedAt"
      label="Date"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by installed date"
      className="justify-start gap-0.5"
      innerClassName="gap-0.5"
    />
    <div className="flex h-8 items-center justify-end text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">Actions</div>
  </div>
)
