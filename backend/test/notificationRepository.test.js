import assert from 'node:assert/strict'
import test from 'node:test'

import { withGuildTransaction } from '../src/Data/database.js'
import {
  createNotificationInDatabase,
  markAllNotificationsRead,
  markNotificationRead,
  readMemberNotificationsFromDatabase,
  resolveNotificationsInDatabase,
} from '../src/Notification/notificationRepository.js'
import { memberIds, withHttpApp } from '../testSupport/httpHarness.js'

function create(db, overrides = {}) {
  return createNotificationInDatabase({
    db,
    recipientMemberId: memberIds.member,
    type: 'test_event',
    title: 'Test notification',
    ...overrides,
  })
}

test('notification creation validates required fields and ignores inactive recipients', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    assert.throws(
      () => createNotificationInDatabase({ db, recipientMemberId: '', type: 'x', title: 'x' }),
      /recipient, type, and title are required/i,
    )
    assert.throws(
      () => createNotificationInDatabase({ db, recipientMemberId: memberIds.member, type: '', title: 'x' }),
      /recipient, type, and title are required/i,
    )
    assert.throws(
      () => createNotificationInDatabase({ db, recipientMemberId: memberIds.member, type: 'x', title: '' }),
      /recipient, type, and title are required/i,
    )

    db.prepare("UPDATE members SET status = 'departed' WHERE id = ?").run(memberIds.member)
    assert.equal(create(db), null)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM notifications').get().count), 0)
  })
}))

test('notification normalization, open dedupe, and reissue semantics stay stable', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const first = create(db, {
      type: `  ${'event'.repeat(30)}  `,
      kind: 'unexpected-kind',
      title: `  ${'T'.repeat(200)}  `,
      message: `  ${'M'.repeat(1300)}  `,
      href: `/${'h'.repeat(600)}`,
      entityType: ' objective ',
      entityId: ` ${'id'.repeat(100)} `,
      data: { questId: 'quest-1', nested: { ok: true } },
      dedupeKey: ' shared-key ',
      now: '2026-10-04T01:00:00.000Z',
    })

    assert.equal(first.kind, 'update')
    assert.equal(first.type.length, 96)
    assert.equal(first.title.length, 160)
    assert.equal(first.message.length, 1200)
    assert.equal(first.href.length, 500)
    assert.equal(first.entityType, 'objective')
    assert.equal(first.entityId.length, 160)
    assert.deepEqual(first.data, { questId: 'quest-1', nested: { ok: true } })

    const marked = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run('2026-10-04T01:30:00.000Z', first.id)
    assert.equal(marked.changes, 1)

    const reopened = create(db, {
      type: 'completion_requested',
      kind: 'action',
      title: 'Review again',
      message: 'The work changed.',
      dedupeKey: 'shared-key',
      now: '2026-10-04T02:00:00.000Z',
    })

    assert.equal(reopened.id, first.id)
    assert.equal(reopened.kind, 'action')
    assert.equal(reopened.readAt, null)
    assert.equal(reopened.createdAt, '2026-10-04T02:00:00.000Z')

    const otherRecipient = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.officer,
      type: 'completion_requested',
      kind: 'action',
      title: 'Same logical work',
      dedupeKey: 'shared-key',
      now: '2026-10-04T02:00:00.000Z',
    })
    assert.notEqual(otherRecipient.id, first.id)

    assert.equal(resolveNotificationsInDatabase(db, { dedupeKey: 'shared-key', now: '2026-10-04T03:00:00.000Z' }), 2)

    const reissued = create(db, {
      type: 'completion_requested',
      kind: 'action',
      title: 'A genuinely new cycle',
      dedupeKey: 'shared-key',
      now: '2026-10-04T04:00:00.000Z',
    })
    assert.notEqual(reissued.id, first.id)

    const memberInbox = readMemberNotificationsFromDatabase(db, memberIds.member)
    assert.equal(memberInbox.notifications.length, 2)
    assert.equal(memberInbox.notifications[0].id, reissued.id)
    assert.equal(memberInbox.notifications[1].id, first.id)
    assert.equal(memberInbox.unreadCount, 1)
    assert.equal(memberInbox.actionCount, 1)
  })
}))

