import assert from 'node:assert/strict'
import test from 'node:test'

import { memberIds, objective, withHttpApp } from '../testSupport/httpHarness.js'

async function ok(request, route, options, status = 200) {
  const response = await request(route, options)
  assert.equal(response.status, status, `${options?.method || 'GET'} ${route}: ${response.text}`)
  return response.json
}

async function inbox(request, persona) {
  return ok(request, '/api/notifications', { persona })
}

async function workspace(request) {
  return ok(request, '/api/quests/manage', { persona: 'owner' })
}

function openOfType(payload, type) {
  return payload.notifications.filter((item) => item.type === type && !item.resolvedAt)
}

test('completion notifications form one synchronized work queue across requester and all reviewers', () => withHttpApp(async ({ request }) => {
  await ok(request, '/api/quests/member/signup', {
    persona: 'member',
    method: 'POST',
    body: objective,
  }, 201)

  await ok(request, '/api/quests/member/request-completion', {
    persona: 'member',
    method: 'POST',
    body: { ...objective, note: 'First delivery is ready.' },
  }, 201)

  const ownerRequested = openOfType(await inbox(request, 'owner'), 'completion_requested')
  const officerRequested = openOfType(await inbox(request, 'officer'), 'completion_requested')
  assert.equal(ownerRequested.length, 1)
  assert.equal(officerRequested.length, 1)
  assert.equal(ownerRequested[0].kind, 'action')
  assert.equal(officerRequested[0].kind, 'action')
  assert.equal((await inbox(request, 'member')).actionCount, 0)

  await ok(request, '/api/quests/manage/review-completion', {
    persona: 'owner',
    method: 'POST',
    body: { ...objective, decision: 'rejected', note: 'Bring the remaining linen.' },
  })

  assert.equal(openOfType(await inbox(request, 'owner'), 'completion_requested').length, 0)
  assert.equal(openOfType(await inbox(request, 'officer'), 'completion_requested').length, 0)

  let memberInbox = await inbox(request, 'member')
  const changes = openOfType(memberInbox, 'completion_rejected')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].kind, 'action')
  assert.match(changes[0].message, /remaining linen/i)
  assert.equal(memberInbox.actionCount, 1)

  await ok(request, '/api/quests/member/request-completion', {
    persona: 'member',
    method: 'POST',
    body: { ...objective, note: 'Delivered the rest.' },
  }, 201)

  memberInbox = await inbox(request, 'member')
  assert.equal(openOfType(memberInbox, 'completion_rejected').length, 0)
  assert.equal(memberInbox.actionCount, 0)
  assert.equal(openOfType(await inbox(request, 'owner'), 'completion_requested').length, 1)
  assert.equal(openOfType(await inbox(request, 'officer'), 'completion_requested').length, 1)

  await ok(request, '/api/quests/member/withdraw-completion', {
    persona: 'member',
    method: 'POST',
    body: objective,
  })

  assert.equal(openOfType(await inbox(request, 'owner'), 'completion_requested').length, 0)
  assert.equal(openOfType(await inbox(request, 'officer'), 'completion_requested').length, 0)
}))

test('approval and payout produce distinct member updates and exactly one reward notification', () => withHttpApp(async ({ request }) => {
  await ok(request, '/api/quests/member/signup', {
    persona: 'member',
    method: 'POST',
    body: objective,
  }, 201)
  await ok(request, '/api/quests/member/request-completion', {
    persona: 'member',
    method: 'POST',
    body: objective,
  }, 201)

  await ok(request, '/api/quests/manage/review-completion', {
    persona: 'owner',
    method: 'POST',
    body: { ...objective, decision: 'approved' },
  })

  let memberInbox = await inbox(request, 'member')
  const approval = openOfType(memberInbox, 'completion_approved')
  assert.equal(approval.length, 1)
  assert.equal(approval[0].kind, 'update')
  assert.equal(memberInbox.actionCount, 0)

  let current = await workspace(request)
  await ok(request, '/api/quests/manage/approve-reward', {
    persona: 'owner',
    method: 'POST',
    body: { ...objective, revision: current.revision },
  })

  current = await workspace(request)
  const completed = await request('/api/quests/manage/complete-objective', {
    persona: 'owner',
    method: 'POST',
    body: { ...objective, revision: current.revision },
  })
  assert.equal(completed.status, 200, completed.text)

  memberInbox = await inbox(request, 'member')
  const rewards = memberInbox.notifications.filter((item) => item.type === 'reward_issued')
  assert.equal(rewards.length, 1)
  assert.equal(rewards[0].kind, 'update')
  assert.match(rewards[0].message, /100 Rep/i)
  assert.match(rewards[0].message, /5 Marks/i)
  assert.equal(rewards[0].data.questId, objective.questId)
  assert.equal(rewards[0].data.objectiveId, objective.objectiveId)

  const replay = await request('/api/quests/manage/complete-objective', {
    persona: 'owner',
    method: 'POST',
    body: { ...objective, revision: current.revision },
  })
  assert.equal(replay.status, 409)

  memberInbox = await inbox(request, 'member')
  assert.equal(memberInbox.notifications.filter((item) => item.type === 'reward_issued').length, 1)
}))

test('rank and billet churn collapses into the latest unread personal state instead of inbox spam', () => withHttpApp(async ({ request }) => {
  await ok(request, `/api/guild/members/manage/${memberIds.member}/rank`, {
    persona: 'owner',
    method: 'PATCH',
    body: { rank: 'Corporal' },
  })
  await ok(request, `/api/guild/members/manage/${memberIds.member}/rank`, {
    persona: 'owner',
    method: 'PATCH',
    body: { rank: 'Sergeant' },
  })

  let memberInbox = await inbox(request, 'member')
  let rankItems = memberInbox.notifications.filter((item) => item.type === 'rank_changed')
  assert.equal(rankItems.length, 1)
  assert.match(rankItems[0].message, /Sergeant/)
  assert.equal(rankItems[0].data.afterRank, 'Sergeant')

  await ok(request, `/api/notifications/${rankItems[0].id}/read`, {
    persona: 'member',
    method: 'POST',
  })
  assert.equal((await inbox(request, 'member')).unreadCount, 0)

  await ok(request, `/api/guild/members/manage/${memberIds.member}/rank`, {
    persona: 'owner',
    method: 'PATCH',
    body: { rank: 'Master Sergeant' },
  })
  memberInbox = await inbox(request, 'member')
  rankItems = memberInbox.notifications.filter((item) => item.type === 'rank_changed')
  assert.equal(rankItems.length, 1)
  assert.equal(rankItems[0].readAt, null)
  assert.match(rankItems[0].message, /Master Sergeant/)

  await ok(request, `/api/guild/members/manage/${memberIds.member}/billets/billet-steward`, {
    persona: 'owner',
    method: 'PUT',
    body: {},
  })
  await ok(request, `/api/guild/members/manage/${memberIds.member}/billets/billet-steward`, {
    persona: 'owner',
    method: 'DELETE',
  })

  memberInbox = await inbox(request, 'member')
  const billetItems = memberInbox.notifications.filter((item) => item.type === 'billet_changed')
  assert.equal(billetItems.length, 1)
  assert.equal(billetItems[0].data.assigned, false)
  assert.match(billetItems[0].message, /removed/i)
}))
