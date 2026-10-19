import { publishLiveUpdate } from './liveUpdateBus.js'
import { HOLDFAST_GUILD_ID } from '../Guild/guildScope.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function pathname(req) {
  return String(req.originalUrl || req.url || '').split('?', 1)[0]
}

// /api/g/:slug/quests is the same mutation as /api/quests, for that guild.
const GUILD_SCOPED_PATH = /^\/api\/g\/[^/]+(\/(?:quests|members|billets|authority|audit)(?:\/.*)?)$/
const GUILD_PATH_ALIASES = { '/members': '/guild/members', '/billets': '/guild/billets', '/authority': '/guild/authority' }

function unscopedPath(path) {
  const match = GUILD_SCOPED_PATH.exec(path)
  if (!match) return path
  const rest = match[1]
  const section = `/${rest.split('/')[1]}`
  return `/api${GUILD_PATH_ALIASES[section] || section}${rest.slice(section.length)}`
}

export function classifyLiveMutation(req) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return []

  const rawPath = pathname(req)
  const guildScoped = GUILD_SCOPED_PATH.test(rawPath)
  const path = unscopedPath(rawPath)
  const guildId = guildScoped ? req.guild?.id || null : null
  const actorId = req.auth?.user?.id ? String(req.auth.user.id) : null
  // Another guild's changes only reach that guild's members.
  const withActor = (event) => (guildId && guildId !== HOLDFAST_GUILD_ID ? { ...event, actorId, guildId } : { ...event, actorId })
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

  // Audit visibility is a Holdfast permission; other guilds' audit history
  // is read on demand.
  if (events.length && !path.startsWith('/api/notifications') && (!guildId || guildId === HOLDFAST_GUILD_ID)) {
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
