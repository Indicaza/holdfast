import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ingestGuildweaverTelemetry,
  readGuildweaverTelemetryHistory,
  readGuildweaverTelemetryRecord,
  readGuildweaverTelemetrySummary,
} from '../src/Guildweaver/telemetryRepository.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

function collectorHealthRecord(overrides = {}) {
  return {
    streamKey: overrides.streamKey || 'collector_health_snapshot:oscilloscope-fixture',
    revision: overrides.revision || 1,
    envelope: {
      schemaVersion: 1,
      eventType: 'collector_health_snapshot',
      capturedAt: 1791270000,
      gameBuild: {
        version: '1.60.1',
        build: '60001',
        interface: 16001,
      },
      realm: 'Classic Beta PvE 2',
      region: 'US',
      installationId: 'install-oscilloscope-fixture',
      characterId: 'character-oscilloscope-fixture',
      guildId: 'guild-oscilloscope-fixture',
      payload: {
        schemaVersion: 1,
        addonVersion: '0.5.0-alpha.1',
        savedVariablesSchemaVersion: 4,
        capabilities: {
          characterSnapshot: true,
          professionSnapshot: true,
          inventorySnapshot: true,
          orderedEventQueue: true,
        },
        observed: {
          stateStreamCount: 4,
          professionCount: 2,
          knownRecipeCount: 37,
        },
        eventQueue: {
          queued: 3,
          capacity: 512,
          dropped: 0,
        },
        ...overrides.payload,
      },
    },
  }
}

function seedTelemetry(suffix = 'default') {
  return ingestGuildweaverTelemetry({
    deviceId: `device-${suffix}`,
    memberId: 'e2e-member',
    idempotencyKey: `gw-test-${suffix}`,
    record: collectorHealthRecord({
      streamKey: `collector_health_snapshot:${suffix}`,
    }),
    receivedAt: '2026-10-06T12:00:03.000Z',
  })
}

test('generic telemetry storage is idempotent and preserves the canonical envelope', () => {
  const created = seedTelemetry('idempotent')
  assert.equal(created.status, 'created')
  assert.equal(created.record.kind, 'state')
  assert.equal(created.record.eventType, 'collector_health_snapshot')
  assert.equal(created.record.capturedAt, '2026-10-06T11:00:00.000Z')
  assert.equal(created.record.payload.eventQueue.capacity, 512)

  const duplicate = ingestGuildweaverTelemetry({
    deviceId: 'device-idempotent',
    memberId: 'e2e-member',
    idempotencyKey: 'gw-test-idempotent',
    record: collectorHealthRecord({
      streamKey: 'collector_health_snapshot:idempotent',
    }),
    receivedAt: '2026-10-06T12:00:04.000Z',
  })
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.record.id, created.record.id)

  const detail = readGuildweaverTelemetryRecord(created.record.id)
  assert.equal(detail.streamKey, 'collector_health_snapshot:idempotent')
  assert.equal(detail.envelope.payload.addonVersion, '0.5.0-alpha.1')
  assert.deepEqual(detail.payload, detail.envelope.payload)
})

test('telemetry storage rejects privacy exclusions before persistence', () => {
  const result = ingestGuildweaverTelemetry({
    deviceId: 'device-private',
    memberId: 'e2e-member',
    idempotencyKey: 'gw-test-private',
    record: collectorHealthRecord({
      streamKey: 'collector_health_snapshot:private',
      payload: { battleTag: 'DoNotCollect#1234' },
    }),
  })

  assert.equal(result.status, 'invalid')
  assert.equal(result.error, 'telemetry_privacy_rejected')
  assert.equal(result.field, 'battleTag')
})

test('telemetry history automatically facets arbitrary future event types', () => {
  const created = seedTelemetry('facets')
  assert.equal(created.status, 'created')

  const future = ingestGuildweaverTelemetry({
    deviceId: 'device-facets',
    memberId: 'e2e-member',
    idempotencyKey: 'gw-test-future-event',
    record: {
      streamKey: 'event:future-domain-fixture',
      revision: 1,
      envelope: {
        schemaVersion: 1,
        eventType: 'future_domain_observation',
        capturedAt: 1791270001,
        realm: 'Classic Beta PvE 2',
        installationId: 'install-oscilloscope-fixture',
        characterId: 'character-oscilloscope-fixture',
        payload: { futureField: true },
      },
    },
  })
  assert.equal(future.status, 'created')
  assert.equal(future.record.kind, 'event')

  const history = readGuildweaverTelemetryHistory({ q: 'futureField', limit: 10 })
  assert.ok(history.records.some((record) => record.id === future.record.id))

  const summary = readGuildweaverTelemetrySummary()
  assert.ok(summary.eventTypes.some((entry) => entry.eventType === 'collector_health_snapshot'))
  assert.ok(summary.eventTypes.some((entry) => entry.eventType === 'future_domain_observation'))
})

test('oscilloscope admin endpoints are protected and expose individual records', () => withHttpApp(async ({ request }) => {
  const seeded = seedTelemetry('admin-api')
  assert.equal(seeded.status, 'created')

  const anonymous = await request('/api/admin/guildweaver/telemetry')
  assert.equal(anonymous.status, 401)

  const member = await request('/api/admin/guildweaver/telemetry', { persona: 'member' })
  assert.equal(member.status, 403)

  const owner = await request('/api/admin/guildweaver/telemetry?eventType=collector_health_snapshot', { persona: 'owner' })
  assert.equal(owner.status, 200, owner.text)
  assert.ok(owner.json.records.some((record) => record.id === seeded.record.id))

  const detail = await request(`/api/admin/guildweaver/telemetry/${seeded.record.id}`, { persona: 'owner' })
  assert.equal(detail.status, 200, detail.text)
  assert.equal(detail.json.record.payload.addonVersion, '0.5.0-alpha.1')

  const summary = await request('/api/admin/guildweaver/summary', { persona: 'owner' })
  assert.equal(summary.status, 200, summary.text)
  assert.ok(summary.json.summary.telemetry.records >= 1)
}))
