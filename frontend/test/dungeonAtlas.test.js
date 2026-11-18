import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FIXTURE_CHARACTER,
  FIXTURE_DEADMINES_DETAIL,
  FIXTURE_DETAIL_WITHOUT_ATLAS,
  FIXTURE_DUNGEON_LIST,
  FIXTURE_WISHLIST,
} from '../src/Player/Dungeons/__fixtures__/atlas.js'
import {
  bossLoot,
  cardModel,
  dungeonsView,
  entranceMarkers,
  exploreHref,
  exploreOptions,
  filterDungeons,
  groupAbilities,
  levelFit,
  levelText,
  lootRows,
  markerPosition,
  needsUnverifiedBadge,
  normalizeAtlas,
  planScope,
  readAtlasQuery,
  trapFocusIndex,
  wishlistCounts,
  wishlistToggleRequest,
  withAtlasOpen,
  worldMapHref,
} from '../src/Player/Dungeons/atlasModel.js'
import { atlasZone } from '../src/Player/Map/atlas.js'

const names = (list) => list.map((entry) => entry.name)
const wishCounts = wishlistCounts(FIXTURE_WISHLIST.items)

test('the Dungeons page opens on Explore; old run links still land on My runs', () => {
  assert.equal(dungeonsView(''), 'explore')
  assert.equal(dungeonsView('view=loot&character=c1'), 'loot')
  assert.equal(dungeonsView('view=runs'), 'runs')
  assert.equal(dungeonsView('run=7'), 'runs')
  assert.equal(dungeonsView('status=completed'), 'runs')
  assert.equal(dungeonsView('view=nonsense'), 'explore')
})

test('explore filters and the open dungeon round-trip through the URL', () => {
  const href = exploreHref({ server: 'us:fixture', character: 'char-1', filters: { find: 'dead', fit: '1' }, open: 36, section: 'bosses', boss: '2746' })
  assert.equal(href, '/dashboard/dungeons?server=us%3Afixture&character=char-1&find=dead&fit=1&open=36&section=bosses&boss=2746')
  const query = readAtlasQuery(href.split('?')[1])
  assert.equal(query.open, 36)
  assert.equal(query.section, 'bosses')
  assert.equal(query.boss, '2746')
  assert.equal(query.filters.find, 'dead')
  assert.equal(readAtlasQuery('open=abc&section=bogus').open, null)
  assert.equal(readAtlasQuery('open=36&section=bogus').section, 'overview')
})

test('opening and closing the modal keeps server, character and tab', () => {
  const base = '/dashboard/dungeons?server=us%3Afixture&view=loot&character=char-1&dungeon=36'
  const opened = withAtlasOpen(base, { open: 43, section: 'loot' })
  assert.equal(opened, `${base}&open=43&section=loot`)
  assert.equal(withAtlasOpen(opened, { open: null }), base)
  assert.equal(withAtlasOpen('/map?zone=1436&dungeons=1', { open: 36 }), '/map?zone=1436&dungeons=1&open=36')
})

test('cards and the modal degrade gracefully without any atlas', () => {
  const plain = { instanceId: 48, name: 'Blackfathom Deeps', itemCount: 5 }
  const atlas = normalizeAtlas(undefined)
  assert.equal(atlas.known, false)
  assert.deepEqual([atlas.bosses, atlas.maps, atlas.quests, atlas.provenance], [[], [], [], []])
  assert.equal(atlas.entrance, null)
  const card = cardModel(plain, { character: FIXTURE_CHARACTER })
  assert.equal(card.name, 'Blackfathom Deeps')
  assert.equal(card.levels, '')
  assert.equal(card.fit, null)
  assert.equal(card.bossCount, null)
  assert.equal(card.itemCount, 5)
  assert.equal(card.hasEntrance, false)
  // The detail page still lists loot from the real (atlas-less) response.
  assert.equal(normalizeAtlas(FIXTURE_DETAIL_WITHOUT_ATLAS.atlas).known, false)
  assert.equal(lootRows(FIXTURE_DETAIL_WITHOUT_ATLAS).length, 5)
  // Null and junk fields are dropped, not shown.
  const partial = normalizeAtlas({ levelMin: null, entrance: { mapId: 1436, x: null, y: 0.5 }, bosses: null, kind: 'castle' })
  assert.equal(partial.levelMin, null)
  assert.equal(partial.entrance, null)
  assert.deepEqual(partial.bosses, [])
  assert.equal(partial.kind, null)
})

