import React, { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from './services/IpcService'
import { IPC } from '../shared/types'
import { Header } from './features/ui/Header'
import { Sidebar } from './features/ui/Sidebar'
import { ToastContainer } from './features/ui/ToastContainer'
import { DuplicateInstallDialog } from './features/ui/DuplicateInstallDialog'
import { WelcomeScreen } from './features/ui/WelcomeScreen'
import { ModList } from './features/library/ModList'
import { DownloadsPane } from './features/downloads/DownloadsPane'
import { SettingsPage } from './features/ui/SettingsDialog'

const MIN_SPLASH_DURATION_MS = 450
const FONT_READY_TIMEOUT_MS = 1800

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
    checkForUpdates,
    setupUpdateListeners,
    setupNxmListeners,
    activeView,
    setStatus,
    settings,
    addToast,
    gamePathValid,
    libraryPathValid,
    validateGamePath,
    validateLibraryPath,
  } = useAppStore((state) => ({
    loadSettings: state.loadSettings,
    updateSettings: state.updateSettings,
    detectGamePath: state.detectGamePath,
    scanMods: state.scanMods,
    restoreEnabledMods: state.restoreEnabledMods,
    checkForUpdates: state.checkForUpdates,
    setupUpdateListeners: state.setupUpdateListeners,
    setupNxmListeners: state.setupNxmListeners,
    activeView: state.activeView,
    setStatus: state.setStatus,
    settings: state.settings,
    addToast: state.addToast,
    gamePathValid: state.gamePathValid,
    libraryPathValid: state.libraryPathValid,
    validateGamePath: state.validateGamePath,
    validateLibraryPath: state.validateLibraryPath,
  }), shallow)

  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cleanup: (() => void) | undefined

    const boot = async () => {
      const bootStartedAt = Date.now()
      setStatus('Loading settings...')
      let currentSettings = await loadSettings()

      if (!currentSettings.gamePath?.trim()) {
        setStatus('Detecting game path...')
        const detectedGame = await detectGamePath()
        if (detectedGame.ok && detectedGame.data) {
          await updateSettings({ gamePath: detectedGame.data })
          currentSettings = { ...currentSettings, gamePath: detectedGame.data }
          addToast('Game path auto-detected', 'success', 2200)
        }
      }

      setStatus('Scanning mods...')
      const scannedMods = await scanMods()

      const hasValidGamePath = await validateGamePath(currentSettings.gamePath)
      const hasValidLibraryPath = await validateLibraryPath(currentSettings.libraryPath)
      if (hasValidGamePath && hasValidLibraryPath) {
        setStatus('Restoring active mods...')
        await restoreEnabledMods(scannedMods)
      }

      const cleanupUpdates = setupUpdateListeners()
      const cleanupNxm = setupNxmListeners()
      cleanup = () => { cleanupUpdates(); cleanupNxm() }

      if (!import.meta.env.DEV && currentSettings.autoUpdate) {
        void checkForUpdates().catch(() => undefined)
      }

      const elapsed = Date.now() - bootStartedAt
      const remaining = Math.max(0, MIN_SPLASH_DURATION_MS - elapsed)

      await Promise.all([
        waitForCriticalFonts(),
        remaining > 0
          ? new Promise((resolve) => window.setTimeout(resolve, remaining))
          : Promise.resolve(),
      ])

      setStatus('Ready')
      setBooting(false)
      window.requestAnimationFrame(() => {
        IpcService.send(IPC.APP_READY)
      })
    }

    boot().catch((error) => {
      console.error(error)
      setStatus('Ready')
      setBooting(false)
      window.requestAnimationFrame(() => {
        IpcService.send(IPC.APP_READY)
      })
    })

    return () => cleanup?.()
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
        <DuplicateInstallDialog />
        <ToastContainer />
      </div>
    </div>
  )
}
