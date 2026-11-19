// WoW Forever's own dungeons in the Dungeon Atlas.
//
// The Classic sources (wago Classic Era, AzerothCore) know nothing of the
// instances Forever added. Their facts come from:
//   - the Forever client's tables, as OpenMap (https://github.com/openmap-world/openmap,
//     MIT) generates them into OpenMap/Data/Forever/Places.lua from the game
//     (build 1.60.1): every instance's map ID, name, raid flag and Group
//     Finder level band, where its entrance is on its zone's map, and its
//     encounters by name in the game's order. These are the client's own
//     records: tier "forever-reference".
//   - DungeonPlanner (MIT; scripts/fetchDungeonPlannerSources.mjs): NPC IDs,
//     floor names, boss drop lists and quest lists for the Forever dungeons,
//     from Forever web guides and warcraft.wiki.gg (tier "community-unverified").
//   - What Guildweaver players' clients reported (FOREVER_OBSERVED below).
// An instance is in the atlas only when the client's tables have its map ID:
// none is invented. A name the client's encounter list gives is the boss's
// name; an NPC ID is attached only when DungeonPlanner names exactly that
// boss. Nothing here is Classic reference data.

import { VANILLA_INSTANCE_IDS } from "./atlasSources.js";

const int = (value) => {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? null : Math.trunc(number);
};
const nameKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const round4 = (value) => Math.round(value * 10000) / 10000;

// Encounter IDs Guildweaver players' clients sent (ENCOUNTER_END, in
// Details! encounter records; Indicaza/guildweaver Data/DungeonBosses.lua).
export const FOREVER_OBSERVED = Object.freeze({
  2998: Object.freeze([
    { name: "Saltspine", encounterId: 3480 },
    { name: "Shadetooth", encounterId: 3481 },
  ]),
});
const OBSERVED_NOTE = "Encounter IDs a Guildweaver player's client reported (ENCOUNTER_END, Details! encounter records, 2026-11-13)";

