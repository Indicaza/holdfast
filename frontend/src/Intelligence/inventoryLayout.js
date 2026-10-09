// Sizing for the Inventory tab's bag windows, in the game's own pixels: 37px
// slots 5px apart, 9px window padding, and the portrait frame's art reaching
// past the window box (13px left, 4px right, 16px up, 3px down).

export const SLOT = 37
const SLOT_GAP = 5
const WINDOW_PADDING = 9
const FRAME_OVERHANG = 17
const FRAME_OVERHANG_VERTICAL = 19
const PANE_PADDING = 8
const MAX_SCALE = 1.8
const SCROLLING_SCALE = 1.3
const WINDOW_GAP = 18
export const SIDE_COLUMNS = 4
const MAX_COLUMNS = 10
const MIN_COLUMNS = 4

function windowWidth(columns) {
  return columns * SLOT + (columns - 1) * SLOT_GAP + WINDOW_PADDING * 2 + FRAME_OVERHANG
}

// The pane's fallback when even 1x does not fit: as many columns as the width
// allows, side windows wrapping underneath.
function fittedColumns(paneWidth) {
  const fit = Math.floor((paneWidth - PANE_PADDING * 2 - WINDOW_PADDING * 2 - FRAME_OVERHANG + SLOT_GAP) / (SLOT + SLOT_GAP))
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fit))
}

function gridHeight(slots, columns) {
  const rows = Math.max(1, Math.ceil(slots / columns))
  return rows * SLOT + (rows - 1) * SLOT_GAP
}

// The window's outer size at 1x, frame art included: the combined window
// adds the search row and money line under its title band.
function windowSize(window, columns) {
  const chrome = window.kind === 'combined' ? 30 + 29 + 31 + 10 : 40 + 10
  return { width: windowWidth(columns), height: chrome + gridHeight(window.slots.length, columns) + FRAME_OVERHANG_VERTICAL }
}

// Sizes the windows to fill the pane: tries every column count for the
// combined window, with the side windows beside it or underneath, and keeps
// the arrangement that draws the slots largest (capped so the art stays crisp).
export function windowsLayout(windows, pane) {
  const combined = windows.find((window) => window.kind === 'combined')
  const sides = windows.filter((window) => window !== combined)
  if (!pane.width || !pane.height) return { columns: MAX_COLUMNS, scale: 1, stacked: false }

  const sideSizes = sides.map((window) => windowSize(window, SIDE_COLUMNS))
  const sidesWidth = sideSizes.reduce((sum, size) => sum + size.width, 0) + WINDOW_GAP * Math.max(0, sideSizes.length - 1)
  const sidesHeight = Math.max(0, ...sideSizes.map((size) => size.height))
  let best = null
  // Widest first, so ties (often both at the size cap) keep more columns, like
  // the game's wide combined bag.
  for (let columns = MAX_COLUMNS; columns >= MIN_COLUMNS; columns -= 1) {
    const main = combined ? windowSize(combined, columns) : { width: 0, height: 0 }
    const arrangements = [
      { stacked: false, width: main.width + (sides.length ? WINDOW_GAP + sidesWidth : 0), height: Math.max(main.height, sidesHeight) },
      ...(sides.length && combined ? [{ stacked: true, width: Math.max(main.width, sidesWidth), height: main.height + WINDOW_GAP + sidesHeight }] : []),
    ]
    for (const arrangement of arrangements) {
      // The padding is zoomed with the windows; a pixel spare absorbs rounding.
      const scale = Math.min(
        MAX_SCALE,
        (pane.width - 1) / (arrangement.width + PANE_PADDING * 2),
        (pane.height - 1) / (arrangement.height + PANE_PADDING * 2),
      )
      if (!best || scale > best.scale + 0.01) best = { columns, scale, stacked: arrangement.stacked }
    }
  }

  if (best.scale >= 1) return best

  // Too tall to fit whole: size the slots for touch (about 1.3x), fill the
  // width and let the pane scroll.
  const columns = fittedColumns(pane.width / SCROLLING_SCALE)
  const width = Math.max(combined ? windowSize(combined, columns).width : 0, sidesWidth)
  return { columns, scale: Math.max(1, Math.min(MAX_SCALE, (pane.width - 1) / (width + PANE_PADDING * 2))), stacked: true }
}

