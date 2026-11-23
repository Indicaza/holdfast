import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FIXTURE_CHARACTER,
  FIXTURE_DEADMINES_DETAIL,
  FIXTURE_DETAIL_SPRINT1,
  FIXTURE_DETAIL_WITHOUT_ATLAS,
  FIXTURE_DUNGEON_LIST,
  FIXTURE_DUNGEON_LIST_SPRINT1,
  FIXTURE_WISHLIST,
} from '../src/Player/Dungeons/__fixtures__/atlas.js'
import {
  FIT_COPY,
  atlasSection,
  bindText,
  bossLoot,
  fitText,
  lootBySource,
  sourceDisplayName,
  withCanonicalSources,
  defaultRole,
  dungeonItems,
  gearTargets,
  itemFacts,
  questModel,
  quickGuide,
  recommendDungeon,
  runHistory,
  wishlistTargets,
  withCharacter,
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
import { listWithAtlasDungeons as listWithAtlasDungeonsForFailure, loadFailureDetail } from '../src/Player/Dungeons/atlasModel.js'
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
  // Bosses are chosen on the Overview now: an old "bosses" section is written as the Overview.
  assert.equal(href, '/dashboard/dungeons?server=us%3Afixture&character=char-1&find=dead&fit=1&open=36&boss=2746')
  const query = readAtlasQuery(href.split('?')[1])
  assert.equal(query.open, 36)
  assert.equal(query.section, 'journal')
  // Old links keep working: a boss link opens that boss, Prepare opens Quests.
  assert.equal(readAtlasQuery('open=36&section=bosses&boss=2746').section, 'journal')
  assert.equal(readAtlasQuery('open=36&section=bosses&boss=2746').boss, '2746')
  assert.equal(readAtlasQuery('open=36&section=prepare').section, 'quests')
  assert.equal(withAtlasOpen('/dashboard/dungeons', { open: 36, section: 'prepare' }), '/dashboard/dungeons?open=36&section=quests')
  assert.equal(query.boss, '2746')
  assert.equal(query.filters.find, 'dead')
  assert.equal(readAtlasQuery('open=abc&section=bogus').open, null)
  assert.equal(readAtlasQuery('open=36&section=bogus').section, 'journal')
})

test('opening and closing the modal keeps server, character and tab', () => {
  const base = '/dashboard/dungeons?server=us%3Afixture&view=loot&character=char-1&dungeon=36'
  const opened = withAtlasOpen(base, { open: 43, section: 'loot' })
  assert.equal(opened, `${base}&open=43&loot=all`)
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
  const vancleef = FIXTURE_DEADMINES_DETAIL.atlas.bosses.find((boss) => boss.name === 'Edwin VanCleef')
  const groups = groupAbilities([...vancleef.abilities, { name: 'Odd', category: 'unknown-thing', priority: 'low' }])
  assert.deepEqual(groups.map((group) => group.category), ['interrupt', 'tank-danger', 'special-mechanic'])
  assert.deepEqual(groups.at(-1).abilities.map((ability) => ability.name), ['Summon Blackguards', 'Odd'])
  assert.equal(needsUnverifiedBadge(vancleef.abilities[0]), true)
  assert.equal(needsUnverifiedBadge({ verifiedForForever: true }), false)
  assert.deepEqual(groupAbilities(undefined), [])
})

