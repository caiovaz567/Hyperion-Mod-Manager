import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import { useAppVersion } from '../../hooks/useAppVersion'
import { useNexusAccount } from '../../hooks/useNexusAccount'

type SettingsTab = 'paths' | 'nexus' | 'updates'

interface SectionProps {
  title: string
  description?: string
  accent?: 'yellow' | 'cyan'
  children: React.ReactNode
}

interface CardProps {
  title: string
  description?: string
  status?: {
    label: string
    tone: 'good' | 'warn' | 'neutral' | 'info' | 'error'
  }
  accent?: 'yellow' | 'cyan'
  children: React.ReactNode
}

function statusToneClass(tone: 'good' | 'warn' | 'neutral' | 'info' | 'error'): string {
  if (tone === 'good') return 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
  if (tone === 'warn') return 'border-[#7e6d12] bg-[#0d0b00] text-[#fcee09]'
  if (tone === 'info') return 'border-[#1e3a5f] bg-[#071524] text-[#60a5fa]'
  if (tone === 'error') return 'border-[#5a2020] bg-[#180707] text-[#f87171]'
  return 'border-[#2a2a2a] bg-[#111111] text-[#8a8a8a]'
}

function accentLineClass(accent: 'yellow' | 'cyan'): string {
  return accent === 'cyan' ? 'bg-[#4fd8ff]' : 'bg-[#fcee09]'
}

function subscriptionToneClass(isPremium: boolean): string {
  return isPremium
    ? 'border-[#6a5714] bg-[#151003] text-[#f7d154]'
    : 'border-[#1e3a5f] bg-[#071524] text-[#60a5fa]'
}

function getDownloadsStatus(downloadPath: string, defaultDownloadPath: string) {
  const trimmed = downloadPath.trim()
  if (!trimmed) {
    return {
      label: 'Default',
      tone: 'neutral' as const,
      path: defaultDownloadPath,
      description: 'Hyperion uses the default downloads folder beside the managed library.',
    }
  }

  return {
    label: 'Configured',
    tone: 'good' as const,
    path: trimmed,
    description: 'Incoming archives are staged here before install.',
  }
}

