// Where a tooltip goes: beside its anchor on the side asked for, flipped to
// the other side when it does not fit, and kept inside the viewport.

const GAP = 8
const MARGIN = 8

export function placeTip(anchor, tip, side, viewport) {
  const { width, height } = tip
  const vw = viewport.width
  const vh = viewport.height
  let left
  let top
  let actual
  if (side === 'right' || side === 'left') {
    const fitsRight = anchor.right + GAP + width <= vw - MARGIN
    const fitsLeft = anchor.left - GAP - width >= MARGIN
    actual = side === 'right' ? (fitsRight || !fitsLeft ? 'right' : 'left') : (fitsLeft || !fitsRight ? 'left' : 'right')
    left = actual === 'right' ? anchor.right + GAP : anchor.left - GAP - width
    top = anchor.top + anchor.height / 2 - height / 2
  } else {
    const fitsTop = anchor.top - GAP - height >= MARGIN
    const fitsBottom = anchor.bottom + GAP + height <= vh - MARGIN
    actual = side === 'top' ? (fitsTop || !fitsBottom ? 'top' : 'bottom') : (fitsBottom || !fitsTop ? 'bottom' : 'top')
    top = actual === 'top' ? anchor.top - GAP - height : anchor.bottom + GAP
    left = anchor.left + anchor.width / 2 - width / 2
  }
  return {
    left: Math.round(Math.max(MARGIN, Math.min(left, vw - width - MARGIN))),
    top: Math.round(Math.max(MARGIN, Math.min(top, vh - height - MARGIN))),
    side: actual,
  }
}
