import { useCallback } from 'react'
import type { ModMetadata, AppSettings } from '@shared/types'
import { IPC } from '@shared/types'
import { IpcService } from '../../services/IpcService'
import type { LibraryContextMenuState } from './LibraryContextMenu'

type ToastSeverity = 'info' | 'success' | 'warning' | 'error'
type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void

interface UseLibraryContextMenuActionsOptions {
  contextMenu: LibraryContextMenuState | null
  selectedModIds: string[]
  settings?: AppSettings | null
  addToast: AddToast
  openReinstallPrompt: (mod: ModMetadata) => void
  moveModsToTopLevel: (modIds: string[]) => Promise<void>
  closeContextMenu: () => void
  requestDelete: (mod: ModMetadata) => void
  beginRename: (mod: ModMetadata) => void
  openDetails: (modId: string) => void
}

export function useLibraryContextMenuActions({
  contextMenu,
  selectedModIds,
  settings,
  addToast,
  openReinstallPrompt,
  moveModsToTopLevel,
  closeContextMenu,
  requestDelete,
  beginRename,
  openDetails,
}: UseLibraryContextMenuActionsOptions) {
  const getContextTargetModIds = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return []
    return selectedModIds.includes(contextMenu.mod.uuid) ? selectedModIds : [contextMenu.mod.uuid]
  }, [contextMenu, selectedModIds])

  const handleContextOpenFolder = useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'row' || !settings?.libraryPath) return
    const modPath = `${settings.libraryPath}\\${contextMenu.mod.folderName ?? contextMenu.mod.uuid}`
    await IpcService.invoke(IPC.OPEN_PATH, modPath)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, settings?.libraryPath])

  const handleContextOpenOnNexus = useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'row') return
    const mod = contextMenu.mod
    const modId = mod.nexusModId ?? mod.nexusFileId
    if (!modId) {
      addToast('No Nexus link stored for this mod', 'warning')
      closeContextMenu()
      return
    }

    const url = `https://www.nexusmods.com/cyberpunk2077/mods/${mod.nexusModId ?? mod.nexusFileId}`
    await IpcService.invoke(IPC.OPEN_EXTERNAL, url)
    closeContextMenu()
  }, [addToast, closeContextMenu, contextMenu])

  const handleContextDelete = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row') return
    requestDelete(contextMenu.mod)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, requestDelete])

  const handleContextRename = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row') return
    beginRename(contextMenu.mod)
    closeContextMenu()
  }, [beginRename, closeContextMenu, contextMenu])

  const handleContextDetails = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return
    openDetails(contextMenu.mod.uuid)
    closeContextMenu()
  }, [closeContextMenu, contextMenu, openDetails])

  const handleContextReinstall = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'row' || contextMenu.mod.kind !== 'mod') return
    if (!contextMenu.mod.sourcePath) {
      addToast('Original source is not stored for this mod', 'warning')
      closeContextMenu()
      return
    }

    openReinstallPrompt(contextMenu.mod)
    closeContextMenu()
  }, [addToast, closeContextMenu, contextMenu, openReinstallPrompt])

  const handleContextMoveToTopLevel = useCallback(async () => {
    const targetIds = getContextTargetModIds()
    if (targetIds.length === 0) return
    await moveModsToTopLevel(targetIds)
    closeContextMenu()
  }, [closeContextMenu, getContextTargetModIds, moveModsToTopLevel])

  return {
    getContextTargetModIds,
    handleContextOpenFolder,
    handleContextOpenOnNexus,
    handleContextDelete,
    handleContextRename,
    handleContextDetails,
    handleContextReinstall,
    handleContextMoveToTopLevel,
  }
}
