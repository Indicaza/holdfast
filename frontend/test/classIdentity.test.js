import assert from 'node:assert/strict'
import test from 'node:test'

import { classIdentity } from '../src/Intelligence/classIdentity.js'

test('each class has a primary power for unit frames without power telemetry', () => {
  assert.equal(classIdentity('Warrior').power, 'RAGE')
  assert.equal(classIdentity('Rogue').power, 'ENERGY')
  assert.equal(classIdentity('Paladin').power, 'MANA')
  assert.equal(classIdentity('Druid').power, 'MANA')
  assert.equal(classIdentity('').power, 'MANA', 'unknown classes still get a bar color')
})
