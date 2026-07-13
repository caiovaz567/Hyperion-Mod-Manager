import React, { useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { Tooltip } from './Tooltip'
import { useTranslation } from '../../i18n/I18nContext'
import { useTheme, type UiMode } from '../../theme/ThemeContext'
import { Icon } from './Icon'
import { LanguageSelect } from './LanguageSelect'

// Light / dark / system segmented toggle (mirrors the HeroUI docs header control).
const ModeToggle: React.FC = () => {
  const { t } = useTranslation()
  const { mode, setMode } = useTheme()

  const options: Array<{ id: UiMode; icon: string; label: string }> = [
    { id: 'light', icon: 'light_mode', label: t('shell.header.modeLight') },
    { id: 'dark', icon: 'dark_mode', label: t('shell.header.modeDark') },
    { id: 'system', icon: 'desktop_windows', label: t('shell.header.modeSystem') },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={t('shell.header.modeAria')}
      className="inline-flex items-center gap-0.5 rounded-lg bg-[var(--surface)] p-0.5"
    >
      {options.map((option) => {
        const active = mode === option.id
        return (
          <Tooltip key={option.id} content={option.label} side="bottom">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              onClick={() => setMode(option.id)}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                active
                  ? 'bg-[var(--surface-secondary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon name={option.icon} className="text-[16px]" />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

export const Header: React.FC = () => {
  const { t } = useTranslation()
  const {
    updateAvailable,
    updateDownloading,
    updateDownloaded,
    updateProgress,
    updateInfo,
    updateError,
    downloadUpdate,
    installUpdate,
    addToast,
    openDialog,
  } = useAppStore()
  const [autoApplyUpdate, setAutoApplyUpdate] = useState(false)

  // Same HeroUI icon-button chrome as the language/App Logs buttons so every header
  // control reads as one family.
  const chromeButtonClass = 'flex h-9 w-9 min-w-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]'

  useEffect(() => {
    if (!updateDownloaded || !autoApplyUpdate) return

    addToast(t('shell.update.downloaded'), 'info', 1800)
    const timeoutId = window.setTimeout(() => {
      installUpdate()
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [updateDownloaded, autoApplyUpdate, installUpdate, addToast])

  useEffect(() => {
    if (!updateError) return

    addToast(updateError, 'error', 4200)
  }, [updateError, addToast])

  const handleUpdateAction = async () => {
    if (updateDownloading) {
      return
    }

    if (updateDownloaded) {
      installUpdate()
      return
    }

    try {
      setAutoApplyUpdate(true)
      await downloadUpdate()
    } catch {
      setAutoApplyUpdate(false)
      addToast(t('shell.update.downloadFailed'), 'error')
    }
  }

  useEffect(() => {
    if (!updateAvailable && !updateDownloading && !updateDownloaded) {
      setAutoApplyUpdate(false)
    }
  }, [updateAvailable, updateDownloading, updateDownloaded])

  const showUpdateTrigger = updateAvailable || updateDownloading || updateDownloaded
  const updateActionLabel = updateDownloading
    ? t('shell.update.downloading', { progress: updateProgress })
    : updateDownloaded
      ? t('shell.update.installing')
      : updateInfo?.version
        ? t('shell.update.installVersion', { version: updateInfo.version })
        : t('shell.update.install')
  const updateProgressWidth = `${Math.min(Math.max(updateProgress, 0), 100)}%`
  const updateIcon = updateDownloading
    ? 'downloading'
    : updateDownloaded
      ? 'autorenew'
      : 'download_for_offline'
  const updateToneClass = updateDownloaded
    ? 'bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)]'
    : updateDownloading
      ? 'bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent)]'
      : 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]'

  return (
    <header
      className="absolute top-0 left-1/2 right-0 z-50 flex h-12 items-center justify-end px-6 bg-transparent"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* The brand mark lives at the top of the sidebar rail (Sidebar.tsx). The header is a
          floating overlay, not a layout row: content starts at the window top, so each
          view's title shares this top line with the controls. It spans only the right half
          so the title area below stays interactive; the empty half up to the controls is
          the window drag strip. */}
      {/* Right: window controls */}
      <div
        className="flex items-center gap-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showUpdateTrigger && (
          <Tooltip content={updateActionLabel} side="bottom">
            <Button
              onPress={() => void handleUpdateAction()}
              isDisabled={updateDownloading || updateDownloaded}
              variant="tertiary"
              className={`group relative flex h-9 min-w-[180px] items-center justify-center overflow-hidden rounded-lg border-0 px-4 text-[14px] font-medium transition-colors ${updateToneClass} ${
                updateDownloading || updateDownloaded ? 'cursor-default' : ''
              }`}
            >
              {updateDownloading && (
                <span
                  className="absolute inset-y-0 left-0 bg-[rgb(var(--accent-rgb)/0.22)] transition-[width] duration-200 ease-out"
                  style={{ width: updateProgressWidth }}
                />
              )}

              <span className="relative z-10 flex items-center gap-2">
                <Icon name={updateIcon} className={`text-[17px] ${updateDownloading || updateDownloaded ? 'animate-pulse' : ''}`} />
                <span>{updateActionLabel}</span>
              </span>
            </Button>
          </Tooltip>
        )}

        {updateError && !updateAvailable && (
          <div className="ui-support-mono uppercase tracking-[0.14em]">
            {t('shell.header.updateCheckFailed')}
          </div>
        )}

        <div className="flex items-center gap-2">
          <ModeToggle />
          <LanguageSelect variant="icon" align="right" />
          <Tooltip content={t('shell.header.appLogs')}>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={t('shell.header.appLogs')}
              className={chromeButtonClass}
              onPress={() => openDialog('appLogs')}
            >
              <Icon name="terminal" className="text-[18px]" />
            </Button>
          </Tooltip>
        </div>

        <div className="h-6 w-px bg-[var(--bg-subtle)]" />

        <div className="flex items-center gap-1.5">
          <Tooltip content={t('shell.header.minimize')}>
            <Button isIconOnly size="sm" variant="ghost" className={chromeButtonClass} onPress={() => IpcService.send('window:minimize')}>
              <Icon name="remove" className="text-[18px]" />
            </Button>
          </Tooltip>
          <Tooltip content={t('shell.header.maximize')}>
            <Button isIconOnly size="sm" variant="ghost" className={chromeButtonClass} onPress={() => IpcService.send('window:maximize')}>
              <Icon name="check_box_outline_blank" className="text-[18px]" />
            </Button>
          </Tooltip>
          <Tooltip content={t('common.close')}>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="flex h-9 w-9 min-w-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[#F87171]"
              onPress={() => IpcService.send('window:close')}
            >
              <Icon name="close" className="text-[18px]" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
