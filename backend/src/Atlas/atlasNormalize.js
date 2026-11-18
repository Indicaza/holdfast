// Source adapters of the Dungeon Atlas: each turns one checked-in source
// extract into atlas facts that carry their provenance, and normalize()
// merges them into the dataset the API serves (data/atlas.json). Pure.
//
// Rules:
// - A fact is only written when a source says it. Anything else is null or
//   [] (never a guess, an average, or a default).
// - Every fact group names its source, revision, tier and confidence.
// - Nothing derived from a non-Forever source claims verifiedForForever.

import { VANILLA_INSTANCE_IDS } from "./atlasSources.js";

export const ATLAS_SCHEMA_VERSION = 1;
export const TIERS = Object.freeze(["official-client", "forever-reference", "classic-reference", "community-unverified"]);
export const ABILITY_CATEGORIES = Object.freeze(["interrupt", "tank-danger", "healer-danger", "positioning", "dispel", "crowd-control", "special-mechanic"]);

// LFGDungeons names its entries by wing, with MapID 0 in the Classic Era
// client; this is the client's own name for each entry, to its map.
const LFG_TO_MAP = Object.freeze({
  "Wailing Caverns": 43, Deadmines: 36, "Shadowfang Keep": 33, "Stormwind Stockades": 34, "Blackfathom Deeps": 48, Gnomeregan: 90,
  "Razorfen Kraul": 47, "Scarlet Monastery": 189, "Razorfen Downs": 129, Uldaman: 70, "Zul'Farak": 209, Maraudon: 349, "Sunken Temple": 109,
  "Blackrock Depths": 230, "Lower Blackrock Spire": 229, "Upper Blackrock Spire": 229, "Dire Maul - East": 429, "Dire Maul - West": 429,
  "Dire Maul - North": 429, Stratholme: 329, Scholomance: 289, "Ragefire Chasm": 389, "Zul'Gurub": 309, Onyxia: 249, "Molten Core": 409,
  "Blackwing Lair": 469,
});

// Race bits of AllowableRaces (3.3.5 masks include Blood Elf / Draenei).
const ALLIANCE_RACES = 1 | 4 | 8 | 64 | 1024;
const HORDE_RACES = 2 | 16 | 32 | 128 | 512;
// Vanilla quest ids end below the first Burning Crusade ids.
const LAST_VANILLA_QUEST_ID = 9299;
const PLACEHOLDER_TITLE = /^\s*(<|\[)|\b(UNUSED|DEPRECATED|PH|TEST|NYI)\b/i;

const int = (value) => {
  const number = Number(value);
  return value === "" || value === null || value === undefined || !Number.isFinite(number) ? null : Math.trunc(number);
};
const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};
const round4 = (value) => Math.round(value * 10000) / 10000;

export function provenanceOf(extract, { tier, confidence, note = null }) {
  if (!TIERS.includes(tier)) throw new Error(`Unknown tier ${tier}`);
  return { source: extract.source, revision: extract.revision ?? null, confidence, tier, retrievedAt: extract.retrievedAt ?? null, url: extract.url ?? null,
    ...(note ? { note } : {}) };
}

// ---------------------------------------------------------------- Adapters

