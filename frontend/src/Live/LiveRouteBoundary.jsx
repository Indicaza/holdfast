import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { matchesLiveTopics, routeTopics } from './liveRouteTopics.js'
import { useLiveUpdates } from './liveUpdatesContext.js'

const DB_REFRESH_DEBOUNCE_MS = 200

export default function LiveRouteBoundary({ children }) {
  const session = useSession()
  const { event } = useLiveUpdates()
  const [version, setVersion] = useState(0)
  const refreshTimer = useRef(null)
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

    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null
      setVersion((current) => current + 1)
    }, DB_REFRESH_DEBOUNCE_MS)

    return undefined
  }, [event, pathname, session.user?.id, topics])

  useEffect(() => () => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
  }, [])

  return <Fragment key={version}>{children}</Fragment>
}
