import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC, type IpcResult } from '@shared/types'
import { Tooltip } from './Tooltip'
import { useAppVersion } from '../../hooks/useAppVersion'
import { useNexusAccount } from '../../hooks/useNexusAccount'
import { PathBox, ValidationRow, uiButton } from './uiKit'

function getParentDirectory(targetPath: string): string {
  const normalizedPath = targetPath.trim().replace(/[\\/]+$/, '')
  if (!normalizedPath) return ''

  const separatorIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'))
  if (separatorIndex <= 0) return ''

  return normalizedPath.slice(0, separatorIndex)
}

interface SetupStepDef {
  key: string
  label: string
  icon: string
  heading: string
  description: string
  preview: string
  optional?: boolean
}

const SETUP_STEPS: SetupStepDef[] = [
  {
    key: 'game',
    label: 'Game',
    icon: 'sports_esports',
    heading: 'Where is Cyberpunk 2077 installed?',
    description: 'Point Hyperion to your game folder. We use it to verify the install and deploy your mods safely.',
    preview: 'Where Cyberpunk 2077 is installed',
  },
  {
    key: 'library',
    label: 'Mod library',
    icon: 'folder_open',
    heading: 'Where should your mods live?',
    description: 'Every mod you add is kept here — organized, staged, and ready to enable whenever you want.',
    preview: 'Where your managed mods are stored',
  },
  {
    key: 'downloads',
    label: 'Downloads',
    icon: 'download',
    heading: 'Where do new downloads land?',
    description: "Hyperion picks up new mod archives from this folder. We've suggested one next to your library — change it anytime.",
    preview: 'Where new mod archives are picked up',
    optional: true,
  },
  {
    key: 'nexus',
    label: 'Nexus',
    icon: 'vpn_key',
    heading: 'Connect your Nexus account',
    description: 'Paste your personal Nexus Mods API key to enable downloads and update checks. You can skip this and add it later in Settings > Nexus.',
    preview: 'Enable Nexus downloads & update checks',
    optional: true,
  },
]

const NEXUS_API_KEYS_URL = 'https://www.nexusmods.com/settings/api-keys'

const BrandMark: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => {
  const isLarge = size === 'lg'
  return (
    <div className="flex items-center gap-3 select-none">
      <span
        className={`relative flex items-center justify-center border border-[#5f5a08] bg-[#fcee09] ${
          isLarge
            ? 'h-12 w-12 rounded-[10px] shadow-[0_0_30px_rgba(252,238,9,0.22)]'
            : 'h-7 w-7 rounded-[6px]'
        }`}
      >
        <span className={`rounded-[3px] bg-[#050505] ${isLarge ? 'h-[18px] w-[18px]' : 'h-[10px] w-[10px]'}`} />
      </span>
      <span className={`brand-font font-black tracking-tighter text-white ${isLarge ? 'text-3xl' : 'text-base'}`}>
        HYPERION
      </span>
    </div>
  )
}

