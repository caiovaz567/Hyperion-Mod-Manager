export type LibraryResizableColumnKey = 'version' | 'category' | 'date'

type LibraryColumnKey = 'name' | LibraryResizableColumnKey

export type LibraryColumnWidths = Record<LibraryColumnKey, number>
export type StoredLibraryColumnWidths = Partial<LibraryColumnWidths>

export const LIBRARY_COLUMN_DEFAULTS: LibraryColumnWidths = {
  name: 480,
  version: 110,
  category: 220,
  date: 184,
}

const LIMITS: Record<LibraryColumnKey, { min: number; max: number }> = {
  name: { min: 220, max: 4000 },
  version: { min: 104, max: 4000 },
  category: { min: 180, max: 4000 },
  date: { min: 176, max: 4000 },
}

const RESIZE_PREVIOUS_COLUMN: Record<LibraryResizableColumnKey, LibraryColumnKey> = {
  version: 'name',
  category: 'version',
  date: 'category',
}

const TOGGLE_WIDTH = 64
const ORDER_WIDTH = 56
const ACTIONS_WIDTH = 96
const COLUMN_GAP = 16
const ROW_PADDING_X = 40

export function clampColumnWidth(key: LibraryColumnKey, value: number): number {
  const { min, max } = LIMITS[key]
  if (!Number.isFinite(value)) return LIBRARY_COLUMN_DEFAULTS[key]
  return Math.round(Math.max(min, Math.min(max, value)))
}

export function applyColumnResize(
  start: LibraryColumnWidths,
  key: LibraryResizableColumnKey,
  deltaPx: number,
): LibraryColumnWidths {
  const previousColumn = RESIZE_PREVIOUS_COLUMN[key]
  const trailingColumn = 'date'

  const previousLimits = LIMITS[previousColumn]
  const trailingLimits = LIMITS[trailingColumn]
  const minDelta = Math.max(
    previousLimits.min - start[previousColumn],
    start[trailingColumn] - trailingLimits.max,
  )
  const maxDelta = Math.min(
    previousLimits.max - start[previousColumn],
    start[trailingColumn] - trailingLimits.min,
  )
  const boundedDelta = Math.round(Math.max(minDelta, Math.min(maxDelta, deltaPx)))

  return {
    ...start,
    [previousColumn]: start[previousColumn] + boundedDelta,
    [trailingColumn]: start[trailingColumn] - boundedDelta,
  }
}

export function fitNameWidthToContainer(containerWidth: number, widths: LibraryColumnWidths): number {
  const fixedColumns = TOGGLE_WIDTH + ORDER_WIDTH + widths.version + widths.category + widths.date + ACTIONS_WIDTH
  const gaps = COLUMN_GAP * 6
  return clampColumnWidth('name', containerWidth - ROW_PADDING_X - gaps - fixedColumns)
}

export function hasStoredColumnWidths(stored?: StoredLibraryColumnWidths): boolean {
  return typeof stored?.name === 'number'
}

export function readLibraryColumnWidths(stored?: StoredLibraryColumnWidths): LibraryColumnWidths {
  return {
    name: clampColumnWidth('name', stored?.name ?? LIBRARY_COLUMN_DEFAULTS.name),
    version: clampColumnWidth('version', stored?.version ?? LIBRARY_COLUMN_DEFAULTS.version),
    category: clampColumnWidth('category', stored?.category ?? LIBRARY_COLUMN_DEFAULTS.category),
    date: clampColumnWidth('date', stored?.date ?? LIBRARY_COLUMN_DEFAULTS.date),
  }
}

export function areLibraryColumnWidthsEqual(
  left?: StoredLibraryColumnWidths,
  right?: StoredLibraryColumnWidths,
): boolean {
  if (!left || !right) return false
  return left.name === right.name &&
    left.version === right.version &&
    left.category === right.category &&
    left.date === right.date
}

export function buildLibraryGridTemplate(widths: LibraryColumnWidths): string {
  return [
    `${TOGGLE_WIDTH}px`,
    `${ORDER_WIDTH}px`,
    `minmax(${widths.name}px, 1fr)`,
    `${widths.version}px`,
    `${widths.category}px`,
    `${widths.date}px`,
    `${ACTIONS_WIDTH}px`,
  ].join(' ')
}

export const LIBRARY_GRID_FALLBACK = buildLibraryGridTemplate(LIBRARY_COLUMN_DEFAULTS)
