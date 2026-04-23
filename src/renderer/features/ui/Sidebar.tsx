import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import { useNexusAccount } from '../../hooks/useNexusAccount'

interface NavItem {
  icon: string
  label: string
  action?: () => void
  active?: boolean
  disabled?: boolean
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
  const { activeView, setActiveView, addToast, settings, gamePathValid } = useAppStore((state) => ({
    activeView: state.activeView,
    setActiveView: state.setActiveView,
    addToast: state.addToast,
    settings: state.settings,
    gamePathValid: state.gamePathValid,
  }), shallow)
  const nexusAccount = useNexusAccount(settings?.nexusApiKey, 250)

  const navItems: NavItem[] = [
    { icon: 'inventory_2', label: 'Mod Library', action: () => setActiveView('library'), active: activeView === 'library' },
    { icon: 'download',    label: 'Downloads', action: () => setActiveView('downloads'), active: activeView === 'downloads' },
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

  const handleLaunchGame = async () => {
    if (!settings?.gamePath || !gamePathValid) {
      addToast('Game path not configured — check Settings', 'warning')
      return
    }
    const result = await IpcService.invoke<{ ok: boolean; error?: string }>(IPC.LAUNCH_GAME)
    if (!result.ok) {
      addToast(result.error ?? 'Could not launch game', 'error')
    }
  }

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
      <div className="px-4 mt-4 w-full">
        <button
          onClick={handleLaunchGame}
          disabled={!settings?.gamePath || !gamePathValid}
          className={`w-full overflow-hidden rounded-sm px-2 py-3 text-xs font-bold tracking-widest whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ${
            !settings?.gamePath || !gamePathValid
              ? 'bg-[#262626] text-[#8a8a8a] cursor-not-allowed'
              : 'bg-[#fcee09] text-[#050505] hover:bg-white shadow-[0_0_20px_rgba(252,238,9,0.15)]'
          }`}
        >
          <span className="flex items-center justify-center">
            <span className="material-symbols-outlined shrink-0 text-[18px]">play_arrow</span>
            <span className="grid [grid-template-columns:0fr] items-center transition-[grid-template-columns,margin] duration-150 group-hover/sidebar:ml-2 group-hover/sidebar:[grid-template-columns:1fr]">
              <span className="overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                LAUNCH GAME
              </span>
            </span>
          </span>
        </button>
      </div>
    </nav>
  )
}
