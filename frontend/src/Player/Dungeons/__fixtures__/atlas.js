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

// A Classic reference item (sprint-2 contract: ReferenceItem). Item ids
// are real Deadmines items; the other facts are shape examples only.
const ref = (itemId, name, extra = {}) => ({
  itemId, itemKey: `i:${itemId}`, name, qualityId: 2, iconFileDataId: null, slot: null, itemLevel: null, requiredLevel: null,
  itemClass: 'Armor', itemSubclass: null, classes: null, bindType: 'BoE', armor: null, weapon: null, stats: null, setName: null,
  kind: 'gear', observed: false, verifiedForForever: false,
  provenance: [{ source: 'classic-reference', revision: 'fixture-ref-1', confidence: 'medium', tier: 'classic-reference', retrievedAt: '2026-11-01T00:00:00Z', url: null }],
  ...extra,
})

const provenance = [{ source: 'classic-reference', revision: 'fixture-1', confidence: 'medium', retrievedAt: '2026-11-01T00:00:00Z', url: null }]

export const FIXTURE_DUNGEON_LIST = Object.freeze([
  {
    instanceId: 36, name: 'The Deadmines', type: 'party', journalInstanceId: 63, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-10T00:00:00Z',
    itemCount: 24, sourceCount: 6, lastEvidenceAt: '2026-11-10T00:00:00Z',
    atlas: { levelMin: 17, levelMax: 26, recommendedLevel: 20, zoneName: 'Westfall', zoneMapId: 1436, entrance: { mapId: 1436, x: 0.42, y: 0.72 },
      artworkUrl: '', bossCount: 6, rareCount: 1, questCount: 5, kind: 'dungeon', lootSlots: ['Chest', 'Legs', 'One-Hand', 'Back'],
      referenceLootCount: 9, referenceItemIds: [5187, 5193, 5191, 5202, 10399, 10400, 6087, 2041, 2042], referenceSlots: ['Back', 'Chest', 'Legs', 'One-Hand', 'Two-Hand'] },
  },
  {
    instanceId: 43, name: 'Wailing Caverns', type: 'party', journalInstanceId: 240, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-11-08T00:00:00Z',
    itemCount: 19, sourceCount: 7, lastEvidenceAt: '2026-11-08T00:00:00Z',
    atlas: { levelMin: 17, levelMax: 24, recommendedLevel: 20, zoneName: 'The Barrens', zoneMapId: 1413, entrance: { mapId: 1413, x: 0.46, y: 0.36 },
      artworkUrl: '', bossCount: 5, rareCount: 1, questCount: 6, kind: 'dungeon', lootSlots: ['Chest', 'Two-Hand', 'Feet'],
      referenceLootCount: 1, referenceItemIds: [6505], referenceSlots: ['Two-Hand'] },
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
        loot: ['i:872'], strategy: { tank: 'Face him away from the group.', summary: 'Tank and spank.' }, provenance,
        referenceLoot: [ref(5187, 'Rhahk\'Zor\'s Hammer', { slot: 'Two-Hand', itemClass: 'Weapon', itemSubclass: 'Mace', itemLevel: 23, requiredLevel: 18, bindType: 'BoP',
          weapon: { minDamage: 38, maxDamage: 58, speed: 3.1, dps: 15.5 }, stats: [{ stat: 'Strength', value: 6 }] })] },
      { encounterId: 2746, npcId: 639, name: 'Edwin VanCleef', portraitUrl: '', floorId: 1, mapPosition: { x: 0.81, y: 0.64 },
        abilities: [
          ability(5915, 'Thrash', 'tank-danger', 'medium', 'Extra attacks against the tank.'),
          ability(6253, 'Summon Blackguards', 'special-mechanic', 'high', 'Calls two Blackguards at half health. Crowd-control one.'),
          ability(9128, 'Battle Shout', 'interrupt', 'low', 'Not interruptible in Classic.', { interruptible: false }),
        ],
        loot: ['i:5193', 'i:5191', 'i:10399'], strategy: { healer: 'Save mana for the adds.', dps: 'Kill the Blackguards first.' }, provenance,
        referenceLoot: [
          ref(5193, 'Cape of the Brotherhood', { qualityId: 3, slot: 'Back', itemSubclass: 'Cloth', itemLevel: 24, requiredLevel: 19, bindType: 'BoP', armor: 24, stats: [{ stat: 'Agility', value: 5 }], observed: true, verifiedForForever: true }),
          ref(5191, 'Cruel Barb', { qualityId: 3, slot: 'One-Hand', itemClass: 'Weapon', itemSubclass: 'Sword', itemLevel: 24, requiredLevel: 19, bindType: 'BoP',
            weapon: { minDamage: 30, maxDamage: 56, speed: 2.8, dps: 15.4 }, stats: [{ stat: 'Strength', value: 12 }], observed: true, verifiedForForever: true }),
          ref(5202, 'Corsair\'s Overshirt', { qualityId: 3, slot: 'Chest', itemSubclass: 'Cloth', itemLevel: 24, requiredLevel: 19, bindType: 'BoP', armor: 37,
            stats: [{ stat: 'Intellect', value: 5 }, { stat: 'Spirit', value: 5 }] }),
          ref(10399, 'Blackened Defias Armor', { qualityId: 3, slot: 'Chest', itemSubclass: 'Leather', itemLevel: 24, requiredLevel: 19, bindType: 'BoP', setName: 'Defias Leather', kind: 'set', observed: true, verifiedForForever: true }),
        ] },
      { encounterId: 2745, npcId: 645, name: 'Cookie', portraitUrl: '', floorId: 1, mapPosition: { x: 0.7, y: 0.5 },
        abilities: [
          ability(5174, 'Cookie\'s Cooking', 'healer-danger', 'high', 'Heals Cookie for a large amount. Interrupt or dispel.', { interruptible: true }),
          ability(6306, 'Acid Splash', 'positioning', 'medium', 'Splashes acid in front of him.', { source: 'forever-reference', verifiedForForever: true }),
        ],
        loot: [], strategy: null, provenance },
      { encounterId: 2744, npcId: 642, name: 'Sneed\'s Shredder', portraitUrl: '', floorId: 1, mapPosition: null, abilities: [], loot: [], strategy: {}, provenance },
    ],
    creatures: [
      { npcId: 4418, name: 'Defias Wizard', levelMin: 18, levelMax: 19, count: 2, abilities: [
        ability(113, 'Chains of Ice', 'crowd-control', 'high', '1.5s cast · interruptible · root · Magic effect', { interruptible: true }),
        ability(9053, 'Fireball', 'interrupt', 'high', '3s cast · interruptible'),
      ] },
    ],
    rares: [{ npcId: 596, name: 'Brainwashed Noble', floorId: 1, mapPosition: { x: 0.12, y: 0.2 }, referenceLoot: [] }],
    dungeonLoot: [ref(10400, 'Blackened Defias Leggings', { slot: 'Legs', itemSubclass: 'Leather', itemLevel: 23, requiredLevel: 18, setName: 'Defias Leather', kind: 'set', sourceName: null, npcId: null })],
    referenceVersion: { dataset: 'atlas-reference-loot', revision: 'fixture-ref-1', importedAt: '2026-11-01T00:00:00Z' },
    quests: [
      { questId: 166, name: 'The Defias Brotherhood', level: 22, minLevel: 14, faction: 'alliance', giver: { npcId: 234, name: 'Gryan Stoutmantle' },
        objective: 'Bring the head of Edwin VanCleef to Gryan Stoutmantle.', prerequisites: [{ questId: 155, name: 'The Defias Brotherhood' }],
        rewards: [
          { ...ref(6087, 'Chausses of Westfall', { slot: 'Legs', itemSubclass: 'Mail', itemLevel: 25, requiredLevel: 0, kind: 'quest-reward', bindType: 'BoP' }), choice: true },
          { ...ref(2041, 'Tunic of Westfall', { slot: 'Chest', itemSubclass: 'Leather', itemLevel: 25, requiredLevel: 0, kind: 'quest-reward', bindType: 'BoP' }), choice: true },
          { ...ref(2042, 'Staff of Westfall', { slot: 'Two-Hand', itemClass: 'Weapon', itemSubclass: 'Staff', itemLevel: 25, requiredLevel: 0, kind: 'quest-reward', bindType: 'BoP' }), choice: true },
        ],
        location: { zoneName: 'Westfall', mapId: 1436, x: 0.565, y: 0.47 }, provenance },
      { questId: 2040, name: 'Underground Assault', level: 20, minLevel: 15, faction: 'alliance', giver: { npcId: 6579, name: 'Shoni the Shilent' } },
    ],
    provenance,
  },
})

