// Classic reference loot (data/reference-loot.json, see Atlas/atlasLoot.js)
// as the site serves it: ReferenceItems for the atlas detail, and lookups
// the loot catalog and wishlists use so a reference item is a known item.
// Read-only and local.
//
// Reference loot is never evidence for WoW Forever: every item says
// observed: false and verifiedForForever: false unless the caller passes
// the loot catalog's own observations, which then win.

import { loadAtlas, loadReferenceData } from "./atlasData.js";

let index = null;

const BIND_IDS = Object.freeze({ BoP: 1, BoE: 2, BoU: 3, Quest: 4 });
const QUALITY_ORDER = (a, b) => (b.qualityId ?? -1) - (a.qualityId ?? -1) || (b.itemLevel ?? 0) - (a.itemLevel ?? 0) || a.name.localeCompare(b.name) || a.itemId - b.itemId;

function build() {
  const data = loadReferenceData();
  const { byId: atlasById } = loadAtlas();
  const items = new Map(Object.values(data.items || {}).map((item) => [item.itemId, item]));
  const dungeons = new Map((data.dungeons || []).map((dungeon) => [dungeon.instanceId, dungeon]));
  const byName = new Map();
  for (const item of items.values()) {
    const key = item.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item.itemId);
  }
  // itemId → where the reference data says it comes from.
  const sources = new Map();
  const add = (itemId, source) => {
    if (!sources.has(itemId)) sources.set(itemId, []);
    const list = sources.get(itemId);
    if (!list.some((entry) => entry.instanceId === source.instanceId && entry.bossName === source.bossName && entry.sourceType === source.sourceType)) list.push(source);
  };
  for (const dungeon of dungeons.values()) {
    const atlas = atlasById.get(dungeon.instanceId);
    const dungeonName = atlas?.name || dungeon.name;
    const base = { instanceId: dungeon.instanceId, dungeonName, reference: true };
    for (const boss of dungeon.bosses) {
      const atlasBoss = atlas?.bosses.find((entry) => entry.encounterId === boss.encounterId);
      for (const itemId of boss.itemIds) add(itemId, { ...base, bossName: atlasBoss?.name ?? null, npcId: boss.npcId ?? null, sourceType: "boss" });
    }
    for (const rare of dungeon.rares) {
      const atlasRare = atlas?.rares.find((entry) => entry.npcId === rare.npcId);
      for (const itemId of rare.itemIds) add(itemId, { ...base, bossName: atlasRare?.name ?? null, npcId: rare.npcId, sourceType: "rare" });
    }
    for (const entry of dungeon.dungeonLoot) add(entry.itemId, { ...base, bossName: entry.sourceName, npcId: entry.npcId, sourceType: "trash" });
    for (const quest of atlas?.quests || []) {
      for (const reward of quest.rewards || []) {
        if (items.has(reward.itemId)) add(reward.itemId, { ...base, bossName: null, npcId: quest.giver?.npcId ?? null, sourceType: "quest", questId: quest.questId, questName: quest.name });
      }
    }
  }
  const byIcon = new Map();
  for (const item of items.values()) {
    if (!item.iconFileDataId) continue;
    if (!byIcon.has(item.iconFileDataId)) byIcon.set(item.iconFileDataId, []);
    byIcon.get(item.iconFileDataId).push(item.itemId);
  }
  return { data, items, dungeons, byName, sources, byIcon };
}

function referenceIndex() {
  if (!index) index = build();
  return index;
}

export function referenceVersion() {
  const { data } = referenceIndex();
  return { dataset: data.dataset, revision: data.revision, importedAt: data.generatedAt };
}

