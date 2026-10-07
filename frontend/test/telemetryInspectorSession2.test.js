import assert from 'node:assert/strict'
import test from 'node:test'

import { telemetrySessionInfo } from '../src/Admin/telemetryInspectorModel.js'

test('manual telemetry checkpoints get a readable label', () => {
  const session = telemetrySessionInfo({
    eventType: 'character_session_checkpoint',
    streamKey: 'character_session:rook:session-abc:manual',
  })

  assert.equal(session.checkpoint, 'manual')
  assert.equal(session.checkpointLabel, 'Manual checkpoint')
})
