import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { bagFrame, bagRows, coins, containerLabel, inventoryGroups, inventorySummary, normalizeInventory } from '../src/Intelligence/inventoryModel.js'
import { normalizeArmory } from '../src/Intelligence/model.js'

// The armory sends the canonical model (backend inventoryModel.js); the raw
// fixture payload has the same containers/items/money shape.
const fixture = JSON.parse(
  fs.readFileSync(new URL('../../backend/test/fixtures/guildweaver-inventory-snapshot.v1.json', import.meta.url), 'utf8'),
)

function armoryInventory() {
  return { ...structuredClone(fixture.payload), telemetry: { revision: 3, capturedAt: '2026-10-09T12:00:00.000Z' } }
}

test('bags lay out every slot and join stacks to their item descriptions', () => {
  const inventory = normalizeInventory(armoryInventory())
  assert.equal(inventory.bags.length, 2)
  assert.equal(inventory.slotCount, 22)
  assert.equal(inventory.usedSlots, 6)
  assert.equal(inventory.freeSlots, 16)
  assert.equal(inventory.revision, 3)

  const [backpack, linen] = inventory.bags
  assert.equal(backpack.label, 'Backpack')
  assert.equal(backpack.slots.length, 16, 'empty slots are kept so the bag keeps its shape')
  assert.equal(backpack.slots[6].item.name, 'Raider Shortsword of the Tiger')
  assert.equal(backpack.slots[6].item.isBound, true)
  assert.equal(backpack.slots[1].item.count, 20)
  assert.equal(backpack.slots[1].item.tooltip.lines[0].left, 'Copper Ore')
  assert.equal(backpack.slots[1].item.itemLevel, null, 'materials hide item level')
  assert.equal(backpack.slots[6].item.itemLevel, 18, 'gear keeps item level')
  assert.equal(backpack.slots[4].item, null)
  assert.equal(linen.label, 'Linen Bag')
  assert.equal(linen.iconFileId, 133622)
})

test('money splits into gold, silver and copper', () => {
  assert.deepEqual(normalizeInventory(armoryInventory()).money, { copper: 1234567, gold: 123, silver: 45, copperRemainder: 67 })
  assert.deepEqual(coins(-5), { copper: 0, gold: 0, silver: 0, copperRemainder: 0 })
})

test('all items folds stacks together, materials first', () => {
  const groups = inventoryGroups(normalizeInventory(armoryInventory()))
  assert.deepEqual(groups.map((group) => group.name), ['Trade Goods', 'Weapon', 'Miscellaneous'])
  const ore = groups[0].items.find((item) => item.itemId === 2770)
  assert.equal(ore.count, 25)
  assert.equal(ore.stacks, 3)
})

test('missing or empty inventory telemetry normalizes to null', () => {
  assert.equal(normalizeInventory(undefined), null)
  assert.equal(normalizeInventory({ containers: [] }), null)
  assert.equal(normalizeArmory({}).inventory, null)
  assert.equal(normalizeArmory({ inventory: armoryInventory() }).inventory.bags.length, 2)
  assert.equal(containerLabel({ kind: 'keyring', bagId: -2 }), 'Keyring')
})

test('bags lay out four to a row with a short first row, as the game does', () => {
  const slots = (size) => Array.from({ length: size }, (_, index) => ({ slot: index + 1 }))
  assert.deepEqual(bagRows(slots(6)).map((row) => [row.lead, row.cells.map((cell) => cell.slot)]), [[true, [1, 2]], [false, [3, 4, 5, 6]]])
  assert.deepEqual(bagRows(slots(8)).map((row) => row.cells.length), [4, 4])
  assert.deepEqual(bagRows(slots(7)).map((row) => row.cells.length), [3, 4])

  assert.equal(bagFrame({ kind: 'backpack', slotCount: 16 }), 'backpack')
  assert.equal(bagFrame({ kind: 'backpack', slotCount: 20 }), 'full', 'a non-standard backpack uses bag art')
  assert.equal(bagFrame({ kind: 'bag', slotCount: 6 }), 'partial')
  assert.equal(bagFrame({ kind: 'bag', slotCount: 7 }), 'full')

  const [backpack, linen] = normalizeInventory(armoryInventory()).bags
  assert.equal(backpack.frame, 'backpack')
  assert.equal(linen.frame, 'partial')
  assert.equal(linen.rows.length, 2)
})

test('the keyring is shown only when it holds keys and never counts as bag space', () => {
  const source = armoryInventory()
  source.containers.push({ bagId: -2, kind: 'keyring', slotCount: 12, freeSlots: 12, slots: [] })
  const empty = normalizeInventory(source)
  assert.equal(empty.bags.some((bag) => bag.kind === 'keyring'), false)
  assert.equal(empty.slotCount, 22)

  source.containers[2].slots = [{ slot: 1, itemKey: 'item:5396', itemId: 5396, count: 1 }]
  source.containers[2].freeSlots = 11
  const keyed = normalizeInventory(source)
  assert.equal(keyed.bags.at(-1).label, 'Keyring')
  assert.equal(keyed.slotCount, 22)
  assert.equal(keyed.freeSlots, 16)
})

test('tooltips price the whole stack and the summary adds up the bags', () => {
  const inventory = normalizeInventory(armoryInventory())
  const ore = inventory.bags[0].slots[1].item
  assert.equal(ore.unitSellPrice, 5)
  assert.equal(ore.sellPrice, 100, 'twenty ore at 5c')

  const summary = inventorySummary(inventory)
  // 25 ore x 5c + 7 leather x 15c + sword 461c + hearthstone 0c
  assert.equal(summary.vendorValue.copper, 125 + 105 + 461)
  assert.equal(summary.distinctItems, 4)
  assert.equal(summary.stacks, 6)
  assert.deepEqual(summary.materials.map((item) => [item.name, item.count]), [['Copper Ore', 25], ['Light Leather', 7]])
})

test('items marked as having no value are not priced', () => {
  const source = armoryInventory()
  source.containers[0].slots[1].hasNoValue = true
  const inventory = normalizeInventory(source)
  assert.equal(inventory.bags[0].slots[1].item.sellPrice, null)
  assert.equal(inventorySummary(inventory).vendorValue.copper, 125 + 105 + 461 - 100)
})
