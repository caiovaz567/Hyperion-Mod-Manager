import React, { createContext, useCallback, useContext, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { LOCALES, DEFAULT_LOCALE, type LocaleCode, type Messages } from './locales'

/**
 * Recursively flattens the nested message object into the union of its dot-path
 * leaf keys (e.g. `welcome.steps.game.heading`), derived from `en.json` so the
 * `t()` helper autocompletes and rejects typos. English is the source of truth.
 */
type FlattenKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : FlattenKeys<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type TranslationKey = FlattenKeys<Messages>

type Vars = Record<string, string | number>

const CATALOGS: Record<string, Record<string, unknown>> = Object.fromEntries(
  LOCALES.map((locale) => [locale.code, locale.messages as Record<string, unknown>])
)

function lookup(messages: Record<string, unknown>, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, messages)
  return typeof value === 'string' ? value : undefined
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

interface I18nValue {
  /** Resolve a translation key in the active language, falling back to English. */
  t: (key: TranslationKey, vars?: Vars) => string
  language: LocaleCode
  setLanguage: (code: string) => void
  languages: typeof LOCALES
}

const I18nContext = createContext<I18nValue | null>(null)

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const settingsLanguage = useAppStore((state) => state.settings?.language)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const language: LocaleCode =
    settingsLanguage && CATALOGS[settingsLanguage] ? (settingsLanguage as LocaleCode) : DEFAULT_LOCALE

  const t = useCallback(
    (key: TranslationKey, vars?: Vars): string => {
      const template = lookup(CATALOGS[language], key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key
      return interpolate(template, vars)
    },
    [language]
  )

  const setLanguage = useCallback(
    (code: string) => {
      void updateSettings({ language: code })
    },
    [updateSettings]
  )

  const value = useMemo<I18nValue>(
    () => ({ t, language, setLanguage, languages: LOCALES }),
    [t, language, setLanguage]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useTranslation(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within an I18nProvider')
  return ctx
}
