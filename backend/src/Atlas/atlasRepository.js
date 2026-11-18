// Serves the Dungeon Atlas (data/atlas.json, written by
// scripts/importDungeonAtlas.mjs) in the shapes of docs/dungeon-atlas-contract.md
// and joins it to the loot catalog's responses. Read-only, local: nothing
// here calls another service.

import { readFileSync } from "node:fs";

import { normalizedName, wishlistItemKey } from "../Loot/lootModel.js";

const ATLAS_URL = new URL("./data/atlas.json", import.meta.url);
let cached = null;

export function loadAtlas() {
  if (!cached) {
    const atlas = JSON.parse(readFileSync(ATLAS_URL, "utf8"));
    cached = { atlas, byId: new Map(atlas.dungeons.map((dungeon) => [dungeon.instanceId, dungeon])) };
  }
  return cached;
}

export function atlasDungeon(instanceId) {
  return loadAtlas().byId.get(Number(instanceId)) || null;
}

// The list entry's `atlas`, or null when the atlas has no such dungeon.
export function atlasSummary(instanceId) {
  const dungeon = atlasDungeon(instanceId);
  if (!dungeon) return null;
  return {
    levelMin: dungeon.levelMin, levelMax: dungeon.levelMax, recommendedLevel: dungeon.recommendedLevel,
    zoneName: dungeon.zoneName, zoneMapId: dungeon.zoneMapId, entrance: dungeon.entrance, artworkUrl: dungeon.artworkUrl,
    bossCount: dungeon.bosses.length,
    // No rare-spawn source yet: unknown, not zero.
    rareCount: dungeon.rares.length ? dungeon.rares.length : null,
    questCount: dungeon.quests.length,
    kind: dungeon.kind,
  };
}

// A boss joined to the catalog's source groups for it (by npc id, encounter
// id or name): the item keys the catalog lists under them, and the catalog's
// spelling of the name, so the frontend can match boss.name to
// sources[].name. atlasName keeps the atlas source's own spelling.
function bossWithCatalog(boss, sources) {
  const name = normalizedName(boss.name);
  const keys = new Set();
  let sourceName = null;
  for (const source of sources || []) {
    if (source.kind === "unknown") continue;
    const match = (boss.npcId && source.npcIds?.includes(boss.npcId)) || (boss.encounterId && source.encounterIds?.includes(boss.encounterId))
      || (name && normalizedName(source.name) === name);
    if (!match) continue;
    if (!sourceName && source.name) sourceName = source.name;
    for (const item of source.items || []) {
      const key = wishlistItemKey(item.itemId);
      if (key) keys.add(key);
    }
  }
  return { ...boss, name: sourceName || boss.name, atlasName: boss.name, loot: [...keys] };
}

// The detail's `atlas`. `sources` is the catalog's source groups, used only
// to point bosses at loot the catalog already holds.
export function atlasDetail(instanceId, sources = []) {
  const dungeon = atlasDungeon(instanceId);
  if (!dungeon) return null;
  return {
    description: dungeon.description,
    kind: dungeon.kind,
    levelMin: dungeon.levelMin, levelMax: dungeon.levelMax, recommendedLevel: dungeon.recommendedLevel,
    ...(dungeon.wings ? { wings: dungeon.wings } : {}),
    zoneName: dungeon.zoneName, zoneMapId: dungeon.zoneMapId,
    maps: dungeon.maps,
    bosses: dungeon.bosses.map((boss) => bossWithCatalog(boss, sources)),
    creatures: dungeon.creatures,
    rares: dungeon.rares,
    quests: dungeon.quests,
    entrance: dungeon.entrance,
    entrances: dungeon.entrances,
    artworkUrl: dungeon.artworkUrl,
    provenance: dungeon.provenance,
  };
}

// Atlas dungeons the loot catalog has not seen yet, for the list response.
export function atlasOnlyDungeons(knownIds) {
  const known = new Set([...knownIds].map(Number));
  return loadAtlas().atlas.dungeons.filter((dungeon) => !known.has(dungeon.instanceId)).map((dungeon) => ({
    instanceId: dungeon.instanceId, name: dungeon.name, type: dungeon.kind === "raid" ? "raid" : "party", atlas: atlasSummary(dungeon.instanceId),
  }));
}

// lootSlots: instanceId → the catalog loot's distinct slots, served as the
// optional `atlas.lootSlots` ([] when the catalog has no equippable loot).
export function withAtlasList(list, lootSlots = new Map()) {
  if (!list || !Array.isArray(list.dungeons)) return list;
  return { ...list, dungeons: list.dungeons.map((dungeon) => {
    const atlas = atlasSummary(dungeon.instanceId);
    return { ...dungeon, atlas: atlas && { ...atlas, lootSlots: lootSlots.get(Number(dungeon.instanceId)) || [] } };
  }),
    atlasDungeons: atlasOnlyDungeons(list.dungeons.map((dungeon) => dungeon.instanceId)) };
}

// A catalog detail with `atlas` added. A dungeon the catalog has never seen
// but the atlas knows answers with empty loot rather than 404.
export function withAtlasDetail(detail, instanceId, revision = 0) {
  if (detail) return { ...detail, atlas: atlasDetail(detail.instance.instanceId, detail.sources) };
  const dungeon = atlasDungeon(instanceId);
  if (!dungeon) return null;
  return {
    schemaVersion: 1, revision,
    instance: { instanceId: dungeon.instanceId, name: dungeon.name, type: dungeon.kind === "raid" ? "raid" : "party", journalInstanceId: null, firstSeenAt: null, lastSeenAt: null },
    difficulties: {}, sources: [], changes: [],
    evidence: { note: "Nobody has reported loot from this dungeon yet. The atlas facts come from the sources listed in its provenance." },
    atlas: atlasDetail(dungeon.instanceId, []),
  };
}
