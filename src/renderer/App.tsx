import React, { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { shallow } from 'zustand/shallow'
import { IpcService } from './services/IpcService'
import { IPC } from '../shared/types'
import { Header } from './features/ui/Header'
import { Sidebar } from './features/ui/Sidebar'
import { ToastContainer } from './features/ui/ToastContainer'
import { LaunchProgressCard } from './features/ui/LaunchProgressCard'
import { DuplicateDownloadDialog } from './features/ui/DuplicateDownloadDialog'
import { DuplicateInstallDialog } from './features/ui/DuplicateInstallDialog'
import { VersionMismatchDialog } from './features/ui/VersionMismatchDialog'
import { FomodInstallerDialog } from './features/ui/FomodInstallerDialog'
import { InstallNameDialog } from './features/ui/InstallNameDialog'
import { WelcomeScreen } from './features/ui/WelcomeScreen'
import { ModList } from './features/library/ModList'
import { DownloadsPane } from './features/downloads/DownloadsPane'
import { SettingsPage } from './features/ui/SettingsDialog'
import { AppLogsDialog } from './features/ui/NexusRequestLogDialog'
import { getInstallProgressAppearance } from './utils/installProgressAppearance'
import { useTranslation } from './i18n/I18nContext'
import { Icon } from './features/ui/Icon'

const MIN_SPLASH_DURATION_MS = 450
const FONT_READY_TIMEOUT_MS = 1800
// Hard cap on how long boot waits for the first conflict pass before revealing the
// window anyway. Normally the cheap pass finishes well under this; the cap only exists
// so a pathologically slow scan can never trap the user on the splash (badges still
// appear once the pass completes in the background).
const CONFLICT_BOOT_WAIT_TIMEOUT_MS = 6000
// On launch, only re-check Nexus mod updates if the persisted cache is older than
// this. Within the window the hydrated cache is shown as-is (no request), so rapid
// relaunches don't spam Nexus; a normal session gap still refreshes.
const MOD_UPDATE_LAUNCH_MAX_AGE_MS = 60 * 60 * 1000

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

  // The families the shell actually renders (self-hosted, so these resolve from
  // disk in milliseconds). DM Sans and the Material Symbols icon font were removed
  // from the project - waiting on them was a no-op at best.
  const fontLoads = [
    fontSet.load('600 16px "Inter"'),
    fontSet.load('700 16px "Syne"'),
    fontSet.load('400 14px "JetBrains Mono"'),
  ]

  await Promise.race([
    Promise.allSettled(fontLoads),
    new Promise((resolve) => window.setTimeout(resolve, FONT_READY_TIMEOUT_MS)),
  ])
}

