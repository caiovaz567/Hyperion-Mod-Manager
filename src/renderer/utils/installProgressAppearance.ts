export type InstallProgressPhase = 'preparing' | 'extracting' | 'analyzing' | 'installing' | 'done'

export interface InstallProgressAppearance {
  phase: InstallProgressPhase
  accent: string
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
  accent: '#FCEE09',
  softBorder: '#3a3200',
  fill: 'linear-gradient(90deg, rgba(252,238,9,0.22) 0%, rgba(252,238,9,0.09) 100%)',
  rowTint: 'rgba(252,238,9,0.04)',
  label: 'Installing',
  summary: 'Writing files into the mod library',
  detailFallback: 'Copying extracted content and finalizing metadata',
  icon: 'inventory_2',
}

const DONE_APPEARANCE: InstallProgressAppearance = {
  phase: 'done',
  accent: '#34D399',
  softBorder: '#1d3d34',
  fill: 'linear-gradient(90deg, rgba(52,211,153,0.2) 0%, rgba(52,211,153,0.07) 100%)',
  rowTint: 'rgba(52,211,153,0.04)',
  label: 'Done',
  summary: 'Installation completed',
  detailFallback: 'Finalizing the installed mod',
  icon: 'task_alt',
}

export function getInstallProgressAppearance(status?: string): InstallProgressAppearance {
  const normalized = status?.trim().toLowerCase() ?? ''

  if (normalized.includes('done') || normalized.includes('complete')) return DONE_APPEARANCE
  if (normalized.includes('extract') || normalized.includes('reading archive')) return EXTRACTING_APPEARANCE
  if (normalized.includes('detect') || normalized.includes('conflict') || normalized.includes('checking')) {
    return ANALYZING_APPEARANCE
  }
  if (normalized.includes('prepare') || normalized.includes('starting')) return PREPARING_APPEARANCE
  return INSTALLING_APPEARANCE
}

