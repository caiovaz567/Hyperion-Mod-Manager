import React, { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from './services/IpcService'
import { IPC } from '../shared/types'
import { Header } from './features/ui/Header'
import { Sidebar } from './features/ui/Sidebar'
import { ToastContainer } from './features/ui/ToastContainer'
import { DuplicateDownloadDialog } from './features/ui/DuplicateDownloadDialog'
import { DuplicateInstallDialog } from './features/ui/DuplicateInstallDialog'
import { VersionMismatchDialog } from './features/ui/VersionMismatchDialog'
import { FomodInstallerDialog } from './features/ui/FomodInstallerDialog'
import { WelcomeScreen } from './features/ui/WelcomeScreen'
import { ModList } from './features/library/ModList'
import { DownloadsPane } from './features/downloads/DownloadsPane'
import { SettingsPage } from './features/ui/SettingsDialog'
import { AppLogsDialog } from './features/ui/NexusRequestLogDialog'
import { getInstallProgressAppearance } from './utils/installProgressAppearance'

const MIN_SPLASH_DURATION_MS = 450
const FONT_READY_TIMEOUT_MS = 1800
const STARTUP_MOD_UPDATE_CHECK_GRACE_MS = 1500

async function waitForFirstPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

async function waitForCriticalFonts(): Promise<void> {
  const fontSet = document.fonts
  if (!fontSet) return

  const fontLoads = [
    fontSet.load('600 16px "DM Sans"'),
    fontSet.load('700 16px "Syne"'),
    fontSet.load('600 16px "Oxanium"'),
    fontSet.load('400 18px "Material Symbols Outlined"'),
  ]

  await Promise.race([
    Promise.allSettled(fontLoads),
    new Promise((resolve) => window.setTimeout(resolve, FONT_READY_TIMEOUT_MS)),
  ])
}

function getInstallOverlayName(sourcePath: string, currentFile: string): string {
  const raw = currentFile || sourcePath
  if (!raw) return 'Preparing installation'
  const normalized = raw.replace(/\//g, '\\')
  const parts = normalized.split('\\').filter(Boolean)
  return parts[parts.length - 1] ?? raw
}

export const App: React.FC = () => {
  const {
    loadSettings,
    updateSettings,
    detectGamePath,
    scanMods,
    refreshLocalFiles,
    setupUpdateListeners,
    setupNxmListeners,
    activeView,
    setStatus,
    settings,
    addToast,
    gamePathValid,
    libraryPathValid,
    detecting,
    installing,
    installProgress,
    installStatus,
    installCurrentFile,
    installSourcePath,
    dialogs,
    closeDialog,
  } = useAppStore((state) => ({
    loadSettings: state.loadSettings,
    updateSettings: state.updateSettings,
    detectGamePath: state.detectGamePath,
    scanMods: state.scanMods,
    refreshLocalFiles: state.refreshLocalFiles,
    setupUpdateListeners: state.setupUpdateListeners,
    setupNxmListeners: state.setupNxmListeners,
    activeView: state.activeView,
    setStatus: state.setStatus,
    settings: state.settings,
    addToast: state.addToast,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
    detecting: state.detecting,
    installing: state.installing,
    installProgress: state.installProgress,
    installStatus: state.installStatus,
    installCurrentFile: state.installCurrentFile,
    installSourcePath: state.installSourcePath,
    dialogs: state.dialogs,
    closeDialog: state.closeDialog,
  }), shallow)

  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let disposed = false

    const boot = async () => {
      const bootStartedAt = Date.now()
      const fontsReadyPromise = waitForCriticalFonts()
      const updateBootStatus = (message: string) => {
        setStatus(message)
        IpcService.send(IPC.APP_BOOT_STATUS, message)
      }

      updateBootStatus('Loading settings...')
      let currentSettings = await loadSettings()

      if (!currentSettings.gamePath?.trim()) {
        updateBootStatus('Detecting game path...')
        const detectedGame = await detectGamePath()
        if (detectedGame.ok && detectedGame.data) {
          await updateSettings({ gamePath: detectedGame.data })
          currentSettings = { ...currentSettings, gamePath: detectedGame.data }
          addToast('Game path auto-detected', 'success', 2200)
        }
      }

      const cleanupUpdates = setupUpdateListeners()
      const cleanupNxm = setupNxmListeners()
      const releaseListeners = () => { cleanupUpdates(); cleanupNxm() }

      if (disposed) {
        releaseListeners()
        return
      }

      cleanup = releaseListeners

      updateBootStatus('Scanning mod library...')
      await scanMods({ refreshConflicts: false, refreshModUpdates: false })

      updateBootStatus('Checking Nexus mod updates...')
      const startupModUpdateCheck = useAppStore.getState()
        .checkModUpdates({ force: true, full: true })
        .catch(() => undefined)

      updateBootStatus('Checking mod conflicts...')
      await useAppStore.getState().refreshConflicts({ immediate: true })

      await Promise.race([
        startupModUpdateCheck,
        new Promise((resolve) => window.setTimeout(resolve, STARTUP_MOD_UPDATE_CHECK_GRACE_MS)),
      ])

      const elapsed = Date.now() - bootStartedAt
      const remaining = Math.max(0, MIN_SPLASH_DURATION_MS - elapsed)

      await Promise.all([
        fontsReadyPromise,
        remaining > 0
          ? new Promise((resolve) => window.setTimeout(resolve, remaining))
          : Promise.resolve(),
      ])

      if (disposed) return

      updateBootStatus('Ready')
      setBooting(false)
      await waitForFirstPaint()
      if (disposed) return
      IpcService.send(IPC.APP_READY)

      // The Hyperion self-update check now runs in the main process during the splash
      // (see initializeUpdates / checkForUpdatesOnStartup) so the header button is ready
      // immediately; no renderer-side startup check is needed here.
      window.setTimeout(() => {
        if (disposed) return

        if (currentSettings.downloadPath?.trim()) {
          void refreshLocalFiles().catch(() => undefined)
        }
      }, 2500)
    }

    boot().catch((error) => {
      if (disposed) return
      console.error(error)
      IpcService.send(IPC.APP_BOOT_STATUS, 'Starting interface...')
      setStatus('Ready')
      setBooting(false)
      void waitForFirstPaint().then(() => {
        if (disposed) return
        IpcService.send(IPC.APP_READY)
      })
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const handleRefreshShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isRefreshShortcut = key === 'f5' || ((event.ctrlKey || event.metaKey) && key === 'r')
      if (!isRefreshShortcut) return

      event.preventDefault()
      window.location.reload()
    }

    window.addEventListener('keydown', handleRefreshShortcut)
    return () => window.removeEventListener('keydown', handleRefreshShortcut)
  }, [])

  if (booting) {
    return null
  }

  const missingRequiredPaths = !settings?.gamePath?.trim() || !settings?.libraryPath?.trim() || !gamePathValid || !libraryPathValid
  const showSidebar = !missingRequiredPaths
  const showHeader = !missingRequiredPaths
  const installAppearance = getInstallProgressAppearance(installStatus)
  const installOverlayName = getInstallOverlayName(installSourcePath, installCurrentFile)
  const clampedInstallProgress = Math.max(6, Math.min(installProgress || 8, 100))

  return (
    <div className="hyperion-shell h-screen overflow-hidden flex flex-col bg-[#050505] text-[#e5e2e1] antialiased">
      <div className="hyperion-bg" aria-hidden="true" />
      <div className="hyperion-content flex h-full flex-col overflow-hidden">
        {showHeader && <Header />}
        <div className="flex flex-1 overflow-hidden relative">
          {showSidebar && <Sidebar />}
          <main className={`flex-1 h-full overflow-hidden bg-transparent transition-[margin] duration-300 ${showSidebar ? 'ml-20' : 'ml-0'}`}>
            {missingRequiredPaths ? <WelcomeScreen /> : null}
            {!missingRequiredPaths && activeView === 'settings' ? <SettingsPage /> : null}
            {!missingRequiredPaths && activeView === 'library' && <ModList />}
            {!missingRequiredPaths && activeView === 'downloads' && <DownloadsPane />}
          </main>
        </div>
        <DuplicateDownloadDialog />
        <DuplicateInstallDialog />
        <FomodInstallerDialog />
        <VersionMismatchDialog />
        {dialogs.appLogs && (
          <AppLogsDialog onClose={() => closeDialog('appLogs')} />
        )}
        {(detecting || installing) && (
          <div className="fixed inset-0 z-[260] flex cursor-wait items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
            <div
              className="relative w-full max-w-[540px] overflow-hidden rounded-sm border-[0.5px] bg-[#070707] px-8 py-7 shadow-[0_24px_60px_rgba(0,0,0,0.72)]"
              style={{ borderColor: installing ? `${installAppearance.accent}28` : '#fcee0928' }}
            >
              <div
                className="absolute left-0 top-0 h-[2px] w-full transition-colors duration-300"
                style={{
                  background: installing ? installAppearance.accent : '#fcee09',
                  boxShadow: `0 0 14px ${installing ? installAppearance.accent : '#fcee09'}44`,
                }}
              />

              <div className="flex items-center gap-2.5 mb-5">
                <span
                  className="material-symbols-outlined animate-spin text-[16px] shrink-0"
                  style={{ color: installing ? installAppearance.accent : '#fcee09' }}
                >
                  progress_activity
                </span>
                <span
                  className="brand-font text-[0.72rem] font-bold uppercase tracking-[0.2em] whitespace-nowrap"
                  style={{ color: installing ? installAppearance.accent : '#fcee09' }}
                >
                  {installing ? (installAppearance.label || 'Installing') : 'Analyzing'}
                </span>
              </div>

              <div className="truncate text-[1.05rem] font-semibold text-[#e8e8e8] mb-6" style={{ fontFamily: '"DM Sans", sans-serif' }}>
                {installOverlayName}
              </div>

              <div className="h-[3px] overflow-hidden rounded-sm bg-[#141414]">
                <div
                  className="h-full transition-[width,background-color] duration-500"
                  style={{
                    width: `${clampedInstallProgress}%`,
                    background: installing ? installAppearance.fill : '#fcee09',
                    boxShadow: `0 0 10px ${installing ? installAppearance.accent : '#fcee09'}44`,
                  }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-[#555]">
                  {installStatus || (detecting ? 'Detecting format...' : '')}
                </span>
                <span className="text-[11px] font-mono text-[#444]">{Math.round(clampedInstallProgress)}%</span>
              </div>
            </div>
          </div>
        )}
        <ToastContainer />
      </div>
    </div>
  )
}
