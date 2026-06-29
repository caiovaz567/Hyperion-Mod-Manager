import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC, type IpcResult, type VfsOverwriteInfo } from '@shared/types'
import { useAppVersion } from '../../hooks/useAppVersion'
import { useNexusAccount } from '../../hooks/useNexusAccount'
import { PathBox, SettingCard, StatusReadout, SurfaceTabRail, ValidationRow, uiButton } from './uiKit'
import { LanguageSelect } from './LanguageSelect'
import { useTranslation } from '../../i18n/I18nContext'

type SettingsTab = 'general' | 'paths' | 'nexus' | 'updates' | 'about'
type FolderState = 'valid' | 'invalid' | 'empty'

const HYPERION_GITHUB_URL = 'https://github.com/caiovaz567/Hyperion-Mod-Manager'
const HYPERION_RELEASES_URL = `${HYPERION_GITHUB_URL}/releases/latest`
const HYPERION_ISSUES_URL = `${HYPERION_GITHUB_URL}/issues`
const USVFS_URL = 'https://github.com/ModOrganizer2/usvfs'
const MOD_ORGANIZER_URL = 'https://github.com/ModOrganizer2/modorganizer'
const REDMODDING_URL = 'https://wiki.redmodding.org/cyberpunk-2077-modding/'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

const NEXUS_FREE_FEATURES = [
  { icon: 'open_in_browser', text: 'Mod updates open Nexus in the browser' },
  { icon: 'link', text: 'Downloads via nxm:// link from the site' },
  { icon: 'deployed_code', text: 'Completed downloads auto-install by default' },
]

const NEXUS_PREMIUM_FEATURES = [
  { icon: 'bolt', text: 'Mod updates download directly, no browser' },
  { icon: 'api', text: 'Direct CDN links resolved via Nexus API' },
  { icon: 'sync', text: 'One-click inline install, stays in the Library' },
]

