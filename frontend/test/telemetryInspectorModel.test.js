import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTelemetryShareBundle,
  telemetryDomainDescriptor,
  telemetrySummaryEntries,
} from '../src/Admin/telemetryInspectorModel.js'

test('telemetry inspector supports unknown domains without bespoke UI', () => {
  const record = {
    domain: 'future_magic',
    payload: { alpha: 1, beta: { enabled: true } },
  }

  assert.equal(telemetryDomainDescriptor(record).label, 'Future Magic')
  assert.deepEqual(telemetrySummaryEntries(record), [
    ['alpha', 1],
    ['beta', { enabled: true }],
  ])
})

test('share bundle is self-describing and retains the canonical envelope', () => {
  const record = {
    id: 12,
    streamKey: 'character_snapshot:abc',
    kind: 'state',
    domain: 'character',
    eventType: 'character_snapshot',
    revision: 4,
    schemaVersion: 1,
    characterId: 'abc',
    installationId: 'install-1',
    deviceId: 'device-1',
    realm: 'Example Realm',
    region: 'US',
    capturedAt: '2026-10-06T12:00:00.000Z',
    receivedAt: '2026-10-06T12:00:01.000Z',
    envelope: {
      schemaVersion: 1,
      eventType: 'character_snapshot',
      payload: { name: 'Rook', level: 20 },
    },
  }

  const bundle = buildTelemetryShareBundle(record)
  assert.equal(bundle.format, 'guildweaver.telemetry-share.v1')
  assert.equal(bundle.metadata.streamKey, record.streamKey)
  assert.deepEqual(bundle.envelope, record.envelope)
})
