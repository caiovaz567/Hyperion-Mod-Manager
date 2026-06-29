import { useAppStore } from '../store/useAppStore'
import { LOCALES, DEFAULT_LOCALE, type Messages } from './locales'

/**
 * Framework-agnostic translation core. `I18nContext` builds the reactive React
 * hook on top of this, and store slices / other non-React code call `translate`
 * / `translateN` directly (they read the active language from the store at call
 * time via `useAppStore.getState()`).
 */

/** Flattened dot-path leaf keys of `en.json` (source of truth). */
type FlattenKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : FlattenKeys<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type TranslationKey = FlattenKeys<Messages>

export type TranslationVars = Record<string, string | number>

/** Base keys that have both a `_one` and `_other` plural variant in the catalog. */
type StripPluralSuffix<T extends string, S extends string> = T extends `${infer Base}_${S}` ? Base : never
export type PluralKey = StripPluralSuffix<TranslationKey, 'one'> & StripPluralSuffix<TranslationKey, 'other'>

const CATALOGS: Record<string, Record<string, unknown>> = Object.fromEntries(
  LOCALES.map((locale) => [locale.code, locale.messages as Record<string, unknown>])
)

export function isSupportedLanguage(code: string | undefined | null): boolean {
  return Boolean(code && CATALOGS[code])
}

function lookup(messages: Record<string, unknown>, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, messages)
  return typeof value === 'string' ? value : undefined
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

/** Resolve a key for a specific language: active catalog → English → the key itself. */
export function resolveTranslation(language: string, key: string, vars?: TranslationVars): string {
  const active = CATALOGS[language] ?? CATALOGS[DEFAULT_LOCALE]
  const template = lookup(active, key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key
  return interpolate(template, vars)
}

/** Plural variant: looks up `${key}_one` / `${key}_other` and injects `count`. */
export function resolveTranslationN(language: string, key: string, count: number, vars?: TranslationVars): string {
  return resolveTranslation(language, `${key}_${count === 1 ? 'one' : 'other'}`, { count, ...vars })
}

/** The language currently selected in settings (falls back to English). */
export function getActiveLanguage(): string {
  const language = useAppStore.getState().settings?.language
  return isSupportedLanguage(language) ? (language as string) : DEFAULT_LOCALE
}

/** Translate outside React (store slices, utilities). */
export function translate(key: TranslationKey, vars?: TranslationVars): string {
  return resolveTranslation(getActiveLanguage(), key, vars)
}

/** Plural translate outside React. */
export function translateN(key: PluralKey, count: number, vars?: TranslationVars): string {
  return resolveTranslationN(getActiveLanguage(), key, count, vars)
}
