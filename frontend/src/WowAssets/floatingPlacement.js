// Where floating boxes (tooltips, popovers) go beside what they describe.

export const VIEWPORT_MARGIN = 12
export const TOOLTIP_GAP = 10

// Where a floating box of `width` × `height` goes beside `anchor` (a
// DOMRect): on the preferred side, else the other side, else below or above
// it when neither side has room (a phone), clamped inside the viewport. It
// never covers its anchor while any placement avoids that.
export function placeFloating(anchor, width, height, side = 'right', viewport = { width: window.innerWidth, height: window.innerHeight }) {
  const maxLeft = viewport.width - width - VIEWPORT_MARGIN
  const maxTop = viewport.height - height - VIEWPORT_MARGIN
  const clampLeft = (value) => Math.max(VIEWPORT_MARGIN, Math.min(value, maxLeft))
  const clampTop = (value) => Math.max(VIEWPORT_MARGIN, Math.min(value, maxTop))
  const below = () => ({ left: clampLeft(anchor.left + anchor.width / 2 - width / 2),
    top: anchor.bottom + TOOLTIP_GAP + height <= viewport.height - VIEWPORT_MARGIN || anchor.top - TOOLTIP_GAP - height < VIEWPORT_MARGIN
      ? clampTop(anchor.bottom + TOOLTIP_GAP) : clampTop(anchor.top - height - TOOLTIP_GAP) })
  if (side === 'top') {
    const top = anchor.top - height - TOOLTIP_GAP
    return top >= VIEWPORT_MARGIN ? { left: clampLeft(anchor.left + anchor.width / 2 - width / 2), top } : below()
  }
  const right = anchor.right + TOOLTIP_GAP
  const leftSide = anchor.left - width - TOOLTIP_GAP
  const fitsRight = right + width <= viewport.width - VIEWPORT_MARGIN
  const fitsLeft = leftSide >= VIEWPORT_MARGIN
  if (!fitsRight && !fitsLeft) return below()
  const left = side === 'left' ? (fitsLeft ? leftSide : right) : (fitsRight ? right : leftSide)
  return { left, top: clampTop(anchor.top) }
}
