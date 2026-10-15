import assert from 'node:assert/strict'
import test from 'node:test'

import { itemTooltipPending } from '../src/Intelligence/gameTooltipModel.js'

const lines = [{ left: 'Footman Tunic' }, { left: 'Chest', right: 'Leather' }, { left: '65 Armor' }]

test('a rendered GameTooltip capture is shown', () => {
  assert.equal(itemTooltipPending({ itemId: 2860, tooltip: { source: 'GameTooltip', rendered: true, complete: true, lines } }), false)
})

test('a C_TooltipInfo capture is shown rather than waiting for a rendered one', () => {
  assert.equal(itemTooltipPending({ itemId: 2860, tooltip: { source: 'C_TooltipInfo', lines } }), false)
  assert.equal(itemTooltipPending({ itemId: 2860, tooltip: { source: 'C_TooltipInfo', rendered: false, complete: false, lines } }), false)
})

test('an item with no captured lines waits for Guildweaver', () => {
  assert.equal(itemTooltipPending({ itemId: 2860, name: 'Footman Tunic' }), true)
  assert.equal(itemTooltipPending({ itemId: 2860, tooltip: { source: 'GameTooltip', lines: [] } }), true)
})

test('farming results read the capture from the nested item', () => {
  assert.equal(itemTooltipPending({ itemKey: 'item:2770', item: { itemId: 2770, tooltip: { source: 'C_TooltipInfo', lines: [{ left: 'Copper Ore' }] } } }), false)
})

test('non-item tooltips never wait', () => {
  assert.equal(itemTooltipPending({ name: 'Blacksmithing' }), false)
})
