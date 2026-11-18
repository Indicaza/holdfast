// FIXTURE DATA for tests and local development only. Never shown in a
// production build: the app loads it only when `import.meta.env.DEV` and
// the URL has ?atlasFixtures=1 (see useAtlasFixtures). The shapes follow
// the shared Dungeon Atlas contract merged with the real
// /api/player/loot/dungeons and /api/player/loot/dungeons/:id responses.

export const FIXTURE_NOTE = 'Fixture data: not real game data.'

const item = (itemId, name, extra = {}) => ({
  itemId, itemKey: `i:${itemId}`, name, nameKnown: true, qualityId: 3, iconFileDataId: null, itemLevel: 23, requiredLevel: 18,
  itemClass: 'Armor', itemSubclass: 'Leather', slot: 'Chest', equippable: true, bindType: 1, classes: [], tooltip: { lines: [], source: null, gameBuild: null },
  confidence: 'confirmed', difficultyIds: [1], evidence: [{ provenance: 'loot_window', evidenceCount: 4, firstBuild: '70338', lastBuild: '70338', status: 'active' }],
  wishlisted: false, ...extra,
})

const ability = (spellId, name, category, priority, summary, extra = {}) => ({
  spellId, name, category, priority, interruptible: category === 'interrupt' ? true : null, summary,
  details: `${summary} (fixture detail text)`, source: 'classic-reference', verifiedForForever: false, ...extra,
})

const provenance = [{ source: 'classic-reference', revision: 'fixture-1', confidence: 'medium', retrievedAt: '2026-11-01T00:00:00Z', url: null }]

export const FIXTURE_DUNGEON_LIST = Object.freeze([
  {
    instanceId: 36, name: 'The Deadmines', type: 'party', journalInstanceId: 63, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-10T00:00:00Z',
    itemCount: 24, sourceCount: 6, lastEvidenceAt: '2026-11-10T00:00:00Z',
    atlas: { levelMin: 17, levelMax: 26, recommendedLevel: 20, zoneName: 'Westfall', zoneMapId: 1436, entrance: { mapId: 1436, x: 0.42, y: 0.72 },
      artworkUrl: '', bossCount: 6, rareCount: 1, questCount: 5, kind: 'dungeon', lootSlots: ['Chest', 'Legs', 'One-Hand', 'Back'] },
  },
  {
    instanceId: 43, name: 'Wailing Caverns', type: 'party', journalInstanceId: 240, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-08T00:00:00Z',
    itemCount: 19, sourceCount: 7, lastEvidenceAt: '2026-11-08T00:00:00Z',
    atlas: { levelMin: 17, levelMax: 24, recommendedLevel: 20, zoneName: 'The Barrens', zoneMapId: 1413, entrance: { mapId: 1413, x: 0.46, y: 0.36 },
      artworkUrl: '', bossCount: 5, rareCount: 1, questCount: 6, kind: 'dungeon', lootSlots: ['Chest', 'Two-Hand', 'Feet'] },
  },
  {
    instanceId: 389, name: 'Ragefire Chasm', type: 'party', journalInstanceId: 226, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-02T00:00:00Z',
    itemCount: 8, sourceCount: 4, lastEvidenceAt: '2026-11-02T00:00:00Z',
    atlas: { levelMin: 13, levelMax: 18, recommendedLevel: 15, zoneName: 'Orgrimmar', zoneMapId: 1454, entrance: null,
      artworkUrl: '', bossCount: 4, rareCount: 0, questCount: null, kind: 'dungeon', lootSlots: ['Feet', 'Wrist'] },
  },
  {
    instanceId: 409, name: 'Molten Core', type: 'raid', journalInstanceId: 741, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-12T00:00:00Z',
    itemCount: 61, sourceCount: 10, lastEvidenceAt: '2026-11-12T00:00:00Z',
    atlas: { levelMin: 60, levelMax: 60, recommendedLevel: 60, zoneName: 'Searing Gorge', zoneMapId: 1427, entrance: { mapId: 1427, x: 0.35, y: 0.84 },
      artworkUrl: '', bossCount: 10, rareCount: 0, questCount: 2, kind: 'raid', lootSlots: ['Chest', 'Legs', 'Head'] },
  },
  // A dungeon the catalog knows only from loot: no atlas at all.
  { instanceId: 48, name: 'Blackfathom Deeps', type: 'party', journalInstanceId: null, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-10-20T00:00:00Z',
    itemCount: 5, sourceCount: 2, lastEvidenceAt: '2026-10-20T00:00:00Z' },
])

