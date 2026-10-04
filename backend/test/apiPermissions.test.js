import assert from 'node:assert/strict'
import test from 'node:test'
import { recordAuditEventInDatabase } from '../src/Audit/auditRepository.js'
import { withGuildTransaction } from '../src/Data/database.js'
import { persistentState, withHttpApp } from '../testSupport/httpHarness.js'

const authenticatedReads = ['/api/quests/member', '/api/quests/member/completions', '/api/guild/members', '/api/guild/members/me', '/api/guild/members/e2e-member', '/api/guild/billets', '/api/guild/authority']
const privileged = [
  ['GET', '/api/admin/audit?details=true'],
  ['GET', '/api/health/data'],
  ['GET', '/api/admin/ping'],
  ['GET', '/api/quests/manage'],
  ['GET', '/api/guild/members/manage/all'],
  ['PUT', '/api/quests/manage'],
  ['PUT', '/api/quests/manage/economy'],
  ['POST', '/api/quests/manage/approve-reward'],
  ['POST', '/api/quests/manage/complete-objective'],
  ['POST', '/api/quests/manage/review-completion'],
  ['PATCH', '/api/guild/members/manage/e2e-member/rank'],
  ['POST', '/api/guild/members/manage/e2e-member/billets/claim'],
  ['PUT', '/api/guild/members/manage/e2e-member/billets/billet-steward'],
  ['DELETE', '/api/guild/members/manage/e2e-member/billets/billet-steward'],
  ['PATCH', '/api/guild/authority/ranks/Private'],
  ['PATCH', '/api/guild/authority/billets/billet-steward'],
  ['POST', '/api/guild/billets'],
  ['PATCH', '/api/guild/billets/billet-steward'],
  ['DELETE', '/api/guild/billets/billet-steward'],
]

for (const [method, route] of [...authenticatedReads.map((route) => ['GET', route]), ...privileged, ['PATCH', '/api/guild/members/me'], ['PATCH', '/api/guild/members/me/timezone'], ['POST', '/api/quests/member/signup'], ['POST', '/api/quests/member/unassign'], ['POST', '/api/quests/member/request-completion'], ['POST', '/api/quests/member/withdraw-completion']]) {
  test(`anonymous ${method} ${route} is denied without persistent writes`, () => withHttpApp(async ({ request }) => {
    const before = persistentState()
    const response = await request(route, { method, ...(method === 'GET' ? {} : { body: {} }) })
    assert.equal(response.status, 401, response.text)
    assert.equal(response.json.error, 'authentication_required')
    assert.deepEqual(persistentState(), before)
  }))
}

for (const [method, route] of privileged) {
  test(`ordinary member ${method} ${route} is denied without persistent writes`, () => withHttpApp(async ({ request }) => {
    const before = persistentState()
    const response = await request(route, { method, persona: 'member', ...(method === 'GET' ? {} : { body: {} }) })
    assert.equal(response.status, 403, response.text)
    assert.equal(response.json.error, 'permission_required')
    assert.deepEqual(persistentState(), before)
  }))
}

test('audit snapshots are available to authorized leadership and never anonymous visitors', () => withHttpApp(async ({ request }) => {
  withGuildTransaction((db) => recordAuditEventInDatabase({ db, actorMemberId: 'e2e-commander', eventType: 'fixture.private', entityType: 'test', payload: { before: { secret: 'fixture' }, after: { secret: 'fixture' } } }))
  const full = await request('/api/admin/audit?details=true', { persona: 'owner' })
  assert.equal(full.status, 200)
  assert.equal(full.json.events[0].payload.before.secret, 'fixture')
  const summary = await request('/api/admin/audit', { persona: 'officer' })
  assert.equal(summary.status, 200)
  assert.equal(summary.json.events[0].payload.before, undefined)
  const anonymous = await request('/api/admin/audit?details=true')
  assert.equal(anonymous.status, 401)
}))

test('cookie claims cannot grant authority and tampered cookies are rejected', () => withHttpApp(async ({ request, cookie }) => {
  const before = persistentState()
  const claimed = await request('/api/admin/audit', { rawCookie: cookie('member', ['site.admin', 'audit.view', 'authority.manage']) })
  assert.equal(claimed.status, 403)
  const tampered = await request('/api/guild/members', { rawCookie: `${cookie('owner')}x` })
  assert.equal(tampered.status, 401)
  assert.deepEqual(persistentState(), before)
}))

test('production origin guards protect writes through the real middleware chain', () => withHttpApp(async ({ request }) => {
  const before = persistentState()
  for (const Origin of ['', 'https://attacker.example']) {
    const response = await request('/api/guild/members/me', { persona: 'member', method: 'PATCH', body: { bio: 'blocked' }, headers: { Origin } })
    assert.equal(response.status, 403)
  }
  assert.deepEqual(persistentState(), before)
}))

