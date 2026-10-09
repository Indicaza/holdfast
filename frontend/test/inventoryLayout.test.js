import assert from 'node:assert/strict'
import test from 'node:test'

import { SIDE_COLUMNS, windowsLayout } from '../src/Intelligence/inventoryLayout.js'

const bag = (kind, slots) => ({ kind, slots: Array.from({ length: slots }, (_, index) => ({ id: `${kind}:${index}` })) })

test('a small inventory in a big pane keeps the wide game shape, scaled up to the cap', () => {
  const layout = windowsLayout([bag('combined', 34)], { width: 925, height: 530 })
  assert.equal(layout.columns, 10)
  assert.equal(layout.stacked, false)
  assert.ok(layout.scale > 1.5 && layout.scale <= 1.8)
})

test('a bag with a reagent bag beside it picks the columns that draw slots largest', () => {
  const windows = [bag('reagent', 16), bag('combined', 40)]
  const layout = windowsLayout(windows, { width: 925, height: 530 })
  assert.ok(layout.columns < 10, 'fewer, taller columns fill the height better')
  assert.ok(layout.scale > 1.3)
  assert.deepEqual(windowsLayout(windows, { width: 925, height: 530 }), layout, 'deterministic')
  assert.equal(SIDE_COLUMNS, 4)
})

test('a phone stacks the windows and scrolls rather than shrinking below game size', () => {
  const layout = windowsLayout([bag('reagent', 16), bag('combined', 40)], { width: 350, height: 630 })
  assert.equal(layout.stacked, true)
  assert.ok(layout.scale >= 1)
  assert.ok(layout.columns >= 4 && layout.columns <= 7)
})

test('an unmeasured pane renders at game size', () => {
  assert.deepEqual(windowsLayout([bag('combined', 20)], { width: 0, height: 0 }), { columns: 10, scale: 1, stacked: false })
})