test('level text and level fit for a character', () => {
  const deadmines = FIXTURE_DUNGEON_LIST[0].atlas
  assert.equal(levelText(deadmines), 'Levels 17–26')
  assert.equal(levelText({ levelMin: 60, levelMax: 60 }), 'Level 60')
  assert.equal(levelFit(deadmines, { level: 20 }), 'fit')
  assert.equal(levelFit(deadmines, { level: 10 }), 'under')
  assert.equal(levelFit(deadmines, { level: 40 }), 'over')
  assert.equal(levelFit(deadmines, { level: null }), null)
  assert.equal(levelFit({}, { level: 20 }), null)
})

test('wishlist drops are counted per dungeon, acquired items aside', () => {
  assert.equal(wishCounts.get(36), 2)
  assert.equal(wishCounts.has(43), false)
})

test('explore filters: search, zone, kind, slot, wishlist, fit and level range', () => {
  const ctx = { character: FIXTURE_CHARACTER, wishCounts }
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { find: 'barrens' }, ctx)), ['Wailing Caverns'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { zone: 'Westfall' }, ctx)), ['The Deadmines'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { kind: 'raid' }, ctx)), ['Molten Core'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { lootSlot: 'Wrist' }, ctx)), ['Ragefire Chasm'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { wish: '1' }, ctx)), ['The Deadmines'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { fit: '1' }, ctx)), ['The Deadmines', 'Wailing Caverns'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { lmin: '55' }, ctx)), ['Molten Core'])
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { lmax: '16' }, ctx)), ['Ragefire Chasm'])
  // No filter: everything, fitting dungeons first, atlas-less last.
  const all = names(filterDungeons(FIXTURE_DUNGEON_LIST, {}, ctx))
  assert.equal(all.length, FIXTURE_DUNGEON_LIST.length)
  assert.deepEqual(all.slice(0, 2), ['The Deadmines', 'Wailing Caverns'])
  assert.equal(all.at(-1), 'Blackfathom Deeps')
  const options = exploreOptions(FIXTURE_DUNGEON_LIST)
  assert.ok(options.zones.includes('Westfall'))
  assert.deepEqual(options.kinds, ['dungeon', 'raid'])
  assert.equal(options.levels, true)
  assert.deepEqual(exploreOptions([{ instanceId: 1, name: 'x' }]), { zones: [], slots: [], kinds: [], levels: false })
})

test('abilities group by category with the important first; unverified ones say so', () => {
  const vancleef = FIXTURE_DEADMINES_DETAIL.atlas.bosses[1]
  const groups = groupAbilities([...vancleef.abilities, { name: 'Odd', category: 'unknown-thing', priority: 'low' }])
  assert.deepEqual(groups.map((group) => group.category), ['interrupt', 'tank-danger', 'special-mechanic'])
  assert.deepEqual(groups.at(-1).abilities.map((ability) => ability.name), ['Summon Blackguards', 'Odd'])
  assert.equal(needsUnverifiedBadge(vancleef.abilities[0]), true)
  assert.equal(needsUnverifiedBadge({ verifiedForForever: true }), false)
  assert.deepEqual(groupAbilities(undefined), [])
})