test('boss loot and map markers', () => {
  const boss = (name) => FIXTURE_DEADMINES_DETAIL.atlas.bosses.find((entry) => entry.name === name)
  const [rhahk, vancleef, shredder] = [boss('Rhahk\'Zor'), boss('Edwin VanCleef'), boss('Sneed\'s Shredder')]
  // Observed loot first, then reference-only items; an item that is both stays one row.
  const rows = bossLoot(vancleef, FIXTURE_DEADMINES_DETAIL)
  assert.deepEqual(rows.map((row) => row.item.name), ['Cape of the Brotherhood', 'Cruel Barb', 'Blackened Defias Armor', 'Corsair\'s Overshirt', 'An Unsent Letter'])
  assert.deepEqual(rows.map((row) => [row.observed, row.reference]), [[true, true], [true, true], [true, true], [false, true], [false, true]])
  // Reference facts fill what the observed record lacks; observed facts win.
  assert.equal(rows[0].item.armor, 21)
  assert.equal(rows[0].item.itemLevel, 25)
  assert.equal(rows[2].item.setName, 'Defias Leather')
  assert.deepEqual(bossLoot(rhahk, FIXTURE_DEADMINES_DETAIL).map((row) => row.item.itemId), [872])
  assert.equal(bossLoot(rhahk, FIXTURE_DEADMINES_DETAIL)[0].reference, true)
  // The sprint-1 backend: no referenceLoot, observed loot only.
  assert.deepEqual(bossLoot(FIXTURE_DETAIL_SPRINT1.atlas.bosses.find((entry) => entry.name === 'Edwin VanCleef'), FIXTURE_DETAIL_SPRINT1).map((row) => row.item.itemId), [5193, 5191, 10399])
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

test('spawn layouts count as maps; empty map entries do not', async () => {
  const { normalizeAtlas } = await import('../src/Player/Dungeons/atlasModel.js')
  const layout = { floorId: 'layout', kind: 'spawn-layout', imageUrl: null, width: 600, height: 400, points: [[0.1, 0.2]] }
  const atlas = normalizeAtlas({ maps: [layout, { floorId: 'blank', imageUrl: null, points: [] }, { floorId: 'art', imageUrl: '/maps/a.png' }] })
  assert.deepEqual(atlas.maps.map((map) => map.floorId), ['layout', 'art'])
})

test('wishlist targets: known sources plus reference item ids; acquired items aside', () => {
  const targets = wishlistTargets(FIXTURE_WISHLIST.items, FIXTURE_DUNGEON_LIST)
  assert.deepEqual(targets.get(36), ['i:5193', 'i:5191', 'i:5202'])
  assert.equal(targets.has(43), false)
  // Without the sprint-2 list fields only the wishlist's own sources count.
  assert.deepEqual(wishlistTargets(FIXTURE_WISHLIST.items, FIXTURE_DUNGEON_LIST_SPRINT1).get(36), ['i:5193', 'i:5191'])
})

test('dungeon items: boss, trash and quest-reward rows, each item once', () => {
  const rows = dungeonItems(FIXTURE_DEADMINES_DETAIL)
  const keys = rows.map((row) => row.item.itemKey)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(rows.find((row) => row.item.itemId === 10400).sourceKind, 'trash')
  const staff = rows.find((row) => row.item.itemId === 2042)
  assert.equal(staff.sourceKind, 'quest')
  assert.equal(staff.choice, true)
  assert.equal(rows.find((row) => row.item.itemId === 1937).sourceKind, 'other')
  assert.equal(rows.find((row) => row.item.itemId === 1930).source, 'Defias Miner')
  assert.deepEqual(dungeonItems(FIXTURE_DETAIL_WITHOUT_ATLAS).map((row) => row.item.itemId), [872, 5193, 5191, 10399, 1937])
})

test('gear targets: class restriction and required level within the dungeon range only', () => {
  const rows = [
    { item: { itemKey: 'i:1', name: 'Now', slot: 'Chest', requiredLevel: 18 } },
    { item: { itemKey: 'i:2', name: 'Later', slot: 'Chest', requiredLevel: 24 } },
    { item: { itemKey: 'i:3', name: 'Too far', slot: 'Chest', requiredLevel: 40 } },
    { item: { itemKey: 'i:4', name: 'Mage only', slot: 'Head', classes: ['Mage'] } },
    { item: { itemKey: 'i:5', name: 'Linen Cloth', slot: null } },
    { item: { itemKey: 'i:6', name: 'Unknown', slot: 'Feet' } },
  ]
  const targets = gearTargets(rows, { name: 'Rook', level: 20, className: 'Rogue' }, { levelMin: 17, levelMax: 26 })
  assert.deepEqual(targets.map((row) => [row.item.name, row.usableNow]).sort(), [['Later', false], ['Now', true], ['Unknown', true]])
  assert.deepEqual(gearTargets(rows, null), [])
})

test('gear targets: armour and weapon types the class can use (Classic proficiencies)', () => {
  const item = (id, name, itemClass, itemSubclass, requiredLevel = 30, slot = 'Chest') => ({ item: { itemKey: `i:${id}`, name, itemClass, itemSubclass, requiredLevel, slot } })
  const rows = [
    item(1, 'Leather vest', 'Armor', 'Leather'), item(2, 'Mail hauberk', 'Armor', 'Mail'), item(3, 'Plate helm', 'Armor', 'Plate', 44, 'Head'),
    item(4, 'Shield', 'Armor', 'Shields', 30, 'Off Hand'), item(5, 'Dagger', 'Weapon', 'Daggers', 30, 'One-Hand'),
    item(6, 'Great axe', 'Weapon', 'Two-Handed Axes', 30, 'Two-Hand'), item(7, 'Mace', 'Weapon', 'One-Handed Maces', 30, 'Main Hand'),
    item(8, 'Orb', 'Armor', 'Miscellaneous', 30, 'Held In Off-hand'), item(9, 'Ring', 'Armor', 'Miscellaneous', 30, 'Finger'),
  ]
  const names = (character, levelMax = 48) => gearTargets(rows, character, { levelMin: 29, levelMax }).map((row) => row.item.name).sort()
  assert.deepEqual(names({ name: 'Mira', level: 31, className: 'Rogue' }), ['Dagger', 'Leather vest', 'Mace', 'Orb', 'Ring'])
  assert.deepEqual(names({ name: 'Bo', level: 31, className: 'Warrior' }, 38), ['Dagger', 'Great axe', 'Leather vest', 'Mace', 'Mail hauberk', 'Orb', 'Ring', 'Shield'],
    'plate waits for level 40')
  assert.ok(names({ name: 'Bo', level: 41, className: 'Warrior' }).includes('Plate helm'))
  assert.ok(!names({ name: 'Hu', level: 31, className: 'Hunter' }, 38).includes('Mail hauberk'), 'hunters wear mail from 40')
  assert.deepEqual(names({ name: 'X', level: 31, className: '' }).length, rows.length, 'unknown class: nothing filtered by type')
})

test('item facts list only what is known', () => {
  const vancleef = FIXTURE_DEADMINES_DETAIL.atlas.bosses.find((boss) => boss.name === 'Edwin VanCleef')
  const barb = vancleef.referenceLoot.find((item) => item.itemId === 5191)
  assert.deepEqual(itemFacts(barb), [
    ['Slot', 'One-Hand'], ['Type', 'One-Handed Swords'], ['Item level', 24], ['Requires level', 19],
    ['Weapon', '30–57 damage, speed 2.80, 15.5 dps'], ['Binds', 'Binds when picked up'],
  ])
  const cape = vancleef.referenceLoot.find((item) => item.itemId === 5193)
  assert.deepEqual(itemFacts(cape).slice(0, 2), [['Slot', 'Back'], ['Type', 'Cloth armor']])
  assert.deepEqual(itemFacts({ itemClass: 'Armor', itemSubclass: 'Shields' })[0], ['Type', 'Shields'])
  assert.deepEqual(itemFacts({}), [])
  assert.equal(bindText(1), 'Binds when picked up')
  assert.equal(bindText('BoE'), 'Binds when equipped')
  assert.equal(bindText(0), '')
})

test('the quick guide: 2–4 lines, role categories first, from ability data only', () => {
  const abilities = [
    { name: 'Cleave', category: 'tank-danger', priority: 'high' },
    { name: 'Heal', category: 'healer-danger', priority: 'high', interruptible: true },
    { name: 'Fear', category: 'crowd-control', priority: 'medium' },
    { name: 'Curse', category: 'dispel', priority: 'medium', verifiedForForever: true },
    { name: 'Shout', category: 'special-mechanic', priority: 'low' },
  ]
  const names = (role) => quickGuide(abilities, role).map((line) => line.ability.name)
  assert.deepEqual(names('tank'), ['Cleave', 'Heal'])
  assert.deepEqual(names('healer'), ['Heal', 'Curse', 'Cleave'])
  assert.deepEqual(names('dps'), ['Heal', 'Fear', 'Cleave'])
  assert.deepEqual(names(''), ['Cleave', 'Heal'])
  const [heal] = quickGuide(abilities, 'healer')
  assert.equal(heal.action, 'Healer danger')
  assert.equal(heal.unverified, true)
  assert.equal(quickGuide(abilities, 'healer')[1].unverified, false)
  // Only low-priority abilities: the two most important still show.
  assert.equal(quickGuide([{ name: 'A', category: 'special-mechanic', priority: 'low' }, { name: 'B', priority: 'low' }, { name: 'C', priority: 'low' }], 'tank').length, 2)
  assert.deepEqual(quickGuide([], 'tank'), [])
  assert.equal(quickGuide([{ name: 'Shout', category: 'interrupt', priority: 'high', interruptible: false }], 'dps')[0].action, 'Cannot be interrupted')
})

test('the default role comes from the character, never a guess for hybrid classes', () => {
  assert.equal(defaultRole({ className: 'Rogue' }), 'dps')
  assert.equal(defaultRole({ className: 'Warrior' }), '')
  assert.equal(defaultRole({ className: 'Warrior', spec: 'Protection' }), 'tank')
  assert.equal(defaultRole({ className: 'Druid', spec: { name: 'Restoration' } }), 'healer')
  assert.equal(defaultRole({ className: 'Priest', role: 'healer' }), 'healer')
  assert.equal(defaultRole(null), '')
})

test('recommendations come from facts and carry their reasons', () => {
  const [deadmines, wailing, ragefire, molten, blackfathom] = FIXTURE_DUNGEON_LIST
  const rook = { name: 'Rook', level: 20, className: 'Rogue' }
  const fit = recommendDungeon(deadmines, { character: rook, wishCount: 3, usable: 5 })
  assert.equal(fit.recommended, true)
  assert.deepEqual(fit.reasons, ['Levels 17–26 suits Rook (level 20)', '3 wishlist items drop here', '5 drops a Rogue can use', '5 quests'])
  assert.equal(recommendDungeon(wailing, { character: rook }).recommended, true)
  // Outlevelled, but it drops a wishlist item: still recommended, for that reason only.
  assert.deepEqual(recommendDungeon(ragefire, { character: rook, wishCount: 1 }).reasons, ['1 wishlist item drops here'])
  assert.equal(recommendDungeon(ragefire, { character: rook }).recommended, false)
  // Too high a level: never, whatever it drops.
  assert.equal(recommendDungeon(molten, { character: rook, wishCount: 4 }).recommended, false)
  assert.equal(recommendDungeon(blackfathom, { character: rook }).recommended, false)
  assert.equal(recommendDungeon(deadmines, {}).recommended, false)
  const ctx = { character: rook, wishCounts, recommendations: new Map(FIXTURE_DUNGEON_LIST.map((entry) => [entry.instanceId, recommendDungeon(entry, { character: rook, wishCount: wishCounts.get(entry.instanceId) || 0 })])) }
  assert.deepEqual(names(filterDungeons(FIXTURE_DUNGEON_LIST, { rec: '1' }, ctx)), ['The Deadmines', 'Wailing Caverns'])
})

test('run history per dungeon: count, completed, best time, last run', () => {
  const history = runHistory([
    { status: 'completed', startedAt: 100, durationSeconds: 900, timer: { seconds: 880 }, dungeon: { instanceId: 36, name: 'The Deadmines' } },
    { status: 'completed', startedAt: 300, durationSeconds: 1200, dungeon: { instanceId: 36, name: 'The Deadmines' } },
    { status: 'abandoned', startedAt: 200, durationSeconds: 300, dungeon: { instanceId: 36, name: 'The Deadmines' } },
  ])
  assert.deepEqual(history.get({ instanceId: 36 }), { count: 3, completed: 2, lastStartedAt: 300, bestSeconds: 880 })
  assert.deepEqual(history.get({ name: 'the deadmines' }), { count: 3, completed: 2, lastStartedAt: 300, bestSeconds: 880 })
  assert.equal(history.get({ instanceId: 43 }), null)
})

test('quests: giver object or name, coordinates in the game\'s style, missing facts left out', () => {
  const [full, bare] = FIXTURE_DEADMINES_DETAIL.atlas.quests
  const quest = questModel(full)
  assert.equal(quest.giver, 'Gryan Stoutmantle')
  assert.equal(quest.faction, 'Alliance')
  assert.deepEqual(quest.location, { zoneName: 'Westfall', mapId: 1436, coords: '56.5, 47.0' })
  assert.deepEqual(quest.prerequisites, ['The Defias Brotherhood'])
  assert.equal(quest.rewards.length, 3)
  const minimal = questModel({ ...bare, giver: 'Shoni the Shilent' })
  assert.equal(minimal.giver, 'Shoni the Shilent')
  assert.equal(minimal.location, null)
  assert.deepEqual(minimal.rewards, [])
})

test('choosing a character keeps every other param', () => {
  assert.equal(withCharacter('/dashboard/dungeons?view=explore&character=a&open=36&section=loot', 'b'), '/dashboard/dungeons?view=explore&character=b&open=36&section=loot')
  assert.equal(withCharacter('/map?zone=1436&open=36', 'b'), '/map?zone=1436&open=36&character=b')
})

test('a failed dungeon request says what the server answered; a degraded list still lists the atlas', () => {
  assert.equal(loadFailureDetail({ status: 500, code: 'loot_dungeons_unavailable' }), ' (HTTP 500, loot_dungeons_unavailable)')
  assert.equal(loadFailureDetail({ status: 401, code: 'unauthorized' }), ' (HTTP 401, unauthorized)', 'sign-in failures are named, not hidden')
  assert.equal(loadFailureDetail(new TypeError('Failed to fetch')), ' (network error)')
  assert.equal(loadFailureDetail({ status: 502, code: '<html>' }), ' (HTTP 502)', 'only a plain error code is shown')
  assert.equal(loadFailureDetail(null), '')
  // The server's degraded answer (observed catalog unreadable): no catalog
  // dungeons, every reference dungeon in atlasDungeons.
  const atlas = (instanceId) => ({ instanceId, name: `D${instanceId}`, atlas: { bossCount: 3 } })
  const degraded = { schemaVersion: 1, revision: 0, dungeons: [], degraded: ['catalog', 'lootSlots'], atlasDungeons: [atlas(36), atlas(48)] }
  assert.deepEqual(listWithAtlasDungeonsForFailure(degraded).map((entry) => entry.instanceId), [36, 48])
})

test('published editorial content reaches the explore card: subtitle and art focal point', () => {
  const card = cardModel({ instanceId: 3065, name: 'The Hall of Thanes', atlas: { levelMin: 13, levelMax: 20, artworkUrl: '/api/atlas-media/m_fixture0001/web',
    subtitle: 'Fixture subtitle', artFocus: { x: 0.25, y: 0.5 }, editorial: { revision: '1' } } })
  assert.equal(card.artworkUrl, '/api/atlas-media/m_fixture0001/web')
  assert.equal(card.artPosition, '25% 50%')
  assert.equal(card.subtitle, 'Fixture subtitle')
  const plain = cardModel({ instanceId: 36, name: 'Deadmines', atlas: { artFocus: { x: 'a' } } })
  assert.equal(plain.artPosition, '')
  assert.equal(plain.subtitle, '')
})

// ------------------------------------------------------------ UX phase 1

test('level fit copy is about the character, never "too high" for an under-levelled one', () => {
  const atlas = { levelMin: 13, levelMax: 20 }
  const low = { name: 'Rook', level: 8 }
  assert.equal(levelFit(atlas, low), 'under')
  assert.equal(fitText('under', low), 'Rook is under-levelled')
  assert.doesNotMatch(FIT_COPY.under.label, /too high/i)
  assert.equal(fitText(levelFit(atlas, { name: 'Rook', level: 16 }), { name: 'Rook' }), 'Good for Rook')
  assert.equal(fitText(levelFit(atlas, { name: 'Brick', level: 40 }), { name: 'Brick' }), 'Brick has outlevelled it')
  // Within one level of the band still fits.
  assert.equal(levelFit(atlas, { level: 12 }), 'fit')
  assert.equal(levelFit(atlas, { level: 21 }), 'fit')
  assert.equal(fitText(null, low), null)
  assert.equal(atlasSection('bogus'), 'journal')
})

// The Hall of Thanes: the add-on knows Faldrim Anvilmar (NPC 261306); the
// loot catalog, having seen the creature only by ID, calls it "Creature 261306".
const THANES = {
  instance: { instanceId: 3065, name: 'The Hall of Thanes' },
  sources: [
    { key: 'creature:261306', kind: 'creature', boss: false, name: 'Creature 261306', npcIds: [261306], items: [{ itemKey: 'i:818', itemId: 818, name: 'Tigerseye', qualityId: 2, sightings: 3 }] },
    { key: 'creature:999001', kind: 'creature', boss: false, name: 'Creature 999001', npcIds: [999001], items: [{ itemKey: 'i:2632', itemId: 2632, name: 'Curved Dagger', qualityId: 1, sightings: 1 }] },
  ],
  atlas: {
    levelMin: 13, levelMax: 20,
    bosses: [
      { npcId: 261306, name: 'Faldrim Anvilmar', referenceLoot: [{ itemId: 818, name: 'Tigerseye' }, { itemId: 5071, name: 'Shadow Wand' }] },
      { npcId: null, name: 'Infurnus' },
    ],
  },
}

test('a creature the catalog knows only by ID takes the atlas boss\'s verified name', () => {
  const named = withCanonicalSources(THANES)
  assert.equal(named.sources[0].name, 'Faldrim Anvilmar')
  assert.equal(named.sources[0].boss, true)
  assert.equal(named.sources[0].catalogName, 'Creature 261306')
  // A creature the atlas does not know is never renamed.
  assert.equal(named.sources[1].name, 'Creature 999001')
  assert.equal(sourceDisplayName(named.sources[1].name), 'Unidentified creature (NPC 999001)')
  // A real catalog name is kept even when it differs.
  const kept = withCanonicalSources({ ...THANES, sources: [{ ...THANES.sources[0], name: 'Faldrim' }] })
  assert.equal(kept.sources[0].name, 'Faldrim')
  // The boss's loot matches by NPC ID too: observed and reference merge on one row.
  const rows = bossLoot(THANES.atlas.bosses[0], THANES)
  const tigerseye = rows.find((row) => row.item.itemId === 818)
  assert.equal(tigerseye.observed, true)
  assert.equal(tigerseye.reference, true)
  assert.equal(tigerseye.source, 'Faldrim Anvilmar')
  assert.equal(rows.find((row) => row.item.itemId === 5071).observed, false)
})

test('loot groups by source; an item with several sources stays under each', () => {
  const detail = {
    sources: [
      // Observed: Cruel Barb from VanCleef, and also from a Defias Pirate (trash).
      { key: 'boss:edwin vancleef', kind: 'boss', boss: true, name: 'Edwin VanCleef', npcIds: [639], items: [{ itemKey: 'i:5191', itemId: 5191, name: 'Cruel Barb', qualityId: 3 }] },
      { key: 'creature:657', kind: 'creature', boss: false, name: 'Defias Pirate', npcIds: [657], items: [{ itemKey: 'i:5191', itemId: 5191, name: 'Cruel Barb', qualityId: 3 }] },
      { key: 'unknown', kind: 'unknown', boss: false, name: null, npcIds: [], items: [{ itemKey: 'i:1', itemId: 1, name: 'Mystery Ring' }] },
    ],
  }
  const atlas = {
    bosses: [{ encounterId: 2747, npcId: 639, name: 'Edwin VanCleef', referenceLoot: [{ itemId: 5202, name: 'Corsair\'s Overshirt' }] }, { encounterId: 2741, npcId: 644, name: 'Rhahk\'Zor' }],
    rares: [{ npcId: 3586, name: 'Miner Johnson', referenceLoot: [{ itemId: 5443, name: 'Gold-plated Buckler' }] }],
    creatures: [{ npcId: 657, name: 'Defias Pirate' }],
    dungeonLoot: [
      { itemId: 1930, name: 'Stonemason Cloak', npcId: 598, sourceName: 'Defias Miner' },
      { itemId: 2000, name: 'Chest Ring', npcId: null, sourceName: 'Chest of The Seven' },
      { itemId: 1951, name: 'Blackwater Cutlass', npcId: null, sourceName: null },
      // Reference also lists the Overshirt as a quest reward: a second, real source.
    ],
    quests: [{ questId: 166, name: 'The Defias Brotherhood', rewards: [{ itemId: 5202, name: 'Corsair\'s Overshirt', choice: true }] }],
  }
  const groups = lootBySource(detail, atlas)
  assert.deepEqual(groups.map((group) => group.kind), ['boss', 'rare', 'trash', 'shared', 'quest', 'unknown'])
  const source = (key) => groups.flatMap((group) => group.sources).find((entry) => entry.key === key)
  const vancleef = source('boss:2747')
  assert.deepEqual(vancleef.rows.map((row) => row.item.itemId), [5191, 5202])
  // No source invented for a boss nothing names.
  assert.equal(source('boss:2741'), undefined)
  // Cruel Barb: under the boss and the trash creature, each naming the other.
  const barbBoss = vancleef.rows.find((row) => row.item.itemId === 5191)
  const barbTrash = source('trash:657').rows.find((row) => row.item.itemId === 5191)
  assert.equal(barbBoss.observed, true)
  assert.equal(barbTrash.observed, true)
  assert.deepEqual(barbBoss.alsoFrom.map((other) => other.name), ['Defias Pirate'])
  assert.deepEqual(barbTrash.alsoFrom.map((other) => other.name), ['Edwin VanCleef'])
  // The Overshirt: a boss drop and a quest reward.
  const shirt = source('quest:166').rows[0]
  assert.equal(shirt.choice, true)
  assert.deepEqual(shirt.alsoFrom.map((other) => other.key), ['boss:2747'])
  // Rare, trash creature, chest and several-source drops each where the data puts them.
  assert.equal(source('rare:3586').rows[0].item.itemId, 5443)
  assert.equal(source('trash:598').name, 'Defias Miner')
  assert.equal(source('chest:chest of the seven').kind, 'shared')
  assert.equal(source('shared:trash and shared drops').rows[0].item.itemId, 1951)
  assert.equal(source('unknown').rows[0].item.name, 'Mystery Ring')
  // Every row links back to its own source.
  for (const group of groups) for (const entry of group.sources) for (const row of entry.rows) assert.equal(row.sourceKey, entry.key)
})

test('a reference boss drop the catalog saw from another source is not "seen" from the boss', () => {
  const detail = { sources: [{ key: 'creature:657', kind: 'creature', name: 'Defias Pirate', npcIds: [657], items: [{ itemKey: 'i:5202', itemId: 5202, name: 'Corsair\'s Overshirt', iconFileDataId: 42 }] }] }
  const boss = { npcId: 639, name: 'Edwin VanCleef', referenceLoot: [{ itemId: 5202 }] }
  const [row] = bossLoot(boss, detail)
  assert.equal(row.observed, false)
  assert.equal(row.reference, true)
  // Its facts (name, icon) still come from the catalog.
  assert.equal(row.item.name, 'Corsair\'s Overshirt')
  assert.equal(row.item.iconFileDataId, 42)
})

test('card art: published art wins, a wing uses its dungeon art, a Forever dungeon without art falls back', () => {
  assert.equal(cardModel({ instanceId: 36, name: 'Deadmines', atlas: { artworkUrl: '/api/atlas-media/m_1/web' } }).artworkUrl, '/api/atlas-media/m_1/web')
  assert.equal(cardModel({ instanceId: 36, name: 'Deadmines', atlas: {} }).artworkUrl, '/wow-art/dungeons/36.webp')
  assert.equal(cardModel({ instanceId: 189, dungeonKey: 'scarlet-monastery:library', name: 'Library', atlas: {} }).artworkUrl, '/wow-art/dungeons/189.webp')
  const missing = cardModel({ instanceId: 2970, name: 'The Drowned City', atlas: { origin: 'forever' } })
  assert.equal(missing.artworkUrl, '')
  assert.equal(missing.artFallback, 'forever')
})
