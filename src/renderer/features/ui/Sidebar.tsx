import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import type { GameLaunchProgress, IpcResult } from '@shared/types'
import { useNexusAccount } from '../../hooks/useNexusAccount'

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

const DEFAULT_LAUNCH_PROGRESS: GameLaunchProgress = {
  step: 'Preparing VFS launch',
  percent: 4,
  detail: 'Starting Hyperion launch pipeline',
  state: 'running',
  cancellable: true,
}

const LaunchProgressDialog: React.FC<{
  progress: GameLaunchProgress
  cancelling: boolean
  onCancel: () => void
}> = ({ progress, cancelling, onCancel }) => {
  const percent = Math.max(4, Math.min(Math.round(progress.percent || 0), 100))
  const isDone = progress.state === 'done'
  const isError = progress.state === 'error'
  const isCancelled = progress.state === 'cancelled'
  const canCancel = Boolean(progress.cancellable) && !cancelling && !isDone && !isError && !isCancelled
  const accent = isError
    ? '#ff5b6e'
    : isCancelled
      ? '#a3a3a3'
      : isDone
        ? '#34d399'
        : '#fcee09'
  const detail = progress.detail || progress.logPath || 'Preparing virtual file system'

  const openLog = () => {
    if (!progress.logPath) return
    void IpcService.invoke(IPC.OPEN_PATH, progress.logPath)
  }

  return createPortal(
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/76 px-4 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[430px] overflow-hidden rounded-sm border-[0.5px] bg-[#070707] px-5 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.72)]"
        style={{ borderColor: `${accent}55` }}
      >
        <div
          className="absolute left-0 top-0 h-[2px] w-full"
          style={{ background: accent, boxShadow: `0 0 14px ${accent}55` }}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" style={{ color: accent }}>
                {isDone ? 'check_circle' : isError ? 'error' : isCancelled ? 'block' : 'folder_managed'}
              </span>
              <div className="brand-font text-[1rem] font-bold uppercase tracking-[0.14em] text-white">
                Preparing VFS
              </div>
              <span
                className="rounded-sm border-[0.5px] px-2 py-0.5 ui-support-mono text-[10px] uppercase tracking-[0.14em]"
                style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }}
              >
                {progress.state ?? 'running'}
              </span>
            </div>
            <div className="mt-2 text-sm text-[#d0d0d0]">
              {progress.step}
            </div>
          </div>
          <button
            type="button"
            onClick={openLog}
            disabled={!progress.logPath}
            className="shrink-0 rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#bdbdbd] transition-colors hover:border-[#fcee09]/40 hover:text-[#fcee09] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Log
          </button>
        </div>

        <div className="mt-5 rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0b0b0b] px-4 py-3">
          <div className="truncate ui-support-mono text-[11px] uppercase tracking-[0.14em] text-[#8f8f8f]">
            {detail}
          </div>
          <div className="mt-3 h-6 overflow-hidden rounded-sm border-[0.5px] border-[#2a2a2a] bg-[#151515]">
            <div
              className="h-full transition-[width,background-color] duration-300"
              style={{ width: `${percent}%`, background: accent, boxShadow: `0 0 16px ${accent}44` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-mono">
            <span style={{ color: accent }}>
              {progress.current !== undefined && progress.total !== undefined
                ? `${progress.current}/${progress.total}`
                : isDone
                  ? 'Ready'
                  : cancelling
                    ? 'Cancelling'
                    : 'Working'}
            </span>
            <span className="text-[#d8d8d8]">{percent}%</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={!canCancel}
            className="rounded-sm border-[0.5px] border-[#454545] bg-[#111] px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#e5e2e1] transition-colors hover:border-[#fcee09]/45 hover:text-[#fcee09] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
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

  useEffect(() => {
    checkGameRunning()
    const id = setInterval(checkGameRunning, 5000)
    return () => clearInterval(id)
  }, [checkGameRunning])

  const handleKillGame = async () => {
    const ok = await killGame()
    if (!ok) addToast('Could not close game', 'error')
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
    { icon: 'inventory_2', label: 'Mod Library', action: () => setActiveView('library'), active: activeView === 'library' },
    {
      icon: 'download',
      label: 'Downloads',
      action: () => setActiveView('downloads'),
      active: activeView === 'downloads',
      badge: downloadsBadge,
      badgeTone: activeDownloadCount > 0 ? 'active' : 'new',
    },
  ]

  const settingsItem: NavItem = {
    icon: 'settings',
    label: 'Settings',
    action: () => setActiveView('settings'),
    active: activeView === 'settings',
  }

  const itemClass = (active?: boolean, disabled?: boolean) => `relative flex h-12 w-full items-center gap-4 pl-7 pr-6 text-left transition-[background-color,color] duration-200 ${
    active
      ? 'text-[#fcee09] bg-[#0a0a0a] before:absolute before:left-0 before:w-[2px] before:h-8 before:bg-[#fcee09] before:top-1/2 before:-translate-y-1/2'
      : disabled
        ? 'text-[#7f7f7f]'
        : 'text-[#7f7f7f] hover:text-white hover:bg-[#0a0a0a]'
  }`

  const labelClass = (active?: boolean, disabled?: boolean) => `ml-4 whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover/sidebar:opacity-100 tracking-wider ${
    active ? 'text-[#fcee09]' : disabled ? 'text-[#8a8a8a]' : ''
  }`

  const [launching, setLaunching] = useState(false)
  const [launchProgress, setLaunchProgress] = useState<GameLaunchProgress | null>(null)
  const [launchCancelling, setLaunchCancelling] = useState(false)
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const launchProgressHideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (gameRunning && launching) {
      setLaunching(false)
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current)
    }
  }, [gameRunning, launching])

  useEffect(() => {
    const unsubscribe = IpcService.on(IPC.LAUNCH_GAME_PROGRESS, (...args) => {
      const progress = args[0] as GameLaunchProgress
      if (launchProgressHideRef.current) {
        clearTimeout(launchProgressHideRef.current)
        launchProgressHideRef.current = null
      }

      setLaunchProgress(progress)
      if (progress.state === 'running') setLaunchCancelling(false)
      if (progress.state === 'done' || progress.state === 'cancelled') {
        launchProgressHideRef.current = setTimeout(() => {
          setLaunchProgress(null)
          setLaunchCancelling(false)
        }, progress.state === 'done' ? 700 : 1000)
      }
    })

    return () => {
      unsubscribe()
      if (launchProgressHideRef.current) clearTimeout(launchProgressHideRef.current)
    }
  }, [])

  const handleCancelLaunch = async () => {
    if (!launchProgress?.cancellable || launchCancelling) return
    setLaunchCancelling(true)
    setLaunchProgress((current) => current
      ? {
        ...current,
        step: 'Cancelling launch',
        detail: 'Waiting for VFS preparation to stop',
        cancellable: false,
      }
      : current)
    await IpcService.invoke<IpcResult>(IPC.CANCEL_GAME_LAUNCH)
  }

  const handleLaunchGame = async () => {
    if (!settings?.gamePath || !gamePathValid) {
      addToast('Game path not configured — check Settings', 'warning')
      return
    }
    if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current)
    if (launchProgressHideRef.current) clearTimeout(launchProgressHideRef.current)
    setLaunching(true)
    setLaunchCancelling(false)
    setLaunchProgress(DEFAULT_LAUNCH_PROGRESS)

    try {
      const result = await IpcService.invoke<{ ok: boolean; error?: string; cancelled?: boolean }>(IPC.LAUNCH_GAME)
      if (!result.ok) {
        setLaunching(false)
        if (!result.cancelled) {
          addToast(result.error ?? 'Could not launch game', 'error')
          setLaunchProgress(null)
        }
        return
      }

      launchTimeoutRef.current = setTimeout(() => {
        setLaunching(false)
      }, 30000)
    } catch (error) {
      setLaunching(false)
      setLaunchProgress(null)
      addToast(error instanceof Error ? error.message : 'Could not launch game', 'error')
    }
  }

  const isLaunchDisabled = !settings?.gamePath || !gamePathValid

  const subscriptionToneClass =
    nexusAccount.status === 'connected'
      ? nexusAccount.data.isPremium
        ? 'border-[#6a5714] bg-[#151003] text-[#f7d154]'
        : 'border-[#1e3a5f] bg-[#071524] text-[#60a5fa]'
      : nexusAccount.status === 'checking'
        ? 'border-[#4a3f08] bg-[#0d0b00] text-[#fcee09]'
        : 'border-[#2a2a2a] bg-[#111111] text-[#8a8a8a]'

  const avatarToneClass =
    nexusAccount.status === 'connected'
      ? nexusAccount.data.isPremium
        ? 'border-[#6a5714] bg-[#151003] text-[#f7d154]'
        : 'border-[#1e3a5f] bg-[#071524] text-[#60a5fa]'
      : nexusAccount.status === 'checking'
        ? 'border-[#4a3f08] bg-[#0d0b00] text-[#fcee09]'
        : 'border-[#222] bg-[#111] text-[#e5e2e1]'

  const accountLabel =
    nexusAccount.status === 'connected'
      ? nexusAccount.data.isPremium
        ? 'PREMIUM'
        : 'FREE'
      : nexusAccount.status === 'checking'
        ? 'CHECKING'
        : 'OFFLINE'

  const accountSubLabel =
    nexusAccount.status === 'connected'
      ? 'NEXUS CONNECTED'
      : nexusAccount.status === 'checking'
        ? 'VALIDATING'
        : 'NOT CONNECTED'

  return (
    <nav className="group/sidebar slide-in-left fixed left-0 top-14 bottom-0 z-40 flex w-20 flex-col overflow-hidden border-r-[0.5px] border-[#1a1a1a] bg-[#050505] py-8 text-sm tracking-tight text-[#fcee09] hover:w-64 transition-[width] duration-200 ease-in-out [will-change:width] [contain:layout_paint] [transform:translateZ(0)] brand-font font-semibold">
      <div className="mb-8 grid h-11 w-full items-center whitespace-nowrap px-[18px] [grid-template-columns:44px_0fr] gap-x-0 transition-[grid-template-columns,column-gap] duration-200 group-hover/sidebar:[grid-template-columns:44px_minmax(0,1fr)] group-hover/sidebar:gap-x-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-[0.5px] text-[12px] font-bold tracking-[0.14em] transition-colors duration-150 ${avatarToneClass}`}
        >
          {nexusAccount.status === 'connected' ? (
            getAccountInitials(nexusAccount.data.name)
          ) : (
            <span className="material-symbols-outlined text-[18px]">
              {nexusAccount.status === 'checking' ? 'sync' : 'person'}
            </span>
          )}
        </div>
        <div className="pointer-events-none min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
          <div className="truncate text-xs font-bold tracking-wider text-[#e5e2e1]">
            {nexusAccount.status === 'connected' ? nexusAccount.data.name : 'NEXUS ACCOUNT'}
          </div>
          <div className="mt-1 flex flex-col items-start gap-1">
            <span
              className={`inline-flex h-5 items-center rounded-sm border-[0.5px] px-2 text-[9px] font-semibold tracking-[0.16em] ${subscriptionToneClass}`}
            >
              {accountLabel}
            </span>
            <span className="text-[10px] tracking-widest text-[#8f8f8f]">{accountSubLabel}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex w-full flex-1 flex-col gap-2">
        {navItems.map((item) => (
          <button
            key={item.label}
            onClick={item.action}
            disabled={item.disabled}
            className={itemClass(item.active, item.disabled)}
          >
            <span className={`material-symbols-outlined flex h-6 w-6 shrink-0 items-center justify-center ${item.active ? 'drop-shadow-[0_0_4px_rgba(252,238,9,0.3)]' : ''}`}>
              {item.icon}
            </span>
            {item.badge ? (
              <span
                className={`absolute left-[38px] top-[7px] inline-flex min-w-[20px] items-center justify-center rounded-sm border-[0.5px] px-1 py-[1px] text-[8px] font-bold leading-none tracking-[0.08em] transition-opacity duration-150 ${
                  item.badgeTone === 'active'
                    ? 'border-[#fcee09]/45 bg-[#171400] text-[#fcee09] shadow-[0_0_10px_rgba(252,238,9,0.16)]'
                    : 'border-[#4fd8ff]/35 bg-[#061117] text-[#9feaff]'
                }`}
              >
                {item.badge}
              </span>
            ) : null}
            <span className={labelClass(item.active, item.disabled)}>
              {item.label}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-auto w-full">
        <button
          onClick={settingsItem.action}
          className={itemClass(settingsItem.active)}
        >
          <span className={`material-symbols-outlined flex h-6 w-6 shrink-0 items-center justify-center ${settingsItem.active ? 'drop-shadow-[0_0_4px_rgba(252,238,9,0.3)]' : ''}`}>
            {settingsItem.icon}
          </span>
          <span className={labelClass(settingsItem.active)}>
            {settingsItem.label}
          </span>
        </button>
      </div>
      <div className="px-4 mt-4 w-full flex flex-col gap-2">
        <button
          onClick={gameRunning || launching ? undefined : handleLaunchGame}
          disabled={isLaunchDisabled && !gameRunning && !launching}
          className={`w-full overflow-hidden rounded-sm px-2 py-3 text-xs font-bold tracking-widest whitespace-nowrap transition-[background-color,color,border-color,box-shadow] duration-150 ${
            gameRunning
              ? 'bg-[#0c1410] border-[0.5px] border-[#34D399]/30 text-[#34D399] cursor-default'
              : launching
                ? 'bg-[#1a1600] border-[0.5px] border-[#fcee09]/30 text-[#fcee09]/60 cursor-default'
                : isLaunchDisabled
                  ? 'bg-[#262626] text-[#8a8a8a] cursor-not-allowed'
                  : 'bg-[#fcee09] text-[#050505] hover:bg-white shadow-[0_0_20px_rgba(252,238,9,0.15)]'
          }`}
        >
          <span className="flex items-center justify-center">
            {launching ? (
              <svg className="shrink-0 animate-spin text-[#fcee09]/60" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <span className="material-symbols-outlined shrink-0 text-[18px]">
                {gameRunning ? 'sports_esports' : 'play_arrow'}
              </span>
            )}
            <span className="grid [grid-template-columns:0fr] items-center transition-[grid-template-columns,margin] duration-150 group-hover/sidebar:ml-2 group-hover/sidebar:[grid-template-columns:1fr]">
              <span className="overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                {gameRunning ? 'IN GAME' : launching ? 'LAUNCHING...' : 'LAUNCH GAME'}
              </span>
            </span>
          </span>
        </button>
        {gameRunning && (
          <button
            onClick={handleKillGame}
            className="w-full overflow-hidden rounded-sm px-2 py-3 text-xs font-bold tracking-widest whitespace-nowrap border-[0.5px] border-[#f87272]/20 bg-[#0d0808] text-[#f87272] hover:bg-[#150a0a] hover:border-[#f87272]/40 transition-[background-color,border-color] duration-150"
          >
            <span className="flex items-center justify-center">
              <span className="material-symbols-outlined shrink-0 text-[18px]">power_settings_new</span>
              <span className="grid [grid-template-columns:0fr] items-center transition-[grid-template-columns,margin] duration-150 group-hover/sidebar:ml-2 group-hover/sidebar:[grid-template-columns:1fr]">
                <span className="overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                  CLOSE GAME
                </span>
              </span>
            </span>
          </button>
        )}
      </div>
      {launchProgress && (
        <LaunchProgressDialog
          progress={launchProgress}
          cancelling={launchCancelling}
          onCancel={() => void handleCancelLaunch()}
        />
      )}
    </nav>
  )
}