// Blizzard's Classic Era client tables: names, kind, level bands, the boss
// list, and where the client's entrance triggers stand.
export function adaptWagoClassicEra(extract, { teleports = new Map() } = {}) {
  const t = extract.tables;
  const prov = (confidence, note) => provenanceOf(extract, { tier: "classic-reference", confidence, note });
  const out = new Map();

  for (const row of t.Map || []) {
    const instanceId = int(row.ID);
    out.set(instanceId, {
      instanceId, name: text(row.MapName_lang), kind: row.InstanceType === "2" ? "raid" : "dungeon", maxPlayers: int(row.MaxPlayers),
      description: text(row.MapDescription0_lang) || text(row.MapDescription1_lang), levelMin: null, levelMax: null, bosses: [], entrances: [],
      provenance: [prov("high", "Map: name, kind, size")],
    });
  }

  const levels = new Map();
  for (const row of t.LFGDungeons || []) {
    const instanceId = LFG_TO_MAP[row.Name_lang];
    const min = int(row.MinLevel);
    const max = int(row.MaxLevel);
    if (!instanceId || !out.has(instanceId) || !min || !max) continue;
    const band = levels.get(instanceId) || { min, max, wings: [] };
    band.min = Math.min(band.min, min);
    band.max = Math.max(band.max, max);
    band.wings.push({ name: row.Name_lang, levelMin: min, levelMax: max });
    levels.set(instanceId, band);
  }
  for (const [instanceId, band] of levels) {
    const entry = out.get(instanceId);
    entry.levelMin = band.min;
    entry.levelMax = band.max;
    if (band.wings.length > 1) entry.wings = band.wings;
    entry.provenance.push(prov("high", "LFGDungeons: level band"));
  }

  // Only the original difficulty (0 = none, 1 = normal); other difficulties of
  // these maps in the Classic Era client are Season of Discovery versions.
  for (const row of t.DungeonEncounter || []) {
    const entry = out.get(int(row.MapID));
    if (!entry || !["0", "1"].includes(String(row.DifficultyID))) continue;
    entry.bosses.push({ encounterId: int(row.ID), name: text(row.Name_lang), order: int(row.OrderIndex) });
  }
  for (const entry of out.values()) {
    entry.bosses.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.encounterId - b.encounterId);
    if (entry.bosses.length) entry.provenance.push(prov("high", "DungeonEncounter: boss list and order"));
  }

  // Entrances: the client's outdoor area triggers that teleport into the map
  // (which trigger goes where comes from the emulator's teleport table),
  // placed in the zone map that contains them.
  const zones = zoneRegions(t);
  for (const row of t.AreaTrigger || []) {
    const target = teleports.get(int(row.ID));
    const entry = target && out.get(target.instanceId);
    if (!entry) continue;
    const point = zonePoint(zones, int(row.ContinentID), Number(row.Pos_0), Number(row.Pos_1));
    if (!point) continue;
    entry.entrances.push({ ...point, areaTriggerId: int(row.ID), label: target.label });
  }
  for (const entry of out.values()) {
    entry.entrances.sort((a, b) => a.areaTriggerId - b.areaTriggerId);
    if (entry.entrances.length) entry.provenance.push(prov("medium", "AreaTrigger positions (client) joined to areatrigger_teleport (AzerothCore)"));
  }
  return out;
}

function zoneRegions(tables) {
  const names = new Map((tables.UiMap || []).filter((row) => row.Type === "3").map((row) => [int(row.ID), text(row.Name_lang)]));
  return (tables.UiMapAssignment || []).filter((row) => names.has(int(row.UiMapID))).map((row) => ({
    mapId: int(row.UiMapID), name: names.get(int(row.UiMapID)), continentId: int(row.MapID),
    minX: Number(row.Region_0), minY: Number(row.Region_1), maxX: Number(row.Region_3), maxY: Number(row.Region_4),
  }));
}

// A world position (game x = north, y = west) as the zone map's normalised
// coordinate (0–1 from the top left). Zone rectangles overlap, so the zone
// is picked the way the site's world map draws borders (frontend
// Player/Map/atlas.js): a city whose rectangle holds the point wins,
// otherwise the holding zone whose centre is nearest (its Voronoi cell on
// the site's map). The position itself is the same world point whichever
// zone frames it; near borders the cell can differ from the game's own zone
// (docs/dungeon-atlas-sources.md lists the known cases).
const CITY_MAP_IDS = new Set([1453, 1454, 1455, 1456, 1457, 1458]);
export function zonePoint(zones, continentId, worldX, worldY) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  const holding = zones.filter((z) => z.continentId === continentId && worldX >= z.minX && worldX <= z.maxX && worldY >= z.minY && worldY <= z.maxY);
  const distance = (z) => Math.hypot(worldX - (z.minX + z.maxX) / 2, worldY - (z.minY + z.maxY) / 2);
  const zone = holding.find((z) => CITY_MAP_IDS.has(z.mapId)) || holding.filter((z) => !CITY_MAP_IDS.has(z.mapId)).sort((a, b) => distance(a) - distance(b))[0];
  if (!zone) return null;
  return { mapId: zone.mapId, zoneName: zone.name, x: round4((zone.maxY - worldY) / (zone.maxY - zone.minY)), y: round4((zone.maxX - worldX) / (zone.maxX - zone.minX)) };
}

