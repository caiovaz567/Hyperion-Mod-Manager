import React from 'react'
import { useTranslation } from '../../i18n/I18nContext'
import { useTheme } from '../../theme/ThemeContext'
import { Icon } from './Icon'

/**
 * Accent color picker - a row of color swatches (like HeroUI's own docs demo). Picking one
 * recolors the whole app live (the accent is applied as an overlay on top of the active
 * theme by AppThemeProvider). Accent is a separate axis from the theme, so any color works
 * with Dark, Clean, or any community theme.
 */
export const AccentSelect: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { t } = useTranslation()
  const { accentId, setAccentId, accents } = useTheme()

  return (
    <div
      className={`flex flex-wrap items-center gap-2.5 ${className}`}
      role="group"
      aria-label={t('settings.general.accent.select')}
    >
      {accents.map((accent) => {
        const active = accent.id === accentId
        return (
          <button
            key={accent.id}
            type="button"
            onClick={() => setAccentId(accent.id)}
            aria-label={accent.label}
            aria-pressed={active}
            title={accent.label}
            className="relative flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 focus:outline-none"
            style={{
              background: accent.accent,
              boxShadow: active
                ? `0 0 0 2px var(--bg-base), 0 0 0 4px ${accent.accent}`
                : 'inset 0 0 0 1px rgba(255,255,255,0.12)',
            }}
          >
            {active && (
              <Icon name="check" className="text-[16px]" style={{ color: accent.foreground }} />
            )}
          </button>
        )
      })}
    </div>
  )
}
