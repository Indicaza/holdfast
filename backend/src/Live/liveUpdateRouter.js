import { Router } from 'express'
import { requireAuthenticated } from '../Auth/permissions.js'
import { subscribeLiveUpdates } from './liveUpdateBus.js'

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
