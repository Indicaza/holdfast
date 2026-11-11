import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  clampWindow,
  closeInspector,
  inspectorId,
  openInspector,
  raiseInspector,
  readInspectors,
  resetInspectors,
  storeInspectors,
  updateInspector,
} from './marketBrowse.js'

export function viewport() {
  return typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight }
}

// The open item windows, kept for the browser session. Several at once;
// opening an item that is already open focuses its window instead.
export function useInspectors() {
  const [windows, setWindows] = useState(() => readInspectors(viewport()))
  const [focus, setFocus] = useState(null)
  useEffect(() => { storeInspectors(windows) }, [windows])
  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWindows((current) => current.map((win) => clampWindow(win, viewport()))))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(frame) }
  }, [])
  const open = useCallback((item) => {
    setWindows((current) => openInspector(current, item, viewport()).windows)
    setFocus({ id: inspectorId(item), at: Date.now() })
  }, [])
  const raise = useCallback((id) => setWindows((current) => raiseInspector(current, id)), [])
  const update = useCallback((id, patch) => setWindows((current) => updateInspector(current, id, patch, viewport())), [])
  const close = useCallback((id) => setWindows((current) => closeInspector(current, id)), [])
  const reset = useCallback(() => setWindows((current) => resetInspectors(current, viewport())), [])
  const closeAll = useCallback(() => setWindows((current) => current.filter((win) => win.pinned)), [])
  const actions = useMemo(() => ({ open, raise, update, close, reset, closeAll }), [open, raise, update, close, reset, closeAll])
  return { windows, focus, actions }
}
