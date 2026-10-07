import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeArmory } from '../src/Intelligence/model.js'

test('armory keeps surname identity and client-native item metadata', () => {
  const armory = normalizeArmory({
    character: {
      id: 'guildweaver-id:character-warrior-rook',
      name: 'Rook Ravenstar',
      firstName: 'Rook',
      lastName: 'Ravenstar',
      displayName: 'Rook Ravenstar',
      className: 'Warrior',
    },
    equipment: [
      {
        slot: 'NeckSlot',
        itemId: 273088,
        name: 'Snake Eye Kaleidoscope',
        quality: 3,
        iconFileId: 134123,
        iconTexture: 'Interface\\Icons\\INV_Misc_Gem_Pearl_05',
        tooltipLines: [
          { left: 'Item Level 22', right: '' },
          { left: '+4 Agility', right: '+3 Stamina' },
        ],
      },
    ],
  })

  assert.equal(armory.character.name, 'Rook Ravenstar')
  assert.equal(armory.character.firstName, 'Rook')
  assert.equal(armory.character.lastName, 'Ravenstar')
  assert.equal(armory.character.displayName, 'Rook Ravenstar')
  assert.equal(armory.equipment[0].iconFileId, 134123)
  assert.equal(armory.equipment[0].iconTexture, 'Interface\\Icons\\INV_Misc_Gem_Pearl_05')
  assert.equal(armory.equipment[0].tooltipLines[1].right, '+3 Stamina')
})