// The dungeon as the sprint-1 backend (current main) sends it: atlas, but
// none of the sprint-2 fields (reference loot, dungeon loot, quest details).
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
const sprintOneAtlas = omit(FIXTURE_DEADMINES_DETAIL.atlas, ['dungeonLoot', 'referenceVersion'])
export const FIXTURE_DETAIL_SPRINT1 = Object.freeze({
  ...FIXTURE_DEADMINES_DETAIL,
  atlas: {
    ...sprintOneAtlas,
    bosses: sprintOneAtlas.bosses.map((boss) => omit(boss, ['referenceLoot'])),
    rares: sprintOneAtlas.rares.map((rare) => omit(rare, ['referenceLoot'])),
    quests: sprintOneAtlas.quests.map(({ questId, name, level, minLevel, faction, giver }) => ({ questId, name, level, minLevel, faction, giver })),
  },
})

export const FIXTURE_DUNGEON_LIST_SPRINT1 = Object.freeze(FIXTURE_DUNGEON_LIST.map((entry) => (
  entry.atlas ? { ...entry, atlas: omit(entry.atlas, ['referenceLootCount', 'referenceItemIds', 'referenceSlots']) } : entry
)))

// The same dungeon as today's backend sends it: no atlas.
export const FIXTURE_DETAIL_WITHOUT_ATLAS = Object.freeze({ ...FIXTURE_DEADMINES_DETAIL, atlas: undefined })

