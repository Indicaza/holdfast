import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { coins, containerLabel, inventoryGroups, normalizeInventory } from '../src/Intelligence/inventoryModel.js'
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
