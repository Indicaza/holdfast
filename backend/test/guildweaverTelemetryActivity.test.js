import assert from 'node:assert/strict'
import test from 'node:test'

import { recordTelemetry } from '../src/Character/telemetryRecordRepository.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

function record({ idempotencyKey, characterId, name, eventType, receivedAt, revision = 1 }) {
  return recordTelemetry({
    deviceId: 'device-telemetry-activity',
    memberId: 'e2e-member',
    idempotencyKey,
    streamKey: `${eventType}:${characterId}`,
    kind: 'state',
    revision,
    envelope: {
      schemaVersion: 1,
      eventType,
      capturedAt: receivedAt,
      realm: 'Classic Beta PvE 2',
      characterId,
      payload: {
        schemaVersion: 3,
        name,
        class: { name: name === 'Quill' ? 'Mage' : 'Warrior' },
      },
    },
    receivedAt,
  })
}

test('telemetry activity is newest-first and supports human debug filters', () => withHttpApp(async ({ request }) => {
  const older = record({
    idempotencyKey: 'gw-activity-old',
    characterId: 'character-quill',
    name: 'Quill',
    eventType: 'character_snapshot',
    receivedAt: '2026-10-08T03:00:00.000Z',
  })
  const newer = record({
    idempotencyKey: 'gw-activity-new',
    characterId: 'character-rook',
    name: 'Rook',
    eventType: 'talent_tree_definition',
    receivedAt: '2026-10-08T03:05:00.000Z',
  })

  assert.equal(older.status, 'created')
  assert.equal(newer.status, 'created')

  const history = await request('/api/admin/guildweaver/telemetry?limit=100', { persona: 'owner' })
  assert.equal(history.status, 200, history.text)
  const ids = history.json.records.map((entry) => entry.id)
  assert.ok(ids.indexOf(newer.record.id) < ids.indexOf(older.record.id), 'newer activity should appear first')

  const quill = history.json.records.find((entry) => entry.id === older.record.id)
  assert.equal(quill.characterName, 'Quill')
  assert.equal(quill.className, 'Mage')

  const byCharacter = await request('/api/admin/guildweaver/telemetry?character=quill&limit=100', { persona: 'owner' })
  assert.equal(byCharacter.status, 200, byCharacter.text)
  assert.ok(byCharacter.json.records.some((entry) => entry.id === older.record.id))
  assert.ok(!byCharacter.json.records.some((entry) => entry.id === newer.record.id))

  const byPayload = await request('/api/admin/guildweaver/telemetry?payloadType=talent_tree&limit=100', { persona: 'owner' })
  assert.equal(byPayload.status, 200, byPayload.text)
  assert.ok(byPayload.json.records.some((entry) => entry.id === newer.record.id))
  assert.ok(!byPayload.json.records.some((entry) => entry.id === older.record.id))

  const byTime = await request('/api/admin/guildweaver/telemetry?since=2026-10-08T03:04:00.000Z&limit=100', { persona: 'owner' })
  assert.equal(byTime.status, 200, byTime.text)
  assert.ok(byTime.json.records.some((entry) => entry.id === newer.record.id))
  assert.ok(!byTime.json.records.some((entry) => entry.id === older.record.id))

  const characters = await request('/api/admin/guildweaver/telemetry/characters?q=quill&limit=12', { persona: 'owner' })
  assert.equal(characters.status, 200, characters.text)
  assert.ok(characters.json.characters.some((entry) => entry.characterId === 'character-quill' && entry.characterName === 'Quill'))

  const summary = await request('/api/admin/guildweaver/telemetry/summary', { persona: 'owner' })
  assert.equal(summary.status, 200, summary.text)
  assert.ok(summary.json.summary.eventTypes.some((entry) => entry.eventType === 'talent_tree_definition'))
}))
