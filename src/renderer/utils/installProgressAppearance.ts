import { translate } from '../i18n/translate'

export type InstallProgressPhase = 'preparing' | 'extracting' | 'analyzing' | 'installing' | 'done'

export interface InstallProgressAppearance {
  phase: InstallProgressPhase
  accent: string
  // Pre-built low-opacity companions. `accent` may be a var() reference (the installing
  // phase follows the user accent), so hex concatenation like `${accent}18` is invalid
  // CSS there and must never be used - read these instead.
  soft: string
  glow: string
  softBorder: string
  fill: string
  rowTint: string
  label: string
  summary: string
  detailFallback: string
  icon: string
}

const PREPARING_APPEARANCE: InstallProgressAppearance = {
  phase: 'preparing',
  accent: '#60A5FA',
  soft: 'rgba(96,165,250,0.14)',
  glow: 'rgba(96,165,250,0.33)',
  softBorder: '#1f3554',
  fill: 'linear-gradient(90deg, rgba(96,165,250,0.2) 0%, rgba(96,165,250,0.07) 100%)',
  rowTint: 'rgba(96,165,250,0.04)',
  label: 'Preparing',
  summary: 'Preparing install workspace',
  detailFallback: 'Opening the archive and preparing the install session',
  icon: 'deployed_code_history',
}

const EXTRACTING_APPEARANCE: InstallProgressAppearance = {
  phase: 'extracting',
  accent: '#4FD8FF',
  soft: 'rgba(79,216,255,0.14)',
  glow: 'rgba(79,216,255,0.33)',
  softBorder: '#164552',
  fill: 'linear-gradient(90deg, rgba(79,216,255,0.22) 0%, rgba(79,216,255,0.08) 100%)',
  rowTint: 'rgba(79,216,255,0.045)',
  label: 'Extracting',
  summary: 'Extracting package contents',
  detailFallback: 'Reading files directly from the archive',
  icon: 'folder_zip',
}

const ANALYZING_APPEARANCE: InstallProgressAppearance = {
  phase: 'analyzing',
  accent: '#7CC7FF',
  soft: 'rgba(124,199,255,0.14)',
  glow: 'rgba(124,199,255,0.33)',
  softBorder: '#233c53',
  fill: 'linear-gradient(90deg, rgba(124,199,255,0.2) 0%, rgba(124,199,255,0.07) 100%)',
  rowTint: 'rgba(124,199,255,0.04)',
  label: 'Analyzing',
  summary: 'Inspecting extracted payload',
  detailFallback: 'Detecting mod structure and checking for conflicts',
  icon: 'manage_search',
}

const INSTALLING_APPEARANCE: InstallProgressAppearance = {
  phase: 'installing',
  accent: 'var(--accent)',
  soft: 'rgb(var(--accent-rgb) / 0.14)',
  glow: 'rgb(var(--accent-rgb) / 0.33)',
  softBorder: 'rgb(var(--accent-rgb) / 0.3)',
  fill: 'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.22) 0%, rgb(var(--accent-rgb) / 0.09) 100%)',
  rowTint: 'rgb(var(--accent-rgb) / 0.04)',
  label: 'Installing',
  summary: 'Writing files into the mod library',
  detailFallback: 'Copying extracted content and finalizing metadata',
  icon: 'inventory_2',
}

const DONE_APPEARANCE: InstallProgressAppearance = {
  phase: 'done',
  accent: '#34D399',
  soft: 'rgba(52,211,153,0.14)',
  glow: 'rgba(52,211,153,0.33)',
  softBorder: '#1d3d34',
  fill: 'linear-gradient(90deg, rgba(52,211,153,0.2) 0%, rgba(52,211,153,0.07) 100%)',
  rowTint: 'rgba(52,211,153,0.04)',
  label: 'Done',
  summary: 'Installation completed',
  detailFallback: 'Finalizing the installed mod',
  icon: 'task_alt',
}

// Overlay text is localized at call time (translate() reads the active language
// from the store); the consuming components re-render on language change.
function withTranslatedText(base: InstallProgressAppearance): InstallProgressAppearance {
  return {
    ...base,
    label: translate(`downloads.install.${base.phase}.label`),
    summary: translate(`downloads.install.${base.phase}.summary`),
    detailFallback: translate(`downloads.install.${base.phase}.detail`),
  }
}

export function getInstallProgressAppearance(status?: string): InstallProgressAppearance {
  const normalized = status?.trim().toLowerCase() ?? ''

  if (normalized.includes('done') || normalized.includes('complete')) return withTranslatedText(DONE_APPEARANCE)
  if (normalized.includes('extract') || normalized.includes('reading archive')) return withTranslatedText(EXTRACTING_APPEARANCE)
  if (normalized.includes('detect') || normalized.includes('conflict') || normalized.includes('checking')) {
    return withTranslatedText(ANALYZING_APPEARANCE)
  }
  if (normalized.includes('prepare') || normalized.includes('starting')) return withTranslatedText(PREPARING_APPEARANCE)
  return withTranslatedText(INSTALLING_APPEARANCE)
}

