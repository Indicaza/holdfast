import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { matchesLiveTopics, routeTopics } from './liveRouteTopics.js'
import { useLiveUpdates } from './liveUpdatesContext.js'

const LIVE_REFRESH_DEBOUNCE_MS = 200

export default function LiveRouteBoundary({ children }) {
  const session = useSession()
  const { event } = useLiveUpdates()
  const [version, setVersion] = useState(0)
  const pendingIntelligenceRefresh = useRef(false)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const hash = window.location.hash
  const topics = useMemo(() => routeTopics(pathname, hash), [pathname, hash])

  useEffect(() => {
    function flushIntelligenceRefresh() {
      if (!pendingIntelligenceRefresh.current) return
      pendingIntelligenceRefresh.current = false
      setVersion((current) => current + 1)
    }

    window.addEventListener('holdfast:intelligence-modal-closed', flushIntelligenceRefresh)
    return () => window.removeEventListener('holdfast:intelligence-modal-closed', flushIntelligenceRefresh)
  }, [])

  useEffect(() => {
    if (!event || !matchesLiveTopics(event.topics, topics)) return undefined
    if (event.actorId && event.actorId === session.user?.id) return undefined

    if (pathname === '/quests') {
      window.dispatchEvent(new Event('holdfast:quests-changed'))
      return undefined
    }

    const timer = window.setTimeout(() => {
      if (pathname === '/intelligence') {
        // An open Armory modal consumes this cancelable event and refreshes its
        // character in place. That preserves the selected character, tab and
        // scroll state while telemetry is arriving. Once the modal closes we
        // perform the normal route refresh so the character list/summary also
        // catches up with everything received while the user was inspecting it.
        const refresh = new CustomEvent('holdfast:intelligence-changed', { detail: event, cancelable: true })
        window.dispatchEvent(refresh)
        if (refresh.defaultPrevented) {
          pendingIntelligenceRefresh.current = true
          return
        }
      }
      setVersion((current) => current + 1)
    }, LIVE_REFRESH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [event, pathname, session.user?.id, topics])

  return <Fragment key={version}>{children}</Fragment>
}
