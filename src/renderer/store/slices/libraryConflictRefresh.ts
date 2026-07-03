import type { StateCreator } from 'zustand'
import { IPC } from '../../../shared/types'
import type { ConflictInfo, IpcResult, ModConflictSummary } from '../../../shared/types'
import { IpcService } from '../../services/IpcService'
import type { LibrarySlice } from './createLibrarySlice'

type LibrarySet = Parameters<StateCreator<LibrarySlice, [], [], LibrarySlice>>[0]

type ConflictCalculationResult = {
  summaries: ModConflictSummary[]
  conflicts: ConflictInfo[]
}

type ConflictCalculationOptions = {
  refreshArchiveResources?: boolean
}

let conflictRefreshTimer: ReturnType<typeof setTimeout> | null = null
let scheduledConflictRefresh: Promise<void> | null = null
let resolveScheduledConflictRefresh: (() => void) | null = null
let activeConflictRefresh: Promise<void> | null = null

export const applyConflictState = (
  set: LibrarySet,
  summaries: ModConflictSummary[],
  conflicts: ConflictInfo[]
) => {
  const summaryMap = new Map(summaries.map((summary) => [summary.modId, summary]))

  set((state) => ({
    mods: state.mods.map((mod) => {
      const summary = summaryMap.get(mod.uuid)
      return {
        ...mod,
        conflictSummary: summary
          ? {
              overwrites: summary.overwrites,
              overwrittenBy: summary.overwrittenBy,
              redundant: Boolean(summary.redundant),
            }
          : { overwrites: 0, overwrittenBy: 0, redundant: false },
      }
    }),
    conflicts,
  }))
}

const clearConflictState = (set: LibrarySet) => {
  set((state) => ({
    mods: state.mods.map((mod) => ({
      ...mod,
      conflictSummary: { overwrites: 0, overwrittenBy: 0, redundant: false },
    })),
    conflicts: [],
  }))
}

const runConflictRefresh = async (
  set: LibrarySet,
  // Fires as soon as conflict badges are visible (after the cheap first pass), so an
  // awaiter - notably the splash/boot - is released BEFORE the slow deep pass. The deep
  // pass can parse .archive files and run external hash tooling (per-archive LXRS /
  // kark resolution), which can take many seconds on a large library or a first-run
  // re-index; blocking the window on it is what froze the splash.
  onBadgesVisible?: () => void
): Promise<void> => {
  let badgesSignaled = false
  const signalBadgesVisible = () => {
    if (badgesSignaled) return
    badgesSignaled = true
    onBadgesVisible?.()
  }

  const requestConflictState = async (
    options: ConflictCalculationOptions
  ): Promise<ConflictCalculationResult | null> => {
    const conflictResult = await IpcService.invoke<IpcResult<ConflictCalculationResult>>(
      IPC.CALCULATE_MOD_CONFLICTS,
      options
    )
    if (conflictResult.ok && conflictResult.data) {
      return conflictResult.data
    }
    return null
  }

  try {
    // First pass is intentionally cheap: use already-indexed sidecars so conflict
    // badges/details show immediately after startup, reorder, enable/disable, etc.
    const quickState = await requestConflictState({ refreshArchiveResources: false })
    if (quickState) {
      applyConflictState(set, quickState.summaries ?? [], quickState.conflicts ?? [])
      // Badges are on screen now - release the awaiter before the potentially slow
      // deep pass so the window never waits on archive (re)indexing.
      signalBadgesVisible()

      // Second pass may parse .archive files and run external hash tooling. It refines
      // paths/counts when ready, but a failure must not erase the visible quick result.
      const deepState = await requestConflictState({ refreshArchiveResources: true })
      if (deepState) {
        applyConflictState(set, deepState.summaries ?? [], deepState.conflicts ?? [])
      }
      return
    }

    // Quick pass produced nothing - don't keep the awaiter blocked on the deep pass.
    signalBadgesVisible()
    const deepState = await requestConflictState({ refreshArchiveResources: true })
    if (deepState) {
      applyConflictState(set, deepState.summaries ?? [], deepState.conflicts ?? [])
      return
    }
  } catch {
    // Fall through to clear stale state only when neither pass produced data.
  } finally {
    // Safety net: never leave an awaiter hanging, even if both passes threw.
    signalBadgesVisible()
  }

  clearConflictState(set)
}

export const scheduleConflictRefresh = (
  set: LibrarySet,
  immediate = false
): Promise<void> => {
  const delay = immediate ? 0 : 80

  if (conflictRefreshTimer !== null) {
    clearTimeout(conflictRefreshTimer)
    conflictRefreshTimer = null
  }

  if (!scheduledConflictRefresh) {
    scheduledConflictRefresh = new Promise<void>((resolve) => {
      resolveScheduledConflictRefresh = resolve
    })
  }

  conflictRefreshTimer = setTimeout(() => {
    conflictRefreshTimer = null
    const finalize = resolveScheduledConflictRefresh
    resolveScheduledConflictRefresh = null
    const currentScheduled = scheduledConflictRefresh
    scheduledConflictRefresh = null

    const execute = async () => {
      if (activeConflictRefresh) {
        await activeConflictRefresh
      }

      // Resolve the scheduled promise as soon as badges are visible (after the cheap
      // first pass), not after the slow deep pass - so awaiters such as the splash/boot
      // aren't blocked on archive (re)indexing. The deep refine still runs to completion
      // as the active refresh; calling `finalize` again below is a harmless no-op.
      activeConflictRefresh = runConflictRefresh(set, finalize ?? undefined)
      try {
        await activeConflictRefresh
      } finally {
        activeConflictRefresh = null
        finalize?.()
      }
    }

    void execute()
    void currentScheduled
  }, delay)

  return scheduledConflictRefresh
}