test('boss loot and map markers', () => {
  const [rhahk, vancleef, shredder] = FIXTURE_DEADMINES_DETAIL.atlas.bosses
  assert.deepEqual(bossLoot(vancleef, FIXTURE_DEADMINES_DETAIL).map((row) => row.item.name), ['Cape of the Brotherhood', 'Cruel Barb', 'Blackened Defias Armor'])
  assert.deepEqual(bossLoot(rhahk, FIXTURE_DEADMINES_DETAIL).map((row) => row.item.itemId), [872])
  assert.deepEqual(bossLoot(shredder, FIXTURE_DEADMINES_DETAIL), [])
  assert.deepEqual(markerPosition(rhahk.mapPosition), { left: '22.00%', top: '31.00%' })
  assert.equal(markerPosition(shredder.mapPosition), null)
  assert.equal(markerPosition({ x: 2, y: 0.5 }), null)
})

test('the wishlist toggle uses the existing PUT and DELETE', () => {
  const item = { itemKey: 'i:5193', name: 'Cape of the Brotherhood' }
  assert.deepEqual(wishlistToggleRequest('char 1', item, false, { instanceId: 36, name: 'The Deadmines' }),
    { path: '/api/player/wishlists/char%201/items/i:5193', method: 'PUT', body: { sourceDungeon: 'The Deadmines', sourceInstanceId: 36 } })
  assert.deepEqual(wishlistToggleRequest('char-1', item, true), { path: '/api/player/wishlists/char-1/items/i:5193', method: 'DELETE', body: undefined })
  assert.deepEqual(wishlistToggleRequest('char-1', item, false).body, {})
})

test('Plan My Gear scopes become the planning prompt\'s dungeon ids', () => {
  assert.deepEqual(planScope('dungeon', { dungeon: { instanceId: 36 } }), [36])
  assert.deepEqual(planScope('appropriate', { dungeons: FIXTURE_DUNGEON_LIST, character: FIXTURE_CHARACTER }), [36, 43])
  assert.deepEqual(planScope('all', {}), [])
})

test('world map entrances: only known entrances in placeable zones', () => {
  const markers = entranceMarkers(FIXTURE_DUNGEON_LIST, (mapId) => atlasZone(mapId))
  assert.deepEqual(markers.map((marker) => marker.instanceId), [36, 43, 409])
  const westfall = atlasZone(1436)
  assert.ok(Math.abs(markers[0].world.x - (westfall.rect.x + 0.42 * westfall.rect.width)) < 1e-9)
  assert.equal(markers[2].kind, 'raid')
  assert.equal(worldMapHref(FIXTURE_DUNGEON_LIST[0]), '/map?zone=1436&dungeons=1')
  assert.equal(worldMapHref({ instanceId: 48 }), '/map?dungeons=1')
})

test('the modal focus trap wraps at both ends and pulls focus inside', () => {
  assert.equal(trapFocusIndex(4, 3, false), 0)
  assert.equal(trapFocusIndex(4, 0, true), 3)
  assert.equal(trapFocusIndex(4, 1, false), null)
  assert.equal(trapFocusIndex(4, -1, false), 0)
  assert.equal(trapFocusIndex(4, -1, true), 3)
  assert.equal(trapFocusIndex(0, -1, false), -1)
})

test('the dungeon list adds atlas-only dungeons without duplicating catalog ones', async () => {
  const { listWithAtlasDungeons } = await import('../src/Player/Dungeons/atlasModel.js')
  const list = listWithAtlasDungeons({
    dungeons: [{ instanceId: 34, name: 'The Stockade', itemCount: 4 }],
    atlasDungeons: [{ instanceId: 34, name: 'The Stockade' }, { instanceId: 33, name: 'Shadowfang Keep' }],
  })
  assert.deepEqual(list.map((entry) => entry.instanceId), [34, 33])
  assert.equal(list[0].itemCount, 4)
  assert.deepEqual(listWithAtlasDungeons(null), [])
  assert.deepEqual(listWithAtlasDungeons({ dungeons: [{ instanceId: 1 }] }).length, 1)
})
