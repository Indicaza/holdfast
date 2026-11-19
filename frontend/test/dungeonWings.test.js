import test from 'node:test'
import assert from 'node:assert/strict'

import { FIXTURE_SM_DUNGEON, FIXTURE_SM_WINGS } from '../src/Player/Dungeons/__fixtures__/wings.js'
import {
  cardModel,
  entranceMarkers,
  entryKey,
  exploreHref,
  isWingEntry,
  listWithAtlasDungeons,
  normalizeAtlas,
  openId,
  planScope,
  readAtlasQuery,
  runHistory,
  runsForEntry,
  wishlistTargets,
  withAtlasOpen,
} from '../src/Player/Dungeons/atlasModel.js'

const DEADMINES = { instanceId: 36, name: 'The Deadmines', type: 'party', atlas: { dungeonKey: 'deadmines', levelMin: 15, levelMax: 28 } }

test('a dungeon played as wings is listed once per wing; others stay as they were', () => {
  const list = listWithAtlasDungeons({ dungeons: [DEADMINES, FIXTURE_SM_DUNGEON], atlasWings: FIXTURE_SM_WINGS })
  assert.deepEqual(list.map(entryKey), [36, 'scarlet-monastery:graveyard', 'scarlet-monastery:library'])
  assert.ok(list.slice(1).every((entry) => entry.instanceId === 189), 'the wings share the game instance ID')
  // A server without wings (or an old response) changes nothing.
  assert.deepEqual(listWithAtlasDungeons({ dungeons: [DEADMINES, FIXTURE_SM_DUNGEON] }).map(entryKey), [36, 189])
  // Wings of a dungeon the catalog has not seen are still listed.
  assert.deepEqual(listWithAtlasDungeons({ dungeons: [DEADMINES], atlasWings: FIXTURE_SM_WINGS }).map(entryKey), [36, 'scarlet-monastery:graveyard', 'scarlet-monastery:library'])
})

test('keys: a wing by its key, a dungeon by its instance ID; old numeric links keep working', () => {
  assert.equal(openId('36'), 36)
  assert.equal(openId('Scarlet-Monastery:Library'), 'scarlet-monastery:library')
  assert.equal(openId('scarlet-monastery'), null, 'only wing keys and numbers open a dungeon')
  assert.equal(openId('../x:y'), null)
  assert.equal(readAtlasQuery('open=189').open, 189, 'the old link opens the dungeon, never a wing')
  assert.equal(readAtlasQuery('open=scarlet-monastery%3Alibrary&section=bosses').open, 'scarlet-monastery:library')
  assert.match(exploreHref({ open: 'scarlet-monastery:library' }), /open=scarlet-monastery%3Alibrary/)
  assert.equal(withAtlasOpen('/dashboard/dungeons?open=189&section=bosses', { open: 'scarlet-monastery:library' }), '/dashboard/dungeons?open=scarlet-monastery%3Alibrary')
  assert.equal(isWingEntry(FIXTURE_SM_WINGS[0]), true)
  assert.equal(isWingEntry(FIXTURE_SM_DUNGEON), false, 'the dungeon key alone is not a wing')
})

test('a wing card is its own: name, levels, bosses', () => {
  const card = cardModel(FIXTURE_SM_WINGS[1])
  assert.deepEqual([card.id, card.name, card.wing, card.levels, card.bossCount], ['scarlet-monastery:library', 'Scarlet Monastery — Library', 'Library', 'Levels 32–40', 2])
  assert.equal(cardModel(DEADMINES).id, 36)
  const atlas = normalizeAtlas(FIXTURE_SM_DUNGEON.atlas)
  assert.deepEqual(atlas.wingEntries.map((wing) => wing.dungeonKey), ['scarlet-monastery:graveyard', 'scarlet-monastery:library'])
  assert.equal(normalizeAtlas(FIXTURE_SM_WINGS[0].atlas).wing, 'Graveyard')
})

