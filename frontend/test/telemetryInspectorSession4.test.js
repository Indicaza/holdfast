import assert from 'node:assert/strict'
import test from 'node:test'

import { telemetrySessionInfo } from '../src/Admin/telemetryInspectorModel.js'

test('unknown checkpoints remain readable', () => {
  const session = telemetrySessionInfo({
    envelope: { checkpoint: 'mid_session' },
  })

  assert.equal(session.checkpointLabel, 'Mid Session')
})
