import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatSyncAge,
  normalizeArmory,
  normalizeIntelligence,
} from '../src/Intelligence/model.js'

test('armory parsing degrades incomplete telemetry into stable empty collections', () => {
  const armory = normalizeArmory({
    character: {
      name: 'Sparse',
      level: '12',
      className: 'Mage',
    },
    equipment: null,
    talents: { nodes: null },
    professions: 'old-format',
  })

  assert.equal(armory.character.name, 'Sparse')
  assert.equal(armory.character.level, 12)
  assert.equal(armory.character.className, 'Mage')
  assert.deepEqual(armory.equipment, [])
  assert.deepEqual(armory.talents.nodes, [])
  assert.deepEqual(armory.talents.edges, [])
  assert.deepEqual(armory.professions, [])
  assert.deepEqual(armory.recipes, [])
  assert.deepEqual(armory.stats, {})
})

test('intelligence parsing ignores malformed collection fields and normalizes counts', () => {
  const data = normalizeIntelligence({
    summary: { characterCount: '3', professionCount: 2, recipeCount: null },
    characters: [{ id: 4, name: null, level: '30' }],
    professions: null,
    classDistribution: [{ name: 'Warrior', count: '2' }],
  })

  assert.equal(data.summary.characterCount, 3)
  assert.equal(data.summary.professionCount, 2)
  assert.equal(data.summary.recipeCount, 0)
  assert.equal(data.characters[0].id, '4')
  assert.equal(data.characters[0].name, 'Unknown adventurer')
  assert.equal(data.characters[0].level, 30)
  assert.deepEqual(data.professions, [])
  assert.deepEqual(data.specDistribution, [])
  assert.deepEqual(data.classDistribution, [{ name: 'Warrior', count: 2 }])
})

test('sync age safely handles missing and malformed timestamps', () => {
  assert.equal(formatSyncAge(null), 'Not synced yet')
  assert.equal(formatSyncAge('not-a-date'), 'Sync time unavailable')
})
