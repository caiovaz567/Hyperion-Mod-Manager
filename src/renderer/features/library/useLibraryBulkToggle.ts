import { useCallback, useState } from 'react'
import type { ModMetadata } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'

type ToastSeverity = 'info' | 'success' | 'warning' | 'error'
type AddToast = (message: string, severity?: ToastSeverity, duration?: number) => void
type BulkToggleTarget = 'enable' | 'disable'

interface UseLibraryBulkToggleOptions {
  allMods: ModMetadata[]
  addToast: AddToast
}

export function useLibraryBulkToggle({
  allMods,
  addToast,
}: UseLibraryBulkToggleOptions) {
  const [isBulkToggling, setIsBulkToggling] = useState(false)

  const runBulkToggle = useCallback(async (modIds: string[], target: BulkToggleTarget) => {
    const actionableIds = modIds.filter((id) => {
      const mod = allMods.find((item) => item.uuid === id)
      if (!mod) return false
      return target === 'enable' ? !mod.enabled : mod.enabled
    })

    if (actionableIds.length === 0) {
      addToast(target === 'enable' ? 'No mods to enable' : 'No mods to disable', 'info')
      return
    }

    const prevEnabled = new Map<string, boolean>()
    for (const id of actionableIds) {
      const mod = allMods.find((item) => item.uuid === id)
      if (mod) prevEnabled.set(id, Boolean(mod.enabled))
    }

    const actionableSet = new Set(actionableIds)
    useAppStore.setState((state) => ({
      mods: state.mods.map((mod) => (
        actionableSet.has(mod.uuid)
          ? { ...mod, enabled: target === 'enable' }
          : mod
      )),
    }))

    const batchResult = target === 'enable'
      ? await useAppStore.getState().enableMods(actionableIds)
      : await useAppStore.getState().disableMods(actionableIds)

    const failed = batchResult?.data?.failed ?? []
    if (failed.length > 0) {
      const failedSet = new Set(failed)
      useAppStore.setState((state) => ({
        mods: state.mods.map((mod) => (
          failedSet.has(mod.uuid)
            ? { ...mod, enabled: prevEnabled.get(mod.uuid) ?? mod.enabled }
            : mod
        )),
      }))
    }

    const changed = actionableIds.length - failed.length
    if (changed > 0) {
      addToast(`${changed} mod${changed === 1 ? '' : 's'} ${target === 'enable' ? 'enabled' : 'disabled'}`, 'success')
    }
    if (failed.length > 0) {
      addToast(`${failed.length} mod${failed.length === 1 ? '' : 's'} failed to ${target}`, 'warning')
    }
  }, [addToast, allMods])

  const runManagedBulkToggle = useCallback(async (modIds: string[], target: BulkToggleTarget) => {
    if (isBulkToggling) return

    setIsBulkToggling(true)
    try {
      await runBulkToggle(modIds, target)
    } finally {
      setIsBulkToggling(false)
    }
  }, [isBulkToggling, runBulkToggle])

  return {
    isBulkToggling,
    runBulkToggle,
    runManagedBulkToggle,
  }
}