test('officers cannot promote themselves, cross their ceiling, or modify the owner', () => withHttpApp(async ({ request }) => {
  for (const [memberId, rank, error] of [['e2e-officer', 'Captain', 'self_authority_change_forbidden'], ['e2e-member', 'Captain', 'rank_ceiling_exceeded'], ['e2e-commander', 'Private', 'rank_ceiling_exceeded']]) {
    const before = persistentState()
    const response = await request(`/api/guild/members/manage/${memberId}/rank`, { persona: 'officer', method: 'PATCH', body: { rank } })
    assert.equal(response.status, 403)
    assert.equal(response.json.error, error)
    assert.deepEqual(persistentState(), before)
  }
  const before = persistentState()
  const billet = await request('/api/guild/members/manage/e2e-member/billets/billet-steward', { persona: 'officer', method: 'PUT', body: {} })
  assert.equal(billet.status, 403)
  assert.deepEqual(persistentState(), before)
}))

test('owner promotions persist and immediately change server-resolved authority', () => withHttpApp(async ({ request }) => {
  const promoted = await request('/api/guild/members/manage/e2e-member/rank', { persona: 'owner', method: 'PATCH', body: { rank: 'Sergeant' } })
  assert.equal(promoted.status, 200, promoted.text)
  assert.equal(promoted.json.member.rank, 'Sergeant')
  const reread = await request('/api/guild/members/e2e-member', { persona: 'member' })
  assert.equal(reread.json.member.rank, 'Sergeant')
  const session = await request('/api/me', { persona: 'member' })
  assert.ok(session.json.permissions.includes('quests.create'))
  assert.equal(session.json.permissions.includes('rewards.issue'), false)
  const ownerLocked = await request('/api/guild/members/manage/e2e-commander/rank', { persona: 'owner', method: 'PATCH', body: { rank: 'Private' } })
  assert.equal(ownerLocked.status, 409)
}))

test('profile editing persists only allowed self-owned fields', () => withHttpApp(async ({ request }) => {
  const other = await request('/api/guild/members/e2e-officer', { persona: 'member' })
  const saved = await request('/api/guild/members/me', { persona: 'member', method: 'PATCH', body: { memberId: 'e2e-officer', rank: 'Commander', permissions: ['site.admin'], profile: { bio: 'Saved through HTTP', battleTag: 'Mira#0042', characters: [{ id: 'test-warrior', name: 'Rook', className: 'Warrior', race: 'Night Elf', isMain: true }] } } })
  assert.equal(saved.status, 200, saved.text)
  assert.equal(saved.json.member.rank, 'Private')
  const reread = await request('/api/guild/members/me', { persona: 'member' })
  assert.equal(reread.json.member.profile.bio, 'Saved through HTTP')
  assert.equal(reread.json.member.profile.characters[0].name, 'Rook')
  const after = await request('/api/guild/members/e2e-officer', { persona: 'member' })
  assert.deepEqual(after.json.member, other.json.member)
}))

test('production frontend fallback, security headers, and API errors remain distinct', () => withHttpApp(async ({ request }) => {
  const page = await request('/charter', { headers: { Accept: 'text/html' } })
  assert.equal(page.status, 200)
  assert.match(page.text, /HTTP test frontend/)
  assert.equal(page.headers.get('cache-control'), 'no-cache')
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  const missing = await request('/api/missing', { headers: { Accept: 'text/html' } })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error, 'not_found')
}))


test('billet authority and assignments persist and revoke member permissions', () => withHttpApp(async ({ request }) => {
  const created = await request('/api/guild/billets', { persona: 'owner', method: 'POST', body: { name: 'HTTP Quartermaster', responsibility: 'Own supply quests' } })
  assert.equal(created.status, 201, created.text)
  const id = created.json.billet.id
  const scope = { permissions: ['quests.create'], maxManagedRank: null, questScope: 'own', rewardLimits: { repPerObjective: 0, marksPerObjective: 0, marksPerQuest: 0 } }
  const granted = await request(`/api/guild/authority/billets/${id}`, { persona: 'owner', method: 'PATCH', body: scope })
  assert.equal(granted.status, 200, granted.text)
  const assigned = await request(`/api/guild/members/manage/e2e-member/billets/${id}`, { persona: 'owner', method: 'PUT', body: {} })
  assert.equal(assigned.status, 200, assigned.text)
  assert.ok((await request('/api/me', { persona: 'member' })).json.permissions.includes('quests.create'))
  const removed = await request(`/api/guild/members/manage/e2e-member/billets/${id}`, { persona: 'owner', method: 'DELETE' })
  assert.equal(removed.status, 200, removed.text)
  assert.equal((await request('/api/me', { persona: 'member' })).json.permissions.includes('quests.create'), false)
  const deleted = await request(`/api/guild/billets/${id}`, { persona: 'owner', method: 'DELETE' })
  assert.equal(deleted.status, 200, deleted.text)
}))