// AzerothCore's world DB: which trigger enters which map, dungeon quests
// (by the dungeon's zone) and who starts them, and boss creature ids by an
// exact, unique name match.
export function adaptAzerothCore(extract, { areaToInstance = new Map() } = {}) {
  const t = extract.tables;
  const prov = (confidence, note) => provenanceOf(extract, { tier: "community-unverified", confidence, note });
  const teleports = new Map((t.areatrigger_teleport || []).map((row) => [int(row.ID), { instanceId: int(row.target_map), label: text(row.Name) }]));
  const creatures = new Map((t.creature_template || []).map((row) => [int(row.entry), row]));
  const starters = new Map();
  for (const row of t.creature_queststarter || []) {
    const quest = int(row.quest);
    if (!starters.has(quest)) starters.set(quest, []);
    starters.get(quest).push(int(row.id));
  }

  const quests = new Map();
  for (const row of t.quest_template || []) {
    const questId = int(row.ID);
    const instanceId = areaToInstance.get(int(row.QuestSortID));
    const name = text(row.LogTitle);
    if (!instanceId || !questId || questId > LAST_VANILLA_QUEST_ID || !name || PLACEHOLDER_TITLE.test(name)) continue;
    const races = int(row.AllowableRaces) || 0;
    const alliance = !races || (races & ALLIANCE_RACES) !== 0;
    const horde = !races || (races & HORDE_RACES) !== 0;
    const giverId = (starters.get(questId) || []).sort((a, b) => a - b)[0] ?? null;
    const giver = giverId ? { npcId: giverId, name: text(creatures.get(giverId)?.name) } : null;
    const list = quests.get(instanceId) || [];
    list.push({ questId, name, level: int(row.QuestLevel) > 0 ? int(row.QuestLevel) : null, minLevel: int(row.MinLevel) || null,
      faction: alliance && horde ? "both" : alliance ? "alliance" : "horde", giver });
    quests.set(instanceId, list);
  }
  for (const list of quests.values()) list.sort((a, b) => (a.minLevel ?? 0) - (b.minLevel ?? 0) || a.questId - b.questId);

  // Boss name → npc id only when exactly one vanilla-range creature has it.
  const byName = new Map();
  for (const [entry, row] of creatures) {
    if (entry >= 17000) continue;
    const key = String(row.name || "");
    byName.set(key, byName.has(key) ? null : entry);
  }
  return { teleports, quests, npcIdOf: (name) => byName.get(String(name || "")) ?? null,
    questProvenance: prov("medium", "quest_template by dungeon zone (QuestSortID), creature_queststarter, creature_template"),
    npcProvenance: prov("medium", "creature_template: unique exact name match") };
}

// ---------------------------------------------------------------- Normalize

