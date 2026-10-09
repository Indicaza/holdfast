import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { coins, itemSearchText, leadingGap, matchesSearch, normalizeInventory, searchTerms } from '../src/Intelligence/inventoryModel.js'
import { normalizeArmory } from '../src/Intelligence/model.js'

// The armory sends the canonical model (backend inventoryModel.js); the raw
// fixture payload has the same containers/items/money shape.
const fixture = JSON.parse(
  fs.readFileSync(new URL('../../backend/test/fixtures/guildweaver-inventory-snapshot.v1.json', import.meta.url), 'utf8'),
)

function armoryInventory() {
  return { ...structuredClone(fixture.payload), telemetry: { revision: 3, capturedAt: '2026-10-09T12:00:00.000Z' } }
}

function slotsOf(window) {
  return window.slots.map((entry) => entry.item?.name ?? null)
}

test('the combined backpack holds every bag, the backpack at the bottom, with every slot', () => {
  const inventory = normalizeInventory(armoryInventory())
  assert.deepEqual(inventory.windows.map((window) => window.kind), ['combined'])
  const [combined] = inventory.windows
  assert.equal(combined.title, 'Combined Backpack')
  assert.equal(combined.iconFileId, 133633, 'the backpack portrait')
  assert.equal(combined.slots.length, 22, 'six linen bag slots and sixteen backpack slots')
  assert.deepEqual(slotsOf(combined).slice(0, 6), ['Light Leather', 'Copper Ore', null, null, null, null], 'the linen bag comes first')
  assert.equal(combined.slots[6].item.name, 'Hearthstone', 'then backpack slot 1')
  assert.equal(combined.slots[12].item.name, 'Raider Shortsword of the Tiger')
  assert.equal(new Set(combined.slots.map((entry) => entry.id)).size, 22, 'slot ids are unique across bags')
  assert.equal(inventory.slotCount, 22)
  assert.equal(inventory.usedSlots, 6)
  assert.equal(inventory.freeSlots, 16)
})

test('reagent bags get their own window, and a keyring only when it holds keys', () => {
  const source = armoryInventory()
  source.containers.push(
    { bagId: 5, kind: 'reagent', name: 'Hefty Reagent Pack', slotCount: 8, freeSlots: 7, iconFileDataId: 133634, slots: [{ slot: 1, itemKey: 'item:2770::::::::20:::::::', itemId: 2770, count: 3 }] },
    { bagId: -2, kind: 'keyring', slotCount: 12, freeSlots: 12, slots: [] },
  )
  const inventory = normalizeInventory(source)
  assert.deepEqual(inventory.windows.map((window) => [window.kind, window.title]), [['reagent', 'Hefty Reagent Pack'], ['combined', 'Combined Backpack']])
  assert.equal(inventory.windows[0].slots.length, 8)
  assert.equal(inventory.windows[0].slots[0].item.name, 'Copper Ore')
  assert.equal(inventory.slotCount, 30, 'reagent bag space counts')

  source.containers.at(-1).slots = [{ slot: 1, itemKey: 'item:5396', itemId: 5396, count: 1 }]
  const keyed = normalizeInventory(source)
  assert.deepEqual(keyed.windows.map((window) => window.title), ['Hefty Reagent Pack', 'Keyring', 'Combined Backpack'])
  assert.equal(keyed.slotCount, 30, 'keyring slots are not bag space')
})

test('a short first row is pushed right, as the game lays out bags', () => {
  assert.equal(leadingGap(22, 10), 8)
  assert.equal(leadingGap(40, 10), 0)
  assert.equal(leadingGap(16, 4), 0)
  assert.equal(leadingGap(34, 7), 1)
})

test('tooltips price the whole stack and unsellable stacks are not priced', () => {
  const source = armoryInventory()
  const combined = normalizeInventory(source).windows[0]
  const ore = combined.slots.find((entry) => entry.item?.count === 20).item
  assert.equal(ore.unitSellPrice, 5)
  assert.equal(ore.sellPrice, 100)

  source.containers[0].slots[1].hasNoValue = true
  const unsellable = normalizeInventory(source).windows[0].slots.find((entry) => entry.item?.count === 20).item
  assert.equal(unsellable.sellPrice, null)
})

test('search matches names, types, slots, quality, tooltip text and binding', () => {
  const items = normalizeInventory(armoryInventory()).windows[0].slots.filter((entry) => entry.item).map((entry) => entry.item)
  const find = (query) => items.filter((item) => matchesSearch(itemSearchText(item), searchTerms(query))).map((item) => item.name)
  const unique = (names) => [...new Set(names)]

  assert.deepEqual(unique(find('ore')), ['Copper Ore'])
  assert.deepEqual(unique(find('trade goods')), ['Light Leather', 'Copper Ore'], 'item class')
  assert.deepEqual(unique(find('sword')), ['Raider Shortsword of the Tiger'], 'subclass')
  assert.deepEqual(unique(find('one-hand')), ['Raider Shortsword of the Tiger'], 'equip slot')
  assert.deepEqual(unique(find('uncommon')), ['Raider Shortsword of the Tiger'], 'quality')
  assert.deepEqual(unique(find('agility')), ['Raider Shortsword of the Tiger'], 'tooltip text')
  assert.deepEqual(unique(find('soulbound')), ['Hearthstone', 'Raider Shortsword of the Tiger'], 'binding')
  assert.deepEqual(unique(find('reagent')), ['Light Leather', 'Copper Ore'], 'crafting reagents')
  assert.deepEqual(unique(find('  COPPER   ore ')), ['Copper Ore'], 'every word must match, any case')
  assert.deepEqual(find('nothing like this'), [])
  assert.deepEqual(searchTerms(''), [])
})

test('money splits into gold, silver and copper', () => {
  assert.deepEqual(normalizeInventory(armoryInventory()).money, { copper: 1234567, gold: 123, silver: 45, copperRemainder: 67 })
  assert.deepEqual(coins(-5), { copper: 0, gold: 0, silver: 0, copperRemainder: 0 })
})

test('missing or empty inventory telemetry normalizes to null', () => {
  assert.equal(normalizeInventory(undefined), null)
  assert.equal(normalizeInventory({ containers: [] }), null)
  assert.equal(normalizeArmory({}).inventory, null)
  assert.equal(normalizeArmory({ inventory: armoryInventory() }).inventory.windows.length, 1)
})
