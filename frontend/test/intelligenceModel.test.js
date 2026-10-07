import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canonicalEquipmentSlot,
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
  assert.deepEqual(armory.gameData.items, {})
})

test('armory parsing retains reconstructed tree metadata', () => {
  const armory = normalizeArmory({
    talents: {
      configId: 10001,
      treeId: 20001,
      treeIds: [20001, 20002],
      pointsSpent: 10,
      pointsAvailable: 1,
      nodes: [],
      edges: [],
    },
  })

  assert.equal(armory.talents.configId, 10001)
  assert.equal(armory.talents.treeId, 20001)
  assert.deepEqual(armory.talents.treeIds, [20001, 20002])
  assert.equal(armory.talents.pointsSpent, 10)
  assert.equal(armory.talents.pointsAvailable, 1)
})

test('armory enriches canonical IDs from shared game data while character state wins', () => {
  const armory = normalizeArmory({
    character: { name: 'Rook' },
    gameData: {
      items: {
        11746: {
          id: '11746',
          name: 'Golem Skull Helm',
          iconFileId: 132767,
          qualityId: 3,
          metadata: {
            itemLevel: 35,
            requiredLevel: 25,
            mediaUrl: 'https://render.worldofwarcraft.com/us/icons/56/inv_helmet_25.jpg',
          },
        },
        3860: {
          id: '3860',
          name: 'Mithril Bar',
          iconFileId: 134579,
          metadata: {},
        },
      },
      spells: {
        12975: {
          id: '12975',
          name: 'Last Stand',
          iconFileId: 135871,
          metadata: {
            description: 'Temporarily increases maximum health.',
            mediaUrl: 'https://render.worldofwarcraft.com/us/icons/56/spell_holy_ashestoashes.jpg',
          },
        },
      },
      professions: {
        164: {
          id: '164',
          name: 'Blacksmithing',
          iconFileId: 136241,
          metadata: {},
        },
      },
      recipes: {
        9789: {
          id: '9789',
          name: 'Mithril Spurs',
          iconFileId: 132307,
          metadata: {},
        },
      },
    },
    equipment: [{ itemId: 11746, slot: 'HEAD', itemLevel: 36 }],
    talents: {
      nodes: [{ id: 1, entries: [{ spellId: 12975 }] }],
    },
    professions: [{ id: 164, current: 225, max: 225 }],
    recipes: [{ id: 9789, reagents: [{ itemId: 3860, quantity: 4 }] }],
  })

  assert.equal(armory.equipment[0].name, 'Golem Skull Helm')
  assert.equal(armory.equipment[0].iconFileId, 132767)
  assert.equal(armory.equipment[0].quality, 3)
  assert.equal(armory.equipment[0].requiredLevel, 25)
  assert.equal(armory.equipment[0].itemLevel, 36)
  assert.equal(armory.equipment[0].mediaUrl, 'https://render.worldofwarcraft.com/us/icons/56/inv_helmet_25.jpg')
  assert.equal(armory.talents.nodes[0].entries[0].name, 'Last Stand')
  assert.equal(armory.talents.nodes[0].entries[0].description, 'Temporarily increases maximum health.')
  assert.equal(armory.talents.nodes[0].entries[0].mediaUrl, 'https://render.worldofwarcraft.com/us/icons/56/spell_holy_ashestoashes.jpg')
  assert.equal(armory.professions[0].name, 'Blacksmithing')
  assert.equal(armory.recipes[0].name, 'Mithril Spurs')
  assert.equal(armory.recipes[0].reagents[0].name, 'Mithril Bar')
})

test('Blizzard equipment slot names map onto the paper doll', () => {
  assert.equal(canonicalEquipmentSlot('HeadSlot'), 'HEAD')
  assert.equal(canonicalEquipmentSlot('MainHandSlot'), 'MAINHAND')
  assert.equal(canonicalEquipmentSlot('SecondaryHandSlot'), 'OFFHAND')
  assert.equal(canonicalEquipmentSlot('Finger0Slot'), 'FINGER1')
  assert.equal(canonicalEquipmentSlot('Finger1Slot'), 'FINGER2')
  assert.equal(canonicalEquipmentSlot('Trinket0Slot'), 'TRINKET1')
  assert.equal(canonicalEquipmentSlot('Trinket1Slot'), 'TRINKET2')
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
