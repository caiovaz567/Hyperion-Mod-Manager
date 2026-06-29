import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC, type IpcResult, type VfsOverwriteInfo } from '@shared/types'
import { useAppVersion } from '../../hooks/useAppVersion'
import { useNexusAccount } from '../../hooks/useNexusAccount'
import { PathBox, SettingCard, StatusReadout, SurfaceTabRail, ValidationRow, uiButton } from './uiKit'
import { LanguageSelect } from './LanguageSelect'
import { useTranslation, type TranslationKey } from '../../i18n/I18nContext'

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
  { icon: 'open_in_browser', textKey: 'settings.nexus.tiers.free.feat1' },
  { icon: 'link', textKey: 'settings.nexus.tiers.free.feat2' },
  { icon: 'deployed_code', textKey: 'settings.nexus.tiers.free.feat3' },
] as const

const NEXUS_PREMIUM_FEATURES = [
  { icon: 'bolt', textKey: 'settings.nexus.tiers.premium.feat1' },
  { icon: 'api', textKey: 'settings.nexus.tiers.premium.feat2' },
  { icon: 'sync', textKey: 'settings.nexus.tiers.premium.feat3' },
] as const

function NexusTierComparison({ isPremium }: { isPremium: boolean | null }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-2 text-[12.5px]">
      {/* Free */}
      <div className={`rounded-sm border-0 p-3 space-y-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)] ${isPremium === false ? 'bg-[rgba(96,165,250,0.10)]' : 'bg-[#101010]'}`}>
        <div className={`text-[10px] brand-font font-bold uppercase tracking-widest mb-1 ${isPremium === false ? 'text-[#60A5FA]' : 'text-[#555]'}`}>{t('common.free')}</div>
        {NEXUS_FREE_FEATURES.map((f) => (
          <div key={f.icon} className="flex items-start gap-2">
            <span className={`material-symbols-outlined text-[14px] mt-[1px] shrink-0 ${isPremium === false ? 'text-[#60A5FA]' : 'text-[#444]'}`}>{f.icon}</span>
            <span className={isPremium === false ? 'text-[#c0c0c0]' : 'text-[#555]'}>{t(f.textKey)}</span>
          </div>
        ))}
      </div>

      {/* Premium */}
      <div className={`rounded-sm border-0 p-3 space-y-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)] ${isPremium === true ? 'bg-[rgba(252,238,9,0.10)]' : 'bg-[#101010]'}`}>
        <div className={`text-[10px] brand-font font-bold uppercase tracking-widest mb-1 ${isPremium === true ? 'text-[#f7d154]' : 'text-[#555]'}`}>{t('common.premium')}</div>
        {NEXUS_PREMIUM_FEATURES.map((f) => (
          <div key={f.icon} className="flex items-start gap-2">
            <span className={`material-symbols-outlined text-[14px] mt-[1px] shrink-0 ${isPremium === true ? 'text-[#f7d154]' : 'text-[#444]'}`}>{f.icon}</span>
            <span className={isPremium === true ? 'text-[#c0c0c0]' : 'text-[#555]'}>{t(f.textKey)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function getDownloadsStatus(
  downloadPath: string,
  defaultDownloadPath: string,
  t: (key: TranslationKey) => string
) {
  const trimmed = downloadPath.trim()
  if (!trimmed) {
    return {
      path: defaultDownloadPath,
      description: t('settings.paths.downloads.defaultDescription'),
    }
  }

  return {
    path: trimmed,
    description: t('settings.paths.downloads.activeDescription'),
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
        addToast(t('settings.toast.capturesCleared'), 'success', 1800)
      } else {
        addToast(result.error ?? t('settings.toast.capturesClearError'), 'error', 3200)
      }
    } catch {
      addToast(t('settings.toast.capturesClearError'), 'error', 3200)
    } finally {
      setClearingCaptures(false)
    }
  }, [addToast, t])

  const handleOpenExternal = useCallback(async (url: string) => {
    await IpcService.invoke(IPC.OPEN_EXTERNAL, url)
  }, [])

  const handleCopyDiagnostics = useCallback(async () => {
    const lines = [
      `Hyperion: ${appVersion}`,
      `Game path: ${gamePath || '(not set)'}`,
      `Mod library: ${libraryPath || '(not set)'}`,
      `Downloads: ${getDownloadsStatus(downloadPath, defaultPaths?.downloadPath ?? '', t).path || '(not set)'}`,
      `Runtime captures: ${runtimeCapturesInfo?.path ?? '(not loaded)'}`,
      `Runtime capture files: ${runtimeCapturesInfo?.fileCount ?? 0}`,
      `Runtime capture size: ${formatBytes(runtimeCapturesInfo?.totalBytes ?? 0)}`,
    ]

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      addToast(t('settings.toast.diagnosticsCopied'), 'success', 1800)
    } catch {
      addToast(t('settings.toast.diagnosticsCopyError'), 'error', 2600)
    }
  }, [addToast, appVersion, defaultPaths?.downloadPath, downloadPath, gamePath, libraryPath, runtimeCapturesInfo, t])

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
            addToast(tn('settings.toast.purged', purgeResult.data.purged), 'info', 2600)
          }
          if (purgeResult.data?.failed) {
            addToast(tn('settings.toast.purgeFailed', purgeResult.data.failed), 'warning', 3200)
          }
        }

        const saveResult = await updateSettings({ gamePath, libraryPath, downloadPath })
        if (!saveResult.ok) {
          addToast(saveResult.error ?? t('settings.toast.saveConfigError'), 'error', 5000)
          return
        }

        if (libraryChanged || gameChanged) {
          selectMod(null)
          const scannedMods = await scanMods()
          if (gamePathValid && libraryPathValid) {
            const restoreResults = await restoreEnabledMods(scannedMods)
            const failedRestoreCount = restoreResults.filter((result) => !result.ok).length
            if (failedRestoreCount > 0) {
              addToast(tn('settings.toast.restoreFailed', failedRestoreCount), 'warning', 3200)
            }
          }
        }

        addToast(t('settings.toast.changesSaved'), 'success', 1800)
      } catch {
        addToast(t('settings.toast.saveConfigError'), 'error', 2600)
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
    t,
    tn,
  ])

  useEffect(() => {
    if (!settings) return
    if (nexusApiKey === (settings.nexusApiKey ?? '')) return

    if (nexusSaveTimerRef.current) window.clearTimeout(nexusSaveTimerRef.current)
    nexusSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await updateSettings({ nexusApiKey })
        addToast(nexusApiKey.trim() ? t('settings.toast.nexusKeySaved') : t('settings.toast.nexusKeyCleared'), 'success', 1800)
      } catch {
        addToast(t('settings.toast.nexusKeyError'), 'error', 2600)
      }
    }, 600)

    return () => {
      if (nexusSaveTimerRef.current) window.clearTimeout(nexusSaveTimerRef.current)
    }
  }, [addToast, nexusApiKey, settings, updateSettings, t])

  const browseFolder = async (title: string, assign: (path: string) => void) => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(IPC.OPEN_FOLDER_DIALOG, { title })
    if (!result.canceled && result.filePaths.length) assign(result.filePaths[0])
  }

  const autoDetectGame = async () => {
    setDetectingGame(true)
    const result = await detectGamePath()
    setDetectingGame(false)

    if (!result.ok || !result.data) {
      addToast(result.error ?? t('settings.toast.gameDetectError'), 'warning', 2600)
      return
    }

    setGamePath(result.data)
    addToast(t('settings.toast.gameDetected'), 'success', 1800)
  }

  const ensureDirectory = async (targetPath: string, label: string): Promise<boolean> => {
    const result = await IpcService.invoke<IpcResult<void>>(IPC.ENSURE_DIRECTORY, targetPath)
    if (!result.ok) {
      addToast(result.error ?? t('settings.toast.createDirError', { label }), 'warning', 2600)
      return false
    }
    return true
  }

  const applyDefaultLibraryPath = async () => {
    if (!defaultPaths) return
    const nextPath = defaultPaths.libraryPath
    setLibraryPath(nextPath)
    if (await ensureDirectory(nextPath, t('settings.toast.libraryLabel'))) {
      addToast(t('settings.toast.libraryLoaded'), 'info', 1800)
    }
  }

  const applyDefaultDownloadPath = async () => {
    if (!defaultPaths) return
    const nextPath = defaultPaths.downloadPath
    setDownloadPath(nextPath)
    if (await ensureDirectory(nextPath, t('settings.toast.downloadsLabel'))) {
      addToast(t('settings.toast.downloadsLoaded'), 'info', 1800)
    }
  }

  const handleCheckForUpdates = async () => {
    setUpdateActionLoading('check')
    try {
      await checkForUpdates()
      addToast(updateAvailable ? t('settings.toast.updateRefreshed') : t('settings.toast.updateChecked'), 'info', 2200)
    } catch {
      addToast(t('settings.toast.updateCheckError'), 'error', 2600)
    } finally {
      setUpdateActionLoading(null)
    }
  }

  const handleDownloadUpdate = async () => {
    setUpdateActionLoading('download')
    try {
      await downloadUpdate()
      addToast(t('settings.toast.updateDownloaded'), 'success', 2200)
    } catch {
      addToast(t('settings.toast.updateDownloadError'), 'error', 2600)
    } finally {
      setUpdateActionLoading(null)
    }
  }

  const { primary: primaryBtn, secondary: secondaryBtn, accentOutline: accentOutlineBtn } = uiButton
  const aboutActionBtn =
    'group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm border-0 bg-[#171717] px-4 text-[10px] brand-font font-bold uppercase leading-none tracking-widest text-[#c9c9c9] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),0_8px_18px_rgba(0,0,0,0.20)] transition-colors hover:bg-[rgba(252,238,9,0.16)] hover:text-[#fcee09] focus:outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(252,238,9,0.42),0_8px_18px_rgba(0,0,0,0.20)] [&_.material-symbols-outlined]:text-current [&_.material-symbols-outlined]:leading-none'

  const tabMeta: Array<{ id: SettingsTab; label: string; icon: string }> = [
    { id: 'general', label: t('settings.tabs.general'), icon: 'tune' },
    { id: 'paths', label: t('settings.tabs.paths'), icon: 'folder_open' },
    { id: 'nexus', label: t('settings.tabs.nexus'), icon: 'cloud' },
    { id: 'updates', label: t('settings.tabs.updates'), icon: 'update' },
    { id: 'about', label: t('settings.tabs.about'), icon: 'info' },
  ]

  const resolvedDefaultDownloadPath = defaultPaths?.downloadPath ?? ''
  const downloadsStatus = getDownloadsStatus(downloadPath, resolvedDefaultDownloadPath, t)

  const gameState: FolderState = gamePath.trim() ? (gamePathValid ? 'valid' : 'invalid') : 'empty'
  const libraryState: FolderState = libraryPath.trim() ? (libraryPathValid ? 'valid' : 'invalid') : 'empty'

  const nexusStatus = nexusAccount.status
  const nexusReadout =
    nexusStatus === 'connected'
      ? { tone: 'good' as const, label: t('settings.nexus.status.connected') }
      : nexusStatus === 'checking'
      ? { tone: 'info' as const, label: t('settings.nexus.status.checking') }
      : nexusStatus === 'error'
      ? { tone: 'error' as const, label: t('settings.nexus.status.invalidKey') }
      : { tone: 'neutral' as const, label: t('settings.nexus.status.notConnected') }

  const updateReadout = updateDownloaded
    ? { tone: 'good' as const, label: t('settings.updates.status.ready') }
    : updateAvailable
    ? { tone: 'warn' as const, label: t('settings.updates.status.available') }
    : { tone: 'neutral' as const, label: `v${appVersion}` }

  const updateVersion = updateInfo?.version ?? ''
  const updateMessage = updateDownloaded
    ? t('settings.updates.message.ready', { version: updateVersion })
    : updateAvailable
    ? t('settings.updates.message.available', { version: updateVersion })
    : t('settings.updates.message.upToDate')

  return (
    <div className="stable-scroll-gutter h-full overflow-y-scroll pb-10 animate-settings-in sm:pb-16">
      <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="mb-6 border-b-[0.5px] border-[#171717] pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-[#fcee09]" />
                <span className="ui-support-mono text-[11px] uppercase tracking-[0.16em] text-[#6f6f6f]">
                  {t('settings.header.eyebrow')}
                </span>
              </div>
              <h1 className="screen-title-font text-[1.42rem] font-black uppercase tracking-[0.06em] text-white sm:text-[1.58rem]">
                {t('settings.header.title')}
              </h1>
              <p className="mt-3 max-w-[680px] text-[15px] leading-7 text-[#c0c0c0]">
                {t('settings.header.subtitle')}
              </p>
            </div>
            <StatusReadout tone="neutral" label={`v${appVersion}`} />
          </div>
        </header>

        <SurfaceTabRail
          items={tabMeta}
          activeId={activeTab}
          onChange={setActiveTab}
          ariaLabel={t('settings.header.sectionsAria')}
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
                  title={t('settings.paths.game.title')}
                  description={t('settings.paths.game.description')}
                  className="fade-up"
                  style={{ animationDelay: '0ms' }}
                >
                  <PathBox value={gamePath} placeholder={t('settings.paths.game.placeholder')} emphasize={gameState !== 'valid'} />
                  <ValidationRow
                    state={gameState}
                    validText={t('settings.paths.game.valid')}
                    invalidText={t('settings.paths.game.invalid')}
                  />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={() => void autoDetectGame()} disabled={detectingGame} className={`${secondaryBtn} w-full sm:w-auto`}>
                      {detectingGame ? (
                        <>
                          <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                          {t('common.detecting')}
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>search</span>
                          {t('common.detectAutomatically')}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => void browseFolder(t('settings.paths.game.dialogTitle'), setGamePath)}
                      className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                      {t('common.chooseFolder')}
                    </button>
                  </div>
                </SettingCard>

              <SettingCard
                icon="inventory_2"
                title={t('settings.paths.library.title')}
                description={t('settings.paths.library.description')}
                className="fade-up"
                style={{ animationDelay: '60ms' }}
              >
                <PathBox value={libraryPath} placeholder={t('settings.paths.library.placeholder')} emphasize={libraryState === 'invalid'} />
                <ValidationRow
                  state={libraryState}
                  validText={t('settings.paths.library.valid')}
                  invalidText={t('settings.paths.library.invalid')}
                />
                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button onClick={applyDefaultLibraryPath} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark</span>
                    {t('common.useSuggested')}
                  </button>
                  <button
                    onClick={() => void browseFolder(t('settings.paths.library.dialogTitle'), setLibraryPath)}
                    className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                    {t('common.chooseFolder')}
                  </button>
                </div>
              </SettingCard>

              <SettingCard
                icon="download"
                title={t('settings.paths.downloads.title')}
                description={t('settings.paths.downloads.description')}
                className="fade-up"
                style={{ animationDelay: '120ms' }}
              >
                <PathBox value={downloadsStatus.path} placeholder={t('settings.paths.downloads.placeholder')} />
                <ValidationRow state="info" infoText={downloadsStatus.description} />
                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button onClick={applyDefaultDownloadPath} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark</span>
                    {t('common.useSuggested')}
                  </button>
                  <button
                    onClick={() => void browseFolder(t('settings.paths.downloads.dialogTitle'), setDownloadPath)}
                    className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                    {t('common.chooseFolder')}
                  </button>
                </div>
              </SettingCard>
            </>
          )}

          {activeTab === 'nexus' && (
            <>
              <SettingCard
                icon="vpn_key"
                title={t('settings.nexus.connection.title')}
                description={t('settings.nexus.connection.description')}
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
                      placeholder={t('settings.nexus.connection.placeholder')}
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
                    {t('settings.nexus.connection.clearKey')}
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
                title={t('settings.nexus.account.title')}
                description={t('settings.nexus.account.description')}
                headerRight={
                  nexusStatus === 'connected' ? (
                    <StatusReadout
                      tone={nexusAccount.data.isPremium ? 'warn' : 'info'}
                      label={nexusAccount.data.isPremium ? t('common.premium') : t('common.free')}
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
                      <div className="text-[13px] text-[#8a8a8a]">{t('settings.nexus.account.userLine', { email: nexusAccount.data.email, id: nexusAccount.data.userId })}</div>
                    </div>
                    <NexusTierComparison isPremium={nexusAccount.data.isPremium} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ValidationRow
                      state="info"
                      infoText={t('settings.nexus.account.empty')}
                    />
                    <NexusTierComparison isPremium={null} />
                  </div>
                )}
              </SettingCard>

              <SettingCard
                icon="downloading"
                title={t('settings.nexus.downloadFlow.title')}
                description={t('settings.nexus.downloadFlow.description')}
                className="fade-up"
                style={{ animationDelay: '120ms' }}
              >
                <div className="space-y-3 text-[13.5px] leading-relaxed text-[#b8b8b8]">
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[#fcee09]" style={{ fontSize: 17 }}>subdirectory_arrow_right</span>
                    <span>{t('settings.nexus.downloadFlow.bullet1')}</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[#fcee09]" style={{ fontSize: 17 }}>rule</span>
                    <span>{t('settings.nexus.downloadFlow.bullet2')}</span>
                  </div>
                </div>
              </SettingCard>
            </>
          )}

          {activeTab === 'updates' && (
            <SettingCard
              icon="update"
              title={t('settings.updates.title')}
              description={t('settings.updates.description')}
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
                      {t('settings.updates.checking')}
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
                      {t('settings.updates.checkButton')}
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
                        {t('settings.updates.downloading')}
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                        {t('settings.updates.downloadButton')}
                      </>
                    )}
                  </button>
                )}
                {updateDownloaded && (
                  <button type="button" onClick={installUpdate} className={`${primaryBtn} w-full sm:ml-auto sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>restart_alt</span>
                    {t('settings.updates.installButton')}
                  </button>
                )}
              </div>
            </SettingCard>
          )}

          {activeTab === 'about' && (
            <>
              <SettingCard
                icon="hexagon"
                title={t('settings.about.title')}
                description={t('settings.about.description')}
                className="fade-up"
                style={{ animationDelay: '0ms' }}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)]">
                  <section className="rounded-sm border-0 bg-[#101010] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">{t('settings.about.projectLabel')}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusReadout tone="neutral" label={`v${appVersion}`} />
                      <span className="inline-flex h-7 items-center rounded-sm border-0 bg-[#151515] px-2.5 brand-font text-[10px] font-bold uppercase tracking-[0.16em] text-[#a0a0a0]">
                        GPL-3.0
                      </span>
                      <span className="inline-flex h-7 items-center rounded-sm border-0 bg-[#151515] px-2.5 brand-font text-[10px] font-bold uppercase tracking-[0.16em] text-[#a0a0a0]">
                        {t('settings.about.unofficial')}
                      </span>
                    </div>
                    <p className="mt-3 text-[13.5px] leading-6 text-[#b8b8b8]">
                      {t('settings.about.projectBody')}
                    </p>
                    <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                      <button type="button" onClick={() => void handleOpenExternal(HYPERION_GITHUB_URL)} className={`${aboutActionBtn} w-full sm:w-auto`}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>code</span>
                        GitHub
                      </button>
                      <button type="button" onClick={() => void handleOpenExternal(HYPERION_RELEASES_URL)} className={`${aboutActionBtn} w-full sm:w-auto`}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>new_releases</span>
                        {t('settings.about.releases')}
                      </button>
                    </div>
                  </section>

                  <section className="rounded-sm border-0 bg-[#101010] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">{t('settings.about.supportLabel')}</div>
                    <p className="mt-3 text-[13.5px] leading-6 text-[#b8b8b8]">
                      {t('settings.about.supportBody')}
                    </p>
                    <div className="mt-4 grid gap-2">
                      <button type="button" onClick={() => void handleOpenExternal(HYPERION_ISSUES_URL)} className={aboutActionBtn}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bug_report</span>
                        {t('settings.about.reportIssue')}
                      </button>
                      <button type="button" onClick={() => void handleCopyDiagnostics()} className={accentOutlineBtn}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>content_copy</span>
                        {t('settings.about.copyDiagnostics')}
                      </button>
                    </div>
                  </section>
                </div>
              </SettingCard>

              <SettingCard
                icon="groups"
                title={t('settings.about.creditsTitle')}
                description={t('settings.about.creditsDescription')}
                className="fade-up"
                style={{ animationDelay: '60ms' }}
              >
                <div className="overflow-hidden rounded-sm border-0 bg-[#101010] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                  <div className="grid gap-3 border-b-[0.5px] border-[#1a1a1a] px-4 py-4 lg:grid-cols-[116px_minmax(0,1fr)_174px] lg:items-center">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#fcee09]">{t('settings.about.credits.coreVfsLabel')}</div>
                    <div>
                      <div className="brand-font text-[11px] font-bold uppercase tracking-[0.14em] text-[#f4f1ee]">usvfs / Mod Organizer 2</div>
                      <p className="mt-1 text-[13.5px] leading-6 text-[#a8a8a8]">
                        {t('settings.about.credits.coreVfsBody')}
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
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">{t('settings.about.credits.serviceApiLabel')}</div>
                    <div>
                      <div className="brand-font text-[11px] font-bold uppercase tracking-[0.14em] text-[#f4f1ee]">Nexus Mods API</div>
                      <p className="mt-1 text-[13.5px] leading-6 text-[#a8a8a8]">
                        {t('settings.about.credits.serviceApiBody')}
                      </p>
                    </div>
                    <div className="hidden lg:block" />
                  </div>

                  <div className="grid gap-3 px-4 py-4 lg:grid-cols-[116px_minmax(0,1fr)_174px] lg:items-center">
                    <div className="brand-font text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">{t('settings.about.credits.referenceLabel')}</div>
                    <div>
                      <div className="brand-font text-[11px] font-bold uppercase tracking-[0.14em] text-[#f4f1ee]">REDmodding ecosystem</div>
                      <p className="mt-1 text-[13.5px] leading-6 text-[#a8a8a8]">
                        {t('settings.about.credits.referenceBody')}
                      </p>
                    </div>
                    <button type="button" onClick={() => void handleOpenExternal(REDMODDING_URL)} className={aboutActionBtn}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>menu_book</span>
                      REDmodding
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-[12.5px] leading-5 text-[#7f7f7f]">
                  {t('settings.about.disclaimer')}
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
