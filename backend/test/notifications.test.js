import assert from 'node:assert/strict'
import test from 'node:test'

import { withGuildTransaction } from '../src/Data/database.js'
import {
  createNotificationInDatabase,
  readMemberNotificationsFromDatabase,
  resolveNotificationsInDatabase,
} from '../src/Notification/notificationRepository.js'
import { memberIds, objective, withHttpApp } from '../testSupport/httpHarness.js'

test('notification inbox is private and read state is owned by the recipient', () => withHttpApp(async ({ request }) => {
  const ids = withGuildTransaction((db) => {
    const member = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.member,
      type: 'test_update',
      title: 'For the member',
      message: 'Private member update.',
      href: '/members/me',
    })
    const officer = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.officer,
      type: 'test_update',
      title: 'For the officer',
    })
    return { member: member.id, officer: officer.id }
  })

  assert.equal((await request('/api/notifications')).status, 401)

  const inbox = await request('/api/notifications', { persona: 'member' })
  assert.equal(inbox.status, 200, inbox.text)
  assert.equal(inbox.json.unreadCount, 1)
  assert.deepEqual(inbox.json.notifications.map((item) => item.id), [ids.member])

  const foreign = await request(`/api/notifications/${ids.officer}/read`, {
    persona: 'member',
    method: 'POST',
  })
  assert.equal(foreign.status, 404)

  const read = await request(`/api/notifications/${ids.member}/read`, {
    persona: 'member',
    method: 'POST',
  })
  assert.equal(read.status, 200, read.text)
  assert.ok(read.json.notification.readAt)

  const reread = await request('/api/notifications', { persona: 'member' })
  assert.equal(reread.json.unreadCount, 0)
}))

test('deduped action notifications re-open and resolve as a shared work item', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const first = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.owner,
      type: 'completion_requested',
      kind: 'action',
      title: 'Completion review requested',
      message: 'First request',
      dedupeKey: 'completion-review:test',
      now: '2026-10-04T01:00:00.000Z',
    })
    const second = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.owner,
      type: 'completion_requested',
      kind: 'action',
      title: 'Completion review requested',
      message: 'Updated request',
      dedupeKey: 'completion-review:test',
      now: '2026-10-04T02:00:00.000Z',
    })

    assert.equal(second.id, first.id)
    let inbox = readMemberNotificationsFromDatabase(db, memberIds.owner)
    assert.equal(inbox.notifications.length, 1)
    assert.equal(inbox.notifications[0].message, 'Updated request')
    assert.equal(inbox.actionCount, 1)

    assert.equal(resolveNotificationsInDatabase(db, { dedupeKey: 'completion-review:test' }), 1)
    inbox = readMemberNotificationsFromDatabase(db, memberIds.owner)
    assert.equal(inbox.actionCount, 0)
    assert.ok(inbox.notifications[0].resolvedAt)
  })
}))

test('rank, billet, and completion handoffs create useful notifications', () => withHttpApp(async ({ request }) => {
  const promoted = await request(`/api/guild/members/manage/${memberIds.member}/rank`, {
    persona: 'owner',
    method: 'PATCH',
    body: { rank: 'Sergeant' },
  })
  assert.equal(promoted.status, 200, promoted.text)

  const billet = await request(`/api/guild/members/manage/${memberIds.member}/billets/billet-steward`, {
    persona: 'owner',
    method: 'PUT',
    body: {},
  })
  assert.equal(billet.status, 200, billet.text)

  let memberInbox = await request('/api/notifications', { persona: 'member' })
  assert.ok(memberInbox.json.notifications.some((item) => item.type === 'rank_changed'))
  assert.ok(memberInbox.json.notifications.some((item) => item.type === 'billet_changed'))

  const signup = await request('/api/quests/member/signup', {
    persona: 'member',
    method: 'POST',
    body: objective,
  })
  assert.equal(signup.status, 200, signup.text)

  const requested = await request('/api/quests/member/request-completion', {
    persona: 'member',
    method: 'POST',
    body: objective,
  })
  assert.equal(requested.status, 201, requested.text)

  const ownerInbox = await request('/api/notifications', { persona: 'owner' })
  const review = ownerInbox.json.notifications.find((item) => item.type === 'completion_requested')
  assert.ok(review)
  assert.equal(review.kind, 'action')
  assert.equal(review.resolvedAt, null)

  const rejected = await request('/api/quests/manage/review-completion', {
    persona: 'owner',
    method: 'POST',
    body: { ...objective, decision: 'rejected', note: 'Double-check the guild bank deposit.' },
  })
  assert.equal(rejected.status, 200, rejected.text)

  const ownerAfter = await request('/api/notifications', { persona: 'owner' })
  assert.ok(ownerAfter.json.notifications.find((item) => item.id === review.id).resolvedAt)

  memberInbox = await request('/api/notifications', { persona: 'member' })
  const changes = memberInbox.json.notifications.find((item) => item.type === 'completion_rejected')
  assert.ok(changes)
  assert.equal(changes.kind, 'action')
  assert.match(changes.message, /Double-check/)
}))
