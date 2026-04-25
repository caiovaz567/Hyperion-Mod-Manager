import React from 'react'
import { HyperionButton, HyperionIconButton, HyperionSearchField } from '../ui/HyperionPrimitives'

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
}) => (
  <div className="shrink-0 px-6 pt-6 pb-3 w-full">
    <h1 className="brand-font text-[1.42rem] font-black uppercase tracking-[0.08em] text-white sm:text-[1.58rem]">
      Downloads
    </h1>
    <p
      className="mt-1 flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.08em] text-[#9a9a9a]"
      style={{ fontFamily: '"DM Sans", sans-serif' }}
    >
      LOCAL: {localFileCount}
      {activeDownloadCount > 0 && <>&nbsp;|&nbsp; ACTIVE: {activeDownloadCount}</>}
      {searchQuery.trim() && <>&nbsp;|&nbsp; SHOWN: {totalRows}</>}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <HyperionSearchField
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder="Search downloads..."
      />
      <HyperionButton
        onClick={() => void onRefresh()}
        variant="toolbar"
        icon="refresh"
      >
        Refresh
      </HyperionButton>
      <HyperionButton
        onClick={onOpenFolder}
        variant="toolbar"
        icon="folder_open"
      >
        Open Folder
      </HyperionButton>
      <HyperionIconButton
        icon="delete_sweep"
        label="Delete every file in the downloads folder"
        tooltip="Delete every file in the downloads folder"
        variant="danger"
        onClick={onDeleteAll}
        disabled={localFileCount === 0}
      />
    </div>
  </div>
)
