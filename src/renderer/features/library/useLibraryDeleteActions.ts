import { useCallback, useEffect, useState } from 'react'
import type { IpcResult, ModMetadata } from '@shared/types'

type ToastSeverity = 'info' | 'success' | 'warning' | 'error'
type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void
type DeleteMod = (id: string) => Promise<IpcResult>

interface UseLibraryDeleteActionsOptions {
  orderedEntries: ModMetadata[]
  allMods: ModMetadata[]
  deleteMod: DeleteMod
  addToast: AddToast
  resetSelection: () => void
  clearPendingAction: () => void
}

export function useLibraryDeleteActions({
  orderedEntries,
  allMods,
  deleteMod,
  addToast,
  resetSelection,
  clearPendingAction,
}: UseLibraryDeleteActionsOptions) {
  const [submittingAction, setSubmittingAction] = useState(false)
  const [deletingRows, setDeletingRows] = useState<Record<string, { startedAt: number }>>({})
  const [deleteProgressTick, setDeleteProgressTick] = useState(() => Date.now())

  const markRowsDeleting = useCallback((modIds: string[]) => {
    const startedAt = Date.now()
    setDeletingRows((current) => {
      const next = { ...current }
      for (const modId of modIds) {
        next[modId] = { startedAt }
      }
      return next
    })
  }, [])

  const clearDeletingRows = useCallback((modIds: string[]) => {
    setDeletingRows((current) => {
      if (modIds.every((modId) => !current[modId])) return current
      const next = { ...current }
      for (const modId of modIds) {
        delete next[modId]
      }
      return next
    })
  }, [])

  useEffect(() => {
    const deletingIds = Object.keys(deletingRows)
    if (deletingIds.length === 0) return

    const intervalId = window.setInterval(() => {
      setDeleteProgressTick(Date.now())
    }, 120)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [deletingRows])

  const handleDeleteAll = useCallback(async () => {
    const targets = [...orderedEntries]
    if (targets.length === 0) {
      addToast('No library entries to delete', 'info')
      return
    }

    setSubmittingAction(true)
    let removed = 0
    let failed = 0

    for (const mod of targets) {
      markRowsDeleting([mod.uuid])
      const result = await deleteMod(mod.uuid)
      if (result.ok) {
        removed += 1
      } else {
        failed += 1
      }
      clearDeletingRows([mod.uuid])
    }

    setSubmittingAction(false)
    clearPendingAction()
    resetSelection()

    if (removed > 0) {
      addToast(`${removed} librar${removed === 1 ? 'y entry' : 'y entries'} deleted`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} librar${failed === 1 ? 'y entry' : 'y entries'} could not be deleted`, 'warning')
    }
  }, [addToast, clearDeletingRows, clearPendingAction, deleteMod, markRowsDeleting, orderedEntries, resetSelection])

  const handleDeleteSelected = useCallback(async (modIds: string[]) => {
    const targets = allMods.filter((mod) => modIds.includes(mod.uuid))
    if (targets.length === 0) {
      clearPendingAction()
      addToast('No selected mods to delete', 'info')
      return
    }

    setSubmittingAction(true)
    let removed = 0
    let failed = 0

    for (const mod of targets) {
      markRowsDeleting([mod.uuid])
      const result = await deleteMod(mod.uuid)
      if (result.ok) {
        removed += 1
      } else {
        failed += 1
      }
      clearDeletingRows([mod.uuid])
    }

    setSubmittingAction(false)
    clearPendingAction()
    resetSelection()

    if (removed > 0) {
      addToast(`${removed} mod${removed === 1 ? '' : 's'} deleted from selection`, 'success')
    }
    if (failed > 0) {
      addToast(`${failed} mod${failed === 1 ? '' : 's'} could not be deleted`, 'warning')
    }
  }, [addToast, allMods, clearDeletingRows, clearPendingAction, deleteMod, markRowsDeleting, resetSelection])

  const handleDeleteMod = useCallback(async (mod: ModMetadata) => {
    markRowsDeleting([mod.uuid])
    const result = await deleteMod(mod.uuid)
    clearDeletingRows([mod.uuid])
    if (!result.ok) {
      addToast(result.error ?? 'Delete failed', 'error')
    } else {
      addToast(`${mod.name} deleted`, 'success')
    }
  }, [addToast, clearDeletingRows, deleteMod, markRowsDeleting])

  return {
    deletingRows,
    deleteProgressTick,
    submittingAction,
    handleDeleteAll,
    handleDeleteSelected,
    handleDeleteMod,
  }
}