// OpenMap's Places.lua as data: instances with a zone-map entrance, and the
// encounter names per map ID. Only the two shapes the file uses are read.
export function parseOpenMapPlaces(text) {
  const instances = [];
  const placed = /\{\s*nil,\s*([\d.]+),\s*([\d.]+),\s*\{((?:\s*\{[^{}]*\},?)+)\s*\},\s*map\s*=\s*(\d+)\s*\}/g;
  const one = /\{\s*(\d+),\s*"((?:[^"\\]|\\.)*)",\s*(true|false),\s*(\d+),\s*(\d+)\s*\}/g;
  for (const match of String(text).matchAll(placed)) {
    for (const entry of match[3].matchAll(one)) {
      instances.push([int(entry[1]), entry[2].replace(/\\(.)/g, "$1"), entry[3] === "true", int(entry[4]), int(entry[5]), int(match[4]),
        round4(Number(match[1])), round4(Number(match[2]))]);
    }
  }
  const encounters = [];
  const bossBlock = /\[(\d+)\]\s*=\s*\{((?:\s*"(?:[^"\\]|\\.)*",?)+)\s*\}/g;
  for (const match of String(text).matchAll(bossBlock)) {
    let order = 0;
    for (const name of match[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      order += 1;
      encounters.push([int(match[1]), order, name[1].replace(/\\(.)/g, "$1")]);
    }
  }
  return { instances, encounters };
}

// The extract (data/sources/forever-instances.json tables): the instances
// the client lists that are not the original game's.
export function extractForever(places) {
  const vanilla = new Set(VANILLA_INSTANCE_IDS);
  const instances = places.instances.filter(([mapId]) => mapId && !vanilla.has(mapId)).sort((a, b) => a[0] - b[0]);
  const ids = new Set(instances.map(([mapId]) => mapId));
  const encounters = places.encounters.filter(([mapId]) => ids.has(mapId)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { instances, encounters };
}

const provenanceLine = (extract, tier, confidence, note) => ({ source: extract.source, revision: extract.revision ?? null, confidence, tier,
  retrievedAt: extract.retrievedAt ?? null, url: extract.url ?? null, note });

// Atlas entries for the Forever instances, in the atlas's shape. Unknown
// facts stay null or []; `coverage` says what is known.
//   zoneName(uiMapId): the zone's name from the client's UiMap table, or null
export function normalizeForever({ forever, planner = null, zoneName = () => null }) {
  if (!forever) return [];
  const encounters = new Map();
  for (const [mapId, order, name] of forever.tables.encounters || []) {
    if (!encounters.has(mapId)) encounters.set(mapId, []);
    encounters.get(mapId).push({ order, name });
  }
  const plannerBosses = new Map();
  for (const [instanceId, npcId, name] of planner?.tables?.creatures || []) {
    if (!plannerBosses.has(instanceId)) plannerBosses.set(instanceId, []);
    plannerBosses.get(instanceId).push({ npcId, name });
  }
  const floors = new Map();
  for (const [instanceId, floor, name] of planner?.tables?.floors || []) {
    if (!floors.has(instanceId)) floors.set(instanceId, []);
    floors.get(instanceId).push({ floor, name });
  }
  const clientProv = provenanceLine(forever, "forever-reference", "high",
    "The Forever client's tables (OpenMap Places.lua): instance map ID, name, Group Finder level band, entrance, encounter names in order");
  const plannerProv = planner ? provenanceLine(planner, "community-unverified", "low", "DungeonPlanner: NPC IDs and floor names from Forever web guides") : null;
  return (forever.tables.instances || []).map(([instanceId, name, raid, minLevel, maxLevel, uiMapId, x, y]) => {
    const planned = plannerBosses.get(instanceId) || [];
    const observed = FOREVER_OBSERVED[instanceId] || [];
    const bosses = (encounters.get(instanceId) || []).map(({ order, name: bossName }) => {
      const npc = planned.filter((entry) => nameKey(entry.name) === nameKey(bossName));
      const seen = observed.find((entry) => nameKey(entry.name) === nameKey(bossName));
      const provenance = [clientProv];
      if (npc.length === 1 && plannerProv) provenance.push(plannerProv);
      if (seen) provenance.push({ source: "guildweaver-observed", revision: null, confidence: "high", tier: "forever-reference", retrievedAt: null, url: null,
        note: OBSERVED_NOTE });
      return { encounterId: seen ? seen.encounterId : null, npcId: npc.length === 1 ? npc[0].npcId : null, name: bossName, order: order * 1000,
        portraitUrl: null, floorId: null, mapPosition: null, abilities: [], loot: [], strategy: null, provenance };
    });
    const zone = zoneName(uiMapId);
    const knownFloors = (floors.get(instanceId) || []).sort((a, b) => a.floor - b.floor).map((entry) => entry.name);
    return {
      instanceId, name, kind: raid ? "raid" : "dungeon", maxPlayers: raid ? null : 5, description: null,
      levelMin: minLevel, levelMax: maxLevel, recommendedLevel: null,
      zoneName: zone, zoneMapId: uiMapId,
      entrance: uiMapId && Number.isFinite(x) && Number.isFinite(y) ? { mapId: uiMapId, x, y } : null,
      entrances: uiMapId && Number.isFinite(x) && Number.isFinite(y) ? [{ mapId: uiMapId, zoneName: zone, x, y, label: `${name} (Entrance)`, areaTriggerId: null }] : [],
      artworkUrl: null, maps: [], bosses, creatures: [], rares: [], rareCount: null, quests: [],
      origin: "forever",
      floorNames: knownFloors,
      // What is known about this instance, per kind of fact.
      coverage: {
        identity: "client",
        bosses: bosses.length ? "client-names" : "none",
        encounterIds: bosses.some((boss) => boss.encounterId) ? "partial-observed" : "none",
        npcIds: bosses.every((boss) => boss.npcId) ? "complete" : bosses.some((boss) => boss.npcId) ? "partial" : "none",
        maps: "none", abilities: "none", rares: "unknown", trash: "unknown",
      },
      provenance: [clientProv, ...(plannerProv && planned.length ? [plannerProv] : [])],
    };
  });
}
