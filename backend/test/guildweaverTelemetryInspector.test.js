import assert from 'node:assert/strict'
import test from 'node:test'

import { recordTelemetry } from '../src/Character/telemetryRecordRepository.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

test('generic telemetry is durable, idempotent, sanitized, and inspectable', () => withHttpApp(async ({ request }) => {
  const envelope = {
    schemaVersion: 1,
    eventType: 'character_snapshot',
    capturedAt: 1791248400,
    gameBuild: { version: '1.60.1', build: '60001' },
    realm: 'Classic Beta PvE 2',
    region: 'US',
    installationId: 'install-test',
    characterId: 'character-test',
    payload: {
      name: 'Quill',
      level: 20,
      accountId: 'must-not-survive',
      nested: { battleTag: 'must-not-survive-either', safe: true },
    },
  }

  const first = recordTelemetry({
    deviceId: 'device-telemetry-test',
    memberId: 'e2e-member',
    idempotencyKey: 'gw-test-telemetry-1',
    streamKey: 'character_snapshot:character-test',
    kind: 'state',
    revision: 7,
    envelope,
    receivedAt: '2026-10-06T01:00:03.000Z',
  })
  assert.equal(first.status, 'created')
  assert.equal(first.record.domain, 'character')
  assert.equal(first.record.payload.name, 'Quill')
  assert.equal(first.record.payload.accountId, undefined)
  assert.equal(first.record.payload.nested.battleTag, undefined)
  assert.equal(first.record.payload.nested.safe, true)

  const duplicate = recordTelemetry({
    deviceId: 'device-telemetry-test',
    memberId: 'e2e-member',
    idempotencyKey: 'gw-test-telemetry-1',
    streamKey: 'character_snapshot:character-test',
    kind: 'state',
    revision: 7,
    envelope,
  })
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.record.id, first.record.id)

  const forbidden = await request('/api/admin/guildweaver/telemetry', { persona: 'member' })
  assert.equal(forbidden.status, 403)

  const history = await request('/api/admin/guildweaver/telemetry?domain=character', { persona: 'owner' })
  assert.equal(history.status, 200, history.text)
  const row = history.json.records.find((record) => record.id === first.record.id)
  assert.ok(row)
  assert.equal(row.kind, 'state')
  assert.equal(row.eventType, 'character_snapshot')
  assert.equal(row.revision, 7)

  const detail = await request(`/api/admin/guildweaver/telemetry/${first.record.id}`, { persona: 'owner' })
  assert.equal(detail.status, 200, detail.text)
  assert.equal(detail.json.record.payload.name, 'Quill')
  assert.equal(detail.json.record.payload.accountId, undefined)

  const summary = await request('/api/admin/guildweaver/telemetry/summary', { persona: 'owner' })
  assert.equal(summary.status, 200, summary.text)
  assert.ok(summary.json.summary.records >= 1)
  assert.ok(summary.json.summary.domains.some((entry) => entry.domain === 'character'))
}))
