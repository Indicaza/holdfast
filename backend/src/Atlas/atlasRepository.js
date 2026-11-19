// Serves the Dungeon Atlas (data/atlas.json, written by
// scripts/importDungeonAtlas.mjs) in the shapes of docs/dungeon-atlas-contract.md
// and joins it to the loot catalog's responses. Read-only, local: nothing
// here calls another service.

import { normalizedName, wishlistItemKey } from "../Loot/lootModel.js";
import { loadAtlas, loadQuestCatalog } from "./atlasData.js";
import { referenceDungeon, referenceItem, referenceSummary, referenceVersion, sortReferenceItems } from "./referenceLoot.js";
import { isWingKey, parentKeyFor, unassignedOf, wingsOf } from "./atlasWings.js";
import { DEFAULT_RELEVANCE } from "./atlasQuests.js";
import { evaluateReadiness, readCharacterState } from "./atlasReadiness.js";

export { loadAtlas };

export function atlasDungeon(instanceId) {
  return loadAtlas().byId.get(Number(instanceId)) || null;
}

// What a dungeon id in a URL names: a numeric instance ID (the dungeon, as
// before), a dungeon key ("deadmines"), or a wing key
// ("scarlet-monastery:library"). { instanceId, wingKey } or null.
export function resolveDungeonId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^\d{1,9}$/.test(text)) return { instanceId: Number(text), wingKey: null };
  if (!/^[a-z0-9-]{1,80}(:[a-z0-9-]{1,40})?$/.test(text)) return null;
  for (const dungeon of loadAtlas().atlas.dungeons) {
    if (isWingKey(text)) {
      if (wingsOf(dungeon).some((wing) => wing.dungeonKey === text)) return { instanceId: dungeon.instanceId, wingKey: text };
    } else if (parentKeyFor(dungeon) === text) {
      return { instanceId: dungeon.instanceId, wingKey: null };
    }
  }
  return null;
}

// A wing's identity as list entries and details carry it.
function wingIdentity(wing) {
  return { dungeonKey: wing.dungeonKey, parentKey: wing.parentKey, instanceId: wing.instanceId, wing: wing.wing, name: wing.name,
    levelMin: wing.levelMin, levelMax: wing.levelMax };
}

