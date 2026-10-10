import { useEffect, useRef } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { useLiveEvents } from '../Live/liveUpdatesContext.js'
import { clearResources, invalidateResources } from './resourceCache.js'

// Keeps the resource cache honest for pages that are not on screen: live
// events mark what they touch as stale, and a different member (or signing
// out) starts the cache over.
export default function ResourceCacheSync() {
  const { status, user } = useSession()
  const userId = status === 'ready' ? user?.id || '' : null
  const previousUser = useRef(userId)

  useEffect(() => {
    if (userId === null) return
    if (previousUser.current !== null && previousUser.current !== userId) clearResources()
    previousUser.current = userId
  }, [userId])

  useLiveEvents((event) => invalidateResources(event.topics))
  return null
}
