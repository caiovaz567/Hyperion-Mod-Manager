import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { HyperionBadge } from './HyperionPrimitives'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import { useNexusAccount } from '../../hooks/useNexusAccount'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

interface NavItem {
  icon: string
  label: string
  action?: () => void
  active?: boolean
  disabled?: boolean
  badge?: string
  badgeTone?: 'active' | 'new'
}

function getAccountInitials(name?: string) {
  const trimmed = name?.trim()
  if (!trimmed) return 'NX'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}


export const Sidebar: React.FC = () => {
  const { activeView, setActiveView, addToast, settings, gamePathValid, activeDownloads, newFiles, gameRunning, checkGameRunning, killGame } = useAppStore((state) => ({
    activeView: state.activeView,
    setActiveView: state.setActiveView,
    addToast: state.addToast,
    settings: state.settings,
    gamePathValid: state.gamePathValid,
    activeDownloads: state.activeDownloads,
    newFiles: state.newFiles,
    gameRunning: state.gameRunning,
    checkGameRunning: state.checkGameRunning,
    killGame: state.killGame,
  }), shallow)
  const nexusAccount = useNexusAccount(settings?.nexusApiKey, 250)
  const { t } = useTranslation()

  useEffect(() => {
    checkGameRunning()
    const id = setInterval(checkGameRunning, 5000)
    return () => clearInterval(id)
  }, [checkGameRunning])

  const handleKillGame = async () => {
    const ok = await killGame()
    if (!ok) addToast(t('shell.game.closeFailed'), 'error')
  }

  const activeDownloadCount = activeDownloads.filter((download) =>
    download.status === 'downloading' || download.status === 'paused' || download.status === 'queued'
  ).length
  const downloadsBadge = activeDownloadCount > 0
    ? String(activeDownloadCount)
    : newFiles.length > 0
      ? 'NEW'
      : undefined

  const navItems: NavItem[] = [
    { icon: 'inventory_2', label: t('shell.nav.library'), action: () => setActiveView('library'), active: activeView === 'library' },
    {
      icon: 'download',
      label: t('shell.nav.downloads'),
      action: () => setActiveView('downloads'),
      active: activeView === 'downloads',
      badge: downloadsBadge,
      badgeTone: activeDownloadCount > 0 ? 'active' : 'new',
    },
  ]

  const settingsItem: NavItem = {
    icon: 'settings',
    label: t('shell.nav.settings'),
    action: () => setActiveView('settings'),
    active: activeView === 'settings',
  }

  const itemClass = (active?: boolean, disabled?: boolean) => `relative h-12 w-full min-w-0 rounded-none bg-transparent p-0 text-left transition-[background-color,color] duration-200 ${
    active
      ? 'text-[var(--accent)] bg-[var(--bg-base)] before:absolute before:left-0 before:w-[2px] before:h-8 before:bg-[var(--accent)] before:top-1/2 before:-translate-y-1/2'
      : disabled
        ? 'text-[var(--text-disabled)]'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-base)]'
  }`

  // Same grid as the account block above (18px inset + 44px icon column), so the avatar,
  // nav icons, and Settings gear all sit on one vertical axis in the collapsed rail.
  const itemInnerClass =
    'grid h-12 w-full items-center whitespace-nowrap px-[18px] [grid-template-columns:44px_0fr] gap-x-0 transition-[grid-template-columns,column-gap] duration-200 group-hover/sidebar:[grid-template-columns:44px_minmax(0,1fr)] group-hover/sidebar:gap-x-4'

  // Inter (the app's primary font - the nav no longer inherits the Syne brand font) with an
  // explicit color, so inactive items keep readable contrast in both light and dark modes.
  const labelClass = (active?: boolean, disabled?: boolean) => `min-w-0 overflow-hidden whitespace-nowrap text-[14.5px] font-medium opacity-0 transition-opacity duration-300 group-hover/sidebar:opacity-100 ${
    active ? 'text-[var(--accent)] font-semibold' : disabled ? 'text-[var(--text-disabled)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
  }`

  const [launching, setLaunching] = useState(false)
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (gameRunning && launching) {
      setLaunching(false)
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current)
    }
  }, [gameRunning, launching])

  const handleLaunchGame = async () => {
    if (!settings?.gamePath || !gamePathValid) {
      addToast(t('shell.game.notConfigured'), 'warning')
      return
    }
    if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current)
    setLaunching(true)

    try {
      const result = await IpcService.invoke<{ ok: boolean; error?: string; cancelled?: boolean }>(IPC.LAUNCH_GAME)
      if (result.cancelled) {
        // Cancelled launches are terminal: stop the spinner right away instead of
        // falling through to the 30s "wait for the game to appear" grace timer.
        setLaunching(false)
        return
      }
      if (!result.ok) {
        setLaunching(false)
        addToast(result.error ?? t('shell.game.launchFailed'), 'error')
        return
      }
      launchTimeoutRef.current = setTimeout(() => setLaunching(false), 30000)
    } catch (error) {
      setLaunching(false)
      addToast(error instanceof Error ? error.message : t('shell.game.launchFailed'), 'error')
    }
  }

  const isLaunchDisabled = !settings?.gamePath || !gamePathValid

  // Premium keeps its semantic gold (HeroUI warning chip) in every accent; Free follows the
  // accent color the user picked in Settings; neutral states stay muted.
  const subscriptionTone =
    nexusAccount.status === 'connected'
      ? nexusAccount.data.isPremium
        ? ('warning' as const)
        : ('accent' as const)
      : nexusAccount.status === 'checking'
        ? ('accent' as const)
        : ('neutral' as const)

  // The avatar always follows the accent color; only the subscription badge keeps the
  // semantic Premium gold.
  const avatarToneClass =
    nexusAccount.status === 'connected' || nexusAccount.status === 'checking'
      ? 'bg-[rgb(var(--accent-rgb)/0.14)] text-[var(--accent)]'
      : 'bg-[var(--surface-secondary)] text-[var(--text-primary-alt)]'

  const accountLabel =
    nexusAccount.status === 'connected'
      ? nexusAccount.data.isPremium
        ? t('shell.account.premium')
        : t('shell.account.free')
      : nexusAccount.status === 'checking'
        ? t('shell.account.checking')
        : t('shell.account.offline')

  const accountSubLabel =
    nexusAccount.status === 'connected'
      ? t('shell.account.connected')
      : nexusAccount.status === 'checking'
        ? t('shell.account.validating')
        : t('shell.account.notConnected')

  return (
    <nav className="group/sidebar slide-in-left fixed left-0 top-14 bottom-0 z-40 flex w-20 flex-col overflow-hidden border-r-[0.5px] border-[var(--bg-subtle)] bg-[var(--bg-base-deep)] py-8 text-[15px] text-[var(--accent)] hover:w-64 transition-[width] duration-200 ease-in-out [will-change:width] [contain:layout_paint] [transform:translateZ(0)]">
      <div className="mb-8 grid h-11 w-full items-center whitespace-nowrap px-[18px] [grid-template-columns:44px_0fr] gap-x-0 transition-[grid-template-columns,column-gap] duration-200 group-hover/sidebar:[grid-template-columns:44px_minmax(0,1fr)] group-hover/sidebar:gap-x-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-0 text-[13px] font-bold tracking-[0.14em] transition-colors duration-150 ${avatarToneClass}`}
        >
          {nexusAccount.status === 'connected' ? (
            getAccountInitials(nexusAccount.data.name)
          ) : (
            <Icon name={nexusAccount.status === 'checking' ? 'sync' : 'person'} className="text-[18px]" />
          )}
        </div>
        <div className="pointer-events-none min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
          <div className="truncate text-xs font-bold tracking-wider text-[var(--text-primary-alt)]">
            {nexusAccount.status === 'connected' ? nexusAccount.data.name : t('shell.account.name')}
          </div>
          <div className="mt-1 flex flex-col items-start gap-1">
            <HyperionBadge tone={subscriptionTone} size="sm">
              {accountLabel}
            </HyperionBadge>
            <span className="text-[10px] tracking-widest text-[var(--text-support)]">{accountSubLabel}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex w-full flex-1 flex-col gap-2">
        {navItems.map((item) => (
          <Button
            key={item.icon}
            onPress={item.action}
            isDisabled={item.disabled}
            variant="ghost"
            fullWidth
            className={itemClass(item.active, item.disabled)}
          >
            <span className={itemInnerClass}>
              <span className="relative flex h-11 w-11 items-center justify-center">
                <Icon name={item.icon} className={`text-[22px] ${item.active ? 'drop-shadow-[0_0_4px_rgb(var(--accent-rgb)/0.3)]' : ''}`} />
                {item.badge ? (
                  <span
                    className="absolute -right-1 -top-0.5 inline-flex min-w-[20px] items-center justify-center rounded-md border-0 bg-[rgb(var(--accent-rgb)/0.18)] px-1.5 py-[2px] font-sans text-[9px] font-semibold leading-none tracking-[0.04em] text-[var(--accent)] transition-opacity duration-150"
                  >
                    {item.badge}
                  </span>
                ) : null}
              </span>
              <span className={labelClass(item.active, item.disabled)}>
                {item.label}
              </span>
            </span>
          </Button>
        ))}
      </div>
      <div className="mt-auto w-full">
        <Button
          onPress={settingsItem.action}
          variant="ghost"
          fullWidth
          className={itemClass(settingsItem.active)}
        >
          <span className={itemInnerClass}>
            <span className="flex h-11 w-11 items-center justify-center">
              <Icon name={settingsItem.icon} className={`text-[22px] ${settingsItem.active ? 'drop-shadow-[0_0_4px_rgb(var(--accent-rgb)/0.3)]' : ''}`} />
            </span>
            <span className={labelClass(settingsItem.active)}>
              {settingsItem.label}
            </span>
          </span>
        </Button>
      </div>
      <div className="px-4 mt-4 w-full flex flex-col gap-2">
        <Button
          onPress={gameRunning || launching ? undefined : handleLaunchGame}
          isDisabled={isLaunchDisabled && !gameRunning && !launching}
          fullWidth
          variant={!gameRunning && !launching && !isLaunchDisabled ? 'primary' : 'tertiary'}
          className={`h-auto min-w-0 w-full overflow-hidden rounded-lg border-0 px-2 py-3 text-[14px] font-semibold whitespace-nowrap transition-[background-color,color] duration-150 ${
            gameRunning
              ? 'bg-[rgba(52,211,153,0.14)] text-[#34D399] cursor-default'
              : launching
                ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent)] cursor-default'
                : isLaunchDisabled
                  ? 'bg-[var(--surface-secondary)] text-[var(--text-disabled)] cursor-not-allowed'
                  : 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]'
          }`}
        >
          <span className="flex items-center justify-center">
            {launching ? (
              <svg className="shrink-0 animate-spin text-current" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <Icon name={gameRunning ? 'sports_esports' : 'play_arrow'} className="shrink-0 text-[18px]" />
            )}
            <span className="grid [grid-template-columns:0fr] items-center transition-[grid-template-columns,margin] duration-150 group-hover/sidebar:ml-2 group-hover/sidebar:[grid-template-columns:1fr]">
              <span className="overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                {gameRunning ? t('shell.game.inGame') : launching ? t('shell.game.launching') : t('shell.game.launch')}
              </span>
            </span>
          </span>
        </Button>
        {gameRunning && (
          <Button
            onPress={handleKillGame}
            fullWidth
            variant="danger-soft"
            className="h-auto min-w-0 w-full overflow-hidden rounded-lg border-0 px-2 py-3 text-[14px] font-semibold whitespace-nowrap bg-[rgba(248,113,113,0.12)] text-[var(--status-error)] hover:bg-[rgba(248,113,113,0.2)] transition-[background-color] duration-150"
          >
            <span className="flex items-center justify-center">
              <Icon name="power_settings_new" className="shrink-0 text-[18px]" />
              <span className="grid [grid-template-columns:0fr] items-center transition-[grid-template-columns,margin] duration-150 group-hover/sidebar:ml-2 group-hover/sidebar:[grid-template-columns:1fr]">
                <span className="overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                  {t('shell.game.close')}
                </span>
              </span>
            </span>
          </Button>
        )}
      </div>
    </nav>
  )
}