export const FIXTURE_DEADMINES_DETAIL = Object.freeze({
  schemaVersion: 1, revision: 42,
  instance: { instanceId: 36, name: 'The Deadmines', type: 'party', journalInstanceId: 63, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-10T00:00:00Z' },
  difficulties: { 1: 'Normal' },
  sources: [
    { key: 'boss:rhahk\'zor', kind: 'boss', boss: true, name: 'Rhahk\'Zor', items: [item(872, 'Rockslicer', { slot: 'Two-Hand', itemClass: 'Weapon', itemSubclass: 'Axe', itemLevel: 22 })] },
    { key: 'boss:edwin vancleef', kind: 'boss', boss: true, name: 'Edwin VanCleef', items: [
      item(5193, 'Cape of the Brotherhood', { slot: 'Back', itemSubclass: 'Cloth', itemLevel: 24 }),
      item(5191, 'Cruel Barb', { slot: 'One-Hand', itemClass: 'Weapon', itemSubclass: 'Sword', itemLevel: 24 }),
      item(10399, 'Blackened Defias Armor', { itemLevel: 24 }),
    ] },
    { key: 'unknown', kind: 'unknown', boss: false, name: null, items: [item(1937, 'Buzz Saw', { slot: 'One-Hand', itemClass: 'Weapon', itemSubclass: 'Sword', confidence: 'reported' })] },
  ],
  changes: [],
  evidence: { note: 'Sightings are loot that was offered, not items anyone received.' },
  atlas: {
    description: 'Fixture: a Defias hideout beneath Moonbrook.',
    maps: [{ floorId: 1, name: 'The Deadmines', imageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 4 3%22%3E%3Crect width=%224%22 height=%223%22 fill=%22%23222%22/%3E%3C/svg%3E', width: 1002, height: 668 }],
    entrance: { mapId: 1436, x: 0.42, y: 0.72 },
    bosses: [
      { encounterId: 2741, npcId: 644, name: 'Rhahk\'Zor', portraitUrl: '', floorId: 1, mapPosition: { x: 0.22, y: 0.31 },
        abilities: [ability(6304, 'Rhahk\'Zor Slam', 'tank-danger', 'high', 'Heavy hit that stuns the tank for 3 seconds.')],
        loot: ['i:872'], strategy: { tank: 'Face him away from the group.', summary: 'Tank and spank.' }, provenance },
      { encounterId: 2746, npcId: 639, name: 'Edwin VanCleef', portraitUrl: '', floorId: 1, mapPosition: { x: 0.81, y: 0.64 },
        abilities: [
          ability(5915, 'Thrash', 'tank-danger', 'medium', 'Extra attacks against the tank.'),
          ability(6253, 'Summon Blackguards', 'special-mechanic', 'high', 'Calls two Blackguards at half health. Crowd-control one.'),
          ability(9128, 'Battle Shout', 'interrupt', 'low', 'Not interruptible in Classic.', { interruptible: false }),
        ],
        loot: ['i:5193', 'i:5191', 'i:10399'], strategy: { healer: 'Save mana for the adds.', dps: 'Kill the Blackguards first.' }, provenance },
      { encounterId: 2744, npcId: 642, name: 'Sneed\'s Shredder', portraitUrl: '', floorId: 1, mapPosition: null, abilities: [], loot: [], strategy: {}, provenance },
    ],
    creatures: [],
    rares: [{ npcId: 596, name: 'Brainwashed Noble', floorId: 1, mapPosition: { x: 0.12, y: 0.2 } }],
    quests: [
      { questId: 166, name: 'The Defias Brotherhood', level: 22, minLevel: 14, faction: 'Alliance', giver: 'Gryan Stoutmantle' },
      { questId: 2040, name: 'Underground Assault', level: 20, minLevel: 15, faction: 'Alliance', giver: 'Shoni the Shilent' },
    ],
    provenance,
  },
})

// The same dungeon as today's backend sends it: no atlas.
export const FIXTURE_DETAIL_WITHOUT_ATLAS = Object.freeze({ ...FIXTURE_DEADMINES_DETAIL, atlas: undefined })

export const FIXTURE_CHARACTER = Object.freeze({ id: 'char-1', name: 'Rook', level: 20, className: 'Rogue', realm: 'Fixture', region: 'us' })

export const FIXTURE_WISHLIST = Object.freeze({
  limit: 50, ownershipKnown: true,
  items: [
    { itemKey: 'i:5193', itemId: 5193, state: 'wanted', priority: 'high', note: '', item: { name: 'Cape of the Brotherhood' }, sources: [{ instanceId: 36, dungeon: 'The Deadmines', source: 'Edwin VanCleef' }] },
    { itemKey: 'i:5191', itemId: 5191, state: 'wanted', priority: 'normal', note: '', item: { name: 'Cruel Barb' }, sources: [{ instanceId: 36, dungeon: 'The Deadmines', source: 'Edwin VanCleef' }] },
    { itemKey: 'i:6505', itemId: 6505, state: 'acquired', priority: 'normal', note: '', item: { name: 'Crescent Staff' }, sources: [{ instanceId: 43, dungeon: 'Wailing Caverns', source: 'Verdan' }] },
  ],
})

// Detail payloads by instance id, for the dev fixture mode.
export const FIXTURE_DETAILS = Object.freeze({ 36: FIXTURE_DEADMINES_DETAIL })
