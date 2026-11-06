import { useLiveEvents } from '../Live/liveUpdatesContext.js'
import { invalidateResources } from './resourceCache.js'

// Keeps the resource cache honest for pages that are not on screen: live
// events mark what they touch as stale. A different account, or signing out,
// starts the cache over (Auth/SessionProvider).
export default function ResourceCacheSync() {
  useLiveEvents((event) => invalidateResources(event.topics))
  return null
}
