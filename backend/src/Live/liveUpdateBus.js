let nextEventId = 1
const subscribers = new Set()

function normalizeTopics(topics) {
  return [...new Set((Array.isArray(topics) ? topics : [topics])
    .map((topic) => String(topic || '').trim())
    .filter(Boolean))]
}

function canReceive(subscriber, event) {
  if (event.memberId && subscriber.memberId !== event.memberId) return false
  if (event.permission && !subscriber.permissions.includes(event.permission)) return false
  return true
}

export function publishLiveUpdate({
  topics,
  source = 'unknown',
  entityId = null,
  actorId = null,
  memberId = null,
  permission = null,
  detail = null,
} = {}) {
  const normalizedTopics = normalizeTopics(topics)
  if (!normalizedTopics.length) return null

  const event = {
    id: nextEventId++,
    type: 'change',
    topics: normalizedTopics,
    source,
    entityId: entityId ? String(entityId) : null,
    actorId: actorId ? String(actorId) : null,
    memberId: memberId ? String(memberId) : null,
    permission: permission ? String(permission) : null,
    detail: detail && typeof detail === 'object' ? detail : null,
    at: new Date().toISOString(),
  }

  for (const subscriber of [...subscribers]) {
    if (!canReceive(subscriber, event)) continue
    try {
      subscriber.send(event)
    } catch {
      subscribers.delete(subscriber)
    }
  }

  return event
}

export function subscribeLiveUpdates({ memberId, permissions = [], send }) {
  const subscriber = {
    memberId: String(memberId || ''),
    permissions: Array.isArray(permissions) ? permissions.map(String) : [],
    send,
  }
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function liveSubscriberCount() {
  return subscribers.size
}

export function resetLiveUpdatesForTests() {
  subscribers.clear()
  nextEventId = 1
}
