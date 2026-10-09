import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { matchesLiveTopics, routeTopics } from './liveRouteTopics.js'
import { useLiveUpdates } from './liveUpdatesContext.js'

const LIVE_REFRESH_DEBOUNCE_MS = 200

export default function LiveRouteBoundary({ children }) {
  const session = useSession()
  const { event } = useLiveUpdates()
  const [version, setVersion] = useState(0)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const hash = window.location.hash
  const topics = useMemo(() => routeTopics(pathname, hash), [pathname, hash])

  useEffect(() => {
    if (!event || !matchesLiveTopics(event.topics, topics)) return undefined
    if (event.actorId && event.actorId === session.user?.id) return undefined

    if (pathname === '/quests') {
      window.dispatchEvent(new Event('holdfast:quests-changed'))
      return undefined
    }

    const timer = window.setTimeout(() => {
      // Intelligence owns substantial local UI state: selected character,
      // modal tab, search text and scroll position. Remounting the whole route
      // on telemetry invalidation used to erase that state and could close a
      // character while the user was inspecting it. Let Intelligence refresh
      // its DB-backed data in place instead.
      if (pathname === '/intelligence') {
        window.dispatchEvent(new CustomEvent('holdfast:intelligence-changed', { detail: event }))
        return
      }
      setVersion((current) => current + 1)
    }, LIVE_REFRESH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [event, pathname, session.user?.id, topics])

  return <Fragment key={version}>{children}</Fragment>
}
