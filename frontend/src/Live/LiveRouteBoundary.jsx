import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { matchesLiveTopics, routeTopics } from './liveRouteTopics.js'
import { useLiveUpdates } from './liveUpdatesContext.js'

export default function LiveRouteBoundary({ children }) {
  const session = useSession()
  const { event } = useLiveUpdates()
  const [version, setVersion] = useState(0)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const hash = window.location.hash
  const topics = useMemo(() => routeTopics(pathname, hash), [pathname, hash])

  useEffect(() => {
    if (!event || !matchesLiveTopics(event.topics, topics)) return
    if (event.actorId && event.actorId === session.user?.id) return

    if (pathname === '/quests') {
      window.dispatchEvent(new Event('holdfast:quests-changed'))
      return
    }

    setVersion((current) => current + 1)
  }, [event, pathname, session.user?.id, topics])

  return <Fragment key={version}>{children}</Fragment>
}
