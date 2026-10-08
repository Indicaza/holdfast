import assert from 'node:assert/strict'
import test from 'node:test'

import {
  sortTelemetryRecordsNewest,
  telemetryPayloadLabel,
  telemetrySinceForWindow,
  telemetrySourceInfo,
} from '../src/Admin/telemetryInspectorModel.js'

test('activity helpers answer what, who, and newest first', () => {
  const records = [
    {
      id: 1,
      eventType: 'character_snapshot',
      receivedAt: '2026-10-08T03:00:00.000Z',
      characterName: 'Quill',
      memberName: 'Zach',
      className: 'Mage',
      realm: 'Classic Beta PvE 2',
    },
    {
      id: 2,
      eventType: 'talent_tree_definition',
      receivedAt: '2026-10-08T03:05:00.000Z',
      memberName: 'Zach',
      realm: 'Classic Beta PvE 2',
    },
  ]

  assert.equal(telemetryPayloadLabel(records[1]), 'Talent Tree Definition')
  assert.deepEqual(telemetrySourceInfo(records[0]), {
    primary: 'Quill',
    secondary: 'Zach · Mage · Classic Beta PvE 2',
    kind: 'character',
  })
  assert.equal(telemetrySourceInfo(records[1]).primary, 'Zach')
  assert.deepEqual(sortTelemetryRecordsNewest(records).map((record) => record.id), [2, 1])
})

test('received-time windows produce stable server filter boundaries', () => {
  const now = Date.parse('2026-10-08T04:00:00.000Z')
  assert.equal(telemetrySinceForWindow('1h', now), '2026-10-08T03:00:00.000Z')
  assert.equal(telemetrySinceForWindow('24h', now), '2026-10-07T04:00:00.000Z')
  assert.equal(telemetrySinceForWindow('', now), '')
})
