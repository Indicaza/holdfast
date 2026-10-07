import assert from 'node:assert/strict'
import test from 'node:test'

import { telemetrySessionInfo } from '../src/Admin/telemetryInspectorModel.js'

test('checkpoint inference falls back to the event stream key', () => {
  const session = telemetrySessionInfo({
    eventType: 'character_session_checkpoint',
    streamKey: 'character_session:rook:session-xyz:start',
  })

  assert.equal(session.checkpoint, 'start')
  assert.equal(session.checkpointLabel, 'Session start')
})
