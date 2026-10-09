import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cooldownRemaining,
  itemTooltipIndex,
  overviewSlots,
  railProfessions,
  rankText,
  rankTitle,
  recipeGroups,
  recipesFor,
  withItemTooltip,
} from '../src/Intelligence/professionsModel.js'

const mining = { key: 'id:186', skillLineId: 186, name: 'Mining', current: 270, max: 300 }
const smithing = { key: 'id:164', skillLineId: 164, name: 'Blacksmithing', current: 289, max: 300, modifier: 5 }
const herbalism = { key: 'id:182', skillLineId: 182, name: 'Herbalism', current: 150, max: 150 }
const cooking = { key: 'id:185', skillLineId: 185, name: 'Cooking', kind: 'secondary', current: 40, max: 75 }
const firstAid = { key: 'id:129', skillLineId: 129, name: 'First Aid', kind: 'secondary', current: 1, max: 75 }

test('overview fills two primary slots and the three secondary cards in game order', () => {
  const slots = overviewSlots([firstAid, smithing, cooking])
  assert.deepEqual(slots.primary.map((slot) => slot.profession?.name ?? slot.placeholder), ['Blacksmithing', 'Second Profession'])
  assert.deepEqual(slots.secondary.map((slot) => [slot.name, slot.profession?.current ?? null]), [
    ['Cooking', 40],
    ['Fishing', null],
    ['First Aid', 1],
  ])
  assert.match(slots.secondary[1].missing, /^Visit a trainer to learn fishing/)
})

test('side tabs skip gathering skills without a crafting window', () => {
  const recipes = [{ professionKey: 'id:186', name: 'Smelt Copper' }]
  assert.deepEqual(railProfessions([firstAid, herbalism, smithing, cooking], recipes).map((entry) => entry.name), ['Blacksmithing', 'Cooking', 'First Aid'])
  assert.deepEqual(railProfessions([mining, smithing], recipes).map((entry) => entry.name), ['Mining', 'Blacksmithing'])
  assert.deepEqual(railProfessions([mining], []).map((entry) => entry.name), ['Mining'], 'Mining opens smelting even before a capture')
})

test('recipes match their profession and omit explicitly unknown recipes', () => {
  const recipes = [
    { professionKey: 'id:164', name: 'Copper Bracers' },
    { professionName: 'Blacksmithing', name: 'Rough Sharpening Stone' },
    { professionKey: 'id:164', name: 'Arcanite Reaper', known: false },
    { professionKey: 'id:185', name: 'Roasted Boar Meat' },
  ]
  assert.deepEqual(recipesFor(smithing, recipes).map((recipe) => recipe.name), ['Copper Bracers', 'Rough Sharpening Stone'])
})

test('recipe groups show learned recipes only, hardest first, and search reagents', () => {
  const recipes = [
    { key: 'a', name: 'Iron Buckle', difficulty: 'trivial' },
    { key: 'b', name: 'Thorium Belt', difficulty: 'optimal', reagents: [{ name: 'Thorium Bar' }] },
    { key: 'c', name: 'Copper Axe', difficulty: 'easy' },
    { key: 'd', name: 'Arcanite Reaper', difficulty: 'optimal', known: false },
  ]
  assert.deepEqual(recipeGroups(recipes).map((group) => [group.label, group.recipes.map((recipe) => recipe.key)]), [
    ['Learned', ['b', 'c', 'a']],
  ])
  assert.deepEqual(recipeGroups(recipes, 'thorium bar').map((group) => group.recipes.map((recipe) => recipe.key)), [['b']])
  assert.deepEqual(recipeGroups(recipes, 'arcanite'), [])
})

test('rank text and titles follow the skill cap', () => {
  assert.deepEqual(rankText(smithing), { current: 289, modifier: 5, max: 300 })
  assert.equal(rankTitle(75), 'Apprentice')
  assert.equal(rankTitle(300), 'Artisan')
  assert.equal(rankTitle(0), '')
})

test('cooldowns read like the game timer', () => {
  const now = 1_000_000_000_000
  const at = (seconds) => now / 1000 + seconds
  assert.equal(cooldownRemaining(at(-5), now), '')
  assert.equal(cooldownRemaining(at(30), now), '1 Min')
  assert.equal(cooldownRemaining(at(3 * 3600 + 20 * 60), now), '3 Hr 20 Min')
  assert.equal(cooldownRemaining(at(3 * 3600), now), '3 Hr')
  assert.equal(cooldownRemaining(at(86400 + 4 * 3600), now), '1 Day 4 Hr')
  assert.equal(cooldownRemaining(null, now), '')
})

test('reagents borrow tooltips and missing names or icons from the same books', () => {
  const tooltip = { source: 'C_TooltipInfo.GetHyperlink', lines: [{ left: 'Copper Bar' }, { left: 'Max Stack: 20' }] }
  const index = itemTooltipIndex([
    { name: 'Smelt Copper', crafted: { itemId: 2840, name: 'Copper Bar', iconFileDataId: 133216, qualityId: 1, itemLevel: 10, tooltip } },
    { name: 'Copper Bracers', crafted: { itemId: 2853, name: 'Copper Bracers' }, reagents: [{ itemId: 2840 }] },
    { name: 'Rough Sharpening Stone', reagents: [{ itemId: 2835, name: 'Rough Stone', iconFileId: 135232, qualityId: 1 }] },
  ])
  const bar = withItemTooltip({ itemId: 2840, name: '', iconFileId: null, quantity: 2 }, index)
  assert.equal(bar.name, 'Copper Bar')
  assert.equal(bar.iconFileId, 133216)
  assert.equal(bar.qualityId, 1)
  assert.equal(bar.tooltip, tooltip)
  assert.equal(bar.itemLevel, 10)
  assert.equal(bar.quantity, 2)
  // Uncached in one recipe, named in another.
  const stone = withItemTooltip({ itemId: 2835, quantity: 1 }, index)
  assert.equal(stone.name, 'Rough Stone')
  assert.equal(stone.iconFileId, 135232)
  assert.equal(stone.tooltip, null)
  const unknown = { itemId: 4000, name: 'Mystery' }
  assert.equal(withItemTooltip(unknown, index), unknown)
})
