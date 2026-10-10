import { apiJson } from './apiClient.js'
import { matchesLiveTopics } from '../Live/liveTopics.js'

// In-memory cache of JSON resources read through useLiveResource, so data
// survives page changes: returning to a page shows what it had at once, and
// it is only fetched again when it may have changed.
//
// An entry is fresh until a live event about one of its topics arrives (or a
// reconnect, which may have missed some), or MAX_AGE_MS passes as a backstop.
// Requests for the same URL share one fetch. The cache is also bounded so
// browsing many character recipe books cannot grow browser memory forever.

const MAX_AGE_MS = 5 * 60 * 1000
const MAX_ENTRIES = 64
const MAX_RECIPE_ENTRIES = 8
const entries = new Map()

function isRecipeResource(url) {
  return /^\/api\/intelligence\/characters\/[^/]+\/recipes(?:[?#]|$)/.test(url)
}

function touchResource(url, entry) {
  entries.delete(url)
  entries.set(url, entry)
}

function evictOldest(predicate) {
  for (const [url, entry] of entries) {
    if (entry.request || !predicate(url, entry)) continue
    entries.delete(url)
    return true
  }
  return false
}

function pruneResources() {
  let recipeCount = 0
  for (const url of entries.keys()) {
    if (isRecipeResource(url)) recipeCount += 1
  }

  while (recipeCount > MAX_RECIPE_ENTRIES) {
    if (!evictOldest((url) => isRecipeResource(url))) break
    recipeCount -= 1
  }

  while (entries.size > MAX_ENTRIES) {
    if (!evictOldest(() => true)) break
  }
}

export function peekResource(url) {
  const entry = entries.get(url) || null
  if (entry) touchResource(url, entry)
  return entry
}

export function resourceIsFresh(entry, now = Date.now()) {
  return Boolean(entry && !entry.stale && now - entry.fetchedAt < MAX_AGE_MS)
}

// Fetches url (joining a fetch already in flight) and caches the payload
// under the live topics that invalidate it.
export function loadResource(url, topics = []) {
  const existing = entries.get(url)
  if (existing?.request) return existing.request

  const request = apiJson(url)
    .then((payload) => {
      touchResource(url, { payload, fetchedAt: Date.now(), stale: false, topics: [...topics], request: null })
      pruneResources()
      return payload
    })
    .catch((error) => {
      const current = entries.get(url)
      if (current?.request === request) {
        if (current.payload === undefined) entries.delete(url)
        else touchResource(url, { ...current, request: null })
      }
      throw error
    })
  touchResource(url, { ...(existing || { payload: undefined, fetchedAt: 0, stale: true }), topics: [...topics], request })
  return request
}

// A page's own write already knows the new payload: keep it, still fresh.
export function replaceResource(url, payload) {
  const entry = entries.get(url)
  touchResource(url, { topics: [], request: null, ...entry, payload, fetchedAt: Date.now(), stale: false })
  pruneResources()
}

export function invalidateResources(eventTopics) {
  for (const [url, entry] of entries) {
    if (matchesLiveTopics(eventTopics, entry.topics)) entries.set(url, { ...entry, stale: true })
  }
}

export function clearResources() {
  entries.clear()
}
