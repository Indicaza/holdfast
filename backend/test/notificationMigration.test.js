import assert from 'node:assert/strict'
import test from 'node:test'

import { withGuildTransaction } from '../src/Data/database.js'
import { createNotificationInDatabase } from '../src/Notification/notificationRepository.js'
import { memberIds, withHttpApp } from '../testSupport/httpHarness.js'

test('notification schema keeps recipient foreign keys, open dedupe uniqueness, and kind constraints intact', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const indexes = db.prepare("PRAGMA index_list('notifications')").all().map((row) => row.name)
    assert.ok(indexes.includes('notifications_recipient_created_idx'))
    assert.ok(indexes.includes('notifications_recipient_attention_idx'))
    assert.ok(indexes.includes('notifications_open_dedupe_idx'))

    const first = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.member,
      type: 'schema_test',
      kind: 'action',
      title: 'Schema test',
      dedupeKey: 'schema:open',
      now: '2026-10-04T01:00:00.000Z',
    })

    assert.throws(
      () => db.prepare(`
        INSERT INTO notifications (
          id, recipient_member_id, event_type, kind, title,
          message, href, entity_type, entity_id, data_json,
          dedupe_key, created_at, updated_at
        ) VALUES (?, ?, 'schema_test', 'action', 'Duplicate', '', '', '', '', '{}', ?, ?, ?)
      `).run('duplicate-open', memberIds.member, 'schema:open', '2026-10-04T01:01:00.000Z', '2026-10-04T01:01:00.000Z'),
      /unique constraint/i,
    )

    assert.throws(
      () => db.prepare(`
        INSERT INTO notifications (
          id, recipient_member_id, event_type, kind, title,
          message, href, entity_type, entity_id, data_json,
          created_at, updated_at
        ) VALUES (?, ?, 'schema_test', 'invalid', 'Bad kind', '', '', '', '', '{}', ?, ?)
      `).run('bad-kind', memberIds.member, '2026-10-04T01:02:00.000Z', '2026-10-04T01:02:00.000Z'),
      /check constraint/i,
    )

    db.prepare('UPDATE notifications SET resolved_at = ? WHERE id = ?').run('2026-10-04T02:00:00.000Z', first.id)
    const replacement = createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.member,
      type: 'schema_test',
      kind: 'action',
      title: 'New open cycle',
      dedupeKey: 'schema:open',
      now: '2026-10-04T03:00:00.000Z',
    })
    assert.notEqual(replacement.id, first.id)

    assert.throws(
      () => db.prepare(`
        INSERT INTO notifications (
          id, recipient_member_id, event_type, kind, title,
          message, href, entity_type, entity_id, data_json,
          created_at, updated_at
        ) VALUES ('missing-member-notification', 'does-not-exist', 'schema_test', 'update', 'Missing member', '', '', '', '', '{}', ?, ?)
      `).run('2026-10-04T04:00:00.000Z', '2026-10-04T04:00:00.000Z'),
      /foreign key constraint/i,
    )
  })
}))

test('deleting a member cascades their private notification history and leaves other inboxes untouched', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.member,
      type: 'member_private',
      title: 'Member private',
    })
    createNotificationInDatabase({
      db,
      recipientMemberId: memberIds.officer,
      type: 'officer_private',
      title: 'Officer private',
    })

    db.prepare('DELETE FROM members WHERE id = ?').run(memberIds.member)

    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_member_id = ?').get(memberIds.member).count), 0)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_member_id = ?').get(memberIds.officer).count), 1)
  })
}))