const Section: React.FC<SectionProps> = ({ title, description, accent = 'yellow', children }) => (
  <section className="border-[0.5px] border-[#171717] bg-[#070707] px-4 py-5 sm:px-5 sm:py-6">
    <div className="mb-5">
      <div className="flex items-center gap-3">
        <span className={`h-[14px] w-[2px] ${accentLineClass(accent)}`} />
        <h2 className="brand-font text-[1rem] font-bold uppercase tracking-[0.14em] text-white">{title}</h2>
      </div>
      {description ? <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[#bebebe]">{description}</p> : null}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
)

const Card: React.FC<CardProps> = ({ title, description, status, accent = 'yellow', children }) => (
  <div className="border-[0.5px] border-[#1b1b1b] bg-[#0a0a0a] px-5 py-5">
    <div className="flex items-start gap-3">
      <span className={`mt-1 h-[14px] w-[2px] shrink-0 ${accentLineClass(accent)}`} />
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="brand-font text-[0.95rem] font-bold uppercase tracking-[0.12em] text-white">{title}</h3>
          {status ? (
            <span
              className={`inline-flex h-6 items-center rounded-sm border-[0.5px] px-2.5 text-[11px] font-semibold uppercase leading-none tracking-[0.12em] ${statusToneClass(
                status.tone,
              )}`}
            >
              {status.label}
            </span>
          ) : null}
        </div>
      </div>
    </div>
    {description ? <p className="mt-3 w-full text-left text-[14px] leading-[1.55] text-[#b8b8b8]">{description}</p> : null}
    <div className="mt-4">{children}</div>
  </div>
)

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

        addToast('Configuration autosaved', 'success', 1800)
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
    addToast('Game path auto-detected', 'success', 1800)
  }

  const applyDefaultManagedPaths = () => {
    if (!defaultPaths) return
    setLibraryPath(defaultPaths.libraryPath)
    setDownloadPath(defaultPaths.downloadPath)
    addToast('Default library and downloads paths loaded', 'info', 1800)
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

  const primaryBtn =
    'h-9 rounded-sm border-[0.5px] border-[#fcee09]/30 bg-[#0a0a0a] px-4 text-[10px] font-bold uppercase tracking-[0.18em] text-[#fcee09] transition-colors hover:bg-[#fcee09] hover:text-[#050505] brand-font disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#fcee09]'
  const secondaryBtn =
    'h-9 rounded-sm border-[0.5px] border-[#1f1f1f] bg-[#0a0a0a] px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a1a1a1] transition-colors hover:border-[#505050] hover:text-white brand-font disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#1f1f1f] disabled:hover:text-[#a1a1a1]'
  const cyanBtn =
    'h-9 rounded-sm border-[0.5px] border-[#4fd8ff]/30 bg-[#081118] px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4fd8ff] transition-colors hover:border-[#4fd8ff] hover:bg-[#0c1a24] hover:text-white brand-font disabled:cursor-not-allowed disabled:opacity-40'
  const fieldClass = 'min-h-9 flex items-center border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 text-[15px] font-medium leading-[1.1] text-[#e5e2e1]'
  const supportTextClass = 'w-full text-left text-[14px] leading-[1.55] text-[#b6b6b6]'
  const tabMeta: Array<{ id: SettingsTab; label: string }> = [
    { id: 'paths', label: 'Paths' },
    { id: 'nexus', label: 'Nexus' },
    { id: 'updates', label: 'Updates' },
  ]

  const resolvedDefaultDownloadPath = defaultPaths?.downloadPath ?? ''
  const downloadsStatus = getDownloadsStatus(downloadPath, resolvedDefaultDownloadPath)
  const premiumTone = nexusAccount.status === 'connected' && nexusAccount.data.isPremium ? 'warn' : 'info'
  const premiumLabel =
    nexusAccount.status === 'connected' ? (nexusAccount.data.isPremium ? 'Premium' : 'Free') : 'Idle'

  return (
    <div className="stable-scroll-gutter h-full overflow-y-scroll pb-10 animate-settings-in sm:pb-16">
      <div className="mx-auto max-w-[980px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="mb-6">
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#b2b2b2]">Settings</div>
          <h1 className="mt-3 brand-font text-[1.42rem] font-black uppercase tracking-[0.08em] text-white sm:text-[1.58rem]">
            Configuration
          </h1>
          <p className="mt-3 max-w-[680px] text-[15px] leading-7 text-[#c0c0c0]">
            Set up core paths, Nexus access, and Hyperion updates without leaving the workspace.
          </p>
        </header>

        <div className="mb-6 inline-flex flex-wrap items-center gap-1 border-[0.5px] border-[#1a1a1a] bg-[#070707] p-1">
          {tabMeta.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-w-[118px] rounded-sm px-4 py-2.5 text-center transition-colors ${
                  active
                    ? 'bg-[#120f03] text-[#fcee09]'
                    : 'text-[#9c9c9c] hover:bg-[#0d0d0d] hover:text-[#d9d9d9]'
                }`}
              >
                <span className="brand-font text-[0.88rem] font-bold uppercase tracking-[0.12em]">{tab.label}</span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-4">
          {activeTab === 'paths' && (
            <Section
              title="Paths"
              description="Keep the three folder decisions together so the required targets are easy to scan and fix."
              accent="yellow"
            >
              <Card
                title="Game Path"
                description="Cyberpunk 2077 installation root used for launch validation and deployment."
                accent="yellow"
                status={{ label: gamePathValid ? 'Valid Path' : 'Needs Fix', tone: gamePathValid ? 'good' : 'warn' }}
              >
                <div className="mb-2 flex flex-col items-start gap-2 lg:flex-row lg:items-stretch">
                  <div className={`${fieldClass} min-w-0 flex-1 mb-0`}>
                    <div className="break-all">{gamePath || <span className="text-[#6b6b6b]">Select Cyberpunk 2077 directory...</span>}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => void autoDetectGame()} disabled={detectingGame} className={secondaryBtn}>
                      {detectingGame ? 'Detecting...' : 'Auto Detect'}
                    </button>
                    <button onClick={() => void browseFolder('Select Cyberpunk 2077 folder', setGamePath)} className={primaryBtn}>
                      Browse
                    </button>
                  </div>
                </div>
                <p className={supportTextClass}>
                  {gamePathValid
                    ? 'Launch and deployment validation are ready.'
                    : 'Launch stays blocked until a valid Cyberpunk 2077 folder is configured.'}
                </p>
              </Card>

              <Card
                title="Mod Library"
                description="Managed archive repository for metadata, reinstalls, staged recovery, and deploy rebuilds."
                accent="yellow"
                status={{ label: libraryPathValid ? 'Valid Path' : 'Needs Fix', tone: libraryPathValid ? 'good' : 'warn' }}
              >
                <div className="mb-2 flex flex-col items-start gap-2 lg:flex-row lg:items-stretch">
                  <div className={`${fieldClass} min-w-0 flex-1 mb-0`}>
                    <div className="break-all">{libraryPath || <span className="text-[#6b6b6b]">Select mod library directory...</span>}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={applyDefaultManagedPaths} disabled={!defaultPaths} className={secondaryBtn}>
                      Use Default
                    </button>
                    <button onClick={() => void browseFolder('Select Mod Library folder', setLibraryPath)} className={primaryBtn}>
                      Browse
                    </button>
                  </div>
                </div>
                <p className={supportTextClass}>
                  {libraryPathValid
                    ? 'Installs, rescans, and recovery can use this library.'
                    : 'Installs stay blocked until a valid managed library is configured.'}
                </p>
              </Card>

              <Card
                title="Downloads Intake"
                description="Optional source folder for incoming archives before install."
                accent="yellow"
                status={{ label: downloadsStatus.label, tone: downloadsStatus.tone }}
              >
                <div className="mb-2 flex flex-col items-start gap-2 lg:flex-row lg:items-stretch">
                  <div className={`${fieldClass} min-w-0 flex-1 mb-0`}>
                    <div className="break-all">{downloadsStatus.path || <span className="text-[#6b6b6b]">Waiting for library path...</span>}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={applyDefaultManagedPaths} disabled={!defaultPaths} className={secondaryBtn}>
                      Use Default
                    </button>
                    <button onClick={() => void browseFolder('Select Downloads folder', setDownloadPath)} className={primaryBtn}>
                      Browse
                    </button>
                  </div>
                </div>
                <p className={supportTextClass}>{downloadsStatus.description}</p>
              </Card>
            </Section>
          )}

          {activeTab === 'nexus' && (
            <Section
              title="Nexus"
              description="Keep the account connection clear and make the download behavior obvious at a glance."
              accent="yellow"
            >
              <Card
                title="Connection"
                description="Paste your personal Nexus API key. Hyperion saves it automatically and validates the account in the background."
                accent="yellow"
                status={{
                  label:
                    nexusAccount.status === 'connected'
                      ? 'Connected'
                      : nexusAccount.status === 'checking'
                      ? 'Checking'
                      : nexusAccount.status === 'error'
                      ? 'Invalid Key'
                      : 'Not Connected',
                  tone:
                    nexusAccount.status === 'connected'
                      ? 'good'
                      : nexusAccount.status === 'checking'
                      ? 'info'
                      : nexusAccount.status === 'error'
                      ? 'error'
                      : 'neutral',
                }}
              >
                <div className="mb-2 flex flex-col items-start gap-2 lg:flex-row lg:items-stretch">
                  <div className="min-h-9 flex min-w-0 flex-1 items-center border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a]">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={nexusApiKey}
                      onChange={(e) => setNexusApiKey(e.target.value)}
                      placeholder="Paste your Nexus API key here..."
                      className="min-w-0 flex-1 bg-transparent px-4 text-[15px] font-medium leading-[1.1] text-[#e5e2e1] placeholder:text-[#595959] focus:outline-none"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((value) => !value)}
                      className="flex h-full items-center px-3 text-[#6a6a6a] transition-colors hover:text-[#e5e2e1]"
                      tabIndex={-1}
                    >
                      <span className="material-symbols-outlined text-[18px]">{showApiKey ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                  <button type="button" onClick={() => setNexusApiKey('')} disabled={!nexusApiKey.trim()} className={secondaryBtn}>
                    Clear Key
                  </button>
                </div>
                {nexusAccount.status === 'error' && (
                  <div className={`mt-4 rounded-sm border-[0.5px] px-4 py-3 text-[14px] leading-6 ${statusToneClass('error')}`}>
                    {nexusAccount.error}
                  </div>
                )}
              </Card>

              <div className="grid gap-4">
                <Card
                  title="Account"
                  description="Show the linked Nexus identity and subscription tier."
                  accent="yellow"
                  status={{ label: premiumLabel, tone: premiumTone }}
                >
                  {nexusAccount.status === 'connected' ? (
                    <div className="space-y-3">
                      <div className="brand-font text-[1rem] font-bold uppercase tracking-[0.1em] text-white">{nexusAccount.data.name}</div>
                      <div className="text-[14px] leading-6 text-[#c0c0c0]">{nexusAccount.data.email}</div>
                      <div className="text-[14px] leading-6 text-[#9d9d9d]">User #{nexusAccount.data.userId}</div>
                    </div>
                  ) : (
                    <p className={supportTextClass}>
                      Add a valid API key to show account identity and unlock Nexus-aware flows.
                    </p>
                  )}
                </Card>

                <Card
                  title="Download Flow"
                  description="Keep the install flow predictable."
                  accent="yellow"
                >
                  <div className={`${supportTextClass} space-y-3`}>
                    <p>Nexus links always land in Downloads first.</p>
                    <p>Hyperion only asks about replace, keep, or copy when you start installing the archive.</p>
                  </div>
                </Card>
              </div>
            </Section>
          )}

          {activeTab === 'updates' && (
            <Section title="Updates" description="Keep Hyperion itself current without turning this into a crowded utility page." accent="yellow">
              <Card
                title="Application Updates"
                description="Check, download, and install new Hyperion builds."
                accent="yellow"
                status={{ label: `v${appVersion}`, tone: 'neutral' }}
              >
                <p className={`${supportTextClass} mb-4`}>
                  {updateDownloaded
                    ? `Update ${updateInfo?.version ?? ''} is ready to install.`
                    : updateAvailable
                    ? `Update ${updateInfo?.version ?? ''} is available.`
                    : 'No downloaded update is waiting right now.'}
                </p>
                {updateError ? (
                  <div className={`mb-4 rounded-sm border-[0.5px] px-4 py-3 text-[14px] leading-6 ${statusToneClass('error')}`}>
                    {updateError}
                  </div>
                ) : null}
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap">
                  <button type="button" onClick={() => void handleCheckForUpdates()} disabled={updateActionLoading !== null || updateDownloading} className={secondaryBtn}>
                    {updateActionLoading === 'check' ? 'Checking...' : 'Check For Updates'}
                  </button>
                  {!updateDownloaded && updateAvailable && (
                    <button type="button" onClick={() => void handleDownloadUpdate()} disabled={updateActionLoading !== null || updateDownloading} className={primaryBtn}>
                      {updateActionLoading === 'download' || updateDownloading ? 'Downloading...' : 'Download Update'}
                    </button>
                  )}
                  {updateDownloaded && (
                    <button type="button" onClick={installUpdate} className={cyanBtn}>
                      Install Update
                    </button>
                  )}
                </div>
              </Card>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

export const SettingsDialog = SettingsPage
