import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/I18nContext'

/**
 * Compact dark/squared combo box for choosing the interface language. Reused in
 * the first-run setup wizard and in Settings > General. The list scales to any
 * number of locales registered in `i18n/locales.ts`.
 */
export const LanguageSelect: React.FC<{
  align?: 'left' | 'right'
  className?: string
  buttonClassName?: string
}> = ({ align = 'right', className = '', buttonClassName = '' }) => {
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
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language.select')}
        className={`inline-flex h-10 items-center gap-2 rounded-sm border-0 bg-[#101010] px-3 text-[13px] font-medium text-[#e5e2e1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-colors hover:bg-[#161616] ${buttonClassName}`}
      >
        <span className="material-symbols-outlined text-[#9a9a9a]" style={{ fontSize: 17 }}>language</span>
        <span className="truncate">{current.nativeLabel}</span>
        <span
          className={`material-symbols-outlined text-[#777777] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          style={{ fontSize: 18 }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1 min-w-[200px] overflow-hidden rounded-sm border-[0.5px] border-[#262626] bg-[#0c0c0c] py-1 shadow-[0_14px_32px_rgba(0,0,0,0.55)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
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
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[rgba(252,238,9,0.08)] text-[#fcee09]' : 'text-[#cfcfcf] hover:bg-[#161616] hover:text-white'
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium">{locale.nativeLabel}</span>
                  {locale.label !== locale.nativeLabel && (
                    <span className={`truncate text-[11px] ${active ? 'text-[#fcee09]/70' : 'text-[#777777]'}`}>
                      {locale.label}
                    </span>
                  )}
                </span>
                {active && (
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
