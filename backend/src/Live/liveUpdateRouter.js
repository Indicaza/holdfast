import { Router } from 'express'
import { requireAuthenticated } from '../Auth/permissions.js'
import { publishLiveUpdate, subscribeLiveUpdates } from './liveUpdateBus.js'

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
  } else if (path.startsWith('/api/bridge')) {
    events.push({ topics: ['quests', 'guildweaver'], source: 'guildweaver.bridge' })
  } else if (path.startsWith('/api/quests')) {
    events.push({ topics: ['quests', 'notifications'], source: 'quests' })
  } else if (path.startsWith('/api/guild/members')) {
    events.push({ topics: ['members', 'ranks', 'authority', 'notifications'], source: 'members' })
  } else if (path.startsWith('/api/guild/billets') || path.startsWith('/api/guild/authority')) {
    events.push({ topics: ['members', 'ranks', 'authority', 'notifications'], source: 'authority' })
  } else if (path.startsWith('/api/notifications')) {
    events.push({ topics: ['notifications'], source: 'notifications', memberId: actorId })
  }

  if (events.length) {
    events.push({ topics: ['audit'], source: 'mutation', permission: 'audit.view' })
  }

  return events
}

export function createLiveMutationObserver() {
  return (req, res, next) => {
    if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) {
      next()
      return
    }

    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 400) return
      for (const event of classifyLiveMutation(req)) publishLiveUpdate(event)
    })

    next()
  }
}

function writeEvent(res, eventName, payload, id = null) {
  if (id !== null && id !== undefined) res.write(`id: ${id}\n`)
  if (eventName) res.write(`event: ${eventName}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export function createLiveUpdateRouter({ heartbeatMs = 20_000 } = {}) {
  const router = Router()

  router.get('/', requireAuthenticated, (req, res) => {
    res.status(200)
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    res.write('retry: 3000\n\n')

    writeEvent(res, 'ready', {
      type: 'ready',
      at: new Date().toISOString(),
    })

    const unsubscribe = subscribeLiveUpdates({
      memberId: req.auth.user.id,
      permissions: req.auth.permissions,
      send(event) {
        writeEvent(res, 'change', {
          id: event.id,
          topics: event.topics,
          source: event.source,
          entityId: event.entityId,
          at: event.at,
        }, event.id)
      },
    })

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`)
    }, heartbeatMs)
    heartbeat.unref?.()

    let closed = false
    function cleanup() {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
    }

    req.once('close', cleanup)
    res.once('close', cleanup)
  })

  return router
}
