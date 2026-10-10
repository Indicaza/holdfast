import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { loadResource, peekResource, replaceResource, resourceIsFresh } from '../Api/resourceCache.js'
import { useLiveRefresh } from './liveUpdatesContext.js'

function readyState(entry, select) {
  return { status: 'ready', data: select ? select(entry.payload) : entry.payload, error: null, refreshing: false }
}

function initialState(url, enabled, select) {
  if (!enabled || !url) return { status: 'idle', data: null, error: null, refreshing: false }
  const entry = peekResource(url)
  return entry?.payload !== undefined ? readyState(entry, select) : { status: 'loading', data: null, error: null, refreshing: false }
}

// Fetches a JSON resource and keeps it current with live updates.
//
// The resource cache (Api/resourceCache.js) keeps the payload across page
// changes: a page shows what it last had at once and only refetches what a
// live event (or age) marked stale.
//
// A matching live event refetches in the background: the last good data stays
// on screen (status stays 'ready') until the new data arrives, and a failed
// background refresh keeps it. Nothing is unmounted, so whatever the user has
// open (a modal, a tab, a scroll position) survives every update.
//
//   topics   live topics that concern this resource
//   matches  optional (event) => boolean to narrow further, e.g. one entity
//   select   optional (payload) => data
//
// mutate(next | (data) => next) applies a page's own write at once; without
// select, the cache keeps it too.
export function useLiveResource(url, { topics = [], matches = null, select = null, enabled = true } = {}) {
  const [state, setState] = useState(() => initialState(url, enabled, select))
  const [version, setVersion] = useState(0)
  const options = useRef({ select, topics })
  const shownUrl = useRef(null)

  // The latest options, for the effects below (layout effects run first).
  useLayoutEffect(() => {
    options.current = { select, topics }
  })

  useEffect(() => {
    if (!enabled || !url) {
      shownUrl.current = null
      setState({ status: 'idle', data: null, error: null, refreshing: false })
      return undefined
    }
    const { select: currentSelect, topics: currentTopics } = options.current
    const entry = peekResource(url)
    const cached = entry?.payload !== undefined
    // A new resource shows its cached copy (or loads); the same resource
    // keeps what is on screen while it refreshes.
    if (shownUrl.current !== url) {
      setState(cached ? readyState(entry, currentSelect) : { status: 'loading', data: null, error: null, refreshing: false })
      shownUrl.current = url
    }
    if (cached && resourceIsFresh(entry)) return undefined

    let active = true
    if (cached) setState((current) => ({ ...current, refreshing: true }))
    loadResource(url, currentTopics)
      .then((payload) => {
        if (!active) return
        setState(readyState({ payload }, options.current.select))
      })
      .catch((error) => {
        if (!active) return
        setState((current) => (current.status === 'ready'
          ? { ...current, refreshing: false }
          : { status: error?.status === 404 ? 'missing' : 'error', data: null, error, refreshing: false }))
      })
    return () => {
      active = false
    }
  }, [url, enabled, version])

  // A matching live event refetches in the background (the cache marks it
  // stale as the event arrives).
  useLiveRefresh(topics, () => setVersion((current) => current + 1), { matches, enabled: Boolean(enabled && url) })

  const latestData = useRef(state.data)
  useLayoutEffect(() => {
    latestData.current = state.data
  })
  const mutate = useCallback((update) => {
    const next = typeof update === 'function' ? update(latestData.current) : update
    latestData.current = next
    setState((current) => ({ ...current, status: 'ready', data: next }))
    if (url && !options.current.select) replaceResource(url, next)
  }, [url])

  return { ...state, mutate }
}
