// Serves the Dungeon Atlas (data/atlas.json, written by
// scripts/importDungeonAtlas.mjs) in the shapes of docs/dungeon-atlas-contract.md
// and joins it to the loot catalog's responses. Read-only, local: nothing
// here calls another service.

import { normalizedName, wishlistItemKey } from "../Loot/lootModel.js";
import { loadAtlas } from "./atlasData.js";
import { referenceDungeon, referenceItem, referenceSummary, referenceVersion, sortReferenceItems } from "./referenceLoot.js";

export { loadAtlas };

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
    // Known (0 included) once the dungeon has spawn data; null means unknown.
    rareCount: dungeon.rareCount ?? null,
    questCount: dungeon.quests.length,
    kind: dungeon.kind,
    // Classic reference loot (docs/dungeon-atlas-contract-sprint2.md).
    ...referenceSummary(instanceId),
  };
}

// The catalog's item records of this dungeon by item id: what was observed
// here. Observed facts win over reference facts.
function observedItems(sources) {
  const observed = new Map();
  for (const source of sources || []) for (const item of source.items || []) if (!observed.has(item.itemId)) observed.set(item.itemId, item);
  return observed;
}

function referenceList(itemIds, observed) {
  return sortReferenceItems(itemIds.map((itemId) => referenceItem(itemId, { observed: observed.get(itemId) || null })).filter(Boolean));
}

// A boss joined to the catalog's source groups for it (by npc id, encounter
// id or name): the item keys the catalog lists under them, and the catalog's
// spelling of the name, so the frontend can match boss.name to
// sources[].name. atlasName keeps the atlas source's own spelling.
function bossWithCatalog(boss, sources, reference = null, observed = new Map()) {
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
  const referenceIds = reference?.bosses.find((entry) => entry.encounterId === boss.encounterId)?.itemIds || [];
  return { ...boss, name: sourceName || boss.name, atlasName: boss.name, loot: [...keys], referenceLoot: referenceList(referenceIds, observed) };
}

// The detail's `atlas`. `sources` is the catalog's source groups, used only
// to point bosses at loot the catalog already holds.
export function atlasDetail(instanceId, sources = []) {
  const dungeon = atlasDungeon(instanceId);
  if (!dungeon) return null;
  const reference = referenceDungeon(dungeon.instanceId);
  const observed = observedItems(sources);
  return {
    description: dungeon.description,
    kind: dungeon.kind,
    levelMin: dungeon.levelMin, levelMax: dungeon.levelMax, recommendedLevel: dungeon.recommendedLevel,
    ...(dungeon.wings ? { wings: dungeon.wings } : {}),
    zoneName: dungeon.zoneName, zoneMapId: dungeon.zoneMapId,
    maps: dungeon.maps,
    bosses: dungeon.bosses.map((boss) => bossWithCatalog(boss, sources, reference, observed)),
    creatures: dungeon.creatures,
    rares: dungeon.rares.map((rare) => ({ ...rare,
      referenceLoot: referenceList(reference?.rares.find((entry) => entry.npcId === rare.npcId)?.itemIds || [], observed) })),
    // Trash and chest drops no boss or rare of the dungeon has.
    dungeonLoot: sortReferenceItems((reference?.dungeonLoot || []).map((entry) => {
      const item = referenceItem(entry.itemId, { observed: observed.get(entry.itemId) || null });
      return item && { ...item, sourceName: entry.sourceName ?? null, npcId: entry.npcId ?? null };
    }).filter(Boolean)),
    referenceVersion: referenceVersion(),
    quests: dungeon.quests.map((quest) => ({
      ...quest,
      objective: quest.objective ?? null, prerequisites: quest.prerequisites || [], location: quest.location ?? null, provenance: quest.provenance || [],
      rewards: (quest.rewards || []).map((reward) => {
        const item = referenceItem(reward.itemId, { observed: observed.get(reward.itemId) || null });
        return item && { ...item, choice: reward.choice };
      }).filter(Boolean),
    })),
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
