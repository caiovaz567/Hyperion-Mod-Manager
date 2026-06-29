import React, { createContext, useCallback, useContext, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { LOCALES, DEFAULT_LOCALE, type LocaleCode } from './locales'
import {
  resolveTranslation,
  resolveTranslationN,
  isSupportedLanguage,
  type TranslationKey,
  type TranslationVars,
  type PluralKey,
} from './translate'

export type { TranslationKey, PluralKey, TranslationVars } from './translate'

interface I18nValue {
  /** Resolve a translation key in the active language, falling back to English. */
  t: (key: TranslationKey, vars?: TranslationVars) => string
  /** Plural-aware translate: picks `${key}_one` / `${key}_other` based on `count`. */
  tn: (key: PluralKey, count: number, vars?: TranslationVars) => string
  language: LocaleCode
  setLanguage: (code: string) => void
  languages: typeof LOCALES
}

const I18nContext = createContext<I18nValue | null>(null)

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const settingsLanguage = useAppStore((state) => state.settings?.language)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const language: LocaleCode = isSupportedLanguage(settingsLanguage)
    ? (settingsLanguage as LocaleCode)
    : DEFAULT_LOCALE

  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars): string => resolveTranslation(language, key, vars),
    [language]
  )

  const tn = useCallback(
    (key: PluralKey, count: number, vars?: TranslationVars): string =>
      resolveTranslationN(language, key, count, vars),
    [language]
  )

  const setLanguage = useCallback(
    (code: string) => {
      void updateSettings({ language: code })
    },
    [updateSettings]
  )

  const value = useMemo<I18nValue>(
    () => ({ t, tn, language, setLanguage, languages: LOCALES }),
    [t, tn, language, setLanguage]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useTranslation(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within an I18nProvider')
  return ctx
}
