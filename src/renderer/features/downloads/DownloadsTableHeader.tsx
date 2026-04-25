import React from 'react'
import { HyperionSortHeader } from '../ui/HyperionPrimitives'

export const DOWNLOADS_GRID_TEMPLATE =
  'minmax(580px, 4.3fr) minmax(118px, 0.74fr) minmax(112px, 0.58fr) minmax(108px, 0.52fr) minmax(140px, 0.70fr) minmax(72px, 0.28fr)'
export const DOWNLOADS_GRID_TEMPLATE_WIDE =
  'minmax(692px, 5.38fr) minmax(118px, 0.70fr) minmax(112px, 0.54fr) minmax(108px, 0.48fr) minmax(160px, 0.85fr) minmax(72px, 0.28fr)'
export const DOWNLOADS_GRID_TEMPLATE_FULLSCREEN =
  'minmax(692px, 5.38fr) minmax(118px, 0.70fr) minmax(112px, 0.54fr) minmax(108px, 0.48fr) minmax(120px, 0.60fr) minmax(64px, 0.22fr)'

export type DownloadSortKey = 'name' | 'status' | 'version' | 'size' | 'downloadedAt'
export type DownloadSortDirection = 'asc' | 'desc'

interface DownloadsTableHeaderProps {
  gridTemplate: string
  sortKey: DownloadSortKey | null
  sortDirection: DownloadSortDirection
  onSort: (key: DownloadSortKey) => void
}

export const DownloadsTableHeader: React.FC<DownloadsTableHeaderProps> = ({
  gridTemplate,
  sortKey,
  sortDirection,
  onSort,
}) => (
  <div
    className="sticky top-0 z-10 grid gap-4 px-5 border-b-[0.5px] border-[#1a1a1a] bg-[#070707]"
    style={{ gridTemplateColumns: gridTemplate }}
  >
    <HyperionSortHeader
      columnKey="name"
      label="Archive Name"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by archive name"
    />
    <HyperionSortHeader
      columnKey="status"
      label="Status"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by status"
    />
    <HyperionSortHeader
      columnKey="version"
      label="Version"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by version"
    />
    <HyperionSortHeader
      columnKey="size"
      label="Size"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by size"
      className="pl-4"
    />
    <HyperionSortHeader
      columnKey="downloadedAt"
      label="Downloaded"
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel="Sort by downloaded date"
    />
    <div className="flex h-8 items-center justify-end text-sm uppercase tracking-widest text-[#9d9d9d] brand-font font-bold">
      Actions
    </div>
  </div>
)
