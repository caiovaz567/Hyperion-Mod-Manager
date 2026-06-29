import { useCallback } from 'react'
import type { AppSettings, InstallModResponse, IpcResult, ModMetadata } from '@shared/types'
import { IPC } from '@shared/types'
import { IpcService } from '../../services/IpcService'
import { translate } from '../../i18n/translate'

type ToastSeverity = 'info' | 'success' | 'warning' | 'error'
type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void
type ActiveView = 'library' | 'downloads' | 'settings'

interface UseLibraryInstallActionsOptions {
  settings?: AppSettings | null
  gamePathValid: boolean
  libraryPathValid: boolean
  gameRunning: boolean
  installMod: (filePath: string) => Promise<IpcResult<InstallModResponse>>
  enableMod: (id: string) => Promise<IpcResult>
  scanMods: () => Promise<ModMetadata[]>
  addToast: AddToast
  setActiveView: (view: ActiveView) => void
}

export function useLibraryInstallActions({
  settings,
  gamePathValid,
  libraryPathValid,
  gameRunning,
  installMod,
  enableMod,
  scanMods,
  addToast,
  setActiveView,
}: UseLibraryInstallActionsOptions) {
  const hasRequiredPaths = Boolean(
    settings?.gamePath?.trim() &&
    settings?.libraryPath?.trim() &&
    gamePathValid &&
    libraryPathValid
  )

  const finalizeInstalledMod = useCallback(async (
    mod: ModMetadata,
    successMessage: string,
    shouldEnable = true,
  ) => {
    await scanMods()

    if (!shouldEnable) {
      addToast(successMessage, 'success')
      return
    }

    const enableResult = await enableMod(mod.uuid)
    if (!enableResult.ok) {
      addToast(translate('library.toast.installedNotActivated', { error: String(enableResult.error ?? '') }), 'warning')
      return
    }

    addToast(successMessage, 'success')
  }, [addToast, enableMod, scanMods])

  const handleInstallFile = useCallback(async (filePath: string) => {
    if (gameRunning) {
      addToast(translate('library.toast.closeGameBeforeInstall'), 'warning')
      return
    }
    if (!hasRequiredPaths) {
      addToast(translate('library.toast.setPathsBeforeInstall'), 'warning')
      setActiveView('settings')
      return
    }

    const installResult = await installMod(filePath)
    if (!installResult.ok || !installResult.data) {
      addToast(installResult.error ?? translate('library.toast.installFailed'), 'error')
      return
    }

    if (installResult.data.status === 'installed' && installResult.data.mod) {
      await finalizeInstalledMod(installResult.data.mod, translate('library.toast.installedActivated', { name: installResult.data.mod.name }))
    }
  }, [addToast, finalizeInstalledMod, hasRequiredPaths, installMod, setActiveView])

  const handleInstallClick = useCallback(async () => {
    if (gameRunning) {
      addToast(translate('library.toast.closeGameBeforeInstall'), 'warning')
      return
    }
    const result = await IpcService.invoke<{ canceled: boolean; filePaths: string[] }>(
      IPC.OPEN_FILE_DIALOG,
      {
        title: translate('library.install.dialogTitle'),
        filters: [{ name: translate('library.install.archiveFilterName'), extensions: ['zip', 'rar', '7z'] }],
        properties: ['openFile'],
      }
    )

    if (result.canceled || !result.filePaths.length) return
    await handleInstallFile(result.filePaths[0])
  }, [addToast, gameRunning, handleInstallFile])

  return {
    handleInstallFile,
    handleInstallClick,
  }
}