export const FIXTURE_CHARACTER = Object.freeze({ id: 'char-1', name: 'Rook', level: 20, className: 'Rogue', realm: 'Fixture', region: 'us' })

export const FIXTURE_WISHLIST = Object.freeze({
  limit: 50, ownershipKnown: true,
  items: [
    { itemKey: 'i:5193', itemId: 5193, state: 'wanted', priority: 'high', note: '', item: { name: 'Cape of the Brotherhood' }, sources: [{ instanceId: 36, dungeon: 'The Deadmines', source: 'Edwin VanCleef' }] },
    { itemKey: 'i:5191', itemId: 5191, state: 'wanted', priority: 'normal', note: '', item: { name: 'Cruel Barb' }, sources: [{ instanceId: 36, dungeon: 'The Deadmines', source: 'Edwin VanCleef' }] },
    { itemKey: 'i:5202', itemId: 5202, state: 'wanted', priority: 'normal', note: '', item: { name: 'Corsair\'s Overshirt' }, sources: [] },
    { itemKey: 'i:6505', itemId: 6505, state: 'acquired', priority: 'normal', note: '', item: { name: 'Crescent Staff' }, sources: [{ instanceId: 43, dungeon: 'Wailing Caverns', source: 'Verdan' }] },
  ],
})

// Detail payloads by instance id, for the dev fixture mode.
export const FIXTURE_DETAILS = Object.freeze({ 36: FIXTURE_DEADMINES_DETAIL })
