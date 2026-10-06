import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTelemetrySectionShareBundle,
  buildTelemetryShareBundle,
  telemetryDomainDescriptor,
  telemetryPayloadSections,
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

test('character payload is split into compact overview and focused sections', () => {
  const record = {
    payload: {
      name: 'Rook',
      realm: 'Darkwing',
      level: 7,
      class: { id: 4, name: 'Rogue' },
      equipment: [{ slot: 'MainHandSlot', itemId: 7166 }],
      professions: [{ name: 'Leatherworking', skillLevel: 43 }],
      talents: { trees: [{ id: 1111, nodes: new Array(40).fill({ rank: 0 }) }] },
    },
  }

  const sections = telemetryPayloadSections(record)
  assert.deepEqual(sections.map((section) => section.key), [
    'overview',
    'equipment',
    'professions',
    'talents',
  ])
  assert.equal(sections[0].value.name, 'Rook')
  assert.equal(sections[0].value.class.name, 'Rogue')
  assert.equal(sections[3].value.trees[0].id, 1111)
})

test('focused share bundle includes metadata and only the selected payload section', () => {
  const record = {
    id: 13,
    streamKey: 'character_snapshot:rook',
    kind: 'state',
    domain: 'character',
    eventType: 'character_snapshot',
    revision: 13,
    schemaVersion: 1,
    characterId: 'rook',
    realm: 'Darkwing',
    payload: {
      name: 'Rook',
      equipment: [{ slot: 'MainHandSlot', itemId: 7166 }],
      talents: { trees: [{ id: 1111 }] },
    },
  }

  const bundle = buildTelemetrySectionShareBundle(record, 'equipment')
  assert.equal(bundle.format, 'guildweaver.telemetry-section-share.v1')
  assert.equal(bundle.metadata.revision, 13)
  assert.equal(bundle.section.key, 'equipment')
  assert.deepEqual(bundle.section.payload, record.payload.equipment)
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.section, 'talents'), false)
})
