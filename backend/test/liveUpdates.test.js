import assert from 'node:assert/strict'
import test from 'node:test'
import { publishLiveUpdate, resetLiveUpdatesForTests, subscribeLiveUpdates } from '../src/Live/liveUpdateBus.js'
import { classifyLiveMutation } from '../src/Live/liveMutationObserver.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

async function readUntil(reader, pattern, timeoutMs = 2500) {
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now())
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('stream_timeout')), remaining)),
    ])
    if (result.done) break
    text += decoder.decode(result.value, { stream: true })
    if (pattern.test(text)) return text
  }

  throw new Error(`Expected live stream pattern ${pattern} in ${text}`)
}

test('live event stream requires an authenticated guild member', () => withHttpApp(async ({ base }) => {
  const response = await fetch(`${base}/api/notifications/live`, {
    headers: { Origin: 'https://holdfast.example' },
  })
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'authentication_required' })
}))

test('successful member writes appear on the authenticated live stream', () => withHttpApp(async ({ base, cookie, request }) => {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/notifications/live`, {
    signal: controller.signal,
    headers: {
      Origin: 'https://holdfast.example',
      Cookie: cookie('member'),
    },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
  const reader = response.body.getReader()

  await readUntil(reader, /event: ready/)
  const saved = await request('/api/guild/members/me', {
    persona: 'member',
    method: 'PATCH',
    body: { profile: { bio: 'Live update fixture' } },
  })
  assert.equal(saved.status, 200, saved.text)

  const text = await readUntil(reader, /"members"/)
  assert.match(text, /event: change/)
  assert.match(text, /"notifications"/)
  assert.match(text, /"actorId":/)
  controller.abort()
}))

test('live bus scopes private and privileged invalidations', () => {
  resetLiveUpdatesForTests()
  const memberEvents = []
  const adminEvents = []
  const stopMember = subscribeLiveUpdates({ memberId: 'member', permissions: [], send: (event) => memberEvents.push(event) })
  const stopAdmin = subscribeLiveUpdates({ memberId: 'admin', permissions: ['site.admin'], send: (event) => adminEvents.push(event) })

  publishLiveUpdate({ topics: ['notifications'], memberId: 'member' })
  publishLiveUpdate({ topics: ['guildweaver'], permission: 'site.admin' })

  assert.deepEqual(memberEvents.map((event) => event.topics), [['notifications']])
  assert.deepEqual(adminEvents.map((event) => event.topics), [['guildweaver']])
  stopMember()
  stopAdmin()
  resetLiveUpdatesForTests()
})

test('mutation classification targets only affected read models and identifies the actor', () => {
  const memberEvents = classifyLiveMutation({
    method: 'PATCH',
    originalUrl: '/api/guild/members/me',
    auth: { user: { id: 'm1' } },
  })
  assert.deepEqual(memberEvents.map((event) => event.topics), [
    ['members', 'ranks', 'authority', 'notifications'],
    ['audit'],
  ])
  assert.deepEqual(memberEvents.map((event) => event.actorId), ['m1', 'm1'])

  const questEvents = classifyLiveMutation({ method: 'POST', originalUrl: '/api/quests/member/signup' })
  assert.deepEqual(questEvents.map((event) => event.topics), [['quests', 'notifications'], ['audit']])
  assert.deepEqual(questEvents.map((event) => event.actorId), [null, null])
  assert.deepEqual(classifyLiveMutation({ method: 'GET', originalUrl: '/api/quests/member' }), [])
})
