// Fixed library column layout. Columns are NOT user-resizable: every column has
// a width that fits its content (version numbers, category names, the Windows
// timestamp format) and Mod Name flexes to absorb the remaining space - so the
// table always fits the viewport and never shows a permanent horizontal
// scrollbar. Scrolling only appears below the hard minimum total (~1080px
// logical), where nothing readable would fit anyway.
const TOGGLE_WIDTH = 64
const ORDER_WIDTH = 56
const NAME_MIN_WIDTH = 220
const VERSION_WIDTH = 110
const CATEGORY_WIDTH = 220
const DATE_WIDTH = 184
const ACTIONS_WIDTH = 96

export const LIBRARY_GRID_FALLBACK = [
  `${TOGGLE_WIDTH}px`,
  `${ORDER_WIDTH}px`,
  `minmax(${NAME_MIN_WIDTH}px, 1fr)`,
  `${VERSION_WIDTH}px`,
  `${CATEGORY_WIDTH}px`,
  `${DATE_WIDTH}px`,
  `${ACTIONS_WIDTH}px`,
].join(' ')
