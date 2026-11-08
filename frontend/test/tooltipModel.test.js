import assert from 'node:assert/strict'
import test from 'node:test'

import { placeTip } from '../src/Player/tooltipModel.js'

const viewport = { width: 1000, height: 800 }
const rect = (left, top, width = 40, height = 20) => ({ left, top, width, height, right: left + width, bottom: top + height })
const tip = { width: 120, height: 30 }

test('a tooltip sits centred above its control', () => {
  assert.deepEqual(placeTip(rect(400, 300), tip, 'top', viewport), { left: 360, top: 262, side: 'top' })
})

test('a tooltip with no room above flips below', () => {
  assert.deepEqual(placeTip(rect(400, 10), tip, 'top', viewport), { left: 360, top: 38, side: 'bottom' })
})

test('a side tooltip flips to the other side at the window edge and stays inside it', () => {
  const placed = placeTip(rect(940, 300), tip, 'right', viewport)
  assert.equal(placed.side, 'left')
  assert.equal(placed.left, 940 - 8 - 120)
  assert.equal(placed.top, 295)
})

test('a tooltip near a corner is clamped into the window', () => {
  const placed = placeTip(rect(2, 400), tip, 'top', viewport)
  assert.equal(placed.left, 8)
})
