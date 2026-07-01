import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Toast, ToastSeverity } from '../../../shared/types'

type StringListUpdater = string[] | ((current: string[]) => string[])

const sameStringList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

export interface DialogState {
  settings: boolean
  about: boolean
  appLogs: boolean
  conflictInspector: boolean
}

export interface UISlice {
  toasts: Toast[]
  dialogs: DialogState
  activeView: 'library' | 'downloads' | 'settings'
  viewHistory: Array<'library' | 'downloads' | 'settings'>
  recentLibraryBadges: Record<string, 'installed' | 'updated' | 'downgraded'>
  collapsedLibrarySeparatorIds: string[]
  conflictHighlight: {
    active: boolean
    focusModId?: string | null
    wins: string[]
    losses: string[]
  }

  addToast: (message: string, severity?: ToastSeverity, duration?: number) => void
  removeToast: (id: string) => void
  openDialog: (name: keyof DialogState) => void
  closeDialog: (name: keyof DialogState) => void
  setActiveView: (view: UISlice['activeView']) => void
  goBack: () => void
  setRecentLibraryBadge: (modId: string, badge: 'installed' | 'updated' | 'downgraded', duration?: number) => void
  clearRecentLibraryBadge: (modId: string) => void
  setCollapsedLibrarySeparatorIds: (next: StringListUpdater) => void
  setConflictHighlight: (focusModId: string, wins: string[], losses: string[]) => void
  clearConflictHighlight: () => void
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  toasts: [],
  dialogs: {
    settings: false,
    about: false,
    appLogs: false,
    conflictInspector: false,
  },
  activeView: 'library',
  viewHistory: [],
  recentLibraryBadges: {},
  collapsedLibrarySeparatorIds: [],
  conflictHighlight: { active: false, focusModId: null, wins: [], losses: [] },

  addToast: (message, severity = 'info', duration = 4000) => {
    const id = uuidv4()
    set((state) => ({
      toasts: [...state.toasts, { id, message, severity, duration }]
    }))
    // Auto-remove after duration
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id)
      }))
    }, duration)
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    })),

  openDialog: (name) =>
    set((state) => ({
      dialogs: { ...state.dialogs, [name]: true }
    })),

  closeDialog: (name) =>
    set((state) => ({
      dialogs: { ...state.dialogs, [name]: false },
      ...(name === 'conflictInspector' ? { conflictHighlight: { active: false, focusModId: null, wins: [], losses: [] } } : {})
    })),

  setActiveView: (activeView) => set((state) => {
    if (state.activeView === activeView) return state

    return {
      activeView,
      viewHistory: [...state.viewHistory, state.activeView],
    }
  }),

  goBack: () => set((state) => {
    if (state.viewHistory.length === 0) return state

    const nextHistory = [...state.viewHistory]
    const previousView = nextHistory.pop() ?? 'library'
    return {
      activeView: previousView,
      viewHistory: nextHistory,
    }
  }),

  setRecentLibraryBadge: (modId, badge, duration = 15000) => {
    set((state) => ({
      recentLibraryBadges: { ...state.recentLibraryBadges, [modId]: badge }
    }))

    setTimeout(() => {
      set((state) => {
        if (!(modId in state.recentLibraryBadges)) return state
        const next = { ...state.recentLibraryBadges }
        delete next[modId]
        return { recentLibraryBadges: next }
      })
    }, duration)
  },

  clearRecentLibraryBadge: (modId) =>
    set((state) => {
      if (!(modId in state.recentLibraryBadges)) return state
      const next = { ...state.recentLibraryBadges }
      delete next[modId]
      return { recentLibraryBadges: next }
    }),

  setCollapsedLibrarySeparatorIds: (next) =>
    set((state) => ({
      collapsedLibrarySeparatorIds:
        typeof next === 'function' ? next(state.collapsedLibrarySeparatorIds) : next,
    })),

  setConflictHighlight: (focusModId, wins, losses) =>
    set((state) => {
      // Idempotent: if the highlight is already exactly this, return the SAME state so
      // Zustand performs no update and no subscriber re-renders. The library highlight
      // effect re-derives fresh `wins`/`losses` arrays on every render, so without this
      // guard a single unstable dependency upstream turned "set highlight" into an
      // infinite render loop — every mod row re-rendering thousands of times per second.
      const current = state.conflictHighlight
      if (
        current.active &&
        current.focusModId === focusModId &&
        sameStringList(current.wins, wins) &&
        sameStringList(current.losses, losses)
      ) {
        return state
      }
      return { conflictHighlight: { active: true, focusModId, wins, losses } }
    }),

  clearConflictHighlight: () =>
    set((state) =>
      state.conflictHighlight.active
        ? { conflictHighlight: { active: false, focusModId: null, wins: [], losses: [] } }
        : state
    ),
})
