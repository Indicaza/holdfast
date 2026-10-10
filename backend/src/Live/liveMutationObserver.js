import { publishLiveUpdate } from './liveUpdateBus.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function pathname(req) {
  return String(req.originalUrl || req.url || '').split('?', 1)[0]
}

export function classifyLiveMutation(req) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return []

  const path = pathname(req)
  const actorId = req.auth?.user?.id ? String(req.auth.user.id) : null
  const withActor = (event) => ({ ...event, actorId })
  const events = []

  // Character snapshots announce themselves once their read model changes
  // (Live/characterChangeEvents.js), not on every bridge request.
  if (path.startsWith('/api/bridge/characters/snapshot')) {
    events.push(withActor({ topics: ['guildweaver'], source: 'guildweaver.character', permission: 'site.admin' }))
  } else if (path.startsWith('/api/bridge/quests')) {
    events.push(withActor({ topics: ['quests', 'notifications'], source: 'guildweaver.quests' }))
    events.push(withActor({ topics: ['guildweaver'], source: 'guildweaver.quests', permission: 'site.admin' }))
  } else if (path.startsWith('/api/bridge/pairing')) {
    events.push(withActor({ topics: ['guildweaver'], source: 'guildweaver.pairing' }))
  } else if (path.startsWith('/api/quests')) {
    events.push(withActor({ topics: ['quests', 'notifications'], source: 'quests' }))
  } else if (path.startsWith('/api/guild/members')) {
    events.push(withActor({ topics: ['members', 'ranks', 'authority', 'notifications'], source: 'members' }))
  } else if (path.startsWith('/api/guild/billets') || path.startsWith('/api/guild/authority')) {
    events.push(withActor({ topics: ['members', 'ranks', 'authority', 'notifications'], source: 'authority' }))
  } else if (path.startsWith('/api/notifications')) {
    events.push(withActor({ topics: ['notifications'], source: 'notifications', memberId: actorId }))
  }

  if (events.length && !path.startsWith('/api/notifications')) {
    events.push(withActor({ topics: ['audit'], source: 'mutation', permission: 'audit.view' }))
  }

  return events
}

export function observeLiveMutation(req, res, next) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase()) || typeof res?.once !== 'function') {
    next()
    return
  }

  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return
    // A route that changed nothing says so, and nobody needs to refresh.
    if (res.locals?.unchanged) return
    for (const event of classifyLiveMutation(req)) publishLiveUpdate(event)
  })

  next()
}