function getInstallOverlayName(sourcePath: string, currentFile: string): string {
  const raw = currentFile || sourcePath
  if (!raw) return ''
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
  const { t } = useTranslation()

  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let disposed = false

    const boot = async () => {
      const bootStartedAt = Date.now()
      const fontsReadyPromise = waitForCriticalFonts()
      const updateBootStatus = (message: string) => {
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
          addToast(t('shell.toast.gameAutoDetected'), 'success', 2200)
        }
      }

      const cleanupUpdates = setupUpdateListeners()
      const cleanupNxm = setupNxmListeners()
      // External change inside the mod library (files added/removed in a mod folder via
      // Explorer, a folder dropped in, etc.) - re-scan with a forced file-metadata refresh
      // so the library and the Files tab reflect what's actually on disk.
      const unsubLibraryChanged = IpcService.on(IPC.LIBRARY_CHANGED, () => {
        void useAppStore.getState().scanMods({ refreshFileMetadata: true })
      })
      const releaseListeners = () => { cleanupUpdates(); cleanupNxm(); unsubLibraryChanged() }

      if (disposed) {
        releaseListeners()
        return
      }

      cleanup = releaseListeners

      // Load the persisted Nexus update cache (from the main process) before scanning,
      // so cached indicators show instantly and the scan's prune keeps the right data.
      updateBootStatus('Loading update history...')
      await useAppStore.getState().hydrateModUpdates()

      updateBootStatus('Scanning mod library...')
      await scanMods({ refreshConflicts: false, refreshModUpdates: false })

      // Refresh Nexus update status on launch, but cheaply: this is the bulk path, so
      // it's one `updated.json` request (window adapts to time since the last check)
      // plus a deep check only for the few mods that changed since then - never one
      // request per mod. Cached indicators already show instantly (hydrated above);
      // this runs in the background (non-blocking, silent) and refreshes them shortly
      // after the window opens. The toolbar button still does an on-demand re-check.
      //
      // Recency gate: skip the request entirely if the cache was refreshed within
      // the last hour, so quick relaunches don't each hit Nexus. A normal session
      // gap (closed earlier, reopened later) still gets a fresh check.
      void useAppStore.getState().checkModUpdates({ force: true, staleAfterMs: MOD_UPDATE_LAUNCH_MAX_AGE_MS })

      updateBootStatus('Checking mod conflicts...')
      // Await (do NOT fire-and-forget) so the splash holds until the +N/-N/! badges are
      // on screen. Firing this off with `void` reveals the window first and the icons pop
      // in a moment later - the startup "icons appear after a while" regression vs 0.28.0.
      // This resolves after the cheap first pass (already-indexed sidecars), so it's fast
      // for an established library; the slow deep archive re-index continues in the
      // background afterwards and must NOT block boot (awaiting it froze the splash). The
      // MIN_SPLASH_DURATION_MS wait below absorbs this time when the pass finishes first.
      // Capped so a pathologically slow scan can never trap the user on the splash.
      await Promise.race([
        useAppStore.getState().refreshConflicts({ immediate: true }),
        new Promise((resolve) => window.setTimeout(resolve, CONFLICT_BOOT_WAIT_TIMEOUT_MS)),
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
  // Stay on the welcome wizard until the user has explicitly finished setup, even if
  // every path happens to validate on its own. An auto-detected game path (saved
  // silently during boot) must never skip onboarding once the game gets installed.
  const needsOnboarding = missingRequiredPaths || !settings?.setupCompleted
  const showSidebar = !needsOnboarding
  const showHeader = !needsOnboarding
  const installAppearance = getInstallProgressAppearance(installStatus)
  const installOverlayName = getInstallOverlayName(installSourcePath, installCurrentFile) || t('downloads.overlay.preparing')
  const clampedInstallProgress = Math.max(6, Math.min(installProgress || 8, 100))

  return (
    <div className="hyperion-shell h-screen overflow-hidden flex flex-col bg-[var(--bg-base-deep)] text-[var(--text-primary-alt)] antialiased">
      <div className="hyperion-bg" aria-hidden="true" />
      <div className="hyperion-content flex h-full flex-col overflow-hidden">
        {showHeader && <Header />}
        <div className="flex flex-1 overflow-hidden relative">
          {showSidebar && <Sidebar />}
          <main className={`flex-1 h-full overflow-hidden bg-transparent transition-[margin] duration-300 ${showSidebar ? 'ml-[92px]' : 'ml-0'}`}>
            {needsOnboarding ? <WelcomeScreen /> : null}
            {!needsOnboarding && activeView === 'settings' ? <SettingsPage /> : null}
            {!needsOnboarding && activeView === 'library' && <ModList />}
            {!needsOnboarding && activeView === 'downloads' && <DownloadsPane />}
          </main>
        </div>
        <DuplicateDownloadDialog />
        <DuplicateInstallDialog />
        <FomodInstallerDialog />
        <VersionMismatchDialog />
        <InstallNameDialog />
        {dialogs.appLogs && (
          <AppLogsDialog onClose={() => closeDialog('appLogs')} />
        )}
        {(detecting || installing) && (
          <div className="fixed inset-0 z-[260] flex cursor-wait items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
            <div className="relative w-full max-w-[540px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] px-7 py-6">
              <div className="mb-4 flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${installing ? installAppearance.accent : 'var(--accent)'}22` }}
                >
                  <Icon name="progress_activity" className="animate-spin text-[16px]" style={{ color: installing ? installAppearance.accent : 'var(--accent)' }} />
                </span>
                <span
                  className="text-[13.5px] font-semibold"
                  style={{ color: installing ? installAppearance.accent : 'var(--accent)' }}
                >
                  {installing ? installAppearance.label : t('downloads.overlay.analyzing')}
                </span>
              </div>

              <div className="mb-5 truncate text-[1.05rem] font-semibold text-[var(--text-primary)]">
                {installOverlayName}
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-500"
                  style={{
                    width: `${clampedInstallProgress}%`,
                    background: installing ? installAppearance.fill : 'var(--accent)',
                  }}
                />
              </div>

              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-muted)]">
                  {installStatus || (detecting ? t('downloads.overlay.detectingFormat') : '')}
                </span>
                <span className="text-[13px] font-medium tabular-nums text-[var(--text-secondary)]">{Math.round(clampedInstallProgress)}%</span>
              </div>
            </div>
          </div>
        )}
        <LaunchProgressCard />
        <ToastContainer />
      </div>
    </div>
  )
}
