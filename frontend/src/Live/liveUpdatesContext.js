import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { matchesLiveTopics } from './liveTopics.js'

// status: the live connection's state. subscribe(listener): calls the listener
// with every live event and returns the unsubscribe. Events are delivered one
// by one rather than held in state, so several arriving together are never
// collapsed into the last one, and nothing rerenders until a listener acts.
export const LiveUpdatesContext = createContext({
  status: 'offline',
  subscribe: () => () => {},
})

export function useLiveUpdates() {
  return useContext(LiveUpdatesContext)
}

// Runs onEvent for every live event, always with the latest onEvent.
export function useLiveEvents(onEvent) {
  const { subscribe } = useLiveUpdates()
  const latest = useRef(onEvent)
  useLayoutEffect(() => {
    latest.current = onEvent
  })
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe])
}

// Calls refresh once per burst of live events about these topics (a
// reconnect, '*', always counts). matches(event) can narrow further.
export function useLiveRefresh(topics, refresh, { matches = null, enabled = true, debounceMs = 300 } = {}) {
  const timer = useRef(null)
  const latest = useRef({ topics, refresh, matches, enabled })
  useLayoutEffect(() => {
    latest.current = { topics, refresh, matches, enabled }
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useLiveEvents((event) => {
    const { topics: wanted, matches: narrow, enabled: on } = latest.current
    if (!on || !matchesLiveTopics(event.topics, wanted)) return
    if (narrow && !event.topics.includes('*') && !narrow(event)) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => latest.current.refresh(event), debounceMs)
  })
}
