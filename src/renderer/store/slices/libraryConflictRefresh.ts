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
    mods: state.mods.map((mod) => ({
      ...mod,
      conflictSummary: summaryMap.get(mod.uuid)
        ? {
            overwrites: summaryMap.get(mod.uuid)!.overwrites,
            overwrittenBy: summaryMap.get(mod.uuid)!.overwrittenBy,
          }
        : { overwrites: 0, overwrittenBy: 0 },
    })),
    conflicts,
  }))
}

const clearConflictState = (set: LibrarySet) => {
  set((state) => ({
    mods: state.mods.map((mod) => ({
      ...mod,
      conflictSummary: { overwrites: 0, overwrittenBy: 0 },
    })),
    conflicts: [],
  }))
}

const runConflictRefresh = async (set: LibrarySet): Promise<void> => {
  try {
    const conflictResult = await IpcService.invoke<IpcResult<ConflictCalculationResult>>(IPC.CALCULATE_MOD_CONFLICTS)
    if (conflictResult.ok && conflictResult.data) {
      applyConflictState(set, conflictResult.data.summaries ?? [], conflictResult.data.conflicts ?? [])
      return
    }
  } catch {
    // Fall through to clear stale state.
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

      activeConflictRefresh = runConflictRefresh(set)
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
