import React from 'react'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import { HyperionBadge, HyperionButton, HyperionIconButton, HyperionSearchField } from '../ui/HyperionPrimitives'
import { Tooltip } from '../ui/Tooltip'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from '../ui/Icon'

interface LibraryToolbarProps {
  totalCount: number
  enabledCount: number
  filter: string
  statusFilter: LibraryStatusFilter
  showCustomOrderBadge: boolean
  onFilterChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onClearFilter: () => void
  onStatusFilterChange: (filter: LibraryStatusFilter) => void
  onOpenModsFolder: () => void
  onDeleteAll: () => void
  onInstallMod: () => void
  onCheckUpdates: () => void
  checkingUpdates: boolean
  updateCount: number
}

export const LibraryToolbar: React.FC<LibraryToolbarProps> = ({
  totalCount,
  enabledCount,
  filter,
  statusFilter,
  showCustomOrderBadge,
  onFilterChange,
  onClearFilter,
  onStatusFilterChange,
  onOpenModsFolder,
  onDeleteAll,
  onInstallMod,
  onCheckUpdates,
  checkingUpdates,
  updateCount,
}) => {
  const { t } = useTranslation()
  const disabledCount = Math.max(0, totalCount - enabledCount)
  const statusReadouts: Array<{
    filter: LibraryStatusFilter
    label: string
    count: number
    tooltip: string
  }> = [
    { filter: 'all', label: t('library.status.all'), count: totalCount, tooltip: t('library.status.showAll') },
    { filter: 'enabled', label: t('library.status.on'), count: enabledCount, tooltip: t('library.status.showEnabled') },
    { filter: 'disabled', label: t('library.status.off'), count: disabledCount, tooltip: t('library.status.showDisabled') },
  ]
  const activeStatusNotice = statusFilter === 'enabled'
    ? { icon: 'toggle_on', label: t('library.status.viewingEnabled') }
    : statusFilter === 'disabled'
      ? { icon: 'visibility_off', label: t('library.status.viewingDisabled') }
      : null

  return (
    <div className="shrink-0 px-8 pt-6 pb-3 w-full">
      <div className="flex items-center gap-2">
        <Tooltip
          content={t('library.toolbar.titleTooltip')}
          side="bottom"
          variant="help"
        >
          <h1 className="text-[1.32rem] font-bold tracking-[-0.01em] text-[var(--text-primary)] sm:text-[1.44rem]">
            {t('library.toolbar.title')}
          </h1>
        </Tooltip>
        <Tooltip
          content={t('library.toolbar.quickSelectTooltip')}
          side="bottom"
          variant="help"
        >
          <Icon name="help_outline" className="cursor-help text-[16px] text-[#4a4a4a] hover:text-[#7a7a7a] transition-colors mt-0.5" />
        </Tooltip>
        {showCustomOrderBadge && (
          <Tooltip
            content={t('library.toolbar.customOrderTooltip')}
            side="bottom"
            variant="help"
          >
            <HyperionBadge tone="accent">{t('library.toolbar.customOrder')}</HyperionBadge>
          </Tooltip>
        )}
      </div>

      <div
        className="mt-2 inline-flex items-center gap-0.5 rounded-lg bg-[var(--surface)] p-0.5"
        role="group"
        aria-label={t('library.toolbar.statusFilterAria')}
      >
        {statusReadouts.map((option) => {
          const active = statusFilter === option.filter

          return (
            <Tooltip key={option.filter} content={option.tooltip} side="bottom" variant="help">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onStatusFilterChange(option.filter)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors focus:outline-none ${
                  active
                    ? 'bg-[var(--surface-secondary)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.3)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{option.label}</span>
                <span className={`tabular-nums ${active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                  {option.count}
                </span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <HyperionSearchField
          placeholder={t('library.toolbar.searchPlaceholder')}
          value={filter}
          onChange={onFilterChange}
          onClear={onClearFilter}
        />

        {activeStatusNotice ? (
          <Tooltip content={t('library.toolbar.clearStatusFilter')} side="bottom" variant="help">
            <button
              type="button"
              onClick={() => onStatusFilterChange('all')}
              className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border-0 bg-[rgb(var(--accent-rgb)/0.10)] px-3 text-[11px] brand-font font-bold uppercase tracking-[0.14em] text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] transition-colors hover:bg-[rgb(var(--accent-rgb)/0.16)] focus:outline-none focus-visible:bg-[rgb(var(--accent-rgb)/0.16)]"
            >
              <Icon name={activeStatusNotice.icon} className="text-[16px] text-current" />
              <span>{activeStatusNotice.label}</span>
              <Icon name="close" className="ml-1 text-[15px] text-[rgb(var(--accent-rgb)/0.55)] transition-colors group-hover:text-[var(--accent)]" />
            </button>
          </Tooltip>
        ) : null}

        <div className="flex items-center gap-2">
          <HyperionButton
            onClick={onOpenModsFolder}
            variant="toolbar"
            icon="folder_open"
            className="px-5"
          >
            {t('library.toolbar.openModsFolder')}
          </HyperionButton>

          <Tooltip content={t('library.toolbar.checkUpdatesTooltip')} side="bottom" variant="help">
            <HyperionButton
              onClick={onCheckUpdates}
              variant="cyan"
              icon={checkingUpdates ? 'progress_activity' : 'sync'}
              iconClassName={checkingUpdates ? 'animate-spin' : undefined}
              disabled={checkingUpdates}
              className="px-5"
            >
              {checkingUpdates ? t('library.toolbar.checking') : updateCount > 0 ? t('library.toolbar.updatesCount', { count: updateCount }) : t('library.toolbar.checkUpdates')}
            </HyperionButton>
          </Tooltip>

        </div>

        <div className="ml-auto flex items-center gap-2">
          <HyperionIconButton
            icon="delete_forever"
            label={t('library.toolbar.deleteAllLabel')}
            tooltip={t('library.toolbar.deleteAllTooltip')}
            variant="danger"
            iconClassName="text-[22px]"
            onClick={onDeleteAll}
          />

          <HyperionButton onClick={onInstallMod} variant="primary" className="px-5 text-xs">
            {t('library.toolbar.installMod')}
          </HyperionButton>
        </div>
      </div>
    </div>
  )
}
