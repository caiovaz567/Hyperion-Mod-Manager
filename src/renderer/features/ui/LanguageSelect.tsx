import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/I18nContext'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'

/**
 * HeroUI-style combo box for choosing the interface language, reused in the
 * first-run setup wizard and in Settings > General. The list scales to any
 * number of locales registered in `i18n/locales.ts`.
 *
 * `variant="icon"` renders the compact icon-only trigger used in the setup
 * wizard's top-right corner (mirrors HeroUI's docs language picker); the
 * default `full` trigger shows the current language name + chevron.
 */
export const LanguageSelect: React.FC<{
  align?: 'left' | 'right'
  variant?: 'full' | 'icon'
  className?: string
  buttonClassName?: string
}> = ({ align = 'right', variant = 'full', className = '', buttonClassName = '' }) => {
  const { language, setLanguage, languages, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = languages.find((locale) => locale.code === language) ?? languages[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      {variant === 'icon' ? (
        <Tooltip content={t('language.select')} side="bottom">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={t('language.select')}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-[var(--surface)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] ${buttonClassName}`}
          >
            <Icon name="language" style={{ fontSize: 18 }} />
          </button>
        </Tooltip>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('language.select')}
          className={`inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[var(--surface-secondary)] px-3 text-[13px] font-medium text-[var(--text-primary-alt)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-secondary),white_7%)] ${buttonClassName}`}
        >
          <Icon name="language" className="text-[var(--text-support)]" style={{ fontSize: 17 }} />
          <span className="truncate">{current.nativeLabel}</span>
          <Icon name="expand_more" className={`text-[var(--text-muted)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`} style={{ fontSize: 18 }} />
        </button>
      )}

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1 min-w-[210px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--overlay)] py-1.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="px-3.5 pb-1.5 pt-1 text-[12px] font-medium text-[var(--text-muted)]">
            {t('language.choose')}
          </div>
          {languages.map((locale) => {
            const active = locale.code === language
            return (
              <button
                key={locale.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setLanguage(locale.code)
                  setOpen(false)
                }}
                className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {active ? <Icon name="check" style={{ fontSize: 15 }} /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate text-[13px] ${active ? 'font-semibold' : 'font-medium'}`}>{locale.nativeLabel}</span>
                  {locale.label !== locale.nativeLabel && (
                    <span className="truncate text-[11px] text-[var(--text-muted)]">
                      {locale.label}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
