import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeArmory } from '../src/Intelligence/model.js'

test('Armory keeps talent art, tree hashes, and definition versions', () => {
  const armory = normalizeArmory({
    talents: {
      treeIds: [1117],
      treeHashes: [{ treeId: 1117, treeHash: 'd4383d8c88abbb31cc65594c33ac945d' }],
      art: {
        specialization: { name: 'Warrior', iconFileDataId: 132355 },
        talentTabs: [{
          id: 71,
          name: 'Arms',
          iconFileDataId: 132355,
          background: 'WarriorArms',
          backgroundTextures: {
            topLeft: { path: 'Interface\\TalentFrame\\WarriorArms-TopLeft', fileDataId: 900001 },
          },
        }],
      },
      treeDefinitions: [{
        schemaVersion: 4,
        treeId: 1117,
        treeHash: 'd4383d8c88abbb31cc65594c33ac945d',
        locale: 'enUS',
        metadata: { status: 'complete' },
        art: { tree: { titleText: 'Warrior' } },
      }],
    },
  })

  assert.equal(armory.talents.treeHashes[0].treeHash, 'd4383d8c88abbb31cc65594c33ac945d')
  assert.equal(armory.talents.treeDefinitions[0].treeId, 1117)
  assert.equal(armory.talents.treeDefinitions[0].metadata.status, 'complete')
  assert.equal(armory.talents.art.talentTabs[0].background, 'WarriorArms')
  assert.equal(armory.talents.art.talentTabs[0].backgroundTextures.topLeft.fileDataId, 900001)
})
