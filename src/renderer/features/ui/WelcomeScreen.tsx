import React, { useEffect, useState } from 'react'
import { CloseButton } from '@heroui/react'
import { useAppStore } from '../../store/useAppStore'
import { IpcService } from '../../services/IpcService'
import { IPC, type IpcResult } from '@shared/types'
import { Tooltip } from './Tooltip'
import { useAppVersion } from '../../hooks/useAppVersion'
import { useNexusAccount } from '../../hooks/useNexusAccount'
import { PathBox, ValidationRow, uiButton } from './uiKit'
import { LanguageSelect } from './LanguageSelect'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'

function getParentDirectory(targetPath: string): string {
  const normalizedPath = targetPath.trim().replace(/[\\/]+$/, '')
  if (!normalizedPath) return ''

  const separatorIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'))
  if (separatorIndex <= 0) return ''

  return normalizedPath.slice(0, separatorIndex)
}

// Step labels/headings/descriptions/previews are resolved from the translation
// catalog at render time via `welcome.steps.<key>.*`, so they re-translate when
// the language changes. Only structural fields live here.
const SETUP_STEPS = [
  { key: 'game', icon: 'sports_esports', optional: false },
  { key: 'library', icon: 'folder_open', optional: false },
  { key: 'downloads', icon: 'download', optional: true },
  { key: 'nexus', icon: 'vpn_key', optional: true },
] as const

const NEXUS_API_KEYS_URL = 'https://www.nexusmods.com/settings/api-keys'