test('wishlist targets: a sibling wing\'s boss is not this wing\'s; shared sources count for every wing', () => {
  const dungeons = [DEADMINES, ...FIXTURE_SM_WINGS]
  const wanted = (itemKey, sources) => ({ itemKey, itemId: Number(itemKey.slice(2)), state: 'wanted', sources })
  const targets = wishlistTargets([
    wanted('i:7714', [{ instanceId: 189, bossName: 'Arcanist Doan', npcId: 6487 }]),
    wanted('i:7683', [{ instanceId: 189, source: 'Bloodmage Thalnos' }]),
    wanted('i:5000', [{ instanceId: 189, source: 'Scarlet Myrmidon' }]),
    wanted('i:5191', [{ instanceId: 36, source: 'Edwin VanCleef' }]),
    { ...wanted('i:7682', []), state: 'acquired' },
  ], dungeons)
  assert.deepEqual(targets.get('scarlet-monastery:library'), ['i:7714', 'i:5000'])
  assert.deepEqual(targets.get('scarlet-monastery:graveyard'), ['i:7683', 'i:5000'])
  assert.deepEqual(targets.get(189), ['i:7714', 'i:7683', 'i:5000'], 'the dungeon as a whole, as before')
  assert.deepEqual(targets.get(36), ['i:5191'])
  // By reference item id: only the wing whose loot it is.
  const byReference = wishlistTargets([wanted('i:7682', [])], dungeons)
  assert.deepEqual([byReference.get('scarlet-monastery:graveyard'), byReference.get('scarlet-monastery:library')], [['i:7682'], undefined])
})

test('run history: a wing counts only runs its boss kills prove', () => {
  const run = (id, wing = null, status = 'completed') => ({ id, status, startedAt: 100 + id, durationSeconds: 900 + id,
    dungeon: { name: 'Scarlet Monastery', instanceId: 189, dungeonKey: wing || 'scarlet-monastery', wing: wing ? { dungeonKey: wing } : null } })
  const runs = [run(1, 'scarlet-monastery:library'), run(2, 'scarlet-monastery:library', 'abandoned'), run(3), run(4, 'scarlet-monastery:graveyard')]
  const history = runHistory(runs)
  assert.deepEqual([history.get(FIXTURE_SM_WINGS[1]).count, history.get(FIXTURE_SM_WINGS[1]).completed], [2, 1])
  assert.equal(history.get(FIXTURE_SM_WINGS[0]).count, 1)
  assert.equal(history.get(FIXTURE_SM_DUNGEON).count, 4, 'the dungeon keeps every run, ambiguous ones included')
  assert.deepEqual(runsForEntry(runs, FIXTURE_SM_WINGS[1]).map((entry) => entry.id), [1, 2])
  assert.deepEqual(runsForEntry(runs, FIXTURE_SM_DUNGEON).map((entry) => entry.id), [1, 2, 3, 4])
  // Runs from before wings (no dungeonKey) still count for the dungeon.
  assert.equal(runHistory([{ id: 9, status: 'completed', dungeon: { name: 'Scarlet Monastery', instanceId: 189 } }]).get(FIXTURE_SM_DUNGEON).count, 1)
})

test('the planning prompt and the world map see one instance per dungeon', () => {
  const character = { name: 'Rook', level: 35 }
  assert.deepEqual(planScope('appropriate', { dungeons: [...FIXTURE_SM_WINGS], character }), [189], 'wings are one instance to the prompt')
  const markers = entranceMarkers(FIXTURE_SM_WINGS, () => ({ rect: { x: 0, y: 0, width: 100, height: 100 } }))
  assert.deepEqual(markers.map((marker) => [marker.key, marker.open, marker.instanceId]),
    [['dungeon:scarlet-monastery:graveyard', 'scarlet-monastery:graveyard', 189], ['dungeon:scarlet-monastery:library', 'scarlet-monastery:library', 189]])
})
