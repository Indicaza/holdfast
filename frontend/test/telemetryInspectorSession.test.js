import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTelemetryShareBundle,
  telemetrySessionInfo,
} from '../src/Admin/telemetryInspectorModel.js'

test('session checkpoint share bundles retain session metadata for debugging', () => {
  const record = {
    id: 42,
    streamKey: 'character_session:rook:session-abc:end',
    kind: 'event',
    domain: 'character_session',
    eventType: 'character_session_checkpoint',
    revision: 1,
    schemaVersion: 1,
    characterId: 'rook',
    realm: 'Classic Beta PvE 2',
    envelope: {
      schemaVersion: 1,
      eventType: 'character_session_checkpoint',
      sessionId: 'session-abc',
      checkpoint: 'end',
      payload: {
        name: 'Rook',
        checkpointReason: 'PLAYER_LOGOUT',
      },
    },
    payload: {
      name: 'Rook',
      checkpointReason: 'PLAYER_LOGOUT',
    },
  }

  const session = telemetrySessionInfo(record)
  const bundle = buildTelemetryShareBundle(record)

  assert.equal(session.sessionId, 'session-abc')
  assert.equal(session.checkpointLabel, 'Session end')
  assert.equal(session.reason, 'PLAYER_LOGOUT')
  assert.equal(bundle.metadata.sessionId, 'session-abc')
  assert.equal(bundle.metadata.checkpoint, 'end')
})