const BrandMark: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => {
  const isLarge = size === 'lg'
  return (
    <div className="flex items-center gap-3 select-none">
      <span
        className={`relative flex items-center justify-center border border-[rgb(var(--accent-rgb)/0.5)] bg-[var(--accent)] ${
          isLarge
            ? 'h-12 w-12 rounded-[10px] shadow-[0_0_30px_rgb(var(--accent-rgb)/0.22)]'
            : 'h-7 w-7 rounded-[6px]'
        }`}
      >
        <span className={`rounded-[3px] bg-[var(--bg-base-deep)] ${isLarge ? 'h-[18px] w-[18px]' : 'h-[10px] w-[10px]'}`} />
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
}> = ({ currentStep, onStepSelect }) => {
  const { t } = useTranslation()
  return (
  <div className="flex items-center" role="list" aria-label={t('welcome.stepsAria')}>
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
                  ? 'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_0_0_4px_rgb(var(--accent-rgb)/0.12)]'
                  : isCompleted
                  ? 'bg-[rgb(52_211_153/0.14)] text-[var(--status-success)] group-hover:bg-[rgb(52_211_153/0.22)]'
                  : 'bg-[var(--surface-secondary)] text-[var(--text-muted)]'
              }`}
            >
              {isCompleted ? (
                <Icon name="check" className="scale-in" style={{ fontSize: 15 }} />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={`hidden text-[12.5px] font-medium transition-colors duration-200 sm:inline ${
                isActive ? 'text-white' : isCompleted ? 'text-[var(--text-support)] group-hover:text-white' : 'text-[#5a5a5a]'
              }`}
            >
              {t(`welcome.steps.${step.key}.label`)}
            </span>
          </button>
          {index < SETUP_STEPS.length - 1 && (
            <div className="mx-3 h-px flex-1 rounded-full bg-[var(--bg-subtle)] sm:mx-4">
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
}

export const WelcomeScreen: React.FC = () => {
  const { t } = useTranslation()
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
      { title: t('welcome.dialog.game') }
    )
    if (!result.canceled && result.filePaths.length) {
      setGamePath(result.filePaths[0])
    }
  }

  const browseLibrary = async () => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG,
      { title: t('welcome.dialog.library') }
    )
    if (!result.canceled && result.filePaths.length) {
      setLibraryPath(result.filePaths[0])
    }
  }

  const browseDownloads = async () => {
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FOLDER_DIALOG,
      { title: t('welcome.dialog.downloads') }
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
        addToast(result.error ?? t('welcome.toast.detectFailed'), 'warning', 2600)
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
      addToast(t('welcome.toast.gameDetected'), 'success', 1800)
    }
  }

  const ensureDirectory = async (targetPath: string, label: string): Promise<boolean> => {
    const result = await IpcService.invoke<IpcResult<void>>(IPC.ENSURE_DIRECTORY, targetPath)
    if (!result.ok) {
      addToast(result.error ?? t('welcome.toast.createDirFailed', { label }), 'warning', 2600)
      return false
    }
    return true
  }

  const applyLibraryDefault = async () => {
    if (!defaultPaths) return
    const nextPath = defaultPaths.libraryPath
    setLibraryPath(nextPath)
    if (await ensureDirectory(nextPath, t('welcome.label.library'))) {
      addToast(t('welcome.toast.libraryLoaded'), 'info', 1800)
    }
  }

  const applyDownloadsDefault = async () => {
    // Use the independent suggested downloads folder, not one derived from the
    // current library path — clicking this must only set the downloads path.
    const nextDownloadPath =
      defaultPaths?.downloadPath?.trim() || resolveDownloadPath(defaultPaths?.libraryPath || '')
    setDownloadPath(nextDownloadPath)
    if (await ensureDirectory(nextDownloadPath, t('welcome.label.downloads'))) {
      addToast(t('welcome.toast.downloadsLoaded'), 'info', 1800)
    }
  }

  const applyPaths = async () => {
    if (!gamePathValid || !libraryPathValid) {
      addToast(t('welcome.toast.finishInvalid'), 'warning', 2400)
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
          addToast(t('welcome.toast.purged', { count: purgeResult.data.purged }), 'info', 2600)
        }
        if (purgeResult.data?.failed) {
          addToast(t('welcome.toast.purgeFailed', { count: purgeResult.data.failed }), 'warning', 3200)
        }
      }

      const saveResult = await updateSettings({ gamePath, libraryPath, downloadPath: resolvedDownloadPath, nexusApiKey: nexusApiKey.trim(), setupCompleted: true })
      if (!saveResult.ok) {
        addToast(saveResult.error ?? t('welcome.toast.saveFailed'), 'error', 5000)
        return
      }
      const scannedMods = await scanMods()

      if (gamePathValid && libraryPathValid) {
        const restoreResults = await restoreEnabledMods(scannedMods)
        const failedRestoreCount = restoreResults.filter((result) => !result.ok).length
        if (failedRestoreCount > 0) {
          addToast(t('welcome.toast.restorePartial', { count: failedRestoreCount }), 'warning', 3200)
        }
        addToast(t('welcome.toast.complete'), 'success', 1800)
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
    ? t('welcome.game.continueTooltip')
    : t('welcome.library.continueTooltip')

  const { primary: primaryBtn, secondary: secondaryBtn, accentOutline: accentOutlineBtn, ghost: ghostBtn } = uiButton
  const centeredEndIconButton = `${primaryBtn} !grid grid-cols-[1fr_auto_1fr] gap-x-3`
  const centeredStartIconButton = `${ghostBtn} !grid grid-cols-[1fr_auto_1fr] gap-x-3`
  const centeredButtonLabel = 'col-start-2 translate-y-px leading-none'
  const centeredEndIcon = 'col-start-3 justify-self-start leading-none transition-transform duration-150 group-hover:translate-x-0.5'
  const centeredStartIcon = 'col-start-1 justify-self-end leading-none transition-transform duration-150 group-hover:-translate-x-0.5'

  return (
    <div className="relative h-full overflow-y-auto animate-settings-in bg-[var(--bg-base-deep)]">
      <div
        className="absolute inset-x-0 top-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div
        className="absolute right-4 top-4 z-20 flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <LanguageSelect variant="icon" />
        <Tooltip content={t('common.close')}>
          <CloseButton
            aria-label={t('welcome.closeAria')}
            onPress={() => IpcService.send('window:close')}
            className="h-9 w-9 rounded-lg bg-[var(--surface)] text-[var(--text-support)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[#f87171]"
          />
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
                className="fade-up text-[28px] font-bold leading-tight tracking-[-0.02em] text-white sm:text-[32px]"
                style={{ animationDelay: '50ms' }}
              >
                {t('welcome.headline')}
              </h1>
              <p
                className="fade-up mt-3 max-w-md text-[15px] leading-relaxed text-[var(--text-support)]"
                style={{ animationDelay: '100ms' }}
              >
                {t('welcome.subtitle')}
              </p>

              <div className="fade-up mt-9 grid w-full gap-2.5 text-left" style={{ animationDelay: '150ms' }}>
                {SETUP_STEPS.map((s, index) => (
                  <div
                    key={s.key}
                    className="flex items-center gap-3.5 rounded-xl border-0 bg-[var(--surface)] px-4 py-3.5"
                  >
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-secondary)] text-[12px] font-semibold text-[var(--text-muted)]">
                      {index + 1}
                    </div>
                    <Icon name={s.icon} className="flex-shrink-0 text-[var(--accent)]" style={{ fontSize: 20 }} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-white">{t(`welcome.steps.${s.key}.label`)}</div>
                      <div className="truncate text-[12.5px] text-[#8a8a8a]">{t(`welcome.steps.${s.key}.preview`)}</div>
                    </div>
                    {s.optional && (
                      <span className="ml-auto flex-shrink-0 text-[11px] font-medium text-[#6a6a6a]">{t('common.optional')}</span>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={beginSetup}
                className={`fade-up mt-9 min-w-[184px] ${centeredEndIconButton}`}
                style={{ animationDelay: '200ms' }}
              >
                <span className={centeredButtonLabel}>{t('common.getStarted')}</span>
                <Icon name="arrow_forward" className={centeredEndIcon} style={{ fontSize: 18 }} />
              </button>

              <div className="fade-up mt-7 text-[11.5px] text-[#5a5a5a]" style={{ animationDelay: '250ms' }}>
                {t('welcome.version', { version: appVersion })}
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
                {t('welcome.stepCounter', { current: currentStep + 1, total: SETUP_STEPS.length })}
              </span>
            </div>

            {/* Progress */}
            <div className="fade-up mb-7">
              <StepProgress currentStep={currentStep} onStepSelect={goToStep} />
            </div>

            {/* Step card */}
            <div
              key={currentStep}
              className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.3)] sm:p-7 ${
                stepDirection === 'forward' ? 'slide-in-right' : 'slide-in-left'
              }`}
            >
              <div className="mb-4 flex items-center gap-3.5">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border-0 bg-[rgb(var(--accent-rgb)/0.12)]">
                  <Icon name={step.icon} className="text-[var(--accent)]" style={{ fontSize: 22 }} />
                </div>
                <h2 className="text-[18px] font-semibold leading-snug tracking-[-0.01em] text-white sm:text-[19px]">
                  {t(`welcome.steps.${step.key}.heading`)}
                </h2>
              </div>

              <p className="mb-5 text-[14px] leading-relaxed text-[var(--text-support)]">{t(`welcome.steps.${step.key}.description`)}</p>

              <div className="mb-1 text-[12px] font-medium text-[#6a6a6a]">{t('common.selectedFolder')}</div>

              {currentStep === 0 && (
                <>
                  <PathBox value={gamePath} placeholder={t('welcome.game.placeholder')} emphasize={gameState !== 'valid'} />
                  <ValidationRow
                    state={gameState}
                    validText={t('welcome.game.valid')}
                    invalidText={t('welcome.game.invalid')}
                  />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={() => void applyGameDefault()} disabled={detectingGame} className={`${secondaryBtn} w-full sm:w-auto`}>
                      {detectingGame ? (
                        <>
                          <Icon name="progress_activity" className="animate-spin" style={{ fontSize: 16 }} />
                          {t('common.detecting')}
                        </>
                      ) : (
                        <>
                          <Icon name="auto_awesome" style={{ fontSize: 16 }} />
                          {t('common.detectAutomatically')}
                        </>
                      )}
                    </button>
                    <button onClick={browseGame} className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}>
                      <Icon name="folder_open" style={{ fontSize: 16 }} />
                      {t('common.chooseFolder')}
                    </button>
                  </div>
                </>
              )}

              {currentStep === 1 && (
                <>
                  <PathBox value={libraryPath} placeholder={t('welcome.library.placeholder')} emphasize={libraryState === 'invalid'} />
                  <ValidationRow
                    state={libraryState}
                    validText={t('welcome.library.valid')}
                    invalidText={t('welcome.library.invalid')}
                  />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={applyLibraryDefault} disabled={!defaultPaths} className={`${secondaryBtn} w-full sm:w-auto`}>
                      <Icon name="bookmark" style={{ fontSize: 16 }} />
                      {t('common.useSuggested')}
                    </button>
                    <button onClick={browseLibrary} className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}>
                      <Icon name="folder_open" style={{ fontSize: 16 }} />
                      {t('common.chooseFolder')}
                    </button>
                  </div>
                </>
              )}

              {currentStep === 2 && (
                <>
                  <PathBox value={effectiveDownloadPath} placeholder={t('welcome.downloads.placeholder')} />
                  <ValidationRow state="info" infoText={t('welcome.downloads.info')} />
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                    <button onClick={applyDownloadsDefault} className={`${secondaryBtn} w-full sm:w-auto`}>
                      <Icon name="bookmark" style={{ fontSize: 16 }} />
                      {t('common.useSuggested')}
                    </button>
                    <button onClick={browseDownloads} className={`${accentOutlineBtn} w-full sm:ml-auto sm:w-auto`}>
                      <Icon name="folder_open" style={{ fontSize: 16 }} />
                      {t('common.chooseFolder')}
                    </button>
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  {/* How to get the key — mirrors the README */}
                  <ol className="mb-5 space-y-2.5">
                    {[
                      t('welcome.nexus.instruction1'),
                      t('welcome.nexus.instruction2'),
                      t('welcome.nexus.instruction3'),
                    ].map((text, index) => (
                      <li key={index} className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[var(--text-support)]">
                        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-secondary)] text-[11px] font-semibold text-[var(--text-muted)]">
                          {index + 1}
                        </span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ol>

                  <button onClick={openNexusApiKeysPage} className={`${secondaryBtn} mb-5 w-full sm:w-auto`}>
                    <Icon name="open_in_new" style={{ fontSize: 16 }} />
                    {t('welcome.nexus.openApiPage')}
                  </button>

                  <div className="mb-1 text-[12px] font-medium text-[#6a6a6a]">{t('welcome.nexus.apiKeyLabel')}</div>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={nexusApiKey}
                      onChange={(event) => setNexusApiKey(event.target.value)}
                      placeholder={t('welcome.nexus.apiKeyPlaceholder')}
                      spellCheck={false}
                      autoComplete="off"
                      className="h-11 w-full rounded-lg border-0 bg-[var(--surface-secondary)] px-3 pr-11 text-[13.5px] text-white outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.45)] focus-visible:outline-none"
                    />
                    {nexusApiKey && (
                      <button
                        type="button"
                        onClick={() => setShowApiKey((value) => !value)}
                        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-[#777777] transition-colors hover:bg-[var(--surface)] hover:text-[#cfcfcf]"
                        aria-label={showApiKey ? t('welcome.nexus.hideKey') : t('welcome.nexus.showKey')}
                      >
                        <Icon name={showApiKey ? 'visibility_off' : 'visibility'} className="text-[17px] leading-none" />
                      </button>
                    )}
                  </div>

                  {/* Live validation */}
                  <div className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed">
                    {nexusAccount.status === 'not-configured' && (
                      <>
                        <Icon name="info" className="mt-px text-[#60A5FA]" style={{ fontSize: 16 }} />
                        <span className="text-[var(--text-support)]">{t('welcome.nexus.optionalInfo')}</span>
                      </>
                    )}
                    {nexusAccount.status === 'checking' && (
                      <>
                        <Icon name="progress_activity" className="mt-px animate-spin text-[var(--text-support)]" style={{ fontSize: 16 }} />
                        <span className="text-[var(--text-support)]">{t('welcome.nexus.validating')}</span>
                      </>
                    )}
                    {nexusAccount.status === 'connected' && (
                      <>
                        <Icon name="check_circle" className="mt-px text-[#34d399]" style={{ fontSize: 16 }} />
                        <span className="text-[#cfe9dc]">
                          {t('welcome.nexus.connectedAs')} <span className="font-semibold text-white">{nexusAccount.data.name}</span>
                          {' '}({nexusAccount.data.isPremium ? t('common.premium') : t('common.free')})
                        </span>
                      </>
                    )}
                    {nexusAccount.status === 'error' && (
                      <>
                        <Icon name="error" className="mt-px text-[var(--status-warning)]" style={{ fontSize: 16 }} />
                        <span className="text-[#d8c98a]">{t('welcome.nexus.error')}</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer nav */}
            <div className="mt-6 flex items-center justify-between">
              <button onClick={goBack} className={`min-w-[108px] ${centeredStartIconButton}`}>
                <Icon name="arrow_back" className={centeredStartIcon} style={{ fontSize: 18 }} />
                <span className={centeredButtonLabel}>{t('common.back')}</span>
              </button>

              {!isLastStep ? (
                stepReady ? (
                  <button onClick={goNext} className={`min-w-[148px] ${centeredEndIconButton}`}>
                    <span className={centeredButtonLabel}>{t('common.continue')}</span>
                    <Icon name="arrow_forward" className={centeredEndIcon} style={{ fontSize: 18 }} />
                  </button>
                ) : (
                  <Tooltip content={continueTooltip} side="top" wrapperClassName="inline-flex">
                    <button disabled className={`min-w-[148px] ${centeredEndIconButton}`}>
                      <span className={centeredButtonLabel}>{t('common.continue')}</span>
                      <Icon name="arrow_forward" className="col-start-3 justify-self-start leading-none" style={{ fontSize: 18 }} />
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
                      <Icon name="progress_activity" className="animate-spin" style={{ fontSize: 18 }} />
                      {t('welcome.settingUp')}
                    </>
                  ) : (
                    <>
                      <span className={centeredButtonLabel}>{t('common.finishSetup')}</span>
                      <Icon name="check" className="col-start-3 justify-self-start leading-none" style={{ fontSize: 18 }} />
                    </>
                  )}
                </button>
              ) : (
                <Tooltip content={t('welcome.finishTooltip')} side="top" wrapperClassName="inline-flex">
                  <button disabled className={`min-w-[164px] ${centeredEndIconButton}`}>
                    <span className={centeredButtonLabel}>{t('common.finishSetup')}</span>
                    <Icon name="check" className="col-start-3 justify-self-start leading-none" style={{ fontSize: 18 }} />
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
