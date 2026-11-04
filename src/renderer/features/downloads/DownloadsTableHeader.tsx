import React from 'react'
import { HyperionSortHeader } from '../ui/HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'

// The last column fits a 12-hour date such as 12/31/2026 11:59:59 PM. The name
// column gave up that width, so the table still fits a 1280px window.
export const DOWNLOADS_GRID_TEMPLATE =
  'minmax(516px, 4.3fr) minmax(118px, 0.74fr) minmax(112px, 0.58fr) minmax(108px, 0.52fr) minmax(196px, 0.70fr)'
export const DOWNLOADS_GRID_TEMPLATE_WIDE =
  'minmax(656px, 5.38fr) minmax(118px, 0.70fr) minmax(112px, 0.54fr) minmax(108px, 0.48fr) minmax(196px, 0.85fr)'
export const DOWNLOADS_GRID_TEMPLATE_FULLSCREEN =
  'minmax(616px, 5.38fr) minmax(118px, 0.70fr) minmax(112px, 0.54fr) minmax(108px, 0.48fr) minmax(196px, 0.60fr)'

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
}) => {
  const { t } = useTranslation()
  return (
  <div
    className="sticky top-0 z-10 grid gap-4 px-5 border-b border-[var(--border)] bg-[var(--surface)]"
    style={{ gridTemplateColumns: gridTemplate }}
  >
    <HyperionSortHeader
      columnKey="name"
      label={t('downloads.columns.name')}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel={t('downloads.sort.name')}
    />
    <HyperionSortHeader
      columnKey="status"
      label={t('downloads.columns.status')}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel={t('downloads.sort.status')}
    />
    <HyperionSortHeader
      columnKey="version"
      label={t('downloads.columns.version')}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel={t('downloads.sort.version')}
    />
    <HyperionSortHeader
      columnKey="size"
      label={t('downloads.columns.size')}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel={t('downloads.sort.size')}
      className="pl-4"
    />
    <HyperionSortHeader
      columnKey="downloadedAt"
      label={t('downloads.columns.downloaded')}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSort={onSort}
      ariaLabel={t('downloads.sort.downloaded')}
      className="justify-end"
    />
  </div>
  )
}