function NexusTierComparison({ isPremium }: { isPremium: boolean | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-[12.5px]">
      {/* Free */}
      <div className={`rounded-sm border-0 p-3 space-y-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)] ${isPremium === false ? 'bg-[rgba(96,165,250,0.10)]' : 'bg-[#101010]'}`}>
        <div className={`text-[10px] brand-font font-bold uppercase tracking-widest mb-1 ${isPremium === false ? 'text-[#60A5FA]' : 'text-[#555]'}`}>Free</div>
        {NEXUS_FREE_FEATURES.map((f) => (
          <div key={f.text} className="flex items-start gap-2">
            <span className={`material-symbols-outlined text-[14px] mt-[1px] shrink-0 ${isPremium === false ? 'text-[#60A5FA]' : 'text-[#444]'}`}>{f.icon}</span>
            <span className={isPremium === false ? 'text-[#c0c0c0]' : 'text-[#555]'}>{f.text}</span>
          </div>
        ))}
      </div>

      {/* Premium */}
      <div className={`rounded-sm border-0 p-3 space-y-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)] ${isPremium === true ? 'bg-[rgba(252,238,9,0.10)]' : 'bg-[#101010]'}`}>
        <div className={`text-[10px] brand-font font-bold uppercase tracking-widest mb-1 ${isPremium === true ? 'text-[#f7d154]' : 'text-[#555]'}`}>Premium</div>
        {NEXUS_PREMIUM_FEATURES.map((f) => (
          <div key={f.text} className="flex items-start gap-2">
            <span className={`material-symbols-outlined text-[14px] mt-[1px] shrink-0 ${isPremium === true ? 'text-[#f7d154]' : 'text-[#444]'}`}>{f.icon}</span>
            <span className={isPremium === true ? 'text-[#c0c0c0]' : 'text-[#555]'}>{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function getDownloadsStatus(downloadPath: string, defaultDownloadPath: string) {
  const trimmed = downloadPath.trim()
  if (!trimmed) {
    return {
      path: defaultDownloadPath,
      description: 'Using the default folder next to your library.',
    }
  }

  return {
    path: trimmed,
    description: 'New mod archives are picked up from here.',
  }
}

export const SettingsPage: React.FC = () => {
  const { t, tn } = useTranslation()
  const appVersion = useAppVersion()
  const {
    settings,
    updateSettings,
    scanMods,
    restoreEnabledMods,
    purgeMods,
    selectMod,
    addToast,
    defaultPaths,
    loadDefaultPaths,
    detectGamePath,
    checkGamePath,
    checkLibraryPath,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    updateAvailable,
    updateInfo,
    updateDownloading,
    updateDownloaded,
    updateError,
  } = useAppStore()

  const [gamePath, setGamePath] = useState('')
  const [libraryPath, setLibraryPath] = useState('')
  const [downloadPath, setDownloadPath] = useState('')
  const [detectingGame, setDetectingGame] = useState(false)
  const [gamePathValid, setGamePathValid] = useState(false)
  const [libraryPathValid, setLibraryPathValid] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [nexusApiKey, setNexusApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [updateActionLoading, setUpdateActionLoading] = useState<null | 'check' | 'download'>(null)
  const nexusSaveTimerRef = useRef<number | null>(null)
  const [runtimeCapturesInfo, setRuntimeCapturesInfo] = useState<VfsOverwriteInfo | null>(null)
  const [clearingCaptures, setClearingCaptures] = useState(false)

  const nexusAccount = useNexusAccount(nexusApiKey)

  const refreshRuntimeCaptures = useCallback(async () => {
    const result = await IpcService.invoke<IpcResult<VfsOverwriteInfo>>(IPC.GET_VFS_OVERWRITE_INFO)
    if (result.ok && result.data) setRuntimeCapturesInfo(result.data)
  }, [])

  useEffect(() => {
    if (activeTab === 'general' || activeTab === 'about') void refreshRuntimeCaptures()
  }, [activeTab, refreshRuntimeCaptures])

  const handleOpenRuntimeCaptures = useCallback(async () => {
    const result = await IpcService.invoke<IpcResult<VfsOverwriteInfo>>(IPC.OPEN_VFS_OVERWRITE)
    if (result.ok && result.data) setRuntimeCapturesInfo(result.data)
  }, [])

  const handleClearRuntimeCaptures = useCallback(async () => {
    setClearingCaptures(true)
    try {
      const result = await IpcService.invoke<IpcResult<VfsOverwriteInfo>>(IPC.CLEAR_VFS_OVERWRITE)
      if (result.data) setRuntimeCapturesInfo(result.data)
      if (result.ok) {
        addToast('Runtime captures cleared', 'success', 1800)
      } else {
        addToast(result.error ?? 'Could not clear runtime captures', 'error', 3200)
      }
    } catch {
      addToast('Could not clear runtime captures', 'error', 3200)
    } finally {
      setClearingCaptures(false)
    }
  }, [addToast])

  const handleOpenExternal = useCallback(async (url: string) => {
    await IpcService.invoke(IPC.OPEN_EXTERNAL, url)
  }, [])

  const handleCopyDiagnostics = useCallback(async () => {
    const lines = [
      `Hyperion: ${appVersion}`,
      `Game path: ${gamePath || '(not set)'}`,
      `Mod library: ${libraryPath || '(not set)'}`,
      `Downloads: ${getDownloadsStatus(downloadPath, defaultPaths?.downloadPath ?? '').path || '(not set)'}`,
      `Runtime captures: ${runtimeCapturesInfo?.path ?? '(not loaded)'}`,
      `Runtime capture files: ${runtimeCapturesInfo?.fileCount ?? 0}`,
      `Runtime capture size: ${formatBytes(runtimeCapturesInfo?.totalBytes ?? 0)}`,
    ]

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      addToast('Diagnostics summary copied', 'success', 1800)
    } catch {
      addToast('Could not copy diagnostics summary', 'error', 2600)
    }
  }, [addToast, appVersion, defaultPaths?.downloadPath, downloadPath, gamePath, libraryPath, runtimeCapturesInfo])

  useEffect(() => {
    if (!defaultPaths) {
      void loadDefaultPaths().catch(() => undefined)
    }
  }, [defaultPaths, loadDefaultPaths])

  useEffect(() => {
    if (settings) {
      setGamePath(settings.gamePath ?? '')
      setLibraryPath(settings.libraryPath ?? '')
      setDownloadPath(settings.downloadPath ?? '')
      setNexusApiKey(settings.nexusApiKey ?? '')
    }
  }, [settings])

  useEffect(() => {
    checkGamePath(gamePath).then(setGamePathValid).catch(() => setGamePathValid(false))
  }, [checkGamePath, gamePath])

  useEffect(() => {
    checkLibraryPath(libraryPath).then(setLibraryPathValid).catch(() => setLibraryPathValid(false))
  }, [checkLibraryPath, libraryPath])

  useEffect(() => {
    if (!settings) return

    const hasChanges =
      gamePath !== settings.gamePath ||
      libraryPath !== settings.libraryPath ||
      downloadPath !== settings.downloadPath

    if (!hasChanges || !gamePathValid || !libraryPathValid) return

    const timeoutId = window.setTimeout(async () => {
      try {
        const libraryChanged = libraryPath !== settings.libraryPath
        const gameChanged = gamePath !== settings.gamePath

        if ((libraryChanged || gameChanged) && settings.gamePath.trim() && settings.libraryPath.trim()) {
          const purgeResult = await purgeMods()
          if (purgeResult.data?.purged) {
            addToast(`Purged ${purgeResult.data.purged} active mod(s) from the previous deployment`, 'info', 2600)
          }
          if (purgeResult.data?.failed) {
            addToast(`Could not fully purge ${purgeResult.data.failed} mod(s) from the previous deployment`, 'warning', 3200)
          }
        }

        const saveResult = await updateSettings({ gamePath, libraryPath, downloadPath })
        if (!saveResult.ok) {
          addToast(saveResult.error ?? 'Could not save configuration', 'error', 5000)
          return
        }

        if (libraryChanged || gameChanged) {
          selectMod(null)
          const scannedMods = await scanMods()
          if (gamePathValid && libraryPathValid) {
            const restoreResults = await restoreEnabledMods(scannedMods)
            const failedRestoreCount = restoreResults.filter((result) => !result.ok).length
            if (failedRestoreCount > 0) {
              addToast(`Loaded library, but ${failedRestoreCount} active mod(s) could not be restored`, 'warning', 3200)
            }
          }
        }

        addToast('Changes saved', 'success', 1800)
      } catch {
        addToast('Could not save configuration', 'error', 2600)
      }
    }, 450)

    return () => window.clearTimeout(timeoutId)
  }, [
    addToast,
    downloadPath,
    gamePath,
    gamePathValid,
    libraryPath,
    libraryPathValid,
    purgeMods,
    restoreEnabledMods,
    scanMods,
    selectMod,
    settings,
    updateSettings,
  ])

  useEffect(() => {
    if (!settings) return
    if (nexusApiKey === (settings.nexusApiKey ?? '')) return

    if (nexusSaveTimerRef.current) window.clearTimeout(nexusSaveTimerRef.current)
    nexusSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await updateSettings({ nexusApiKey })
        addToast(nexusApiKey.trim() ? 'Nexus API key saved' : 'Nexus API key cleared', 'success', 1800)
      } catch {
        addToast('Could not save Nexus API key', 'error', 2600)
      }
    }, 600)

    return () => {
      if (nexusSaveTimerRef.current) window.clearTimeout(nexusSaveTimerRef.current)
    }
  }, [addToast, nexusApiKey, settings, updateSettings])

  const browseFolder = async (title: string, assign: (path: string) => void) => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(IPC.OPEN_FOLDER_DIALOG, { title })
    if (!result.canceled && result.filePaths.length) assign(result.filePaths[0])
  }

  const autoDetectGame = async () => {
    setDetectingGame(true)
    const result = await detectGamePath()
    setDetectingGame(false)

    if (!result.ok || !result.data) {
      addToast(result.error ?? 'Could not auto-detect Cyberpunk 2077', 'warning', 2600)
      return
    }

    setGamePath(result.data)
    addToast('Game path detected', 'success', 1800)
  }

  const ensureDirectory = async (targetPath: string, label: string): Promise<boolean> => {
    const result = await IpcService.invoke<IpcResult<void>>(IPC.ENSURE_DIRECTORY, targetPath)
    if (!result.ok) {
      addToast(result.error ?? `Could not create ${label}`, 'warning', 2600)
      return false
    }
    return true
  }

  const applyDefaultLibraryPath = async () => {
    if (!defaultPaths) return
    const nextPath = defaultPaths.libraryPath
    setLibraryPath(nextPath)
    if (await ensureDirectory(nextPath, 'suggested mod library')) {
      addToast('Suggested mod library loaded', 'info', 1800)
    }
  }

  const applyDefaultDownloadPath = async () => {
    if (!defaultPaths) return
    const nextPath = defaultPaths.downloadPath
    setDownloadPath(nextPath)
    if (await ensureDirectory(nextPath, 'suggested downloads folder')) {
      addToast('Suggested downloads folder loaded', 'info', 1800)
    }
  }

  const handleCheckForUpdates = async () => {
    setUpdateActionLoading('check')
    try {
      await checkForUpdates()
      addToast(updateAvailable ? 'Update status refreshed' : 'Checked for Hyperion updates', 'info', 2200)
    } catch {
      addToast('Could not check for updates', 'error', 2600)
    } finally {
      setUpdateActionLoading(null)
    }
  }

  const handleDownloadUpdate = async () => {
    setUpdateActionLoading('download')
    try {
      await downloadUpdate()
      addToast('Update downloaded', 'success', 2200)
    } catch {
      addToast('Could not download update', 'error', 2600)
    } finally {
      setUpdateActionLoading(null)
    }
  }

  const { primary: primaryBtn, secondary: secondaryBtn, accentOutline: accentOutlineBtn } = uiButton
  const aboutActionBtn =
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-[#171717] px-4 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#c9c9c9] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),0_8px_18px_rgba(0,0,0,0.20)] transition-colors hover:bg-[rgba(252,238,9,0.16)] hover:text-[#fcee09] focus:outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(252,238,9,0.42),0_8px_18px_rgba(0,0,0,0.20)] [&_.material-symbols-outlined]:text-current [&_.material-symbols-outlined]:leading-none'

  const tabMeta: Array<{ id: SettingsTab; label: string; icon: string }> = [
    { id: 'general', label: 'General', icon: 'tune' },
    { id: 'paths', label: 'Paths', icon: 'folder_open' },
    { id: 'nexus', label: 'Nexus', icon: 'cloud' },
    { id: 'updates', label: 'Updates', icon: 'update' },
    { id: 'about', label: 'About', icon: 'info' },
  ]

  const resolvedDefaultDownloadPath = defaultPaths?.downloadPath ?? ''
  const downloadsStatus = getDownloadsStatus(downloadPath, resolvedDefaultDownloadPath)

  const gameState: FolderState = gamePath.trim() ? (gamePathValid ? 'valid' : 'invalid') : 'empty'
  const libraryState: FolderState = libraryPath.trim() ? (libraryPathValid ? 'valid' : 'invalid') : 'empty'

  const nexusStatus = nexusAccount.status
  const nexusReadout =
    nexusStatus === 'connected'
      ? { tone: 'good' as const, label: 'Connected' }
      : nexusStatus === 'checking'
      ? { tone: 'info' as const, label: 'Checking...' }
      : nexusStatus === 'error'
      ? { tone: 'error' as const, label: 'Invalid key' }
      : { tone: 'neutral' as const, label: 'Not connected' }

  const updateReadout = updateDownloaded
    ? { tone: 'good' as const, label: 'Ready to install' }
    : updateAvailable
    ? { tone: 'warn' as const, label: 'Update available' }
    : { tone: 'neutral' as const, label: `v${appVersion}` }

  const updateVersion = updateInfo?.version ?? ''
  const updateMessage = updateDownloaded
    ? `Update ${updateVersion} is ready to install.`
    : updateAvailable
    ? `Update ${updateVersion} is available to download.`
    : 'Current build is up to date.'

  return (
    <div className="stable-scroll-gutter h-full overflow-y-scroll pb-10 animate-settings-in sm:pb-16">
      <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="mb-6 border-b-[0.5px] border-[#171717] pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-[#fcee09]" />
                <span className="ui-support-mono text-[11px] uppercase tracking-[0.16em] text-[#6f6f6f]">
                  Control panel
                </span>
              </div>
              <h1 className="screen-title-font text-[1.42rem] font-black uppercase tracking-[0.06em] text-white sm:text-[1.58rem]">
                Settings
              </h1>
              <p className="mt-3 max-w-[680px] text-[15px] leading-7 text-[#c0c0c0]">
                Configure paths, Nexus access, and Hyperion updates without leaving the manager.
              </p>
            </div>
            <StatusReadout tone="neutral" label={`v${appVersion}`} />
          </div>
        </header>

        <SurfaceTabRail
          items={tabMeta}
          activeId={activeTab}
          onChange={setActiveTab}
          ariaLabel="Settings sections"
        />

        <div className="relative z-0 bg-[#050505] shadow-[inset_0_-1px_0_rgba(255,255,255,0.045)]">
          <div key={activeTab}>
            {activeTab === 'general' && (
              <>
                <SettingCard
                  icon="deployed_code"
                  title={t('settings.general.installBehavior.title')}
                  description={t('settings.general.installBehavior.description')}
                  className="fade-up"
                  style={{ animationDelay: '0ms' }}
                >
                <button
                  type="button"
                  onClick={() => {
                    void updateSettings({ autoInstallDownloads: !(settings?.autoInstallDownloads ?? true) })
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-sm border-0 bg-[#101010] px-4 py-3 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055)] transition-colors hover:bg-[#151515]"
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-[#e5e2e1]">{t('settings.general.installBehavior.toggleTitle')}</span>
                    <span className="mt-1 block text-[13px] leading-5 text-[#8f8f8f]">
                      {t('settings.general.installBehavior.toggleDescription')}
                    </span>
                  </span>
                  <span
                    className={`relative h-5 w-10 shrink-0 rounded-full border-0 transition-colors ${
                      (settings?.autoInstallDownloads ?? true)
                        ? 'bg-[rgba(252,238,9,0.28)]'
                        : 'bg-[#1d1d1d]'
                    }`}
                  >
                    <span
                      className={`absolute top-1/2 h-[14px] w-[14px] -translate-y-1/2 rounded-full transition-all ${
                        (settings?.autoInstallDownloads ?? true)
                          ? 'right-[2px] bg-[#fcee09]'
                          : 'left-[2px] bg-[#5a5a5a]'
                      }`}
                    />
                  </span>
                </button>
              </SettingCard>

              <SettingCard
                icon="folder_special"
                title={t('settings.general.runtimeCaptures.title')}
                description={t('settings.general.runtimeCaptures.description')}
                className="fade-up"
                style={{ animationDelay: '60ms' }}
              >
                <ValidationRow
                  state={runtimeCapturesInfo ? (runtimeCapturesInfo.fileCount > 0 ? 'info' : 'valid') : 'empty'}
                  validText={t('settings.general.runtimeCaptures.clean')}
                  infoText={runtimeCapturesInfo ? tn('settings.general.runtimeCaptures.captured', runtimeCapturesInfo.fileCount) : ''}
                  emptyText={t('settings.general.runtimeCaptures.loading')}
                />
                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void handleOpenRuntimeCaptures()}
                    className={`${secondaryBtn} w-full sm:w-auto`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                    {t('common.openFolder')}
                  </button>
                  {runtimeCapturesInfo && runtimeCapturesInfo.fileCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleClearRuntimeCaptures()}
                      disabled={clearingCaptures}
                      className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-[rgba(248,113,113,0.13)] px-4 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#ff9b9b] transition-colors hover:bg-[#f87171] hover:text-[#190505] disabled:cursor-not-allowed disabled:bg-[#0d0404] disabled:text-[#7c4a4a] sm:w-auto [&_.material-symbols-outlined]:leading-none"
                    >
                      <span className={`material-symbols-outlined ${clearingCaptures ? 'animate-spin' : ''}`} style={{ fontSize: 16 }}>
                        {clearingCaptures ? 'progress_activity' : 'delete_sweep'}
                      </span>
                      {clearingCaptures ? t('settings.general.runtimeCaptures.clearing') : t('settings.general.runtimeCaptures.clear')}
                    </button>
                  )}
                </div>
              </SettingCard>

              <SettingCard
                icon="language"
                title={t('settings.general.language.title')}
                description={t('settings.general.language.description')}
                className="fade-up"
                style={{ animationDelay: '120ms' }}
              >
                <LanguageSelect align="left" buttonClassName="w-full justify-between sm:w-auto sm:justify-start" />
              </SettingCard>
              </>
            )}

            {activeTab === 'paths' && (
              <>
                <SettingCard
                  icon="sports_esports"
                  title="Game Path"
                  description="Cyberpunk 2077 installation root used for launch validation and deployment."
                  className="fade-up"
                  style={{ animationDelay: '0ms' }}
                >
                  <PathBox value={gamePath} placeholder="No folder selected - detect or browse" emphasize={gameState !== 'valid'} />
                  <ValidationRow
                    state={gameState}
                    validText="Cyberpunk 2077 found. Launch and deployment validation are ready."
                    invalidText="We couldn't find Cyberpunk 2077 in this folder. Launch stays blocked until it's fixed."
                  />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={() => void autoDetectGame()} disabled={detectingGame} className={`${secondaryBtn} w-full sm:w-auto`}>
                      {detectingGame ? (
                        <>
                          <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                          Detecting...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>search</span>
                          Detect automatically
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => void browseFolder('Select Cyberpunk 2077 folder', setGamePath)}
                      className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                      Choose folder
                    </button>
                  </div>
                </SettingCard>

              <SettingCard
                icon="inventory_2"
                title="Mod Library"
                description="Managed archive repository for metadata, reinstalls, staged recovery, and deploy rebuilds."
                className="fade-up"
                style={{ animationDelay: '60ms' }}
              >
                <PathBox value={libraryPath} placeholder="No folder selected - use suggested or browse" emphasize={libraryState === 'invalid'} />
                <ValidationRow
                  state={libraryState}
                  validText="Installs, rescans, and recovery can use this library."
                  invalidText="This folder can't be used as a mod library. Installs stay blocked until it's fixed."
                />
                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button onClick={applyDefaultLibraryPath} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark</span>
                    Use suggested
                  </button>
                  <button
                    onClick={() => void browseFolder('Select Mod Library folder', setLibraryPath)}
                    className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                    Choose folder
                  </button>
                </div>
              </SettingCard>

              <SettingCard
                icon="download"
                title="Downloads Intake"
                description="Optional source folder for incoming archives before install."
                className="fade-up"
                style={{ animationDelay: '120ms' }}
              >
                <PathBox value={downloadsStatus.path} placeholder="Waiting for a library path..." />
                <ValidationRow state="info" infoText={downloadsStatus.description} />
                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button onClick={applyDefaultDownloadPath} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark</span>
                    Use suggested
                  </button>
                  <button
                    onClick={() => void browseFolder('Select Downloads folder', setDownloadPath)}
                    className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                    Choose folder
                  </button>
                </div>
              </SettingCard>
            </>
          )}

          {activeTab === 'nexus' && (
            <>
              <SettingCard
                icon="vpn_key"
                title="Nexus Connection"
                description="Paste your personal Nexus API key. Hyperion saves it automatically and validates it in the background."
                headerRight={
                  <StatusReadout
                    tone={nexusReadout.tone}
                    label={nexusReadout.label}
                    pulse={nexusStatus === 'checking'}
                  />
                }
                className="fade-up"
                style={{ animationDelay: '0ms' }}
              >
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
                  <div className="flex min-h-10 min-w-0 flex-1 items-center rounded-sm border-0 bg-[#101010] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_rgba(252,238,9,0.26)]">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={nexusApiKey}
                      onChange={(e) => setNexusApiKey(e.target.value)}
                      placeholder="Paste your Nexus API key here..."
                      className="min-w-0 flex-1 bg-transparent px-4 py-2.5 font-mono text-[13px] text-[#e5e2e1] placeholder:text-[#595959] focus:outline-none"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((value) => !value)}
                      className="flex items-center self-stretch px-3 text-[#6a6a6a] transition-colors hover:text-[#e7e4e3]"
                      tabIndex={-1}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        {showApiKey ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNexusApiKey('')}
                    disabled={!nexusApiKey.trim()}
                    className={`${secondaryBtn} w-full sm:w-auto`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>backspace</span>
                    Clear key
                  </button>
                </div>
                {nexusStatus === 'error' && (
                  <div className="mt-4 rounded-sm border-0 bg-[rgba(248,113,113,0.13)] px-4 py-3 text-[14px] leading-6 text-[#ff9b9b]">
                    {nexusAccount.error}
                  </div>
                )}
              </SettingCard>

              <SettingCard
                icon="account_circle"
                title="Account"
                description="Linked Nexus identity and subscription tier."
                headerRight={
                  nexusStatus === 'connected' ? (
                    <StatusReadout
                      tone={nexusAccount.data.isPremium ? 'warn' : 'info'}
                      label={nexusAccount.data.isPremium ? 'Premium' : 'Free'}
                    />
                  ) : undefined
                }
                className="fade-up"
                style={{ animationDelay: '60ms' }}
              >
                {nexusStatus === 'connected' ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="text-[15px] font-semibold text-white">{nexusAccount.data.name}</div>
                      <div className="text-[13px] text-[#8a8a8a]">{nexusAccount.data.email} · User #{nexusAccount.data.userId}</div>
                    </div>
                    <NexusTierComparison isPremium={nexusAccount.data.isPremium} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ValidationRow
                      state="info"
                      infoText="Add a valid API key to show your account and unlock Nexus-aware flows."
                    />
                    <NexusTierComparison isPremium={null} />
                  </div>
                )}
              </SettingCard>

              <SettingCard
                icon="downloading"
                title="Download Flow"
                description="Keep Nexus installs predictable."
                className="fade-up"
                style={{ animationDelay: '120ms' }}
              >
                <div className="space-y-3 text-[13.5px] leading-relaxed text-[#b8b8b8]">
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[#fcee09]" style={{ fontSize: 17 }}>subdirectory_arrow_right</span>
                    <span>Nexus links land in Downloads and install automatically unless disabled in General.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[#fcee09]" style={{ fontSize: 17 }}>rule</span>
                    <span>Hyperion still asks when a duplicate, FOMOD, or overwrite decision needs your input.</span>
                  </div>
                </div>
              </SettingCard>
            </>
          )}

          {activeTab === 'updates' && (
            <SettingCard
              icon="update"
              title="Application Updates"
              description="Check for, download, and install new Hyperion builds."
              headerRight={
                <StatusReadout tone={updateReadout.tone} label={updateReadout.label} pulse={updateDownloading} />
              }
              className="fade-up"
              style={{ animationDelay: '0ms' }}
            >
              <ValidationRow state={updateDownloaded || updateAvailable ? 'info' : 'valid'} validText={updateMessage} infoText={updateMessage} />
              {updateError ? (
                <div className="mt-4 rounded-sm border-0 bg-[rgba(248,113,113,0.13)] px-4 py-3 text-[14px] leading-6 text-[#ff9b9b]">
                  {updateError}
                </div>
              ) : null}
              <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={updateActionLoading !== null || updateDownloading}
                  className={`${secondaryBtn} w-full sm:w-auto`}
                >
                  {updateActionLoading === 'check' ? (
                    <>
                      <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                      Checking...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
                      Check for updates
                    </>
                  )}
                </button>
                {!updateDownloaded && updateAvailable && (
                  <button
                    type="button"
                    onClick={() => void handleDownloadUpdate()}
                    disabled={updateActionLoading !== null || updateDownloading}
                    className={`${accentOutlineBtn} w-full sm:w-auto`}
                  >
                    {updateActionLoading === 'download' || updateDownloading ? (
                      <>
                        <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                        Downloading...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                        Download update
                      </>
                    )}
                  </button>
                )}
                {updateDownloaded && (
                  <button type="button" onClick={installUpdate} className={`${primaryBtn} w-full sm:ml-auto sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>restart_alt</span>
                    Install & restart
                  </button>
                )}
              </div>
            </SettingCard>
          )}

          {activeTab === 'about' && (
            <>
              <SettingCard
                icon="hexagon"
                title="About Hyperion"
                description="Cyberpunk 2077 mod manager focused on virtual deployment, conflict visibility, and a predictable load order."
                className="fade-up"
                style={{ animationDelay: '0ms' }}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)]">
                  <section className="rounded-sm border-0 bg-[#101010] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">Project</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusReadout tone="neutral" label={`v${appVersion}`} />
                      <span className="inline-flex h-7 items-center rounded-sm border-0 bg-[#151515] px-2.5 brand-font text-[10px] font-bold uppercase tracking-[0.16em] text-[#a0a0a0]">
                        GPL-3.0
                      </span>
                      <span className="inline-flex h-7 items-center rounded-sm border-0 bg-[#151515] px-2.5 brand-font text-[10px] font-bold uppercase tracking-[0.16em] text-[#a0a0a0]">
                        Unofficial
                      </span>
                    </div>
                    <p className="mt-3 text-[13.5px] leading-6 text-[#b8b8b8]">
                      Built for a clean Cyberpunk 2077 modding workflow: install, inspect, reorder, and launch without turning the game folder into the source of truth.
                    </p>
                    <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                      <button type="button" onClick={() => void handleOpenExternal(HYPERION_GITHUB_URL)} className={`${aboutActionBtn} w-full sm:w-auto`}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>code</span>
                        GitHub
                      </button>
                      <button type="button" onClick={() => void handleOpenExternal(HYPERION_RELEASES_URL)} className={`${aboutActionBtn} w-full sm:w-auto`}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>new_releases</span>
                        Releases
                      </button>
                    </div>
                  </section>

                  <section className="rounded-sm border-0 bg-[#101010] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">Support</div>
                    <p className="mt-3 text-[13.5px] leading-6 text-[#b8b8b8]">
                      For bug reports, include your Hyperion version and diagnostics summary so launch, VFS, and path issues are easier to trace.
                    </p>
                    <div className="mt-4 grid gap-2">
                      <button type="button" onClick={() => void handleOpenExternal(HYPERION_ISSUES_URL)} className={aboutActionBtn}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bug_report</span>
                        Report issue
                      </button>
                      <button type="button" onClick={() => void handleCopyDiagnostics()} className={accentOutlineBtn}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>content_copy</span>
                        Copy diagnostics
                      </button>
                    </div>
                  </section>
                </div>
              </SettingCard>

              <SettingCard
                icon="groups"
                title="Credits"
                description="Acknowledgements for the tools, APIs, and modding references that make Hyperion possible."
                className="fade-up"
                style={{ animationDelay: '60ms' }}
              >
                <div className="overflow-hidden rounded-sm border-0 bg-[#101010] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                  <div className="grid gap-3 border-b-[0.5px] border-[#1a1a1a] px-4 py-4 lg:grid-cols-[116px_minmax(0,1fr)_174px] lg:items-center">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#fcee09]">Core VFS</div>
                    <div>
                      <div className="brand-font text-[11px] font-bold uppercase tracking-[0.14em] text-[#f4f1ee]">usvfs / Mod Organizer 2</div>
                      <p className="mt-1 text-[13.5px] leading-6 text-[#a8a8a8]">
                        Hyperion's virtual deployment is powered by usvfs, the User-Space VFS used by Mod Organizer 2.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                      <button type="button" onClick={() => void handleOpenExternal(USVFS_URL)} className={aboutActionBtn}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hub</span>
                        usvfs
                      </button>
                      <button type="button" onClick={() => void handleOpenExternal(MOD_ORGANIZER_URL)} className={aboutActionBtn}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
                        MO2
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 border-b-[0.5px] border-[#1a1a1a] px-4 py-4 lg:grid-cols-[116px_minmax(0,1fr)_174px] lg:items-center">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">Service API</div>
                    <div>
                      <div className="brand-font text-[11px] font-bold uppercase tracking-[0.14em] text-[#f4f1ee]">Nexus Mods API</div>
                      <p className="mt-1 text-[13.5px] leading-6 text-[#a8a8a8]">
                        Account validation, update checks, nxm links, and Premium-aware download handling.
                      </p>
                    </div>
                    <div className="hidden lg:block" />
                  </div>

                  <div className="grid gap-3 px-4 py-4 lg:grid-cols-[116px_minmax(0,1fr)_174px] lg:items-center">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">Reference</div>
                    <div>
                      <div className="brand-font text-[11px] font-bold uppercase tracking-[0.14em] text-[#f4f1ee]">REDmodding ecosystem</div>
                      <p className="mt-1 text-[13.5px] leading-6 text-[#a8a8a8]">
                        Archive behavior, load-order details, and public Cyberpunk modding documentation.
                      </p>
                    </div>
                    <button type="button" onClick={() => void handleOpenExternal(REDMODDING_URL)} className={aboutActionBtn}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>menu_book</span>
                      REDmodding
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-[12.5px] leading-5 text-[#7f7f7f]">
                  Hyperion is not affiliated with CD PROJEKT RED, Nexus Mods, Mod Organizer 2, or the usvfs maintainers.
                </p>
              </SettingCard>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const SettingsDialog = SettingsPage
