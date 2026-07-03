import en from './locales/en.json'
import ptBR from './locales/pt-BR.json'

/**
 * The list of supported interface languages.
 *
 * ── Adding a new language ──────────────────────────────────────────────────
 * 1. Copy `locales/en.json` to `locales/<code>.json` (e.g. `fr.json`) and
 *    translate the values. Keys that are left out fall back to English at
 *    runtime, so a partial translation still works.
 * 2. `import` it above and add one entry to the `LOCALES` array below with its
 *    BCP-47 `code`, an English `label`, and the `nativeLabel` (the language
 *    name written in that language).
 * That is the only code change required - `en.json` stays the source of truth
 * for the available translation keys.
 */
export const LOCALES = [
  { code: 'en', label: 'English', nativeLabel: 'English', messages: en },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)', messages: ptBR },
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

export const DEFAULT_LOCALE: LocaleCode = 'en'

export type Messages = typeof en
