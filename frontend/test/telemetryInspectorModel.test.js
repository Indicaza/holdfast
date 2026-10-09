import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTelemetrySectionShareBundle,
  buildTelemetryShareBundle,
  humanizeTelemetryName,
  telemetryDomainDescriptor,
  telemetryExternalReferences,
  telemetryPayloadSections,
  telemetrySessionInfo,
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

test('normalized telemetry uses semantic labels', () => {
  assert.equal(telemetryDomainDescriptor({ domain: 'talent_tree' }).label, 'Talent Tree')
  assert.equal(telemetryDomainDescriptor({ domain: 'character_session' }).label, 'Session Checkpoint')
  assert.equal(humanizeTelemetryName('iconFileDataId'), 'Icon FileDataID')
  assert.equal(humanizeTelemetryName('qualityId'), 'Quality ID')
  assert.equal(humanizeTelemetryName('rawItemString'), 'Raw Item String')
})

test('session checkpoint metadata is readable from summaries and full payloads', () => {
  const summary = telemetrySessionInfo({
    eventType: 'character_session_checkpoint',
    streamKey: 'character_session:rook:session-abc:start',
  })
  assert.equal(summary.checkpoint, 'start')
  assert.equal(summary.checkpointLabel, 'Session start')

  const detail = telemetrySessionInfo({
    eventType: 'character_session_checkpoint',
    streamKey: 'character_session:rook:session-abc:end',
    envelope: { sessionId: 'session-abc', checkpoint: 'end' },
    payload: { sessionId: 'session-abc', checkpoint: 'end', checkpointReason: 'PLAYER_LOGOUT' },
  })
  assert.equal(detail.sessionId, 'session-abc')
  assert.equal(detail.checkpointLabel, 'Session end')
  assert.equal(detail.reason, 'PLAYER_LOGOUT')
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

test('character schema v3 is split into compact overview and focused sections', () => {
  const record = {
    payload: {
      schemaVersion: 3,
      name: 'Rook',
      realm: 'Classic Beta PvE 2',
      level: 7,
      class: { id: 4, name: 'Rogue', token: 'ROGUE' },
      equipment: [{ slot: 'main_hand', itemId: 7166, iconFileDataId: 135650 }],
      professions: [{ name: 'Leatherworking', skillLineId: 165, skillLevel: 43 }],
      talents: { treeIds: [1111], allocations: [] },
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
  assert.equal(sections[0].value.class.token, 'ROGUE')
  assert.equal(sections[3].value.treeIds[0], 1111)
})

test('session fields stay in the overview instead of creating noisy payload tabs', () => {
  const sections = telemetryPayloadSections({
    payload: {
      name: 'Rook',
      sessionId: 'session-abc',
      checkpoint: 'start',
      checkpointReason: 'SESSION_START',
      equipment: [],
    },
  })

  assert.deepEqual(sections.map((section) => section.key), ['overview', 'equipment'])
  assert.equal(sections[0].value.sessionId, 'session-abc')
  assert.equal(sections[0].value.checkpoint, 'start')
})

test('normalized ids are ready for later WoW API enrichment', () => {
  const record = {
    payload: {
      equipment: [
        { itemId: 7166, iconFileDataId: 135650 },
        { itemId: 5957, iconFileDataId: 132760 },
      ],
      professions: [
        {
          recipes: [
            { recipeId: 1001, craftedItemId: 2853, iconFileDataId: 132604 },
          ],
        },
      ],
      nodes: [
        { entries: [{ spellId: 14162, iconFileDataId: 132292 }] },
      ],
    },
  }

  assert.deepEqual(telemetryExternalReferences(record), {
    itemIds: [2853, 5957, 7166],
    spellIds: [14162],
    iconFileDataIds: [132292, 132604, 132760, 135650],
  })
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
    realm: 'Classic Beta PvE 2',
    payload: {
      schemaVersion: 3,
      name: 'Rook',
      equipment: [{ slot: 'main_hand', itemId: 7166 }],
      talents: { treeIds: [1111], allocations: [] },
    },
  }

  const bundle = buildTelemetrySectionShareBundle(record, 'equipment')
  assert.equal(bundle.format, 'guildweaver.telemetry-section-share.v1')
  assert.equal(bundle.metadata.revision, 13)
  assert.equal(bundle.section.key, 'equipment')
  assert.deepEqual(bundle.section.payload, record.payload.equipment)
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.section, 'talents'), false)
})
test('profession_snapshot records get a Professions view and readable recipe labels', () => {
  const record = {
    domain: 'profession',
    eventType: 'profession_snapshot',
    payload: {
      schemaVersion: 1,
      professions: [{ skillLineId: 164, name: 'Blacksmithing', recipeBook: { knownCount: 1 } }],
    },
  }

  assert.equal(telemetryDomainDescriptor(record).label, 'Professions')
  assert.deepEqual(
    telemetrySummaryEntries(record).map(([key]) => key),
    ['professions', 'schemaVersion'],
  )
  assert.equal(humanizeTelemetryName('knownCount'), 'Known Recipes')
  assert.equal(humanizeTelemetryName('skillUps'), 'Skill Ups')
})
