import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC } from '@shared/types'
import { Tooltip } from './Tooltip'
import { useAppVersion } from '../../hooks/useAppVersion'

function getParentDirectory(targetPath: string): string {
  const normalizedPath = targetPath.trim().replace(/[\\/]+$/, '')
  if (!normalizedPath) return ''

  const separatorIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'))
  if (separatorIndex <= 0) return ''

  return normalizedPath.slice(0, separatorIndex)
}

export const WelcomeScreen: React.FC = () => {
  const appVersion = useAppVersion()
  const {
    settings,
    updateSettings,
    scanMods,
    restoreEnabledMods,
    purgeMods,
    addToast,
    setActiveView,
    defaultPaths,
    loadDefaultPaths,
    detectGamePath,
    checkGamePath,
    checkLibraryPath,
  } = useAppStore()

  const [gamePath, setGamePath] = useState('')
  const [libraryPath, setLibraryPath] = useState('')
  const [downloadPath, setDownloadPath] = useState('')
  const [detectingGame, setDetectingGame] = useState(false)
  const [gamePathValid, setGamePathValid] = useState(false)
  const [libraryPathValid, setLibraryPathValid] = useState(false)
  const [autoDetectAttempted, setAutoDetectAttempted] = useState(false)

  const resolveDownloadPath = (nextLibraryPath: string): string => {
    const normalizedLibraryPath = nextLibraryPath.trim()
    if (!normalizedLibraryPath) {
      return defaultPaths?.downloadPath ?? settings?.downloadPath ?? ''
    }

    const libraryParent = getParentDirectory(normalizedLibraryPath)
    if (!libraryParent) {
      return defaultPaths?.downloadPath ?? settings?.downloadPath ?? ''
    }

    return `${libraryParent}\\Downloads`
  }

  useEffect(() => {
    if (!defaultPaths) {
      void loadDefaultPaths().catch(() => undefined)
    }
  }, [defaultPaths, loadDefaultPaths])

  useEffect(() => {
    setGamePath(settings?.gamePath ?? '')
    setLibraryPath(settings?.libraryPath ?? defaultPaths?.libraryPath ?? '')
    setDownloadPath(settings?.downloadPath ?? resolveDownloadPath(settings?.libraryPath ?? defaultPaths?.libraryPath ?? ''))
  }, [defaultPaths?.libraryPath, settings?.downloadPath, settings?.gamePath, settings?.libraryPath])

  useEffect(() => {
    checkGamePath(gamePath).then((valid) => {
      console.log(`[WelcomeScreen] checkGamePath(${gamePath}) => ${valid}`)
      setGamePathValid(valid)
    }).catch((err) => {
      console.error(`[WelcomeScreen] checkGamePath failed:`, err)
      setGamePathValid(false)
    })
  }, [checkGamePath, gamePath])

  useEffect(() => {
    checkLibraryPath(libraryPath).then(setLibraryPathValid).catch(() => setLibraryPathValid(false))
  }, [checkLibraryPath, libraryPath])

  useEffect(() => {
    if (autoDetectAttempted || gamePath.trim()) return
    setAutoDetectAttempted(true)
    void applyGameDefault(true)
  }, [autoDetectAttempted, gamePath])

  const browseGame = async () => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG,
      { title: 'Select Cyberpunk 2077 folder' }
    )
    if (!result.canceled && result.filePaths.length) {
      setGamePath(result.filePaths[0])
    }
  }

  const browseLibrary = async () => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG,
      { title: 'Select Mod Library folder' }
    )
    if (!result.canceled && result.filePaths.length) {
      setLibraryPath(result.filePaths[0])
    }
  }

  const browseDownloads = async () => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG,
      { title: 'Select Downloads folder' }
    )
    if (!result.canceled && result.filePaths.length) {
      setDownloadPath(result.filePaths[0])
    }
  }

  const applyGameDefault = async (silent = false) => {
    setDetectingGame(true)
    const result = await detectGamePath()
    setDetectingGame(false)

    if (!result.ok || !result.data) {
      console.error(`[WelcomeScreen] detectGamePath failed:`, result.error)
      if (!silent) {
        addToast(result.error ?? 'Could not auto-detect Cyberpunk 2077', 'warning', 2600)
      }
      return
    }

    console.log(`[WelcomeScreen] detectGamePath succeeded: ${result.data}`)
    setGamePath(result.data)
    try {
      const isValid = await checkGamePath(result.data)
      console.log(`[WelcomeScreen] revalidated detected game path (${result.data}) => ${isValid}`)
      setGamePathValid(isValid)
    } catch (err) {
      console.error('[WelcomeScreen] revalidating detected game path failed:', err)
      setGamePathValid(false)
    }
    if (!silent) {
      addToast('Game path default loaded', 'success', 1800)
    }
  }

  const applyLibraryDefault = () => {
    if (!defaultPaths) return
    setLibraryPath(defaultPaths.libraryPath)
    addToast('Default managed library loaded', 'info', 1800)
  }

  const applyDownloadsDefault = () => {
    const nextDownloadPath = resolveDownloadPath(libraryPath || defaultPaths?.libraryPath || '')
    setDownloadPath(nextDownloadPath)
    addToast('Default downloads path loaded', 'info', 1800)
  }

  const applyPaths = async () => {
    if (!gamePathValid || !libraryPathValid) {
      addToast('Select a valid game folder and mod library before applying paths', 'warning', 2400)
      return
    }

    const libraryChanged = libraryPath !== (settings?.libraryPath ?? '')
    const gameChanged = gamePath !== (settings?.gamePath ?? '')
    const resolvedDownloadPath = downloadPath.trim() || resolveDownloadPath(libraryPath)
    const downloadChanged = resolvedDownloadPath !== (settings?.downloadPath ?? '')

    if ((libraryChanged || gameChanged) && settings?.gamePath?.trim() && settings?.libraryPath?.trim()) {
      const purgeResult = await purgeMods()
      if (purgeResult.data?.purged) {
        addToast(`Purged ${purgeResult.data.purged} active mod(s) from the previous deployment`, 'info', 2600)
      }
      if (purgeResult.data?.failed) {
        addToast(`Could not fully purge ${purgeResult.data.failed} mod(s) from the previous deployment`, 'warning', 3200)
      }
    }

    await updateSettings({ gamePath, libraryPath, downloadPath: resolvedDownloadPath })
    const scannedMods = await scanMods()

    if (gamePathValid && libraryPathValid) {
      const restoreResults = await restoreEnabledMods(scannedMods)
      const failedRestoreCount = restoreResults.filter((result) => !result.ok).length
      if (failedRestoreCount > 0) {
        addToast(`Loaded library, but ${failedRestoreCount} active mod(s) could not be restored`, 'warning', 3200)
      }
      addToast(downloadChanged ? 'Paths and defaults saved' : 'Required paths saved', 'success', 1800)
      setActiveView('library')
    }
  }

  const missingGame = !gamePath.trim() || !gamePathValid
  const activeGameState = gamePath.trim() ? (gamePathValid ? 'Valid Path' : 'Target Invalid') : 'Target Required'
  const resolvedDefaultDownloadPath = resolveDownloadPath(libraryPath || defaultPaths?.libraryPath || '')
  const effectiveDownloadPath = downloadPath.trim() || resolvedDefaultDownloadPath

  const browseBtn = 'px-4 py-2 bg-[#0a0a0a] border-[0.5px] border-[#fcee09]/30 text-[#fcee09] rounded-sm text-[10px] brand-font font-bold uppercase tracking-widest hover:bg-[#fcee09] hover:text-[#050505] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#fcee09]'
  const accentBtn = 'px-4 py-2 bg-[#0a0a0a] border-[0.5px] border-[#1a1a1a] text-[#9a9a9a] rounded-sm text-[10px] brand-font font-semibold uppercase tracking-widest hover:text-white hover:border-[#7a7a7a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#9a9a9a] disabled:hover:border-[#1a1a1a]'
  const statusBadgeClass = 'relative top-[-1px] inline-flex h-5 items-center rounded-sm border-[0.5px] px-2.5 text-[10px] font-mono uppercase leading-none tracking-[0.14em]'
  const metaBadgeClass = 'relative top-[-1px] inline-flex h-5 items-center rounded-sm border-[0.5px] px-2 text-[10px] font-mono uppercase leading-none tracking-[0.14em]'
  const sectionDotClass = 'relative top-[-1px] h-1.5 w-1.5 flex-shrink-0 bg-[#fcee09]'

  return (
    <div className="relative h-full overflow-y-auto animate-settings-in bg-[#050505]">
      <div
        className="absolute inset-x-0 top-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="mx-auto flex min-h-full w-full items-center justify-center px-3 py-6 sm:px-5 sm:py-8 lg:px-8 xl:px-10">
        <div className="w-full max-w-[clamp(720px,44vw,980px)]">

        {/* Page header */}
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="brand-font text-lg font-bold tracking-[0.18em] uppercase text-white sm:text-xl">Workspace Setup</h1>
            <p className="ui-support-mono mt-2 uppercase tracking-[0.15em]">
              Configure required paths to initialize Hyperion
            </p>
            <div className="ui-support-mono mt-2 text-[10px] uppercase tracking-[0.16em] text-[#5f5f5f]">
              Hyperion {appVersion}
            </div>
          </div>
          <div className="relative w-fit shrink-0 overflow-hidden rounded-sm border-[0.5px] border-[#6a5b10] bg-[linear-gradient(180deg,#171303,#100d02)] px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em] text-[#f1df88] shadow-[inset_0_1px_0_rgba(252,238,9,0.08)]">
            <span className="absolute inset-0 animate-[firstrun-glow_2.4s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,rgba(252,238,9,0.08),transparent)]" />
            <span className="relative">First Run</span>
          </div>
        </div>

        {/* Paths card */}
        <div className="border-[0.5px] border-[#1a1a1a] bg-[#070707] shadow-[0_6px_18px_rgba(0,0,0,0.24)]">

          {/* Game Path */}
          <div className="border-b-[0.5px] border-[#1a1a1a] px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-2 flex min-h-[20px] flex-wrap items-center gap-2">
              <div className={sectionDotClass} />
              <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Game Path</span>
              <span className={`${metaBadgeClass} border-[#1e3a5f] bg-[#071524] text-[#60a5fa]`}>Required</span>
              <span className={`ml-auto ${statusBadgeClass} ${
                missingGame ? 'border-[#7e6d12] bg-[#0d0b00] text-[#fcee09]' : 'border-[#1d3d2e] bg-[#091410] text-[#34d399]'
              }`}>
                {activeGameState}
              </span>
            </div>
            <p className="ui-support-mono mb-3">
              Cyberpunk 2077 installation root — used for executable validation and mod deployment.
            </p>
            <div className={`allow-text-selection border-[0.5px] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-[#e5e2e1] mb-3 min-w-0 ${
              missingGame ? 'border-[#6a5a10]' : 'border-[#1a1a1a]'
            }`}>
              <div className="break-all">{gamePath || <span className="text-[#6b6b6b]">Select Cyberpunk 2077 directory...</span>}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => void applyGameDefault()} disabled={detectingGame} className={`${accentBtn} w-full sm:w-auto`}>
                {detectingGame ? 'Detecting...' : 'Auto Detect'}
              </button>
              <button onClick={browseGame} className={`${browseBtn} w-full sm:ml-auto sm:w-auto`}>Browse</button>
            </div>
          </div>

          {/* Mod Library */}
          <div className="border-b-[0.5px] border-[#1a1a1a] px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-2 flex min-h-[20px] flex-wrap items-center gap-2">
              <div className={sectionDotClass} />
              <span className="text-sm uppercase tracking-widest text-white brand-font font-bold">Mod Library</span>
              <span className={`${metaBadgeClass} border-[#1e3a5f] bg-[#071524] text-[#60a5fa]`}>Required</span>
            </div>
            <p className="ui-support-mono mb-3">
              Managed archive repository for mod metadata, staging, and deployment recovery.
            </p>
            <div className="allow-text-selection border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-[#e5e2e1] mb-3 min-w-0">
              <div className="break-all">{libraryPath || <span className="text-[#6b6b6b]">Select mod library directory...</span>}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={applyLibraryDefault} disabled={!defaultPaths} className={`${accentBtn} w-full sm:w-auto`}>Use Default</button>
              <button onClick={browseLibrary} className={`${browseBtn} w-full sm:ml-auto sm:w-auto`}>Browse</button>
            </div>
          </div>

          {/* Downloads */}
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-2 flex min-h-[20px] flex-wrap items-center gap-2">
              <div className="relative top-[-1px] h-1.5 w-1.5 flex-shrink-0 bg-[rgba(252,238,9,0.35)]" />
              <span className="text-sm uppercase tracking-widest text-[#d0d0d0] brand-font font-bold">Downloads Intake</span>
              <span className={`${metaBadgeClass} border-[#343434] bg-[#121212] text-[#878787]`}>Optional</span>
            </div>
            <p className="ui-support-mono mb-3">
              Source folder for incoming archives. Defaults to a sibling folder beside the library.
            </p>
            <div className="allow-text-selection border-[0.5px] border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-[#e5e2e1] mb-3 min-w-0">
              <div className="break-all">{effectiveDownloadPath || <span className="text-[#6b6b6b]">Waiting for path definition...</span>}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={applyDownloadsDefault} className={`${accentBtn} w-full sm:w-auto`}>Use Default</button>
              <button onClick={browseDownloads} className={`${browseBtn} w-full sm:ml-auto sm:w-auto`}>Browse</button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex flex-col gap-4 border-t-[0.5px] border-[#1a1a1a] pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="ui-support-mono">
            Hyperion initializes only after both required paths validate.
          </p>
          <Tooltip
            content={
              !gamePathValid && !libraryPathValid
                ? 'Set a valid Game Path and Mod Library'
                : !gamePathValid
                ? 'Set a valid Game Path'
                : 'Set a valid Mod Library'
            }
            side="top"
            wrapperClassName="inline-flex"
          >
            <button
              onClick={applyPaths}
              disabled={!gamePathValid || !libraryPathValid}
              className="w-full shrink-0 rounded-sm bg-[#fcee09] px-6 py-3 text-[10px] brand-font font-bold uppercase tracking-widest text-[#050505] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-[#1c1b07] disabled:text-[#6b6830] disabled:opacity-40 disabled:hover:bg-[#1c1b07] sm:w-auto"
            >
              Initialize Workspace
            </button>
          </Tooltip>
        </div>

        </div>
      </div>
    </div>
  )
}
