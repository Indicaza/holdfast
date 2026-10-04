import assert from 'node:assert/strict'
import test from 'node:test'
import { withGuildDatabase } from '../src/Data/database.js'
import { readContributionTotals } from '../src/Contribution/contributionRepository.js'
import { objective, persistentState, withHttpApp } from '../testSupport/httpHarness.js'

async function workspace(request) {
  const response = await request('/api/quests/manage', { persona: 'owner' })
  assert.equal(response.status, 200, response.text)
  return response.json
}

async function successful(request, route, options, status = 200) {
  const response = await request(route, options)
  assert.equal(response.status, status, response.text)
  return response.json
}

test('signup rejects duplicates and leaving one objective preserves other assignments', () => withHttpApp(async ({ request }) => {
  await successful(request, '/api/quests/member/signup', { method: 'POST', persona: 'member', body: objective }, 201)
  const before = persistentState()
  const duplicate = await request('/api/quests/member/signup', { method: 'POST', persona: 'member', body: objective })
  assert.equal(duplicate.status, 409)
  assert.deepEqual(persistentState(), before)
  await successful(request, '/api/quests/member/signup', { method: 'POST', persona: 'member', body: { ...objective, objectiveId: 'e2e-patrol' } }, 201)
  await successful(request, '/api/quests/member/unassign', { method: 'POST', persona: 'member', body: objective })
  const assignments = withGuildDatabase((db) => db.prepare('SELECT objective_id, member_id FROM assignments').all())
  assert.equal(assignments.length, 1)
  assert.equal(assignments[0].objective_id, 'e2e-patrol')
  assert.equal(assignments[0].member_id, 'e2e-member')
}))

test('HTTP stale edits and malformed imports cannot replace existing guild work', () => withHttpApp(async ({ request }) => {
  const opened = await workspace(request)
  const changed = structuredClone(opened)
  changed.quests[0].title = 'Saved from one browser'
  await successful(request, '/api/quests/manage', { method: 'PUT', persona: 'owner', body: changed })
  const before = persistentState()
  const stale = await request('/api/quests/manage', { method: 'PUT', persona: 'owner', body: { ...opened, rewardPolicy: 'Stale overwrite' } })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error, 'quest_revision_conflict')
  assert.deepEqual(persistentState(), before)
  const latest = await workspace(request)
  const invalid = structuredClone(latest)
  invalid.quests.push(structuredClone(invalid.quests[0]))
  const malformed = await request('/api/quests/manage', { method: 'PUT', persona: 'owner', body: invalid })
  assert.equal(malformed.status, 400)
  assert.deepEqual(persistentState(), before)
  const reread = await workspace(request)
  assert.equal(reread.quests[0].title, 'Saved from one browser')
}))

test('completed work pays exactly once through concurrent HTTP submissions', () => withHttpApp(async ({ request }) => {
  await successful(request, '/api/quests/member/signup', { method: 'POST', persona: 'member', body: objective }, 201)
  const beforeApproval = persistentState()
  const premature = await request('/api/quests/manage/complete-objective', { method: 'POST', persona: 'officer', body: { ...objective, revision: (await workspace(request)).revision } })
  assert.equal(premature.status, 409)
  assert.deepEqual(persistentState(), beforeApproval)
  await successful(request, '/api/quests/member/request-completion', { method: 'POST', persona: 'member', body: { ...objective, note: 'Twenty linen delivered.' } }, 201)
  await successful(request, '/api/quests/manage/review-completion', { method: 'POST', persona: 'officer', body: { ...objective, decision: 'approved' } })
  await successful(request, '/api/quests/manage/approve-reward', { method: 'POST', persona: 'officer', body: { ...objective, revision: (await workspace(request)).revision } })
  const body = { ...objective, revision: (await workspace(request)).revision }
  const results = await Promise.all([0, 1].map(() => request('/api/quests/manage/complete-objective', { method: 'POST', persona: 'officer', body })))
  assert.equal(results.filter((result) => result.status === 200).length, 1, JSON.stringify(results))
  assert.ok(results.some((result) => result.status === 409))
  assert.deepEqual((await readContributionTotals()).get('e2e-member'), { rep: 100, marks: 5, completedObjectives: 1 })
  const state = withGuildDatabase((db) => ({
    transactions: db.prepare('SELECT COUNT(*) AS count FROM contribution_transactions').get().count,
    awards: db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'quest.objective_completed'").get().count,
    completed: db.prepare('SELECT completed FROM objectives WHERE id = ?').get(objective.objectiveId).completed,
  }))
  assert.deepEqual(state, { transactions: 1, awards: 1, completed: 1 })
  const persisted = persistentState()
  const replay = await request('/api/quests/manage/complete-objective', { method: 'POST', persona: 'officer', body })
  assert.equal(replay.status, 409)
  assert.deepEqual(persistentState(), persisted)
}))

test('rejection needs a reason and resubmission and withdrawal preserve unpaid work', () => withHttpApp(async ({ request }) => {
  await successful(request, '/api/quests/member/signup', { method: 'POST', persona: 'member', body: objective }, 201)
  await successful(request, '/api/quests/member/request-completion', { method: 'POST', persona: 'member', body: objective }, 201)
  const before = persistentState()
  const invalid = await request('/api/quests/manage/review-completion', { method: 'POST', persona: 'officer', body: { ...objective, decision: 'rejected' } })
  assert.equal(invalid.status, 400)
  assert.deepEqual(persistentState(), before)
  const rejected = await successful(request, '/api/quests/manage/review-completion', { method: 'POST', persona: 'officer', body: { ...objective, decision: 'rejected', note: 'Bring the remaining linen.' } })
  assert.equal(rejected.completion.status, 'rejected')
  await successful(request, '/api/quests/member/request-completion', { method: 'POST', persona: 'member', body: { ...objective, note: 'Delivered the rest.' } }, 201)
  await successful(request, '/api/quests/member/withdraw-completion', { method: 'POST', persona: 'member', body: objective })
  assert.equal((await readContributionTotals()).size, 0)
  assert.equal((await workspace(request)).quests[0].objectives[0].completed, false)
}))
