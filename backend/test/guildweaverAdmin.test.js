import assert from 'node:assert/strict'
import test from 'node:test'

import { recordCharacterSnapshotInDatabase } from '../src/Character/characterSnapshotRepository.js'
import { withGuildTransaction } from '../src/Data/database.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

function seedSnapshot() {
  return withGuildTransaction((db) => {
    db.prepare(`
      INSERT OR IGNORE INTO characters (
        id, member_id, name, race, class_name, spec,
        professions_json, is_main, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 99)
    `).run(
      'guildweaver-admin-fixture',
      'e2e-member',
      'Quill',
      'Human',
      'Mage',
      'Frost',
    )

    return recordCharacterSnapshotInDatabase({
      db,
      characterId: 'guildweaver-admin-fixture',
      source: 'guildweaver',
      capturedAt: '2026-10-06T01:00:00.000Z',
      receivedAt: '2026-10-06T01:00:03.000Z',
      deviceId: 'device-debug-fixture',
      bridgeRevision: 42,
      payload: {
        schemaVersion: 1,
        capturedAt: 1791248400,
        reason: 'PLAYER_LOGOUT',
        addonVersion: '0.4.0-alpha.1',
        name: 'Quill',
        realm: 'Classic Beta PvE 2',
        level: 20,
        race: { name: 'Human' },
        class: { name: 'Mage' },
        specialization: { name: 'Frost' },
        professions: [],
        equipment: [],
      },
    })
  })
}

test('Guildweaver admin payload history is site-admin only', () => withHttpApp(async ({ request }) => {
  seedSnapshot()

  const anonymous = await request('/api/admin/guildweaver/summary')
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.json.error, 'authentication_required')

  const member = await request('/api/admin/guildweaver/snapshots', { persona: 'member' })
  assert.equal(member.status, 403)
  assert.equal(member.json.error, 'permission_required')

  const owner = await request('/api/admin/guildweaver/summary', { persona: 'owner' })
  assert.equal(owner.status, 200, owner.text)
  assert.ok(owner.json.summary.snapshots >= 1)
  assert.ok(owner.json.summary.characters >= 1)
}))

test('Guildweaver admin history exposes searchable summaries and exact payload detail', () => withHttpApp(async ({ request }) => {
  const seeded = seedSnapshot()

  const history = await request('/api/admin/guildweaver/snapshots?q=Quill&limit=10', { persona: 'owner' })
  assert.equal(history.status, 200, history.text)
  assert.ok(history.json.snapshots.length >= 1)

  const row = history.json.snapshots.find((snapshot) => snapshot.id === seeded.id)
  assert.ok(row)
  assert.equal(row.characterName, 'Quill')
  assert.equal(row.deviceId, 'device-debug-fixture')
  assert.equal(row.bridgeRevision, 42)
  assert.equal(row.reason, 'PLAYER_LOGOUT')
  assert.equal(row.addonVersion, '0.4.0-alpha.1')
  assert.equal(row.lagMs, 3000)
  assert.ok(row.payloadBytes > 0)

  const detail = await request(`/api/admin/guildweaver/snapshots/${seeded.id}`, { persona: 'owner' })
  assert.equal(detail.status, 200, detail.text)
  assert.equal(detail.json.snapshot.payload.name, 'Quill')
  assert.equal(detail.json.snapshot.payload.level, 20)
  assert.equal(detail.json.snapshot.payload.reason, 'PLAYER_LOGOUT')

  const missing = await request('/api/admin/guildweaver/snapshots/99999999', { persona: 'owner' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error, 'snapshot_not_found')
}))
