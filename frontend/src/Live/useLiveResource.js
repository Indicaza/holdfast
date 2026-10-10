import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useLiveRefresh } from './liveUpdatesContext.js'

// Fetches a JSON resource and keeps it current with live updates.
//
// A matching live event refetches in the background: the last good data stays
// on screen (status stays 'ready') until the new data arrives, and a failed
// background refresh keeps it. Nothing is unmounted, so whatever the user has
// open (a modal, a tab, a scroll position) survives every update.
//
//   topics   live topics that concern this resource
//   matches  optional (event) => boolean to narrow further, e.g. one entity
//   select   optional (payload) => data
export function useLiveResource(url, { topics = [], matches = null, select = null, enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled && url ? 'loading' : 'idle', data: null, error: null, refreshing: false })
  const [version, setVersion] = useState(0)
  const options = useRef({ select })
  const loadedUrl = useRef(null)

  // The latest options, for the effects below (layout effects run first).
  useLayoutEffect(() => {
    options.current = { select }
  })

  // A new resource starts over; the same resource refreshes in place.
  useEffect(() => {
    if (!enabled || !url) {
      loadedUrl.current = null
      setState({ status: 'idle', data: null, error: null, refreshing: false })
      return undefined
    }
    const background = loadedUrl.current === url
    if (!background) setState({ status: 'loading', data: null, error: null, refreshing: false })
    else setState((current) => ({ ...current, refreshing: true }))

    const controller = new AbortController()
    apiJson(url, { signal: controller.signal })
      .then((payload) => {
        loadedUrl.current = url
        const data = options.current.select ? options.current.select(payload) : payload
        setState({ status: 'ready', data, error: null, refreshing: false })
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setState((current) => (background && current.status === 'ready'
          ? { ...current, refreshing: false }
          : { status: error?.status === 404 ? 'missing' : 'error', data: null, error, refreshing: false }))
      })
    return () => controller.abort()
  }, [url, enabled, version])

  // A matching live event refetches in the background (see above).
  useLiveRefresh(topics, () => setVersion((current) => current + 1), { matches, enabled: Boolean(enabled && url) })

  return state
}
