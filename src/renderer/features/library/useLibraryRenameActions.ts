import { useCallback, useEffect, useState } from 'react'
import type { ModMetadata, ToastSeverity } from '@shared/types'

type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void

interface UseLibraryRenameActionsOptions {
  orderedEntries: ModMetadata[]
  updateModMetadata: (id: string, updates: Partial<ModMetadata>) => Promise<void>
  addToast: AddToast
}

export function useLibraryRenameActions({
  orderedEntries,
  updateModMetadata,
  addToast,
}: UseLibraryRenameActionsOptions) {
  const [renamingModId, setRenamingModId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (!renamingModId) return

    const renamedMod = orderedEntries.find((mod) => mod.uuid === renamingModId)
    if (!renamedMod) {
      setRenamingModId(null)
      setRenameValue('')
      return
    }

    setRenameValue(renamedMod.name)
  }, [renamingModId, orderedEntries])

  const beginRename = useCallback((mod: ModMetadata) => {
    setRenamingModId(mod.uuid)
    setRenameValue(mod.name)
  }, [])

  const handleSaveRename = useCallback(async () => {
    if (!renamingModId) return

    const trimmed = renameValue.trim()
    if (!trimmed) {
      addToast('Mod name cannot be empty', 'warning')
      return
    }

    await updateModMetadata(renamingModId, { name: trimmed })
    addToast('Mod name updated', 'success', 1800)
    setRenamingModId(null)
    setRenameValue('')
  }, [addToast, renameValue, renamingModId, updateModMetadata])

  const handleCancelRename = useCallback(() => {
    setRenamingModId(null)
    setRenameValue('')
  }, [])

  return {
    renamingModId,
    renameValue,
    setRenameValue,
    beginRename,
    handleSaveRename,
    handleCancelRename,
  }
}