// A ReferenceItem (docs/dungeon-atlas-contract-sprint2.md), or null.
// `observed` is the loot catalog's item record when the catalog holds the
// item for the dungeon in question: its facts win, and only then is the
// item verified for Forever.
export function referenceItem(itemId, { observed = null } = {}) {
  const { data, items } = referenceIndex();
  const item = items.get(Number(itemId));
  if (!item) return null;
  const provenance = [...(data.provenance || [])];
  if (!observed) return { ...item, observed: false, verifiedForForever: false, provenance };
  const pick = (value, fallback) => (value === null || value === undefined ? fallback : value);
  return {
    ...item,
    name: observed.nameKnown ? observed.name : item.name,
    qualityId: pick(observed.qualityId, item.qualityId), iconFileDataId: pick(observed.iconFileDataId, item.iconFileDataId),
    slot: pick(observed.slot, item.slot), itemLevel: pick(observed.itemLevel, item.itemLevel), requiredLevel: pick(observed.requiredLevel, item.requiredLevel),
    itemClass: pick(observed.itemClass, item.itemClass), itemSubclass: pick(observed.itemSubclass, item.itemSubclass),
    classes: pick(observed.classes, item.classes),
    bindType: pick(Object.keys(BIND_IDS).find((key) => BIND_IDS[key] === observed.bindType) ?? null, item.bindType),
    sellPrice: pick(observed.sellPrice, item.sellPrice),
    ...(observed.tooltip?.lines?.length ? { tooltip: observed.tooltip } : {}),
    ...(observed.itemDefinition ? { itemDefinition: observed.itemDefinition } : {}),
    observed: true, verifiedForForever: true,
    provenance: [{ source: "guildweaver-loot-catalog", revision: null, confidence: "high", tier: "official-client", retrievedAt: observed.lastSeenAt ?? null, url: null,
      note: "Observed in the game by Guildweaver players (the loot catalog); its facts win" }, ...provenance],
  };
}

export const sortReferenceItems = (list) => list.sort(QUALITY_ORDER);

// The reference dungeon (item ids by boss / rare / trash), or null.
export function referenceDungeon(instanceId) {
  return referenceIndex().dungeons.get(Number(instanceId)) || null;
}

// The list entry's additions to `atlas`.
export function referenceSummary(instanceId) {
  const dungeon = referenceDungeon(instanceId);
  const { items } = referenceIndex();
  const itemIds = dungeon ? [...dungeon.itemIds] : [];
  const slots = [...new Set(itemIds.map((id) => items.get(id)?.slot).filter(Boolean))].sort();
  return { referenceLootCount: itemIds.length, referenceItemIds: itemIds, referenceSlots: slots };
}

// Where the reference data says an item comes from (wishlist `sources`).
export function referenceSourcesOf(itemId) {
  return referenceIndex().sources.get(Number(itemId)) || [];
}

// The reference items that use this icon (a FileDataID); empty for any
// other icon, so the icon routes stay limited to items the atlas shows.
export function referenceItemIdsForIcon(fileDataId) {
  return referenceIndex().byIcon.get(Number(fileDataId)) || [];
}

// Reference items of exactly this name (case ignored).
export function referenceItemsByName(name) {
  const { byName, items } = referenceIndex();
  return (byName.get(String(name ?? "").trim().toLowerCase()) || []).map((id) => items.get(id));
}

// A reference item in the loot catalog's item-record shape (lootItemFacts),
// for a wishlist row or an import check of an item the site's item index
// does not know. Null when the reference data does not know it either.
export function referenceItemFacts(itemId) {
  const item = referenceIndex().items.get(Number(itemId));
  if (!item) return null;
  return {
    itemId: item.itemId, itemKey: item.itemKey, name: item.name, nameKnown: true, qualityId: item.qualityId, iconFileDataId: item.iconFileDataId,
    itemLevel: item.itemLevel, requiredLevel: item.requiredLevel, itemClass: item.itemClass, itemSubclass: item.itemSubclass, slot: item.slot,
    equippable: Boolean(item.slot) || ["Weapon", "Armor"].includes(item.itemClass), bindType: BIND_IDS[item.bindType] ?? null, classes: item.classes,
    tooltip: { lines: [], source: null, gameBuild: null },
    // The rest of the reference record, labeled as such.
    reference: { kind: item.kind, armor: item.armor, weapon: item.weapon, stats: item.stats, setName: item.setName, bindType: item.bindType,
      tier: "classic-reference", verifiedForForever: false },
  };
}