test('resolution can target one recipient or every recipient without conflating read state', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const member = create(db, { kind: 'action', dedupeKey: 'review:1' })
    const officer = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.officer,
      type: 'test_event',
      kind: 'action',
      title: 'Officer copy',
      dedupeKey: 'review:1',
    })

    assert.equal(resolveNotificationsInDatabase(db, { dedupeKey: '' }), 0)
    assert.equal(resolveNotificationsInDatabase(db, {
      dedupeKey: 'review:1',
      recipientMemberId: memberIds.member,
      now: '2026-10-04T05:00:00.000Z',
    }), 1)

    let memberInbox = readMemberNotificationsFromDatabase(db, memberIds.member)
    let officerInbox = readMemberNotificationsFromDatabase(db, memberIds.officer)
    assert.equal(memberInbox.notifications.find((item) => item.id === member.id).readAt, null)
    assert.ok(memberInbox.notifications.find((item) => item.id === member.id).resolvedAt)
    assert.equal(memberInbox.unreadCount, 0)
    assert.equal(memberInbox.actionCount, 0)
    assert.equal(officerInbox.unreadCount, 1)
    assert.equal(officerInbox.actionCount, 1)

    assert.equal(resolveNotificationsInDatabase(db, {
      dedupeKey: 'review:1',
      now: '2026-10-04T06:00:00.000Z',
    }), 1)
    officerInbox = readMemberNotificationsFromDatabase(db, memberIds.officer)
    assert.ok(officerInbox.notifications.find((item) => item.id === officer.id).resolvedAt)
    assert.equal(officerInbox.unreadCount, 0)
    assert.equal(officerInbox.actionCount, 0)
  })
}))

test('inbox reads are ordered, bounded, and tolerant of malformed historical metadata', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    for (let index = 0; index < 105; index += 1) {
      create(db, {
        type: `event-${index}`,
        title: `Notification ${index}`,
        now: new Date(Date.UTC(2026, 9, 4, 0, 0, index)).toISOString(),
      })
    }

    const newest = db.prepare('SELECT id FROM notifications ORDER BY created_at DESC LIMIT 1').get().id
    db.prepare("UPDATE notifications SET data_json = 'not-json' WHERE id = ?").run(newest)

    const maxed = readMemberNotificationsFromDatabase(db, memberIds.member, { limit: 1000 })
    assert.equal(maxed.notifications.length, 100)
    assert.equal(maxed.notifications[0].id, newest)
    assert.deepEqual(maxed.notifications[0].data, {})

    const minimum = readMemberNotificationsFromDatabase(db, memberIds.member, { limit: -10 })
    assert.equal(minimum.notifications.length, 1)
    assert.equal(minimum.notifications[0].id, newest)

    const defaulted = readMemberNotificationsFromDatabase(db, memberIds.member, { limit: 'not-a-number' })
    assert.equal(defaulted.notifications.length, 40)
  })
}))

test('single and bulk read operations are private, idempotent, and preserve resolution', () => withHttpApp(async () => {
  const ids = withGuildTransaction((db) => {
    const open = create(db, { kind: 'action', dedupeKey: 'read-open' })
    const resolved = create(db, { kind: 'action', dedupeKey: 'read-resolved' })
    resolveNotificationsInDatabase(db, { dedupeKey: 'read-resolved' })
    const other = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.officer,
      type: 'other',
      title: 'Other recipient',
    })
    return { open: open.id, resolved: resolved.id, other: other.id }
  })

  assert.equal(markNotificationRead(memberIds.member, ids.other), null)

  const first = markNotificationRead(memberIds.member, ids.open)
  assert.ok(first.readAt)
  const second = markNotificationRead(memberIds.member, ids.open)
  assert.equal(second.readAt, first.readAt)

  const updated = markAllNotificationsRead(memberIds.member)
  assert.equal(updated, 1)
  assert.equal(markAllNotificationsRead(memberIds.member), 0)

  withGuildTransaction((db) => {
    const inbox = readMemberNotificationsFromDatabase(db, memberIds.member)
    assert.equal(inbox.unreadCount, 0)
    assert.equal(inbox.actionCount, 1)
    const resolved = inbox.notifications.find((item) => item.id === ids.resolved)
    assert.ok(resolved.readAt)
    assert.ok(resolved.resolvedAt)
  })
}))
