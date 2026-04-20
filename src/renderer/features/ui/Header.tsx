import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { Tooltip } from './Tooltip'
import { useAppVersion } from '../../hooks/useAppVersion'

export const Header: React.FC = () => {
  const appVersion = useAppVersion()
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

  const chromeButtonClass = 'flex h-8 w-8 items-center justify-center rounded-sm text-[#7f7f7f] transition-colors hover:bg-[#111] hover:text-white'

  useEffect(() => {
    if (!updateDownloaded || !autoApplyUpdate) return

    addToast('Update downloaded. Restarting Hyperion...', 'info', 1800)
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
      addToast('Could not download update', 'error')
    }
  }

  useEffect(() => {
    if (!updateAvailable && !updateDownloading && !updateDownloaded) {
      setAutoApplyUpdate(false)
    }
  }, [updateAvailable, updateDownloading, updateDownloaded])

  const showUpdateTrigger = updateAvailable || updateDownloading || updateDownloaded
  const updateActionLabel = updateDownloading
    ? `Downloading ${updateProgress}%`
    : updateDownloaded
      ? 'Installing update...'
      : `Install update${updateInfo?.version ? ` ${updateInfo.version}` : ''}`
  const updateProgressWidth = `${Math.min(Math.max(updateProgress, 0), 100)}%`
  const updateIcon = updateDownloading
    ? 'downloading'
    : updateDownloaded
      ? 'autorenew'
      : 'download_for_offline'

  return (
    <header
      className="flex justify-between items-center w-full px-6 h-14 bg-[#050505] border-b-[0.5px] border-[#1a1a1a] z-50 flex-shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: brand */}
      <div className="flex items-center gap-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-3 select-none">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-[7px] border border-[#5f5a08] bg-[#fcee09] shadow-[0_0_18px_rgba(252,238,9,0.18)]">
            <span className="h-3 w-3 rounded-[2px] bg-[#050505]" />
          </span>
          <div className="flex items-end gap-2">
            <span className="brand-font font-black tracking-tighter text-2xl text-white">
              HYPERION
            </span>
            <span className="ui-support-mono pb-[2px] text-[10px] uppercase tracking-[0.16em] text-[#5f5f5f]">
              {appVersion}
            </span>
          </div>
        </div>
      </div>

      {/* Right: window controls */}
      <div
        className="flex items-center gap-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showUpdateTrigger && (
          <button
            onClick={() => void handleUpdateAction()}
            disabled={updateDownloading || updateDownloaded}
            title={updateActionLabel}
            className={`relative flex h-10 min-w-[204px] items-center justify-center overflow-hidden rounded-sm border-[0.5px] px-4 text-[10px] uppercase tracking-[0.18em] transition-all ${
              updateDownloaded
                ? 'border-[#fcee09]/60 bg-[#151202] text-[#fcee09]'
                : updateDownloading
                  ? 'border-[#5f5a08] bg-[#0b0b0b] text-[#fcee09]'
                  : 'border-[#4a3f08] bg-[#120f03] text-[#fcee09] hover:border-[#fcee09] hover:bg-[#171303] hover:text-white'
            } ${updateDownloading || updateDownloaded ? 'cursor-default' : ''}`}
          >
            {updateDownloading && (
              <span
                className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,rgba(252,238,9,0.22),rgba(252,238,9,0.5))] transition-[width] duration-200 ease-out"
                style={{ width: updateProgressWidth }}
              />
            )}

            <span className="relative z-10 flex items-center gap-2 brand-font font-bold">
              <span className={`material-symbols-outlined text-[18px] ${updateDownloading || updateDownloaded ? 'animate-pulse' : ''}`}>
                {updateIcon}
              </span>
              <span>{updateActionLabel}</span>
            </span>
          </button>
        )}

        {updateError && !updateAvailable && (
          <div className="ui-support-mono uppercase tracking-[0.14em]">
            Update check failed
          </div>
        )}

        <Tooltip content="App Logs">
          <button
            className={chromeButtonClass}
            onClick={() => openDialog('appLogs')}
          >
            <span className="material-symbols-outlined text-[18px]">terminal</span>
          </button>
        </Tooltip>

        <div className="h-6 w-px bg-[#1a1a1a]" />

        <div className="flex items-center gap-0.5">
          <Tooltip content="Minimize">
            <button
              className={chromeButtonClass}
              onClick={() => IpcService.send('window:minimize')}
            >
              <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
          </Tooltip>
          <Tooltip content="Maximize">
            <button
              className={chromeButtonClass}
              onClick={() => IpcService.send('window:maximize')}
            >
              <span className="material-symbols-outlined text-[18px]">check_box_outline_blank</span>
            </button>
          </Tooltip>
          <Tooltip content="Close">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-sm text-[#7f7f7f] transition-colors hover:bg-[#111] hover:text-[#F87171]"
              onClick={() => IpcService.send('window:close')}
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
