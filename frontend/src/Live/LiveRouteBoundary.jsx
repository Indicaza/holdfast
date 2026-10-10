import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { matchesLiveTopics, refreshesInPlace, routeTopics } from './liveRouteTopics.js'
import { useLiveUpdates } from './liveUpdatesContext.js'

const LIVE_REFRESH_DEBOUNCE_MS = 200

// Re-renders a route from scratch when its data changes, for pages that load
// their data once on mount. Pages that keep their data current themselves
// (refreshesInPlace) are left alone.
export default function LiveRouteBoundary({ children }) {
  const session = useSession()
  const { event } = useLiveUpdates()
  const [version, setVersion] = useState(0)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const hash = window.location.hash
  const topics = useMemo(() => routeTopics(pathname, hash), [pathname, hash])
  const inPlace = refreshesInPlace(pathname, hash)

  useEffect(() => {
    if (inPlace || !event || !matchesLiveTopics(event.topics, topics)) return undefined
    if (event.actorId && event.actorId === session.user?.id) return undefined

    if (pathname === '/quests') {
      window.dispatchEvent(new Event('holdfast:quests-changed'))
      return undefined
    }

    const timer = window.setTimeout(() => setVersion((current) => current + 1), LIVE_REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [event, inPlace, pathname, session.user?.id, topics])

  return <Fragment key={version}>{children}</Fragment>
}
