import type { ModMetadata } from '@shared/types'

const TYPE_LABEL: Record<string, string> = {
  archive: 'Archive',
  redmod: 'REDmod',
  cet: 'CET',
  redscript: 'Redscript',
  tweakxl: 'TweakXL',
  red4ext: 'RED4ext',
  bin: 'Binary',
  engine: 'Engine',
  r6: 'R6 Scripts',
  unknown: 'Unknown',
}

export function getModCategoryLabel(mod: ModMetadata): string {
  const category = mod.nexusCategoryName?.trim()
  if (category) return category
  return TYPE_LABEL[mod.type] ?? 'Unknown'
}
