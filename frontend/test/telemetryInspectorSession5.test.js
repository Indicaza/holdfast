import assert from 'node:assert/strict'
import test from 'node:test'

import { telemetrySessionInfo } from '../src/Admin/telemetryInspectorModel.js'

test('non-session telemetry has no checkpoint metadata', () => {
  const session = telemetrySessionInfo({ eventType: 'character_snapshot' })
  assert.equal(session.sessionId, '')
  assert.equal(session.checkpoint, '')
  assert.equal(session.checkpointLabel, '')
})
