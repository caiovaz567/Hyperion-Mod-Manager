import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { BASE_THEME_TOKENS, LIGHT_THEME_TOKENS } from './themes'
import { ACCENT_PRESETS, accentTokens, resolveAccent, type AccentPreset } from './accents'

export type UiMode = 'light' | 'dark' | 'system'

interface ThemeValue {
  /** The stored preference (light / dark / system). */
  mode: UiMode
  /** What is actually rendered right now (system resolved against the OS). */
  resolvedMode: 'light' | 'dark'
  setMode: (mode: UiMode) => void
  accentId: string
  setAccentId: (id: string) => void
  accents: AccentPreset[]
}

const ThemeContext = createContext<ThemeValue | null>(null)

// Applies the base tokens (dark, overlaid with the light palette in light mode) plus the
// chosen accent overlay as inline custom properties on <html>, and flips HeroUI's own
// component tokens by toggling the `dark` class. The accent overlay is applied LAST so
// the selected color always wins.
function applyThemeTokens(resolvedMode: 'light' | 'dark', accentOverlay: Record<string, string>): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolvedMode === 'dark')
  const merged = {
    ...BASE_THEME_TOKENS,
    ...(resolvedMode === 'light' ? LIGHT_THEME_TOKENS : {}),
    ...accentOverlay,
  }
  for (const [key, value] of Object.entries(merged)) {
    root.style.setProperty(key, value)
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const settingsUiMode = useAppStore((state) => state.settings?.uiMode)
  const settingsAccentId = useAppStore((state) => state.settings?.accentColor)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [osPrefersDark, setOsPrefersDark] = useState(() => systemPrefersDark())

  const mode: UiMode = settingsUiMode === 'light' || settingsUiMode === 'dark' ? settingsUiMode : 'system'
  const resolvedMode: 'light' | 'dark' = mode === 'system' ? (osPrefersDark ? 'dark' : 'light') : mode

  const resolvedAccent = resolveAccent(settingsAccentId)
  const accentId = resolvedAccent.id

  // Follow live OS scheme changes while in system mode.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setOsPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyThemeTokens(resolvedMode, accentTokens(resolvedAccent))
  }, [resolvedMode, resolvedAccent])

  const setMode = useCallback(
    (nextMode: UiMode) => {
      void updateSettings({ uiMode: nextMode })
    },
    [updateSettings]
  )

  const setAccentId = useCallback(
    (id: string) => {
      void updateSettings({ accentColor: id })
    },
    [updateSettings]
  )

  const value = useMemo<ThemeValue>(
    () => ({ mode, resolvedMode, setMode, accentId, setAccentId, accents: ACCENT_PRESETS }),
    [mode, resolvedMode, setMode, accentId, setAccentId]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within an AppThemeProvider')
  return ctx
}