export function normalize({ wago, azerothcore, generatedAt = null }) {
  const areaToInstance = new Map((wago?.tables?.AreaTable || []).map((row) => [int(row.ID), int(row.ContinentID)]));
  const ac = azerothcore ? adaptAzerothCore(azerothcore, { areaToInstance }) : null;
  const base = wago ? adaptWagoClassicEra(wago, { teleports: ac?.teleports || new Map() }) : new Map();
  const dungeons = VANILLA_INSTANCE_IDS.filter((id) => base.has(id)).map((instanceId) => {
    const entry = base.get(instanceId);
    const quests = ac?.quests.get(instanceId) || [];
    const provenance = [...entry.provenance];
    if (quests.length) provenance.push(ac.questProvenance);
    const bosses = entry.bosses.map((boss) => {
      const npcId = ac ? ac.npcIdOf(boss.name) : null;
      return { encounterId: boss.encounterId, npcId, name: boss.name, order: boss.order, portraitUrl: null, floorId: null, mapPosition: null, abilities: [],
        strategy: null, provenance: [entry.provenance.find((line) => line.note?.startsWith("DungeonEncounter")), ...(npcId ? [ac.npcProvenance] : [])].filter(Boolean) };
    });
    const entrance = entry.entrances[0] || null;
    return {
      instanceId, name: entry.name, kind: entry.kind, maxPlayers: entry.maxPlayers, description: entry.description,
      levelMin: entry.levelMin, levelMax: entry.levelMax, recommendedLevel: null, ...(entry.wings ? { wings: entry.wings } : {}),
      zoneName: entrance?.zoneName ?? null, zoneMapId: entrance?.mapId ?? null,
      entrance: entrance ? { mapId: entrance.mapId, x: entrance.x, y: entrance.y } : null,
      entrances: entry.entrances.map(({ mapId, zoneName, x, y, label, areaTriggerId }) => ({ mapId, zoneName, x, y, label, areaTriggerId })),
      artworkUrl: null, maps: [], bosses, creatures: [], rares: [], quests, provenance,
    };
  });
  return { schemaVersion: ATLAS_SCHEMA_VERSION, generatedAt, sources: [wago, azerothcore].filter(Boolean).map((extract) => ({ source: extract.source,
    revision: extract.revision ?? null, retrievedAt: extract.retrievedAt ?? null, url: extract.url ?? null, license: extract.license ?? null })), dungeons };
}

// Invariants every dataset must meet before it is written or served.
export function atlasProblems(atlas) {
  const problems = [];
  const unit = (value) => typeof value === "number" && value >= 0 && value <= 1;
  for (const dungeon of atlas?.dungeons || []) {
    const where = `${dungeon.instanceId} ${dungeon.name}`;
    if (!dungeon.provenance?.length) problems.push(`${where}: no provenance`);
    for (const line of dungeon.provenance || []) if (!TIERS.includes(line.tier) || !line.source) problems.push(`${where}: bad provenance`);
    if (dungeon.entrance && !(unit(dungeon.entrance.x) && unit(dungeon.entrance.y) && dungeon.entrance.mapId)) problems.push(`${where}: entrance out of range`);
    if (dungeon.levelMin !== null && !(dungeon.levelMin <= dungeon.levelMax)) problems.push(`${where}: level band`);
    for (const boss of dungeon.bosses || []) {
      if (boss.mapPosition !== null && !(unit(boss.mapPosition?.x) && unit(boss.mapPosition?.y))) problems.push(`${where}: ${boss.name} mapPosition`);
      if (!boss.provenance?.length) problems.push(`${where}: ${boss.name} has no provenance`);
      for (const ability of boss.abilities || []) {
        if (!ABILITY_CATEGORIES.includes(ability.category)) problems.push(`${where}: ${boss.name} ability category`);
        if (ability.verifiedForForever && ability.source !== "official-client" && ability.source !== "forever-reference") {
          problems.push(`${where}: ${boss.name} ${ability.name} claims Forever verification from ${ability.source}`);
        }
      }
    }
    for (const art of [dungeon.artworkUrl, ...(dungeon.bosses || []).map((boss) => boss.portraitUrl), ...(dungeon.maps || []).map((map) => map.imageUrl)]) {
      if (art !== null && !String(art).startsWith("/")) problems.push(`${where}: art must be a local asset or null`);
    }
  }
  return problems;
}
