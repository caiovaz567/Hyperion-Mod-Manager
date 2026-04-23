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
import { ConflictInspectorDialog } from './features/ui/ConflictInspectorDialog'
import { WelcomeScreen } from './features/ui/WelcomeScreen'
import { ModList } from './features/library/ModList'
import { DownloadsPane } from './features/downloads/DownloadsPane'
import { SettingsPage } from './features/ui/SettingsDialog'
import { AppLogsDialog } from './features/ui/NexusRequestLogDialog'
import { getInstallProgressAppearance } from './utils/installProgressAppearance'

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
        <VersionMismatchDialog />
        <ConflictInspectorDialog />
        {dialogs.appLogs && (
          <AppLogsDialog onClose={() => closeDialog('appLogs')} />
        )}
        {installing && (
          <div className="fixed inset-0 z-[260] flex cursor-wait items-center justify-center bg-black/86 px-4 backdrop-blur-sm">
            <div
              className="relative w-full max-w-[520px] overflow-hidden rounded-sm border-[0.5px] bg-[#070707] px-6 py-6 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
              style={{ borderColor: `${installAppearance.accent}44` }}
            >
              <div
                className="absolute left-0 top-0 h-[2px] w-full"
                style={{
                  background: installAppearance.accent,
                  boxShadow: `0 0 12px ${installAppearance.accent}44`,
                }}
              />
              <div className="flex items-start gap-4">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-[0.5px] bg-[#0a0a0a]"
                  style={{ borderColor: `${installAppearance.accent}33`, color: installAppearance.accent }}
                >
                  <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="brand-font text-[1rem] font-bold uppercase tracking-[0.12em]" style={{ color: installAppearance.accent }}>
                    Installing Mod
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[#d3d3d3]">
                    Hyperion is extracting files, updating the library, and deploying the mod. Please wait until the installation finishes.
                  </p>
                  <div className="mt-4 rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
                    <div className="ui-support-mono text-[#8d8d8d] uppercase tracking-[0.14em]">
                      Processing now
                    </div>
                    <div className="mt-2 truncate text-sm font-medium text-[#f2f2f2]">
                      {installOverlayName}
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#111]">
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${clampedInstallProgress}%`,
                          background: installAppearance.fill,
                          boxShadow: `0 0 12px ${installAppearance.accent}33`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-mono">
                      <span style={{ color: installAppearance.accent }}>
                        {installStatus || installAppearance.summary}
                      </span>
                      <span className="text-[#d8d8d8]">
                        {Math.round(clampedInstallProgress)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 text-[11px] brand-font uppercase tracking-[0.16em] text-[#8a8a8a]">
                    The interface is temporarily locked to keep this install stable.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <ToastContainer />
      </div>
    </div>
  )
}
