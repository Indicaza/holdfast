import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearResources,
  invalidateResources,
  loadResource,
  peekResource,
  replaceResource,
  resourceIsFresh,
} from '../src/Api/resourceCache.js'

function stubFetch(context, respond) {
  const originalFetch = globalThis.fetch
  const calls = []
  context.after(() => {
    globalThis.fetch = originalFetch
    clearResources()
  })
  globalThis.fetch = async (url) => {
    calls.push(url)
    return respond(url, calls.length)
  }
  return calls
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('requests for the same resource share one fetch and stay fresh', async (context) => {
  const calls = stubFetch(context, () => json({ members: [1] }))

  const [first, second] = await Promise.all([
    loadResource('/api/guild/members', ['members']),
    loadResource('/api/guild/members', ['members']),
  ])

  assert.deepEqual(first, { members: [1] })
  assert.equal(second, first)
  assert.equal(calls.length, 1)
  assert.equal(resourceIsFresh(peekResource('/api/guild/members')), true)
})

test('a live event about its topics, or a reconnect, marks a resource stale', async (context) => {
  stubFetch(context, () => json({ ok: true }))
  await loadResource('/api/guild/members', ['members'])
  await loadResource('/api/guild/authority', ['authority'])

  invalidateResources(['quests'])
  assert.equal(resourceIsFresh(peekResource('/api/guild/members')), true)

  invalidateResources(['members', 'notifications'])
  assert.equal(resourceIsFresh(peekResource('/api/guild/members')), false)
  assert.equal(resourceIsFresh(peekResource('/api/guild/authority')), true)

  invalidateResources(['*'])
  assert.equal(resourceIsFresh(peekResource('/api/guild/authority')), false)
})

test('old entries expire and a page write stays fresh', async (context) => {
  stubFetch(context, () => json({ v: 1 }))
  await loadResource('/api/guild/authority', ['authority'])
  const entry = peekResource('/api/guild/authority')
  assert.equal(resourceIsFresh(entry, entry.fetchedAt + 6 * 60 * 1000), false)

  invalidateResources(['authority'])
  replaceResource('/api/guild/authority', { v: 2 })
  assert.deepEqual(peekResource('/api/guild/authority').payload, { v: 2 })
  assert.equal(resourceIsFresh(peekResource('/api/guild/authority')), true)
})

test('a failed first load leaves nothing cached; a failed refresh keeps the last payload', async (context) => {
  stubFetch(context, (url, count) => (count === 2 ? json({ error: 'nope' }, 403) : json({ v: count })))

  await loadResource('/api/one', ['x'])
  invalidateResources(['x'])
  await assert.rejects(loadResource('/api/one', ['x']))
  assert.deepEqual(peekResource('/api/one').payload, { v: 1 })

  clearResources()
  stubFetch(context, () => json({ error: 'nope' }, 403))
  await assert.rejects(loadResource('/api/two', ['x']))
  assert.equal(peekResource('/api/two'), null)
})
