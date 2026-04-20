export interface DeleteProgressAppearance {
  accent: string
  softBorder: string
  fill: string
  rowTint: string
  label: string
  summary: string
  detailFallback: string
}

export const DELETE_PROGRESS_APPEARANCE: DeleteProgressAppearance = {
  accent: '#ff4d4f',
  softBorder: '#4a191a',
  fill: 'linear-gradient(90deg, rgba(255,77,79,0.24) 0%, rgba(255,77,79,0.08) 100%)',
  rowTint: 'rgba(255,77,79,0.05)',
  label: 'Deleting',
  summary: 'Removing files from disk',
  detailFallback: 'Removing deployed files and deleting the library entry',
}

export function getTransientDeleteProgress(startedAt: number, now = Date.now()): number {
  const elapsed = Math.max(0, now - startedAt)
  if (elapsed < 250) return 8
  if (elapsed < 900) return 18 + Math.floor((elapsed - 250) / 24)
  if (elapsed < 2500) return 46 + Math.floor((elapsed - 900) / 48)
  if (elapsed < 7000) return 78 + Math.floor((elapsed - 2500) / 300)
  return 93
}
