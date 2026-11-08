import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { placeTip } from './tooltipModel.js'

// The app's one hover tooltip: a short label beside a control. It waits a
// moment on hover (no delay once another tooltip has just been open, so
// sweeping across a toolbar reads every label), shows at once on keyboard
// focus, and goes away on leave, blur, scroll, a press or Escape. Rendered
// in document.body so no panel clips it.

const OPEN_DELAY = 380
const WARM_FOR = 400
let warmUntil = 0
// One pending open at a time: hovering another control cancels the last.
let pending = 0

function keyboardFocus(event) {
  try {
    return event.target.matches(':focus-visible')
  } catch {
    return true
  }
}

// <Tip label="…"><button …/></Tip>. The child must be one DOM element (or a
// component that passes its props and ref through). `shortcut` adds a key
// hint; `side` is top (default), bottom, left or right, flipped to fit.
export default function Tip({ label, shortcut, side = 'top', disabled = false, children }) {
  const id = useId()
  const [anchor, setAnchor] = useState(null)

  const close = useCallback(() => {
    window.clearTimeout(pending)
    setAnchor((current) => {
      if (current) warmUntil = performance.now() + WARM_FOR
      return null
    })
  }, [])

  const open = useCallback((element, now) => {
    window.clearTimeout(pending)
    const show = () => {
      if (element.isConnected) setAnchor(element.getBoundingClientRect())
    }
    if (now || performance.now() < warmUntil) show()
    else pending = window.setTimeout(show, OPEN_DELAY)
  }, [])

  useEffect(() => {
    if (!anchor) return undefined
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, close])

  // A tooltip turned off while showing (a sidebar expanding) goes at once.
  useEffect(() => {
    if (disabled || !label) close()
  }, [disabled, label, close])

  const child = Children.only(children)
  if (!isValidElement(child) || !label || disabled) return child

  const props = child.props
  return (
    <>
      {cloneElement(child, {
        'aria-describedby': anchor ? [props['aria-describedby'], id].filter(Boolean).join(' ') : props['aria-describedby'],
        onPointerEnter: (event) => {
          props.onPointerEnter?.(event)
          if (event.pointerType !== 'touch') open(event.currentTarget, false)
        },
        onPointerLeave: (event) => {
          props.onPointerLeave?.(event)
          close()
        },
        onFocus: (event) => {
          props.onFocus?.(event)
          if (keyboardFocus(event)) open(event.currentTarget, true)
        },
        onBlur: (event) => {
          props.onBlur?.(event)
          close()
        },
      })}
      {anchor && typeof document !== 'undefined' ? <Bubble id={id} anchor={anchor} side={side} label={label} shortcut={shortcut} /> : null}
    </>
  )
}

function Bubble({ id, anchor, side, label, shortcut }) {
  const ref = useRef(null)
  const [spot, setSpot] = useState(null)
  useLayoutEffect(() => {
    if (ref.current) setSpot(placeTip(anchor, { width: ref.current.offsetWidth, height: ref.current.offsetHeight }, side, { width: window.innerWidth, height: window.innerHeight }))
  }, [anchor, side, label])
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`gw-tip${spot ? ` gw-tip--${spot.side} is-shown` : ''}`}
      style={spot ? { left: spot.left, top: spot.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </div>,
    document.body,
  )
}
