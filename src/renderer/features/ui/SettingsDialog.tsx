import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import type { IpcResult, NexusValidateResult } from '@shared/types'

export const SettingsPage: React.FC = () => {
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
  } = useAppStore()

  const [gamePath, setGamePath]       = useState('')
  const [libraryPath, setLibraryPath] = useState('')
  const [downloadPath, setDownloadPath] = useState('')
  const [detectingGame, setDetectingGame] = useState(false)
  const [gamePathValid, setGamePathValid] = useState(false)
  const [libraryPathValid, setLibraryPathValid] = useState(false)
  const [activeTab, setActiveTab] = useState<'paths' | 'workspace' | 'nexus'>('paths')
  const [nexusApiKey, setNexusApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [nexusValidating, setNexusValidating] = useState(false)
  const [nexusValidateResult, setNexusValidateResult] = useState<
    { ok: true; name: string; isPremium: boolean } | { ok: false; error: string } | null
  >(null)
  const nexusSaveTimerRef = useRef<number | null>(null)

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

    if (!hasChanges) return

    if (!gamePathValid || !libraryPathValid) return

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
  }, [gamePath, libraryPath, downloadPath, settings, updateSettings, scanMods, restoreEnabledMods, purgeMods, selectMod, addToast, gamePathValid, libraryPathValid])

  useEffect(() => {
    if (!settings) return
    if (nexusApiKey === (settings.nexusApiKey ?? '')) return

    if (nexusSaveTimerRef.current) window.clearTimeout(nexusSaveTimerRef.current)
    nexusSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await updateSettings({ nexusApiKey })
        addToast('Nexus API key saved', 'success', 1800)
        setNexusValidateResult(null)
      } catch {
        addToast('Could not save Nexus API key', 'error', 2600)
      }
    }, 600)

    return () => {
      if (nexusSaveTimerRef.current) window.clearTimeout(nexusSaveTimerRef.current)
    }
  }, [nexusApiKey, settings, updateSettings, addToast])

  const testNexusConnection = async () => {
    if (!nexusApiKey.trim()) return
    setNexusValidating(true)
    setNexusValidateResult(null)
    try {
      const result = await IpcService.invoke<IpcResult<NexusValidateResult>>(
        IPC.NEXUS_VALIDATE_KEY,
        nexusApiKey.trim()
      )
      if (result.ok && result.data) {
        setNexusValidateResult({ ok: true, name: result.data.name, isPremium: result.data.isPremium })
      } else {
        setNexusValidateResult({ ok: false, error: result.error ?? 'Validation failed' })
      }
    } catch {
      setNexusValidateResult({ ok: false, error: 'Connection error' })
    } finally {
      setNexusValidating(false)
    }
  }

  const applyDefaultManagedPaths = () => {
    if (!defaultPaths) return
    setLibraryPath(defaultPaths.libraryPath)
    setDownloadPath(defaultPaths.downloadPath)
    addToast('Default library and downloads paths loaded', 'info', 1800)
  }

  const browseGame = async () => {
    const r = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG,
      { title: 'Select Cyberpunk 2077 folder' }
    )
    if (!r.canceled && r.filePaths.length) setGamePath(r.filePaths[0])
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

  const browseLibrary = async () => {
    const r = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG, { title: 'Select Mod Library folder' }
    )
    if (!r.canceled && r.filePaths.length) setLibraryPath(r.filePaths[0])
  }

  const browseDownloads = async () => {
    const r = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG, { title: 'Select Downloads folder' }
    )
    if (!r.canceled && r.filePaths.length) setDownloadPath(r.filePaths[0])
  }

  const saveBlocked = !gamePathValid || !libraryPathValid
  const browseBtn = 'px-4 py-2 bg-[#0a0a0a] border-[0.5px] border-[#fcee09]/30 text-[#fcee09] rounded-sm text-[10px] brand-font font-bold uppercase tracking-widest hover:bg-[#fcee09] hover:text-[#050505] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#fcee09]'
  const accentBtn = 'px-4 py-2 bg-[#0a0a0a] border-[0.5px] border-[#1a1a1a] text-[#9a9a9a] rounded-sm text-[10px] brand-font font-semibold uppercase tracking-widest hover:text-white hover:border-[#7a7a7a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#9a9a9a] disabled:hover:border-[#1a1a1a]'
  const statusBadgeClass = 'relative top-[-1px] inline-flex h-5 items-center rounded-sm border-[0.5px] px-2.5 text-[10px] font-mono uppercase leading-none tracking-[0.14em]'
  const metaBadgeClass = 'relative top-[-1px] inline-flex h-5 items-center rounded-sm border-[0.5px] px-2 text-[10px] font-mono uppercase leading-none tracking-[0.14em]'
  const sectionDotClass = 'relative top-[-1px] h-1.5 w-1.5 flex-shrink-0 bg-[#fcee09]'
  const tabButtonClass = (tab: 'paths' | 'workspace' | 'nexus') => `group relative flex w-full items-center gap-3 overflow-hidden rounded-sm border-[0.5px] px-3 py-3 text-left transition-all duration-200 ${
    activeTab === tab
      ? 'border-[#6a5b10] bg-transparent text-[#f1df88]'
      : 'border-[#1a1a1a] bg-transparent text-[#a3a3a3] hover:border-[#2a2a2a] hover:text-[#d0d0d0]'
  }`

  return (
    <div className="h-full overflow-y-auto hyperion-scrollbar stable-scroll-gutter pb-10 animate-settings-in sm:pb-16">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12">

        {/* Page header */}
        <div className="mb-6 sm:mb-10">
          <h1 className="brand-font mb-2 text-[1.2rem] font-black uppercase leading-none tracking-[0.08em] text-white sm:text-[1.5rem]">
            Configuration
          </h1>
          <p className="ui-support-mono uppercase tracking-[0.14em] text-[#a6a6a6]">
            Paths, workspace modules &amp; library controls
          </p>
        </div>

        <div className="mb-6 border-t-[0.5px] border-[#1a1a1a] sm:mb-10" />

        <div className="grid gap-0 border-[0.5px] border-[#1a1a1a] bg-[#070707] shadow-[0_6px_18px_rgba(0,0,0,0.24)] lg:grid-cols-[168px_minmax(0,1fr)]">
          <aside className="border-b-[0.5px] border-[#1a1a1a] bg-[linear-gradient(180deg,rgba(12,12,12,0.98),rgba(8,8,8,0.98))] p-3 sm:p-4 lg:border-b-0 lg:border-r-[0.5px]">
            <div className="ui-support-mono mb-4 uppercase tracking-[0.18em] text-[#b6b6b6]">Sections</div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              <button
                type="button"
                onClick={() => setActiveTab('paths')}
                className={tabButtonClass('paths')}
              >
                <span className={`absolute inset-y-0 left-0 w-[2px] ${activeTab === 'paths' ? 'bg-[#fcee09]' : 'bg-transparent group-hover:bg-[#2f2f2f]'}`} />
                <span className={`h-1.5 w-1.5 flex-shrink-0 ${activeTab === 'paths' ? 'bg-[#fcee09]' : 'bg-[#3a3a3a]'}`} />
                <span className="ui-support-mono uppercase tracking-[0.18em]">Paths</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('workspace')}
                className={tabButtonClass('workspace')}
              >
                <span className={`absolute inset-y-0 left-0 w-[2px] ${activeTab === 'workspace' ? 'bg-[#fcee09]' : 'bg-transparent group-hover:bg-[#2f2f2f]'}`} />
                <span className={`h-1.5 w-1.5 flex-shrink-0 ${activeTab === 'workspace' ? 'bg-[#fcee09]' : 'bg-[#3a3a3a]'}`} />
                <span className="ui-support-mono uppercase tracking-[0.18em]">Workspace</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('nexus')}
                className={tabButtonClass('nexus')}
              >
                <span className={`absolute inset-y-0 left-0 w-[2px] ${activeTab === 'nexus' ? 'bg-[#fcee09]' : 'bg-transparent group-hover:bg-[#2f2f2f]'}`} />
                <span className={`h-1.5 w-1.5 flex-shrink-0 ${activeTab === 'nexus' ? 'bg-[#fcee09]' : 'bg-[#3a3a3a]'}`} />
                <span className="ui-support-mono uppercase tracking-[0.18em]">Nexus</span>
              </button>
            </div>
          </aside>

          <section className="min-w-0 p-0">
          {activeTab === 'paths' && (
          <div>
            <div className="border-b-[0.5px] border-[#1a1a1a] px-5 py-5">
              <div className="ui-support-mono mb-2 uppercase tracking-[0.2em] font-bold text-[#9a9a9a]">
                Core Directories
              </div>
              <p className="ui-support-mono">
                Required paths define launch, deployment, archive storage, and download intake behavior.
              </p>
            </div>

            <div>
            <div className="px-5 py-5 border-b-[0.5px] border-[#1a1a1a]">
              <div className="flex items-center gap-2 mb-2 min-h-[20px]">
                <div className={sectionDotClass} />
                <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Game Path</span>
                <span className={`${metaBadgeClass} border-[#1e3a5f] bg-[#071524] text-[#60a5fa]`}>Required</span>
                <span className={`ml-auto ${statusBadgeClass} ${gamePathValid ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]' : 'border-[#7e6d12] bg-[#0d0b00] text-[#fcee09]'}`}>
                  {gamePathValid ? 'Valid Path' : 'Target Required'}
                </span>
              </div>
              <p className="ui-support-mono mb-3">
                Root Cyberpunk 2077 folder used for launch validation and deployment targeting.
              </p>
              <div className={`allow-text-selection border-[0.5px] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-[#e5e2e1] mb-3 min-w-0 ${gamePathValid ? 'border-[#1a1a1a]' : 'border-[#6a5a10]'}`}>
                <div className="break-all">{gamePath || <span className="text-[#6b6b6b]">SteamLibrary\steamapps\common\Cyberpunk 2077</span>}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => void autoDetectGame()} disabled={detectingGame} className={accentBtn}>
                  {detectingGame ? 'Detecting...' : 'Auto Detect'}
                </button>
                <button onClick={browseGame} className={`${browseBtn} ml-auto`}>
                  Browse
                </button>
              </div>
            </div>

            <div className="px-5 py-5 border-b-[0.5px] border-[#1a1a1a]">
              <div className="flex items-center gap-2 mb-2 min-h-[20px]">
                <div className={sectionDotClass} />
                <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Mod Library</span>
                <span className={`${metaBadgeClass} border-[#1e3a5f] bg-[#071524] text-[#60a5fa]`}>Required</span>
                <span className={`ml-auto ${statusBadgeClass} ${libraryPathValid ? 'border-[#1d3d2e] bg-[#091410] text-[#34d399]' : 'border-[#7e6d12] bg-[#0d0b00] text-[#fcee09]'}`}>
                  {libraryPathValid ? 'Valid Path' : 'Target Required'}
                </span>
              </div>
              <p className="ui-support-mono mb-3">
                Managed archive repository for metadata, reinstalls, autosave scanning, and recovery.
              </p>
              <div className="allow-text-selection border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-[#e5e2e1] mb-3 min-w-0">
                <div className="break-all">{libraryPath || <span className="text-[#6b6b6b]">F:\Mods\Cyberpunk 2077</span>}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={applyDefaultManagedPaths} disabled={!defaultPaths} className={accentBtn}>
                  Use Default
                </button>
                <button onClick={browseLibrary} className={`${browseBtn} ml-auto`}>
                  Browse
                </button>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="flex items-center gap-2 mb-2 min-h-[20px]">
                <div className="relative top-[-1px] h-1.5 w-1.5 flex-shrink-0 bg-[rgba(252,238,9,0.35)]" />
                <span className="text-sm uppercase tracking-widest text-[#d0d0d0] brand-font font-bold">Downloads Intake</span>
                <span className={`${metaBadgeClass} border-[#343434] bg-[#121212] text-[#878787]`}>Optional</span>
              </div>
              <p className="ui-support-mono mb-3">
                Optional archive source folder used for incoming downloads and staged installs.
              </p>
              <div className="allow-text-selection border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-[#e5e2e1] mb-3 min-w-0">
                <div className="break-all">{downloadPath || <span className="text-[#6b6b6b]">G:\Downloads</span>}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={applyDefaultManagedPaths} disabled={!defaultPaths} className={accentBtn}>
                  Use Default
                </button>
                <button onClick={browseDownloads} className={`${browseBtn} ml-auto`}>
                  Browse
                </button>
              </div>
            </div>
          </div>

          {saveBlocked && (
            <div className="m-5 mt-0 border-[0.5px] border-[#4a3f08] bg-[#151202] px-4 py-3 text-sm font-mono uppercase tracking-[0.14em] text-[#fcee09]">
              Changes stay local until the game path and mod library are valid.
            </div>
          )}
          </div>
          )}
          {activeTab === 'workspace' && (
          <div>
            <div className="border-b-[0.5px] border-[#1a1a1a] px-5 py-5">
              <div className="ui-support-mono mb-2 uppercase tracking-[0.2em] font-bold text-[#9a9a9a]">
                Workspace Controls
              </div>
              <p className="ui-support-mono">
                Secondary tab scaffold connected to the same settings surface for future modules.
              </p>
            </div>

            <div className="px-5 py-5 border-b-[0.5px] border-[#1a1a1a]">
              <div className="flex items-center gap-2 mb-2 min-h-[20px]">
                <div className={sectionDotClass} />
                <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Future Module</span>
                <span className={`${metaBadgeClass} border-[#343434] bg-[#121212] text-[#878787]`}>Preview</span>
              </div>
              <p className="ui-support-mono mb-3">
                Use this area for future extension-like settings groups without changing the panel structure.
              </p>
              <div className="ui-support-mono border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-4">
                Example future sections: update behavior, indexing rules, workspace automation, or extension-integrated modules.
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="ui-support-mono mb-3 uppercase tracking-[0.18em]">Status</div>
              <div className="ui-support-mono border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 uppercase tracking-[0.14em]">
                Workspace tab scaffold ready for expansion.
              </div>
            </div>
          </div>
          )}
          {activeTab === 'nexus' && (
          <div>
            <div className="border-b-[0.5px] border-[#1a1a1a] px-5 py-5">
              <div className="ui-support-mono mb-2 uppercase tracking-[0.2em] font-bold text-[#9a9a9a]">
                Nexus Mods Integration
              </div>
              <p className="ui-support-mono">
                Personal API key enables "Mod Manager Download" buttons on nexusmods.com to route directly into Hyperion.
              </p>
            </div>

            <div className="px-5 py-5 border-b-[0.5px] border-[#1a1a1a]">
              <div className="flex items-center gap-2 mb-2 min-h-[20px]">
                <div className={sectionDotClass} />
                <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Personal API Key</span>
                <span className={`${metaBadgeClass} border-[#343434] bg-[#121212] text-[#878787]`}>Optional</span>
                {nexusApiKey.trim() ? (
                  nexusValidateResult ? (
                    nexusValidateResult.ok ? (
                      <span className={`ml-auto ${statusBadgeClass} border-[#1d3d2e] bg-[#091410] text-[#34d399]`}>
                        {nexusValidateResult.isPremium ? 'Premium' : 'Free'} · {nexusValidateResult.name}
                      </span>
                    ) : (
                      <span className={`ml-auto ${statusBadgeClass} border-[#4a1212] bg-[#150404] text-[#f87171]`}>
                        Invalid Key
                      </span>
                    )
                  ) : (
                    <span className={`ml-auto ${statusBadgeClass} border-[#4a3f08] bg-[#0d0b00] text-[#fcee09]`}>
                      Not Verified
                    </span>
                  )
                ) : (
                  <span className={`ml-auto ${statusBadgeClass} border-[#2a2a2a] bg-[#111] text-[#6a6a6a]`}>
                    Not Configured
                  </span>
                )}
              </div>
              <p className="ui-support-mono mb-3">
                Generate a Personal API key at nexusmods.com → Account → API Keys.
              </p>
              <div className="flex items-center border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] mb-3">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={nexusApiKey}
                  onChange={(e) => setNexusApiKey(e.target.value)}
                  placeholder="Paste your Nexus API key here..."
                  className="flex-1 bg-transparent px-4 py-3 font-mono text-sm text-[#e5e2e1] placeholder:text-[#4a4a4a] focus:outline-none"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="flex h-full items-center px-3 text-[#6a6a6a] hover:text-[#e5e2e1] transition-colors"
                  tabIndex={-1}
                >
                  <span className="material-symbols-outlined text-[18px]">{showApiKey ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => void testNexusConnection()}
                  disabled={!nexusApiKey.trim() || nexusValidating}
                  className={`${accentBtn} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {nexusValidating ? 'Connecting...' : 'Test Connection'}
                </button>
                {nexusValidateResult && !nexusValidateResult.ok && (
                  <span className="ui-support-mono text-[#f87171]">{nexusValidateResult.error}</span>
                )}
              </div>
            </div>

            <div className="px-5 py-5 border-b-[0.5px] border-[#1a1a1a]">
              <div className="flex items-center gap-2 mb-2 min-h-[20px]">
                <div className={sectionDotClass} />
                <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Nexus Download Flow</span>
                <span className={`${metaBadgeClass} border-[#4a3f08] bg-[#0d0b00] text-[#fcee09]`}>Manual</span>
                <span className={`ml-auto ${statusBadgeClass} border-[#1e3a5f] bg-[#071524] text-[#60a5fa]`}>
                  Downloads Only
                </span>
              </div>
              <p className="ui-support-mono mb-4">
                Nexus downloads stay in Downloads with the <span className="text-[#fcee09]">NEW</span> tag until you install them. Hyperion only asks for version decisions when the user actually starts an install.
              </p>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-4">
                  <div className="ui-support-mono uppercase tracking-[0.16em] text-[#d6d6d6]">After download</div>
                  <div className="ui-support-mono mt-2">
                    The archive is staged in the downloads list and keeps its `NEW` state until a successful install happens.
                  </div>
                </div>

                <div className="rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-4">
                  <div className="ui-support-mono uppercase tracking-[0.16em] text-[#d6d6d6]">When versions differ</div>
                  <div className="ui-support-mono mt-2">
                    If the same Nexus mod is already installed with another version, Hyperion shows a replace-or-copy confirmation before proceeding.
                  </div>
                </div>

                <div className="rounded-sm border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-4">
                  <div className="ui-support-mono uppercase tracking-[0.16em] text-[#d6d6d6]">Multiple versions</div>
                  <div className="ui-support-mono mt-2">
                    You can stage multiple Nexus versions in Downloads at the same time; Hyperion only asks you to replace or install as copy when you actually install one.
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-[16px] text-[#6a6a6a]">info</span>
                <span className="ui-support-mono uppercase tracking-[0.18em]">Protocol Handler</span>
              </div>
              <div className="ui-support-mono border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3">
                nxm:// links open in Hyperion automatically once the app has been launched at least once. App logs are available from the header logs button near the window controls.
              </div>
            </div>
          </div>
          )}
          </section>
        </div>

      </div>
    </div>
  )
}

// Legacy export alias
export const SettingsDialog = SettingsPage
