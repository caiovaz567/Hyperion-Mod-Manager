// Renderer side of the accent system. The preset data lives in src/shared/theme/accents.ts
// (also used by the main-process splash screen); this module adds the CSS-token mapping
// applied by AppThemeProvider.
//
// Each preset drives BOTH HeroUI v3 (which reads --accent / --accent-foreground straight from
// the root element) and Hyperion's own legacy tokens (--accent-hover, --accent-dim,
// --accent-rgb, --text-accent, --border-accent, --focus-ring), so a single choice recolors
// the whole app live.

export { ACCENT_PRESETS, DEFAULT_ACCENT_ID, resolveAccent, type AccentPreset } from '../../shared/theme/accents'
import type { AccentPreset } from '../../shared/theme/accents'

/** Maps an accent preset to the CSS custom properties it overrides on the root element. */
export function accentTokens(preset: AccentPreset): Record<string, string> {
  return {
    '--accent': preset.accent,
    '--accent-foreground': preset.foreground,
    '--accent-hover': preset.hover,
    '--accent-dim': `rgb(${preset.rgb} / 0.12)`,
    '--accent-rgb': preset.rgb,
    '--text-accent': preset.hover,
    '--border-accent': `rgb(${preset.rgb} / 0.5)`,
    '--focus-ring': `rgb(${preset.rgb} / 0.6)`,
  }
}
