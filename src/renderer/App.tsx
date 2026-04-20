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
import { WelcomeScreen } from './features/ui/WelcomeScreen'
import { ModList } from './features/library/ModList'
import { DownloadsPane } from './features/downloads/DownloadsPane'
import { SettingsPage } from './features/ui/SettingsDialog'
import { AppLogsDialog } from './features/ui/NexusRequestLogDialog'

const MIN_SPLASH_DURATION_MS = 450
const FONT_READY_TIMEOUT_MS = 1800

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

export const App: React.FC = () => {
  const {
    loadSettings,
    updateSettings,
    detectGamePath,
    scanMods,
    restoreEnabledMods,
    refreshLocalFiles,
    checkForUpdates,
    setupUpdateListeners,
    setupNxmListeners,
    activeView,
    setStatus,
    settings,
    addToast,
    gamePathValid,
    libraryPathValid,
    dialogs,
    closeDialog,
  } = useAppStore((state) => ({
    loadSettings: state.loadSettings,
    updateSettings: state.updateSettings,
    detectGamePath: state.detectGamePath,
    scanMods: state.scanMods,
    restoreEnabledMods: state.restoreEnabledMods,
    refreshLocalFiles: state.refreshLocalFiles,
    checkForUpdates: state.checkForUpdates,
    setupUpdateListeners: state.setupUpdateListeners,
    setupNxmListeners: state.setupNxmListeners,
    activeView: state.activeView,
    setStatus: state.setStatus,
    settings: state.settings,
    addToast: state.addToast,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
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
      let { gamePathValid: hasValidGamePath, libraryPathValid: hasValidLibraryPath } = useAppStore.getState()

      if (!currentSettings.gamePath?.trim()) {
        updateBootStatus('Detecting game path...')
        const detectedGame = await detectGamePath()
        if (detectedGame.ok && detectedGame.data) {
          await updateSettings({ gamePath: detectedGame.data })
          currentSettings = { ...currentSettings, gamePath: detectedGame.data }
          ;({ gamePathValid: hasValidGamePath, libraryPathValid: hasValidLibraryPath } = useAppStore.getState())
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
      const scannedMods = await scanMods()

      if (hasValidGamePath && hasValidLibraryPath) {
        updateBootStatus('Restoring enabled mods...')
        await restoreEnabledMods(scannedMods).catch(() => undefined)
      }

      if (currentSettings.downloadPath?.trim()) {
        updateBootStatus('Scanning downloads...')
        await refreshLocalFiles().catch(() => undefined)
      }

      if (!import.meta.env.DEV && currentSettings.autoUpdate) {
        void checkForUpdates().catch(() => undefined)
      }

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
        {dialogs.appLogs && (
          <AppLogsDialog onClose={() => closeDialog('appLogs')} />
        )}
        <ToastContainer />
      </div>
    </div>
  )
}
