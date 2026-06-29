import React from 'react'
import { HyperionButton, HyperionIconButton, HyperionSearchField } from '../ui/HyperionPrimitives'
import { useTranslation } from '../../i18n/I18nContext'

interface DownloadsToolbarProps {
  searchQuery: string
  localFileCount: number
  activeDownloadCount: number
  totalRows: number
  onSearchQueryChange: (value: string) => void
  onRefresh: () => void | Promise<void>
  onOpenFolder: () => void
  onDeleteAll: () => void
}

export const DownloadsToolbar: React.FC<DownloadsToolbarProps> = ({
  searchQuery,
  localFileCount,
  activeDownloadCount,
  totalRows,
  onSearchQueryChange,
  onRefresh,
  onOpenFolder,
  onDeleteAll,
}) => {
  const { t } = useTranslation()
  return (
  <div className="shrink-0 px-6 pt-6 pb-3 w-full">
    <h1 className="screen-title-font text-[1.42rem] font-black uppercase tracking-[0.06em] text-white sm:text-[1.58rem]">
      {t('downloads.title')}
    </h1>
    <p
      className="mt-1 flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.08em] text-[#9a9a9a]"
      style={{ fontFamily: '"DM Sans", sans-serif' }}
    >
      {t('downloads.summary.local')}: {localFileCount}
      {activeDownloadCount > 0 && <>&nbsp;|&nbsp; {t('downloads.summary.active')}: {activeDownloadCount}</>}
      {searchQuery.trim() && <>&nbsp;|&nbsp; {t('downloads.summary.shown')}: {totalRows}</>}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <HyperionSearchField
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder={t('downloads.searchPlaceholder')}
      />
      <HyperionButton
        onClick={() => void onRefresh()}
        variant="toolbar"
        icon="refresh"
      >
        {t('common.refresh')}
      </HyperionButton>
      <HyperionButton
        onClick={onOpenFolder}
        variant="toolbar"
        icon="folder_open"
      >
        {t('downloads.openFolder')}
      </HyperionButton>
      <div className="ml-auto">
        <HyperionIconButton
          icon="delete_sweep"
          label={t('downloads.deleteAllTooltip')}
          tooltip={t('downloads.deleteAllTooltip')}
          variant="danger"
          onClick={onDeleteAll}
          disabled={localFileCount === 0}
        />
      </div>
    </div>
  </div>
  )
}
