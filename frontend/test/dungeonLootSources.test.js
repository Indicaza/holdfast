import test from 'node:test'
import assert from 'node:assert/strict'

import { dungeonItems, sharedSourceLabel } from '../src/Player/Dungeons/atlasModel.js'

const refItem = (itemId, fields = {}) => ({ itemId, itemKey: `i:${itemId}`, name: `Item ${itemId}`, qualityId: 3, slot: 'Chest', observed: false,
  verifiedForForever: false, provenance: [], ...fields })

test('a shared drop is listed under the creatures or chest that drop it', () => {
  assert.equal(sharedSourceLabel({ sourceName: 'Cache of the Firelord' }), 'Cache of the Firelord')
  assert.equal(sharedSourceLabel({ sourceName: null, sources: [{ npcId: 1, name: 'Defias Pirate' }, { npcId: 2, name: 'Defias Taskmaster' }] }),
    'Defias Pirate, Defias Taskmaster')
  assert.equal(sharedSourceLabel({ sources: [1, 2, 3, 4, 5].map((npcId) => ({ npcId, name: `Mob ${npcId}` })) }), 'Mob 1, Mob 2, Mob 3 and 2 more')
  assert.equal(sharedSourceLabel({ sources: [] }), 'Trash and shared drops', 'nothing named: the old label')
  assert.equal(sharedSourceLabel({}), 'Trash and shared drops')
})

test('loot rows: a boss keeps its own items; shared drops name their sources; observed wins', () => {
  const detail = {
    sources: [{ key: 'boss:x', kind: 'boss', name: 'Edwin VanCleef', items: [{ itemId: 5191, itemKey: 'i:5191', name: 'Cruel Barb', nameKnown: true, qualityId: 3 }] }],
    atlas: {
      bosses: [{ encounterId: 2747, name: 'Edwin VanCleef', loot: ['i:5191'], referenceLoot: [refItem(5191, { referenceSources: ['azerothcore', 'dungeon-planner'] })] }],
      dungeonLoot: [refItem(10400, { sourceName: null, sources: [{ npcId: 1, name: 'Defias Pirate' }, { npcId: 2, name: 'Defias Taskmaster' }] })],
      rares: [], quests: [],
    },
  }
  const rows = dungeonItems(detail)
  const barb = rows.find((row) => row.item.itemKey === 'i:5191')
  assert.equal(barb.observed, true, 'seen by Guildweaver: observed wins')
  const shared = rows.find((row) => row.item.itemKey === 'i:10400')
  assert.equal(shared.source, 'Defias Pirate, Defias Taskmaster')
  assert.equal(shared.sourceKind, 'trash')
  assert.equal(rows.filter((row) => row.item.itemKey === 'i:5191').length, 1, 'one row per item')
})
