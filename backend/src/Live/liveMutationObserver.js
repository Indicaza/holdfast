import { publishLiveUpdate } from './liveUpdateBus.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function pathname(req) {
  return String(req.originalUrl || req.url || '').split('?', 1)[0]
}

export function classifyLiveMutation(req) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return []

  const path = pathname(req)
  const actorId = req.auth?.user?.id ? String(req.auth.user.id) : null
  const events = []

  if (path.startsWith('/api/bridge/characters/snapshot')) {
    events.push({ topics: ['intelligence', 'armory'], source: 'guildweaver.character' })
    events.push({ topics: ['guildweaver'], source: 'guildweaver.character', permission: 'site.admin' })
  } else if (path.startsWith('/api/bridge/quests')) {
    events.push({ topics: ['quests', 'notifications'], source: 'guildweaver.quests' })
    events.push({ topics: ['guildweaver'], source: 'guildweaver.quests', permission: 'site.admin' })
  } else if (path.startsWith('/api/bridge/pairing')) {
    events.push({ topics: ['guildweaver'], source: 'guildweaver.pairing' })
  } else if (path.startsWith('/api/quests')) {
    events.push({ topics: ['quests', 'notifications'], source: 'quests' })
  } else if (path.startsWith('/api/guild/members')) {
    events.push({ topics: ['members', 'ranks', 'authority', 'notifications'], source: 'members' })
  } else if (path.startsWith('/api/guild/billets') || path.startsWith('/api/guild/authority')) {
    events.push({ topics: ['members', 'ranks', 'authority', 'notifications'], source: 'authority' })
  } else if (path.startsWith('/api/notifications')) {
    events.push({ topics: ['notifications'], source: 'notifications', memberId: actorId })
  }

  if (events.length && !path.startsWith('/api/notifications')) {
    events.push({ topics: ['audit'], source: 'mutation', permission: 'audit.view' })
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
    for (const event of classifyLiveMutation(req)) publishLiveUpdate(event)
  })

  next()
}
