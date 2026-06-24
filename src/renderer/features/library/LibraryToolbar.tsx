import React, { useEffect, useRef, useState } from 'react'
import type { VfsOverwriteInfo } from '@shared/types'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import { HyperionBadge, HyperionButton, HyperionIconButton, HyperionSearchField } from '../ui/HyperionPrimitives'
import { Tooltip } from '../ui/Tooltip'

interface LibraryToolbarProps {
  totalCount: number
  enabledCount: number
  filter: string
  statusFilter: LibraryStatusFilter
  showCustomOrderBadge: boolean
  onFilterChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onStatusFilterChange: (filter: LibraryStatusFilter) => void
  onCreateSeparator: () => void
  onDeleteAll: () => void
  onInstallMod: () => void
  onCheckUpdates: () => void
  onOpenOverwrite: () => void
  onClearOverwrite: () => void
  checkingUpdates: boolean
  clearingOverwrite: boolean
  updateCount: number
  overwriteInfo: VfsOverwriteInfo | null
}

const statusFilterOptions: LibraryStatusFilter[] = ['all', 'enabled', 'disabled']

function getStatusFilterLabel(filter: LibraryStatusFilter): string {
  if (filter === 'enabled') return 'Enabled'
  if (filter === 'disabled') return 'Disabled'
  return 'All'
}

function formatOverwriteSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export const LibraryToolbar: React.FC<LibraryToolbarProps> = ({
  totalCount,
  enabledCount,
  filter,
  statusFilter,
  showCustomOrderBadge,
  onFilterChange,
  onStatusFilterChange,
  onCreateSeparator,
  onDeleteAll,
  onInstallMod,
  onCheckUpdates,
  onOpenOverwrite,
  onClearOverwrite,
  checkingUpdates,
  clearingOverwrite,
  updateCount,
  overwriteInfo,
}) => {
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)
  const statusFilterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!statusFilterOpen) return

    const close = (event: MouseEvent) => {
      if (!statusFilterRef.current?.contains(event.target as Node)) {
        setStatusFilterOpen(false)
      }
    }

    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [statusFilterOpen])

  const overwriteFileCount = overwriteInfo?.fileCount ?? 0
  const overwriteSummary = overwriteInfo
    ? `${overwriteFileCount} file${overwriteFileCount === 1 ? '' : 's'} / ${formatOverwriteSize(overwriteInfo.totalBytes)}`
    : 'Runtime files redirected from VFS launches'

  return (
    <div className="shrink-0 px-8 pt-6 pb-3 w-full">
      <div className="flex items-center gap-2">
        <Tooltip
          content={"Managed Mods: list of mods managed by the Hyperion library.\nUse the 'Install Mod' button to add a mod. Use 'Reinstall' to reinstall from the original source file."}
          side="bottom"
          variant="help"
        >
          <h1 className="brand-font text-[1.42rem] font-black uppercase tracking-[0.08em] text-white sm:text-[1.58rem]">
            Managed Mods
          </h1>
        </Tooltip>
        <Tooltip
          content={"QUICK SELECTION:\nClick in a mod and then select another mod while holding shift to select multiple mods.\nCtrl+A to select all mods."}
          side="bottom"
          variant="help"
        >
          <span className="material-symbols-outlined cursor-help text-[16px] text-[#4a4a4a] hover:text-[#7a7a7a] transition-colors mt-0.5">help_outline</span>
        </Tooltip>
        {showCustomOrderBadge && (
          <Tooltip
            content={"Custom Order active.\nDrag a mod onto a separator to group it.\nDrag before/after a row to reorder.\nDrag to the header to move a mod to top-level."}
            side="bottom"
            variant="help"
          >
            <HyperionBadge tone="accent">Custom Order</HyperionBadge>
          </Tooltip>
        )}
      </div>

      <p
        className="mt-1 flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.08em] text-[#9a9a9a]"
        style={{ fontFamily: '"DM Sans", sans-serif' }}
      >
        TOTAL: {totalCount} &nbsp;|&nbsp; ACTIVE: {enabledCount}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <HyperionSearchField
          placeholder="Search managed mods..."
          value={filter}
          onChange={onFilterChange}
        />

        <div className="flex items-center gap-2">
          <div ref={statusFilterRef} className="relative">
            <button
              type="button"
              onClick={() => setStatusFilterOpen((current) => !current)}
              className={`group flex h-10 items-center gap-2 rounded-sm border-[0.5px] pl-3 pr-3 text-xs brand-font font-bold uppercase tracking-widest transition-colors ${
                statusFilterOpen
                  ? 'border-[#fcee09]/50 bg-[#0d0d0d] text-[#fcee09]'
                  : 'border-[#fcee09]/50 bg-[#0a0a0a] text-[#cccccc] hover:border-[#fcee09]/70 hover:text-[#e8e8e8]'
              }`}
            >
              <span className={`material-symbols-outlined text-[16px] transition-colors ${statusFilterOpen ? 'text-[#fcee09]' : 'text-[#6a6a6a] group-hover:text-[#e8e8e8]'}`}>filter_list</span>
              {getStatusFilterLabel(statusFilter)}
              <span className={`material-symbols-outlined text-[14px] transition-transform transition-colors duration-150 ${statusFilterOpen ? 'rotate-180 text-[#fcee09]' : 'text-[#6a6a6a] group-hover:text-[#e8e8e8]'}`}>expand_more</span>
            </button>
            {statusFilterOpen && (
              <div className="absolute top-full left-0 mt-1 z-[200] min-w-[130px] rounded-sm border-[0.5px] border-[#222] bg-[#0a0a0a] shadow-[0_8px_24px_rgba(0,0,0,0.6)] py-1">
                {statusFilterOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      onStatusFilterChange(option)
                      setStatusFilterOpen(false)
                    }}
                    className={`flex w-full items-center px-4 py-2.5 text-xs brand-font font-bold uppercase tracking-widest transition-colors ${
                      statusFilter === option
                        ? 'text-[#fcee09] bg-[#111]'
                        : 'text-[#9d9d9d] hover:text-[#fcee09] hover:bg-[#0d0d0d]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>

          <HyperionButton onClick={onCreateSeparator} variant="toolbar" className="px-5">
            Add Separator
          </HyperionButton>

          <Tooltip content="Check installed Nexus mods for newer versions" side="bottom" variant="help">
            <HyperionButton
              onClick={onCheckUpdates}
              variant="cyan"
              icon={checkingUpdates ? 'progress_activity' : 'sync'}
              iconClassName={checkingUpdates ? 'animate-spin' : undefined}
              disabled={checkingUpdates}
              className="px-5"
            >
              {checkingUpdates ? 'Checking…' : updateCount > 0 ? `Updates (${updateCount})` : 'Check Updates'}
            </HyperionButton>
          </Tooltip>

          <Tooltip
            content={`VFS Overwrite stores runtime-generated files outside the game folder.\n${overwriteSummary}`}
            side="bottom"
            variant="help"
          >
            <HyperionButton
              onClick={onOpenOverwrite}
              variant={overwriteFileCount > 0 ? 'cyan' : 'toolbar'}
              icon="folder_open"
              className="px-5"
            >
              {overwriteFileCount > 0 ? `Overwrite (${overwriteFileCount})` : 'Overwrite'}
            </HyperionButton>
          </Tooltip>

          {overwriteFileCount > 0 && (
            <HyperionIconButton
              icon={clearingOverwrite ? 'progress_activity' : 'delete_sweep'}
              label="Clear VFS overwrite"
              tooltip="Clear runtime files from the VFS overwrite folder"
              variant="danger"
              iconClassName={clearingOverwrite ? 'animate-spin text-[20px]' : 'text-[20px]'}
              disabled={clearingOverwrite}
              onClick={onClearOverwrite}
            />
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <HyperionIconButton
            icon="delete_forever"
            label="Delete all mods"
            tooltip="Delete all mods from the current library"
            variant="danger"
            iconClassName="text-[22px]"
            onClick={onDeleteAll}
          />

          <HyperionButton onClick={onInstallMod} variant="primary" className="px-5 text-xs">
            Install Mod
          </HyperionButton>
        </div>
      </div>
    </div>
  )
}