// The list entry's `atlas`, or null when the atlas has no such dungeon.
export function atlasSummary(instanceId) {
  const dungeon = atlasDungeon(instanceId);
  if (!dungeon) return null;
  const wings = wingsOf(dungeon);
  return {
    // Optional additions: the dungeon's stable key, and its wings when they
    // are played as separate dungeons (see Atlas/atlasWings.js).
    dungeonKey: parentKeyFor(dungeon),
    ...(wings.length ? { wingEntries: wings.map(wingIdentity) } : {}),
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

// sources: the reference entry's { source: itemIds } (who lists each item);
// each item says which reference sources list it (referenceSources).
function referenceList(itemIds, observed, sources = null) {
  const by = new Map();
  for (const [source, ids] of Object.entries(sources || {})) for (const itemId of ids) by.set(itemId, [...(by.get(itemId) || []), source]);
  return sortReferenceItems(itemIds.map((itemId) => {
    const item = referenceItem(itemId, { observed: observed.get(itemId) || null });
    return item && (by.size ? { ...item, referenceSources: (by.get(itemId) || []).sort() } : item);
  }).filter(Boolean));
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
  const entry = reference?.bosses.find((candidate) => candidate.encounterId === boss.encounterId);
  return { ...boss, name: sourceName || boss.name, atlasName: boss.name, loot: [...keys], referenceLoot: referenceList(entry?.itemIds || [], observed, entry?.sources) };
}

// The detail's `atlas`. `sources` is the catalog's source groups, used only
// to point bosses at loot the catalog already holds.
export function atlasDetail(instanceId, sources = []) {
  const dungeon = atlasDungeon(instanceId);
  if (!dungeon) return null;
  const reference = referenceDungeon(dungeon.instanceId);
  const observed = observedItems(sources);
  const wings = wingsOf(dungeon);
  return {
    dungeonKey: parentKeyFor(dungeon),
    ...(wings.length ? { wingEntries: wings.map(wingIdentity) } : {}),
    description: dungeon.description,
    kind: dungeon.kind,
    levelMin: dungeon.levelMin, levelMax: dungeon.levelMax, recommendedLevel: dungeon.recommendedLevel,
    ...(dungeon.wings ? { wings: dungeon.wings } : {}),
    zoneName: dungeon.zoneName, zoneMapId: dungeon.zoneMapId,
    maps: dungeon.maps,
    bosses: dungeon.bosses.map((boss) => bossWithCatalog(boss, sources, reference, observed)),
    creatures: dungeon.creatures,
    rares: dungeon.rares.map((rare) => {
      const entry = reference?.rares.find((candidate) => candidate.npcId === rare.npcId);
      return { ...rare, referenceLoot: referenceList(entry?.itemIds || [], observed, entry?.sources) };
    }),
    // Trash and chest drops no boss or rare of the dungeon has.
    dungeonLoot: sortReferenceItems((reference?.dungeonLoot || []).map((entry) => {
      const item = referenceItem(entry.itemId, { observed: observed.get(entry.itemId) || null });
      // sourceName/npcId: the one creature or chest that drops it (null when
      // several do); sources: every one of them (optional addition).
      return item && { ...item, sourceName: entry.sourceName ?? null, npcId: entry.npcId ?? null, sources: entry.sources || [] };
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

// Does a catalog source group stand for this boss or rare (npc id, encounter
// id or name)?
function sourceMatches(source, entry) {
  if (source.kind === "unknown") return false;
  const name = normalizedName(entry.name);
  return Boolean((entry.npcId && source.npcIds?.includes(entry.npcId)) || (entry.encounterId && source.encounterIds?.includes(entry.encounterId))
    || (name && normalizedName(source.name) === name));
}

// The list entry of one wing: its own bosses, rares and reference loot;
// quests and trash loot are the dungeon's, shared by every wing.
function wingSummary(dungeon, wing) {
  const reference = referenceDungeon(dungeon.instanceId);
  const own = new Set();
  for (const boss of wing.bosses) for (const id of reference?.bosses.find((entry) => entry.encounterId === boss.encounterId)?.itemIds || []) own.add(id);
  for (const rare of wing.rares) for (const id of reference?.rares.find((entry) => entry.npcId === rare.npcId)?.itemIds || []) own.add(id);
  const shared = new Set((reference?.dungeonLoot || []).map((entry) => entry.itemId));
  for (const quest of dungeon.quests) for (const reward of quest.rewards || []) shared.add(reward.itemId);
  const base = referenceSummary(dungeon.instanceId);
  const ids = [...new Set([...own, ...[...shared].filter((id) => base.referenceItemIds.includes(id))])];
  const { referenceSlots } = referenceSummary(dungeon.instanceId);
  return {
    ...wingIdentity(wing),
    levelSource: wing.levelSource,
    recommendedLevel: dungeon.recommendedLevel,
    zoneName: dungeon.zoneName, zoneMapId: dungeon.zoneMapId, entrance: wing.entrance, artworkUrl: dungeon.artworkUrl,
    bossCount: wing.bosses.length,
    rareCount: dungeon.rareCount === null || dungeon.rareCount === undefined ? null : wing.rares.length,
    questCount: dungeon.quests.length,
    sharedQuestCount: dungeon.quests.length,
    kind: dungeon.kind,
    referenceLootCount: ids.length, referenceItemIds: ids,
    referenceSlots: referenceSlots.filter((slot) => ids.some((id) => referenceItem(id)?.slot === slot)),
    // Who the wing's bosses and rares are, so a client can tell a wishlist
    // source of this wing from one of a sibling wing.
    bossNpcIds: [...wing.bosses, ...wing.rares].map((entry) => entry.npcId).filter(Boolean),
    bossNames: [...wing.bosses, ...wing.rares].map((entry) => entry.name),
  };
}

// Every wing of every multi-wing atlas dungeon, as list entries.
// lootSlots: instanceId → the catalog's slots (the instance's, not the wing's).
export function atlasWingEntries(lootSlots = new Map()) {
  const entries = [];
  for (const dungeon of loadAtlas().atlas.dungeons) {
    for (const wing of wingsOf(dungeon)) {
      entries.push({ instanceId: dungeon.instanceId, dungeonKey: wing.dungeonKey, parentKey: wing.parentKey, wing: wing.wing, name: wing.name,
        instanceName: dungeon.name, type: dungeon.kind === "raid" ? "raid" : "party",
        atlas: { ...wingSummary(dungeon, wing), lootSlots: lootSlots.get(Number(dungeon.instanceId)) || [] } });
    }
  }
  return entries;
}

// A wing's detail: the dungeon's catalog detail and atlas, narrowed to the
// wing. Catalog sources that are one of this wing's bosses or rares are the
// wing's; ones that are a sibling wing's are left out; the rest (trash, an
// unassigned boss, unknown sources) are kept and marked shared. Null when
// the key names no wing.
export function withAtlasWingDetail(detail, wingKey, revision = 0) {
  for (const dungeon of loadAtlas().atlas.dungeons) {
    const wings = wingsOf(dungeon);
    const wing = wings.find((entry) => entry.dungeonKey === wingKey);
    if (!wing) continue;
    const others = wings.filter((entry) => entry !== wing).flatMap((entry) => [...entry.bosses, ...entry.rares]);
    const mine = [...wing.bosses, ...wing.rares];
    const sources = [];
    let leftOut = 0;
    for (const source of detail?.sources || []) {
      if (mine.some((entry) => sourceMatches(source, entry))) sources.push({ ...source, wingAttribution: "wing" });
      else if (others.some((entry) => sourceMatches(source, entry))) leftOut += 1;
      else sources.push({ ...source, wingAttribution: "shared" });
    }
    const base = detail || withAtlasDetail(null, dungeon.instanceId, revision);
    const full = atlasDetail(dungeon.instanceId, sources);
    const npcIds = new Set(mine.map((entry) => entry.npcId));
    const unassigned = unassignedOf(dungeon);
    const shared = (list) => list.map((entry) => ({ ...entry, wingAttribution: "shared" }));
    return {
      ...base,
      sources,
      wing: { ...wingIdentity(wing), slug: wing.slug, parentName: wing.parentName, levelSource: wing.levelSource, sourcesLeftOut: leftOut,
        siblings: wings.filter((entry) => entry !== wing).map(wingIdentity) },
      atlas: {
        ...full,
        dungeonKey: wing.dungeonKey, parentKey: wing.parentKey, wing: wing.wing, name: wing.name,
        levelMin: wing.levelMin, levelMax: wing.levelMax, levelSource: wing.levelSource,
        bosses: full.bosses.filter((boss) => boss.npcId && npcIds.has(boss.npcId)),
        rares: full.rares.filter((rare) => rare.npcId && npcIds.has(rare.npcId)),
        creatures: shared(full.creatures),
        quests: shared(full.quests),
        dungeonLoot: shared(full.dungeonLoot),
        entrance: wing.entrance, entrances: wing.entrances, entrancesShared: wing.entrancesShared,
        floors: wing.floors,
        // Bosses and rares of the dungeon no source places in a wing.
        unassigned: { bosses: unassigned.bosses.map((boss) => boss.name), rares: unassigned.rares.map((rare) => rare.name) },
        provenance: [...full.provenance, ...wing.provenance],
      },
    };
  }
  return null;
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
    atlasDungeons: atlasOnlyDungeons(list.dungeons.map((dungeon) => dungeon.instanceId)),
    // Optional addition: one entry per wing of a multi-wing dungeon. The
    // dungeon's own entry above is unchanged (old clients, numeric links).
    atlasWings: atlasWingEntries(lootSlots) };
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

// ------------------------------------------------------------ Quests

// A dungeon's (or wing's) quest catalog for the API: the quests shown by
// default (every relevance but "zone"), or all with include "all". A wing
// leaves out quests attributed to a sibling wing. Rewards are served as
// ReferenceItems (unknown ids left out). Null when the id names no dungeon.
export function atlasQuests(id, { include = "" } = {}) {
  const target = resolveDungeonId(id);
  if (!target) return null;
  const dungeon = atlasDungeon(target.instanceId);
  const entry = loadQuestCatalog().byId.get(target.instanceId);
  if (!dungeon || !entry) return null;
  const all = include === "all";
  const quests = entry.quests
    .filter((quest) => (all || DEFAULT_RELEVANCE.includes(quest.relevance)) && (!target.wingKey || !quest.wing || quest.wing === target.wingKey))
    .map((quest) => ({ ...quest, rewards: quest.rewards.map((reward) => {
      const item = referenceItem(reward.itemId);
      return item && { ...item, choice: reward.choice };
    }).filter(Boolean), verifiedForForever: false }));
  const wing = target.wingKey ? wingsOf(dungeon).find((candidate) => candidate.dungeonKey === target.wingKey) : null;
  const { catalog } = loadQuestCatalog();
  return {
    schemaVersion: catalog.schemaVersion,
    dungeon: { instanceId: dungeon.instanceId, dungeonKey: wing?.dungeonKey || parentKeyFor(dungeon), name: wing?.name || dungeon.name,
      wing: wing ? wing.wing : null },
    curated: entry.curated,
    relevance: catalog.relevance,
    included: all ? "all" : "default",
    hiddenZoneQuests: all ? 0 : entry.quests.filter((quest) => quest.relevance === "zone").length,
    quests,
    sources: catalog.sources,
  };
}

// Readiness of a character (the state it is given) for a dungeon or wing.
// { status: "ok", result } | { status: "invalid", problems } | null.
export function atlasReadiness(id, rawState) {
  const target = resolveDungeonId(id);
  const entry = target && loadQuestCatalog().byId.get(target.instanceId);
  if (!entry) return null;
  const { state, problems } = readCharacterState(rawState);
  if (!state) return { status: "invalid", problems };
  return { status: "ok", result: { dungeon: { instanceId: target.instanceId, dungeonKey: target.wingKey || parentKeyFor(atlasDungeon(target.instanceId)) },
    ...evaluateReadiness(entry.quests, state, { wingKey: target.wingKey }) } };
}
