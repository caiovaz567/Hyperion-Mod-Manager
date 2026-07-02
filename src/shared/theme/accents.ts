// Accent color presets — the single user-facing visual customization axis
// (see AppSettings.accentColor). Shared between the renderer (AppThemeProvider /
// the Settings "Color" selector) and the main process (the splash screen tints
// its brand mark and progress bar with the chosen accent).

export interface AccentPreset {
  id: string
  /** Human label — shown in the Settings selector (kept short; not translated). */
  label: string
  /** Base accent (hex). */
  accent: string
  /** Text/icon color that sits on top of the accent fill. */
  foreground: string
  /** Slightly brighter accent for hover states. */
  hover: string
  /** SPACE-separated RGB channels of `accent`, for `rgb(var(--accent-rgb)/opacity)` blends.
   *  Must be space-separated (not commas): `rgb(0, 111, 238/0.2)` is invalid CSS and renders
   *  transparent, whereas `rgb(0 111 238/0.2)` is valid. See CLAUDE.md → UI Theming. */
  rgb: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blue',   label: 'Blue',   accent: '#006FEE', foreground: '#FFFFFF', hover: '#338EF7', rgb: '0 111 238' },
  { id: 'cyan',   label: 'Cyan',   accent: '#00B7FA', foreground: '#00131C', hover: '#40D0FF', rgb: '0 183 250' },
  { id: 'green',  label: 'Green',  accent: '#17C964', foreground: '#00190C', hover: '#45D483', rgb: '23 201 100' },
  { id: 'yellow', label: 'Yellow', accent: '#FCEE09', foreground: '#0A0A0B', hover: '#FFF22A', rgb: '252 238 9' },
  { id: 'orange', label: 'Orange', accent: '#F5A524', foreground: '#160C00', hover: '#F9B94E', rgb: '245 165 36' },
  { id: 'red',    label: 'Red',    accent: '#FF0000', foreground: '#FFFFFF', hover: '#FF3333', rgb: '255 0 0' },
  { id: 'pink',   label: 'Pink',   accent: '#FF4ECD', foreground: '#1A0014', hover: '#FF71D7', rgb: '255 78 205' },
  { id: 'purple', label: 'Purple', accent: '#9353D3', foreground: '#FFFFFF', hover: '#AD7BDE', rgb: '147 83 211' },
]

export const DEFAULT_ACCENT_ID = 'blue'

export function resolveAccent(id: string | undefined): AccentPreset {
  return ACCENT_PRESETS.find((a) => a.id === id) ?? ACCENT_PRESETS[0]
}
