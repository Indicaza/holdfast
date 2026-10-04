import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'

import { createNotificationRouter } from '../src/Notification/notificationRouter.js'

async function withRouter(run, { authenticated = true, dependencies = {} } = {}) {
  const app = express()
  app.use(express.json())
  if (authenticated) {
    app.use((req, res, next) => {
      req.auth = { user: { id: 'member-1', username: 'member' }, permissions: [] }
      next()
    })
  }
  app.use('/api/notifications', createNotificationRouter(dependencies))

  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })

  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (route, { method = 'GET' } = {}) => {
      const response = await fetch(`${base}${route}`, { method })
      const text = await response.text()
      let json
      try { json = JSON.parse(text) } catch { json = null }
      return { status: response.status, headers: response.headers, text, json }
    }
    await run({ request })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('notification routes require a signed-in member before invoking dependencies', () => withRouter(async ({ request }) => {
  for (const [method, route] of [
    ['GET', '/api/notifications'],
    ['POST', '/api/notifications/read-all'],
    ['POST', '/api/notifications/anything/read'],
  ]) {
    const response = await request(route, { method })
    assert.equal(response.status, 401, `${method} ${route}: ${response.text}`)
    assert.equal(response.json.error, 'authentication_required')
  }
}, {
  authenticated: false,
  dependencies: {
    readNotifications() { throw new Error('must not run') },
    markAllRead() { throw new Error('must not run') },
    markRead() { throw new Error('must not run') },
  },
}))

test('notification GET returns only the authenticated member inbox with no-store caching', () => {
  const calls = []
  return withRouter(async ({ request }) => {
    const response = await request('/api/notifications')
    assert.equal(response.status, 200, response.text)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(response.json, {
      notifications: [{ id: 'n-1' }],
      unreadCount: 1,
      actionCount: 0,
    })
    assert.deepEqual(calls, ['member-1'])
  }, {
    dependencies: {
      readNotifications(memberId) {
        calls.push(memberId)
        return { notifications: [{ id: 'n-1' }], unreadCount: 1, actionCount: 0 }
      },
    },
  })
})

test('notification GET reports a stable diagnostic error when storage fails', () => withRouter(async ({ request }) => {
  const response = await request('/api/notifications')
  assert.equal(response.status, 500, response.text)
  assert.deepEqual(response.json, {
    error: 'notifications_unavailable',
    message: 'Holdfast could not load notifications.',
  })
}, {
  dependencies: {
    readNotifications() { throw new Error('simulated read failure') },
  },
}))

test('mark-all-read returns the exact updated count and storage failures stay distinguishable', async () => {
  const calls = []
  await withRouter(async ({ request }) => {
    const response = await request('/api/notifications/read-all', { method: 'POST' })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(response.json, { updated: 3 })
    assert.deepEqual(calls, ['member-1'])
  }, {
    dependencies: {
      markAllRead(memberId) {
        calls.push(memberId)
        return 3
      },
    },
  })

  await withRouter(async ({ request }) => {
    const response = await request('/api/notifications/read-all', { method: 'POST' })
    assert.equal(response.status, 500, response.text)
    assert.deepEqual(response.json, { error: 'notification_update_failed' })
  }, {
    dependencies: {
      markAllRead() { throw new Error('simulated write failure') },
    },
  })
})

test('single-read route binds both member and notification ids and preserves 404 versus 500', async () => {
  const calls = []
  await withRouter(async ({ request }) => {
    const response = await request('/api/notifications/n-42/read', { method: 'POST' })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(response.json, { notification: { id: 'n-42', readAt: 'now' } })
    assert.deepEqual(calls, [['member-1', 'n-42']])
  }, {
    dependencies: {
      markRead(memberId, notificationId) {
        calls.push([memberId, notificationId])
        return { id: notificationId, readAt: 'now' }
      },
    },
  })

  await withRouter(async ({ request }) => {
    const response = await request('/api/notifications/missing/read', { method: 'POST' })
    assert.equal(response.status, 404, response.text)
    assert.deepEqual(response.json, { error: 'notification_not_found' })
  }, {
    dependencies: { markRead() { return null } },
  })

  await withRouter(async ({ request }) => {
    const response = await request('/api/notifications/n-500/read', { method: 'POST' })
    assert.equal(response.status, 500, response.text)
    assert.deepEqual(response.json, { error: 'notification_update_failed' })
  }, {
    dependencies: { markRead() { throw new Error('simulated write failure') } },
  })
})
