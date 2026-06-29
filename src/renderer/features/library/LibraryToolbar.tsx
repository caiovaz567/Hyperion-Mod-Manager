import React from 'react'
import type { LibraryStatusFilter } from '../../store/slices/createLibrarySlice'
import { HyperionBadge, HyperionButton, HyperionIconButton, HyperionSearchField } from '../ui/HyperionPrimitives'
import { Tooltip } from '../ui/Tooltip'
import { useTranslation } from '../../i18n/I18nContext'

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
          <h1 className="screen-title-font text-[1.42rem] font-black uppercase tracking-[0.06em] text-white sm:text-[1.58rem]">
            {t('library.toolbar.title')}
          </h1>
        </Tooltip>
        <Tooltip
          content={t('library.toolbar.quickSelectTooltip')}
          side="bottom"
          variant="help"
        >
          <span className="material-symbols-outlined cursor-help text-[16px] text-[#4a4a4a] hover:text-[#7a7a7a] transition-colors mt-0.5">help_outline</span>
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
        className="mt-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em]"
        style={{ fontFamily: '"DM Sans", sans-serif' }}
        role="group"
        aria-label={t('library.toolbar.statusFilterAria')}
      >
        {statusReadouts.map((option, index) => {
          const active = statusFilter === option.filter

          return (
            <React.Fragment key={option.filter}>
              <Tooltip content={option.tooltip} side="bottom" variant="help">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onStatusFilterChange(option.filter)}
                  className={`group relative -ml-1 inline-flex h-7 min-w-[44px] items-center gap-1.5 rounded-sm border-0 px-1.5 text-left transition-colors focus:outline-none focus-visible:bg-[#141414] focus-visible:text-[#fcee09] ${
                    active
                      ? 'text-[#fcee09]'
                      : 'text-[#898989] hover:text-[#efebe8]'
                  }`}
                >
                  <span className="brand-font text-[11px] font-bold tracking-[0.16em]">
                    {option.label}
                  </span>
                  <span className={`text-[12px] tabular-nums transition-colors ${
                    active ? 'text-[#fff6a8]' : 'text-[#6f6f6f] group-hover:text-[#c7c7c7]'
                  }`}>
                    {option.count}
                  </span>
                  {active ? (
                    <span className="absolute bottom-0 left-1.5 right-1.5 h-px bg-[#fcee09] shadow-[0_0_8px_rgba(252,238,9,0.28)]" />
                  ) : null}
                </button>
              </Tooltip>
              {index < statusReadouts.length - 1 ? (
                <span className="text-[#363636]" aria-hidden="true">|</span>
              ) : null}
            </React.Fragment>
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
              className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border-0 bg-[rgba(252,238,9,0.10)] px-3 text-[11px] brand-font font-bold uppercase tracking-[0.14em] text-[#fcee09] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] transition-colors hover:bg-[rgba(252,238,9,0.16)] hover:text-[#fff6a8] focus:outline-none focus-visible:bg-[rgba(252,238,9,0.16)]"
            >
              <span className="material-symbols-outlined text-[16px] text-current">
                {activeStatusNotice.icon}
              </span>
              <span>{activeStatusNotice.label}</span>
              <span className="material-symbols-outlined ml-1 text-[15px] text-[#aaa35a] transition-colors group-hover:text-[#fcee09]">
                close
              </span>
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
