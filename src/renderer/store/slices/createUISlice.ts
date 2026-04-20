import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Toast, ToastSeverity } from '../../../shared/types'

export interface DialogState {
  settings: boolean
  about: boolean
  appLogs: boolean
}

export interface UISlice {
  statusMessage: string
  toasts: Toast[]
  dialogs: DialogState
  activeView: 'library' | 'downloads' | 'settings'
  viewHistory: Array<'library' | 'downloads' | 'settings'>

  setStatus: (message: string) => void
  addToast: (message: string, severity?: ToastSeverity, duration?: number) => void
  removeToast: (id: string) => void
  openDialog: (name: keyof DialogState) => void
  closeDialog: (name: keyof DialogState) => void
  setActiveView: (view: UISlice['activeView']) => void
  goBack: () => void
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  statusMessage: 'Ready',
  toasts: [],
  dialogs: {
    settings: false,
    about: false,
    appLogs: false,
  },
  activeView: 'library',
  viewHistory: [],

  setStatus: (message) => set({ statusMessage: message }),

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
      dialogs: { ...state.dialogs, [name]: false }
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
  })
})
