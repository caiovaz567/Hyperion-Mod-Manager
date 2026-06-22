import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import { useAppVersion } from '../../hooks/useAppVersion'
import { useNexusAccount } from '../../hooks/useNexusAccount'
import { PathBox, SettingCard, StatusReadout, ValidationRow, uiButton } from './uiKit'

type SettingsTab = 'paths' | 'nexus' | 'updates'
type FolderState = 'valid' | 'invalid' | 'empty'

const NEXUS_FREE_FEATURES = [
  { icon: 'open_in_browser', text: 'Mod updates open Nexus in the browser' },
  { icon: 'link', text: 'Downloads via nxm:// link from the site' },
  { icon: 'download', text: 'Archive lands in Downloads — install from there' },
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
      <div className={`rounded-sm border-[0.5px] p-3 space-y-2.5 ${isPremium === false ? 'border-[#60A5FA]/40 bg-[#060e18]' : 'border-[rgba(255,255,255,0.07)] bg-[#080808]'}`}>
        <div className={`text-[10px] brand-font font-bold uppercase tracking-widest mb-1 ${isPremium === false ? 'text-[#60A5FA]' : 'text-[#555]'}`}>Free</div>
        {NEXUS_FREE_FEATURES.map((f) => (
          <div key={f.text} className="flex items-start gap-2">
            <span className={`material-symbols-outlined text-[14px] mt-[1px] shrink-0 ${isPremium === false ? 'text-[#60A5FA]' : 'text-[#444]'}`}>{f.icon}</span>
            <span className={isPremium === false ? 'text-[#c0c0c0]' : 'text-[#555]'}>{f.text}</span>
          </div>
        ))}
      </div>

      {/* Premium */}
      <div className={`rounded-sm border-[0.5px] p-3 space-y-2.5 ${isPremium === true ? 'border-[#f7d154]/40 bg-[#14110a]' : 'border-[rgba(255,255,255,0.07)] bg-[#080808]'}`}>
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
  const [activeTab, setActiveTab] = useState<SettingsTab>('paths')
  const [nexusApiKey, setNexusApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [updateActionLoading, setUpdateActionLoading] = useState<null | 'check' | 'download'>(null)
  const nexusSaveTimerRef = useRef<number | null>(null)

  const nexusAccount = useNexusAccount(nexusApiKey)

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

        await updateSettings({ gamePath, libraryPath, downloadPath })

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

  const applyDefaultManagedPaths = () => {
    if (!defaultPaths) return
    setLibraryPath(defaultPaths.libraryPath)
    setDownloadPath(defaultPaths.downloadPath)
    addToast('Suggested folders loaded', 'info', 1800)
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

  const tabMeta: Array<{ id: SettingsTab; label: string; icon: string }> = [
    { id: 'paths', label: 'Paths', icon: 'folder_open' },
    { id: 'nexus', label: 'Nexus', icon: 'cloud' },
    { id: 'updates', label: 'Updates', icon: 'update' },
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
              <h1 className="brand-font text-[1.42rem] font-black uppercase tracking-[0.08em] text-white sm:text-[1.58rem]">
                Settings
              </h1>
              <p className="mt-3 max-w-[680px] text-[15px] leading-7 text-[#c0c0c0]">
                Configure paths, Nexus access, and Hyperion updates without leaving the manager.
              </p>
            </div>
            <StatusReadout tone="neutral" label={`v${appVersion}`} />
          </div>
        </header>

        <div className="mb-5 inline-flex flex-wrap items-center gap-1 border-[0.5px] border-[#1a1a1a] bg-[#070707] p-1">
          {tabMeta.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex min-w-[124px] items-center justify-center gap-2 rounded-sm px-4 py-2.5 transition-colors ${
                  active
                    ? 'bg-[#120f03] text-[#fcee09]'
                    : 'text-[#8f8f8f] hover:bg-[#0d0d0d] hover:text-[#d9d9d9]'
                }`}
              >
                <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="brand-font text-[0.84rem] font-bold uppercase tracking-[0.12em]">{tab.label}</span>
              </button>
            )
          })}
        </div>

        <div className="border-[0.5px] border-[#171717] bg-[#050505] p-3 sm:p-4">
          <div key={activeTab} className="grid gap-3">
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
                  <button onClick={applyDefaultManagedPaths} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
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
                  <button onClick={applyDefaultManagedPaths} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
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
                  <div className="flex min-h-10 min-w-0 flex-1 items-center rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] transition-colors focus-within:border-[#6a5a10]">
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
                  <div className="mt-4 rounded-sm border-[0.5px] border-[#5a2020] bg-[#180707] px-4 py-3 text-[14px] leading-6 text-[#f87171]">
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
                    <span>Nexus links always land in your Downloads folder first.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[#fcee09]" style={{ fontSize: 17 }}>rule</span>
                    <span>Hyperion only asks about replace, keep, or copy when you start installing.</span>
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
                <div className="mt-4 rounded-sm border-[0.5px] border-[#5a2020] bg-[#180707] px-4 py-3 text-[14px] leading-6 text-[#f87171]">
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
          </div>
        </div>
      </div>
    </div>
  )
}

export const SettingsDialog = SettingsPage
