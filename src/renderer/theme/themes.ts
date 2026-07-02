import darkPalette from '../../shared/theme/palettes/dark.json'
import lightPalette from '../../shared/theme/palettes/light.json'

// Hyperion's base look tokens. Dark is the default; Light mirrors HeroUI's light scheme
// (the HeroUI component tokens themselves flip by removing the `dark` class from <html>,
// while these cover Hyperion's own legacy identity tokens). The accent color (accents.ts)
// is applied as an overlay on top of either mode by AppThemeProvider.
export const BASE_THEME_TOKENS: Record<string, string> = darkPalette.tokens
export const LIGHT_THEME_TOKENS: Record<string, string> = lightPalette.tokens
