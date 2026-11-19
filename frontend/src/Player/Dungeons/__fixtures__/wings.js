// Fixture data for dungeon wings (Scarlet Monastery, instance 189): the
// list response's dungeon entry, its wing entries (atlasWings) and two
// detail responses, in the shapes of docs/dungeon-atlas-contract.md.
// Not real game data beyond the names and ids it mirrors.

const wingAtlas = (fields) => ({
  kind: 'dungeon', zoneName: 'Western Plaguelands', zoneMapId: 1422, artworkUrl: null, recommendedLevel: null,
  rareCount: 0, questCount: 2, sharedQuestCount: 2, referenceLootCount: 0, referenceItemIds: [], referenceSlots: [], lootSlots: [],
  ...fields,
})

export const FIXTURE_SM_DUNGEON = {
  instanceId: 189, name: 'Scarlet Monastery', type: 'party', itemCount: 3,
  atlas: wingAtlas({ dungeonKey: 'scarlet-monastery', levelMin: 29, levelMax: 48, bossCount: 7, rareCount: 3, entrance: { mapId: 1422, x: 0.2826, y: 0.1543 },
    wingEntries: [
      { dungeonKey: 'scarlet-monastery:graveyard', parentKey: 'scarlet-monastery', instanceId: 189, wing: 'Graveyard', name: 'Scarlet Monastery — Graveyard', levelMin: 30, levelMax: 37 },
      { dungeonKey: 'scarlet-monastery:library', parentKey: 'scarlet-monastery', instanceId: 189, wing: 'Library', name: 'Scarlet Monastery — Library', levelMin: 32, levelMax: 40 },
    ] }),
}

export const FIXTURE_SM_WINGS = [
  { instanceId: 189, dungeonKey: 'scarlet-monastery:graveyard', parentKey: 'scarlet-monastery', wing: 'Graveyard', name: 'Scarlet Monastery — Graveyard',
    instanceName: 'Scarlet Monastery', type: 'party',
    atlas: wingAtlas({ dungeonKey: 'scarlet-monastery:graveyard', wing: 'Graveyard', levelMin: 30, levelMax: 37, bossCount: 2, rareCount: 3,
      entrance: { mapId: 1422, x: 0.2826, y: 0.1543 }, referenceItemIds: [7682], referenceLootCount: 1,
      bossNpcIds: [3983, 4543], bossNames: ['Interrogator Vishas', 'Bloodmage Thalnos'] }) },
  { instanceId: 189, dungeonKey: 'scarlet-monastery:library', parentKey: 'scarlet-monastery', wing: 'Library', name: 'Scarlet Monastery — Library',
    instanceName: 'Scarlet Monastery', type: 'party',
    atlas: wingAtlas({ dungeonKey: 'scarlet-monastery:library', wing: 'Library', levelMin: 32, levelMax: 40, bossCount: 2,
      entrance: { mapId: 1422, x: 0.2887, y: 0.1768 }, referenceItemIds: [7714], referenceLootCount: 1,
      bossNpcIds: [3974, 6487], bossNames: ['Houndmaster Loksey', 'Arcanist Doan'] }) },
]

const boss = (encounterId, npcId, name, order) => ({ encounterId, npcId, name, atlasName: name, order, portraitUrl: null, floorId: 'layout',
  mapPosition: null, abilities: [], loot: [], referenceLoot: [], strategy: null, provenance: [] })

const instance = { instanceId: 189, name: 'Scarlet Monastery', type: 'party', journalInstanceId: null, firstSeenAt: null, lastSeenAt: null }

export const FIXTURE_SM_LIBRARY_DETAIL = {
  schemaVersion: 1, revision: 1, instance, difficulties: {}, changes: [], sources: [],
  wing: { dungeonKey: 'scarlet-monastery:library', parentKey: 'scarlet-monastery', instanceId: 189, wing: 'Library', name: 'Scarlet Monastery — Library',
    levelMin: 32, levelMax: 40, slug: 'library', parentName: 'Scarlet Monastery', levelSource: 'instance-journal', sourcesLeftOut: 0, siblings: [] },
  atlas: {
    dungeonKey: 'scarlet-monastery:library', parentKey: 'scarlet-monastery', wing: 'Library', name: 'Scarlet Monastery — Library',
    description: null, kind: 'dungeon', levelMin: 32, levelMax: 40, levelSource: 'instance-journal', recommendedLevel: null,
    zoneName: 'Western Plaguelands', zoneMapId: 1422, artworkUrl: null, maps: [], creatures: [], rares: [], dungeonLoot: [],
    bosses: [boss(446, 3974, 'Houndmaster Loksey', 2000), boss(447, 6487, 'Arcanist Doan', 3000)],
    quests: [{ questId: 1050, name: 'Mythology of the Titans', level: 38, minLevel: 28, faction: 'alliance', giver: null, rewards: [], wingAttribution: 'shared' }],
    entrance: { mapId: 1422, x: 0.2887, y: 0.1768 }, entrances: [], entrancesShared: false,
    floors: [{ name: 'Library', source: 'openmap' }],
    unassigned: { bosses: [], rares: [] },
    provenance: [{ source: 'dungeon-planner', revision: 'Data/Bosses', confidence: 'medium', tier: 'community-unverified', retrievedAt: null, url: null }],
  },
}

export const FIXTURE_SM_DETAIL = {
  schemaVersion: 1, revision: 1, instance, difficulties: {}, changes: [], sources: [],
  atlas: {
    dungeonKey: 'scarlet-monastery', wingEntries: FIXTURE_SM_DUNGEON.atlas.wingEntries,
    description: null, kind: 'dungeon', levelMin: 29, levelMax: 48, recommendedLevel: null,
    zoneName: 'Western Plaguelands', zoneMapId: 1422, artworkUrl: null, maps: [], creatures: [], rares: [], dungeonLoot: [], quests: [],
    bosses: [boss(444, 3983, 'Interrogator Vishas', 0), boss(446, 3974, 'Houndmaster Loksey', 2000), boss(447, 6487, 'Arcanist Doan', 3000)],
    entrance: { mapId: 1422, x: 0.2826, y: 0.1543 }, entrances: [], provenance: [],
  },
}