const StepProgress: React.FC<{
  currentStep: number
  onStepSelect: (index: number) => void
}> = ({ currentStep, onStepSelect }) => (
  <div className="flex items-center" role="list" aria-label="Setup steps">
    {SETUP_STEPS.map((step, index) => {
      const isActive = index === currentStep
      const isCompleted = index < currentStep
      const isClickable = isCompleted

      return (
        <React.Fragment key={step.key}>
          <button
            type="button"
            onClick={() => isClickable && onStepSelect(index)}
            disabled={!isClickable}
            aria-current={isActive ? 'step' : undefined}
            className={`group flex items-center gap-2.5 ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-[#fcee09] text-[#0a0a0a] shadow-[0_0_0_4px_rgba(252,238,9,0.12)]'
                  : isCompleted
                  ? 'bg-[#0e1a14] text-[#34d399] ring-1 ring-[#1f3d2e] group-hover:ring-[#34d399]/60'
                  : 'bg-[#111111] text-[#5a5a5a] ring-1 ring-[#222222]'
              }`}
            >
              {isCompleted ? (
                <span className="material-symbols-outlined scale-in" style={{ fontSize: 15 }}>check</span>
              ) : (
                index + 1
              )}
            </span>
            <span
              className={`hidden text-[12.5px] font-medium transition-colors duration-200 sm:inline ${
                isActive ? 'text-white' : isCompleted ? 'text-[#9a9a9a] group-hover:text-white' : 'text-[#5a5a5a]'
              }`}
            >
              {step.label}
            </span>
          </button>
          {index < SETUP_STEPS.length - 1 && (
            <div className="mx-3 h-px flex-1 rounded-full bg-[#1c1c1c] sm:mx-4">
              <div
                className="h-full rounded-full bg-[#34d399]/45 transition-all duration-300 ease-out"
                style={{ width: index < currentStep ? '100%' : '0%' }}
              />
            </div>
          )}
        </React.Fragment>
      )
    })}
  </div>
)

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
  const [nexusApiKey, setNexusApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [detectingGame, setDetectingGame] = useState(false)
  const [gamePathValid, setGamePathValid] = useState(false)
  const [libraryPathValid, setLibraryPathValid] = useState(false)
  const [autoDetectAttempted, setAutoDetectAttempted] = useState(false)
  const [started, setStarted] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward')
  const [isInitializing, setIsInitializing] = useState(false)

  const nexusAccount = useNexusAccount(nexusApiKey)

  const openNexusApiKeysPage = () => {
    void IpcService.invoke(IPC.OPEN_EXTERNAL, NEXUS_API_KEYS_URL)
  }

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
    setNexusApiKey(settings?.nexusApiKey ?? '')
  }, [defaultPaths?.libraryPath, settings?.downloadPath, settings?.gamePath, settings?.libraryPath, settings?.nexusApiKey])

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

  const goToStep = (index: number) => {
    const clamped = Math.max(0, Math.min(SETUP_STEPS.length - 1, index))
    if (clamped === currentStep) return
    setStepDirection(clamped > currentStep ? 'forward' : 'backward')
    setCurrentStep(clamped)
  }

  const beginSetup = () => {
    setStepDirection('forward')
    setStarted(true)
  }

  const goNext = () => goToStep(currentStep + 1)
  const goBack = () => {
    if (currentStep === 0) {
      setStepDirection('backward')
      setStarted(false)
      return
    }
    goToStep(currentStep - 1)
  }

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
      addToast('Game path detected', 'success', 1800)
    }
  }

  const ensureDirectory = async (targetPath: string, label: string): Promise<boolean> => {
    const result = await IpcService.invoke<IpcResult<void>>(IPC.ENSURE_DIRECTORY, targetPath)
    if (!result.ok) {
      addToast(result.error ?? `Could not create ${label}`, 'warning', 2600)
      return false
    }
    return true
  }

  const applyLibraryDefault = async () => {
    if (!defaultPaths) return
    const nextPath = defaultPaths.libraryPath
    setLibraryPath(nextPath)
    if (await ensureDirectory(nextPath, 'suggested mod library')) {
      addToast('Suggested mod library loaded', 'info', 1800)
    }
  }

  const applyDownloadsDefault = async () => {
    // Use the independent suggested downloads folder, not one derived from the
    // current library path — clicking this must only set the downloads path.
    const nextDownloadPath =
      defaultPaths?.downloadPath?.trim() || resolveDownloadPath(defaultPaths?.libraryPath || '')
    setDownloadPath(nextDownloadPath)
    if (await ensureDirectory(nextDownloadPath, 'suggested downloads folder')) {
      addToast('Suggested downloads folder loaded', 'info', 1800)
    }
  }

  const applyPaths = async () => {
    if (!gamePathValid || !libraryPathValid) {
      addToast('Select a valid game folder and mod library before finishing', 'warning', 2400)
      return
    }

    setIsInitializing(true)
    try {
      const libraryChanged = libraryPath !== (settings?.libraryPath ?? '')
      const gameChanged = gamePath !== (settings?.gamePath ?? '')
      const resolvedDownloadPath =
        downloadPath.trim() || defaultPaths?.downloadPath?.trim() || resolveDownloadPath(libraryPath)
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

      const saveResult = await updateSettings({ gamePath, libraryPath, downloadPath: resolvedDownloadPath, nexusApiKey: nexusApiKey.trim() })
      if (!saveResult.ok) {
        addToast(saveResult.error ?? 'Could not save setup', 'error', 5000)
        return
      }
      const scannedMods = await scanMods()

      if (gamePathValid && libraryPathValid) {
        const restoreResults = await restoreEnabledMods(scannedMods)
        const failedRestoreCount = restoreResults.filter((result) => !result.ok).length
        if (failedRestoreCount > 0) {
          addToast(`Loaded library, but ${failedRestoreCount} active mod(s) could not be restored`, 'warning', 3200)
        }
        addToast(downloadChanged ? 'Setup complete' : 'Setup complete', 'success', 1800)
        setActiveView('library')
      }
    } finally {
      setIsInitializing(false)
    }
  }

  const resolvedDefaultDownloadPath =
    defaultPaths?.downloadPath?.trim() || resolveDownloadPath(defaultPaths?.libraryPath || '')
  const effectiveDownloadPath = downloadPath.trim() || resolvedDefaultDownloadPath

  const step = SETUP_STEPS[currentStep]
  const isLastStep = currentStep === SETUP_STEPS.length - 1

  const gameState: 'valid' | 'invalid' | 'empty' = gamePath.trim() ? (gamePathValid ? 'valid' : 'invalid') : 'empty'
  const libraryState: 'valid' | 'invalid' | 'empty' = libraryPath.trim() ? (libraryPathValid ? 'valid' : 'invalid') : 'empty'

  const stepReady = currentStep === 0 ? gamePathValid : currentStep === 1 ? libraryPathValid : true
  const continueTooltip = currentStep === 0
    ? 'Select a valid Cyberpunk 2077 folder to continue'
    : 'Select a valid mod library folder to continue'

  const { primary: primaryBtn, secondary: secondaryBtn, accentOutline: accentOutlineBtn, ghost: ghostBtn } = uiButton
  const centeredEndIconButton = `${primaryBtn} !grid grid-cols-[1fr_auto_1fr] gap-x-3`
  const centeredStartIconButton = `${ghostBtn} !grid grid-cols-[1fr_auto_1fr] gap-x-3`
  const centeredButtonLabel = 'col-start-2 translate-y-px leading-none'
  const centeredEndIcon = 'material-symbols-outlined col-start-3 justify-self-start leading-none transition-transform duration-150 group-hover:translate-x-0.5'
  const centeredStartIcon = 'material-symbols-outlined col-start-1 justify-self-end leading-none transition-transform duration-150 group-hover:-translate-x-0.5'

  return (
    <div className="relative h-full overflow-y-auto animate-settings-in bg-[#050505]">
      <div
        className="absolute inset-x-0 top-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div
        className="absolute right-4 top-4 z-20"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Tooltip content="Close">
          <button
            type="button"
            aria-label="Close Hyperion"
            onClick={() => IpcService.send('window:close')}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-[#777777] transition-colors hover:bg-[#111111] hover:text-[#f87171]"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">close</span>
          </button>
        </Tooltip>
      </div>
      <div className="mx-auto flex min-h-full w-full items-center justify-center px-4 py-8 sm:px-6 sm:py-10">

        {/* ─────────────── Welcome ─────────────── */}
        {!started && (
          <div className="w-full max-w-[560px]">
            <div className="flex flex-col items-center text-center">
              <div className="fade-up mb-8" style={{ animationDelay: '0ms' }}>
                <BrandMark size="lg" />
              </div>

              <h1
                className="fade-up brand-font text-[28px] font-bold leading-tight text-white sm:text-[34px]"
                style={{ animationDelay: '50ms' }}
              >
                Let's set up your workspace
              </h1>
              <p
                className="fade-up mt-3 max-w-md text-[15px] leading-relaxed text-[#9a9a9a]"
                style={{ animationDelay: '100ms' }}
              >
                A quick, one-time setup. Point Hyperion to Cyberpunk 2077 and choose where your mods
                live — it takes less than a minute.
              </p>

              <div className="fade-up mt-9 grid w-full gap-2.5 text-left" style={{ animationDelay: '150ms' }}>
                {SETUP_STEPS.map((s, index) => (
                  <div
                    key={s.key}
                    className="flex items-center gap-3.5 rounded-md border border-[#181818] bg-[#0a0a0a] px-4 py-3.5"
                  >
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#141414] text-[12px] font-semibold text-[#6a6a6a]">
                      {index + 1}
                    </div>
                    <span className="material-symbols-outlined flex-shrink-0 text-[#fcee09]" style={{ fontSize: 20 }}>
                      {s.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-white">{s.label}</div>
                      <div className="truncate text-[12.5px] text-[#8a8a8a]">{s.preview}</div>
                    </div>
                    {s.optional && (
                      <span className="ml-auto flex-shrink-0 text-[11px] font-medium text-[#6a6a6a]">Optional</span>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={beginSetup}
                className={`fade-up mt-9 min-w-[184px] ${centeredEndIconButton}`}
                style={{ animationDelay: '200ms' }}
              >
                <span className={centeredButtonLabel}>Get started</span>
                <span className={centeredEndIcon} style={{ fontSize: 18 }}>
                  arrow_forward
                </span>
              </button>

              <div className="fade-up mt-7 text-[11.5px] text-[#5a5a5a]" style={{ animationDelay: '250ms' }}>
                Hyperion {appVersion}
              </div>
            </div>
          </div>
        )}

        {/* ─────────────── Setup steps ─────────────── */}
        {started && (
          <div className="w-full max-w-[600px]">
            {/* Header row */}
            <div className="fade-up mb-7 flex items-center justify-between">
              <BrandMark />
              <span className="text-[12.5px] font-medium text-[#6a6a6a]">
                Step {currentStep + 1} of {SETUP_STEPS.length}
              </span>
            </div>

            {/* Progress */}
            <div className="fade-up mb-7">
              <StepProgress currentStep={currentStep} onStepSelect={goToStep} />
            </div>

            {/* Step card */}
            <div
              key={currentStep}
              className={`rounded-lg border border-[#191919] bg-[#080808] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.3)] sm:p-7 ${
                stepDirection === 'forward' ? 'slide-in-right' : 'slide-in-left'
              }`}
            >
              <div className="mb-4 flex items-center gap-3.5">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-[#2a2607] bg-[#0d0b00]">
                  <span className="material-symbols-outlined text-[#fcee09]" style={{ fontSize: 22 }}>{step.icon}</span>
                </div>
                <h2 className="brand-font text-[18px] font-bold leading-snug text-white sm:text-[19px]">
                  {step.heading}
                </h2>
              </div>

              <p className="mb-5 text-[14px] leading-relaxed text-[#9a9a9a]">{step.description}</p>

              <div className="mb-1 text-[12px] font-medium text-[#6a6a6a]">Selected folder</div>

              {currentStep === 0 && (
                <>
                  <PathBox value={gamePath} placeholder="No folder selected — detect or browse below" emphasize={gameState !== 'valid'} />
                  <ValidationRow
                    state={gameState}
                    validText="Cyberpunk 2077 found — you're good to go."
                    invalidText="We couldn't find Cyberpunk 2077 in this folder."
                  />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={() => void applyGameDefault()} disabled={detectingGame} className={`${secondaryBtn} w-full sm:w-auto`}>
                      {detectingGame ? (
                        <>
                          <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                          Detecting…
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
                          Detect automatically
                        </>
                      )}
                    </button>
                    <button onClick={browseGame} className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                      Choose folder
                    </button>
                  </div>
                </>
              )}

              {currentStep === 1 && (
                <>
                  <PathBox value={libraryPath} placeholder="No folder selected — use the suggestion or browse" emphasize={libraryState === 'invalid'} />
                  <ValidationRow
                    state={libraryState}
                    validText="This folder is ready to use."
                    invalidText="This folder can't be used as a mod library."
                  />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={applyLibraryDefault} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark</span>
                      Use suggested
                    </button>
                    <button onClick={browseLibrary} className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                      Choose folder
                    </button>
                  </div>
                </>
              )}

              {currentStep === 2 && (
                <>
                  <PathBox value={effectiveDownloadPath} placeholder="No folder selected yet" />
                  <ValidationRow state="info" infoText="New mod downloads will be saved here." />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={applyDownloadsDefault} className={`${secondaryBtn} w-full sm:w-auto`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark</span>
                      Use suggested
                    </button>
                    <button onClick={browseDownloads} className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
                      Choose folder
                    </button>
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  {/* How to get the key — mirrors the README */}
                  <ol className="mb-5 space-y-2.5">
                    {[
                      <>Log in to Nexus Mods and open the <span className="text-[#e5e2e1]">API Key Settings</span> page.</>,
                      <>Scroll to the bottom and find <span className="text-[#e5e2e1]">Personal API Key</span>.</>,
                      <>Copy your personal API key and paste it below.</>,
                    ].map((text, index) => (
                      <li key={index} className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[#9a9a9a]">
                        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#141414] text-[11px] font-semibold text-[#8a8a8a]">
                          {index + 1}
                        </span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ol>

                  <button onClick={openNexusApiKeysPage} className={`${secondaryBtn} mb-5 w-full sm:w-auto`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
                    Open API Key page
                  </button>

                  <div className="mb-1 text-[12px] font-medium text-[#6a6a6a]">Personal API key</div>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={nexusApiKey}
                      onChange={(event) => setNexusApiKey(event.target.value)}
                      placeholder="Paste your Nexus Mods API key"
                      spellCheck={false}
                      autoComplete="off"
                      className="h-11 w-full rounded-md border-[0.5px] border-[#2d2d2d] bg-[#050505] px-3 pr-11 text-[13.5px] text-white outline-none transition-colors focus:border-[#fcee09]/55 focus-visible:outline-none"
                    />
                    {nexusApiKey && (
                      <button
                        type="button"
                        onClick={() => setShowApiKey((value) => !value)}
                        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-[#777777] transition-colors hover:bg-[#111111] hover:text-[#cfcfcf]"
                        aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                      >
                        <span className="material-symbols-outlined text-[17px] leading-none">{showApiKey ? 'visibility_off' : 'visibility'}</span>
                      </button>
                    )}
                  </div>

                  {/* Live validation */}
                  <div className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed">
                    {nexusAccount.status === 'not-configured' && (
                      <>
                        <span className="material-symbols-outlined mt-px text-[#60A5FA]" style={{ fontSize: 16 }}>info</span>
                        <span className="text-[#9a9a9a]">Optional — you can add this later in Settings &gt; Nexus.</span>
                      </>
                    )}
                    {nexusAccount.status === 'checking' && (
                      <>
                        <span className="material-symbols-outlined mt-px animate-spin text-[#9a9a9a]" style={{ fontSize: 16 }}>progress_activity</span>
                        <span className="text-[#9a9a9a]">Validating your API key…</span>
                      </>
                    )}
                    {nexusAccount.status === 'connected' && (
                      <>
                        <span className="material-symbols-outlined mt-px text-[#34d399]" style={{ fontSize: 16 }}>check_circle</span>
                        <span className="text-[#cfe9dc]">
                          Connected as <span className="font-semibold text-white">{nexusAccount.data.name}</span>
                          {' '}({nexusAccount.data.isPremium ? 'Premium' : 'Free'})
                        </span>
                      </>
                    )}
                    {nexusAccount.status === 'error' && (
                      <>
                        <span className="material-symbols-outlined mt-px text-[#fcee09]" style={{ fontSize: 16 }}>error</span>
                        <span className="text-[#d8c98a]">We couldn't validate this key. Double-check you copied the Personal API Key.</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer nav */}
            <div className="mt-6 flex items-center justify-between">
              <button onClick={goBack} className={`min-w-[108px] ${centeredStartIconButton}`}>
                <span className={centeredStartIcon} style={{ fontSize: 18 }}>arrow_back</span>
                <span className={centeredButtonLabel}>Back</span>
              </button>

              {!isLastStep ? (
                stepReady ? (
                  <button onClick={goNext} className={`min-w-[148px] ${centeredEndIconButton}`}>
                    <span className={centeredButtonLabel}>Continue</span>
                    <span className={centeredEndIcon} style={{ fontSize: 18 }}>arrow_forward</span>
                  </button>
                ) : (
                  <Tooltip content={continueTooltip} side="top" wrapperClassName="inline-flex">
                    <button disabled className={`min-w-[148px] ${centeredEndIconButton}`}>
                      <span className={centeredButtonLabel}>Continue</span>
                      <span className="material-symbols-outlined col-start-3 justify-self-start leading-none" style={{ fontSize: 18 }}>arrow_forward</span>
                    </button>
                  </Tooltip>
                )
              ) : (gamePathValid && libraryPathValid) ? (
                <button
                  onClick={() => void applyPaths()}
                  disabled={isInitializing}
                  className={isInitializing ? primaryBtn : `min-w-[164px] ${centeredEndIconButton}`}
                >
                  {isInitializing ? (
                    <>
                      <span className="material-symbols-outlined animate-spin" style={{ fontSize: 18 }}>progress_activity</span>
                      Setting things up…
                    </>
                  ) : (
                    <>
                      <span className={centeredButtonLabel}>Finish setup</span>
                      <span className="material-symbols-outlined col-start-3 justify-self-start leading-none" style={{ fontSize: 18 }}>check</span>
                    </>
                  )}
                </button>
              ) : (
                <Tooltip content="Select a valid game folder and mod library to finish" side="top" wrapperClassName="inline-flex">
                  <button disabled className={`min-w-[164px] ${centeredEndIconButton}`}>
                    <span className={centeredButtonLabel}>Finish setup</span>
                    <span className="material-symbols-outlined col-start-3 justify-self-start leading-none" style={{ fontSize: 18 }}>check</span>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
