// Dungeon Atlas reference loot and quest details: Classic reference data
// for what each dungeon's bosses, rares and trash drop, and what its quests
// ask and give. Pure: the extract* functions trim upstream tables into the
// checked-in extracts (run by scripts/fetchDungeonAtlasSources.mjs --loot),
// the rest turns those extracts into data/reference-loot.json and the quest
// details of data/atlas.json (scripts/importDungeonAtlas.mjs).
//
// Sources and what each one is trusted for:
// - AzerothCore world DB (GPL-2.0, community-unverified): which creature
//   drops which item (creature_loot_template, resolved through
//   reference_loot_template), where creatures stand (creature), quest
//   objectives, rewards, prerequisites and givers (quest_template,
//   quest_template_addon, creature_queststarter).
// - The Classic Era client's item tables via wago.tools (classic-reference):
//   every item fact (name, quality, icon, slot, levels, class, binding,
//   armour, weapon damage, stats, set). An item the client does not have is
//   left out, whatever the emulator says.
//
// No drop chance is ever kept: the emulator's numbers are its own tuning,
// not the game's. Reference loot is never verifiedForForever; the loot
// catalog's own observations (Loot/) stay the evidence for Forever.

import { slotLabel } from "../Loot/lootModel.js";
import { VANILLA_INSTANCE_IDS } from "./atlasSources.js";

export const REFERENCE_LOOT_SCHEMA_VERSION = 1;
export const REFERENCE_LOOT_DATASET = "atlas-reference-loot";
export const REFERENCE_KINDS = Object.freeze(["gear", "set", "rare", "boe", "material", "quest-reward", "other"]);

const int = (value) => {
  const number = Number(value);
  return value === "" || value === null || value === undefined || !Number.isFinite(number) ? null : Math.trunc(number);
};
const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};
const round1 = (value) => Math.round(value * 10) / 10;

// Item classes (ItemClass.ClassID) the curation looks at.
const CLASS = Object.freeze({ consumable: 0, container: 1, weapon: 2, armor: 4, reagent: 5, tradeGoods: 7, recipe: 9, quiver: 11, quest: 12 });
const GAMEOBJECT_CHEST = "3";
// ItemSparse.Bonding.
const BIND = Object.freeze({ 1: "BoP", 2: "BoE", 3: "BoU", 4: "Quest" });
// ItemSparse.StatModifier_bonusStat (ITEM_MOD_*) values a Classic item carries.
const STAT = Object.freeze({ 0: "Mana", 1: "Health", 3: "Agility", 4: "Strength", 5: "Intellect", 6: "Spirit", 7: "Stamina" });
// ItemSparse.Resistances_1..6 (Resistances_0 is armour).
const RESISTANCES = Object.freeze(["Holy Resistance", "Fire Resistance", "Nature Resistance", "Frost Resistance", "Shadow Resistance", "Arcane Resistance"]);
// AllowableClass bits of the nine Classic classes.
const CLASS_BITS = Object.freeze([[1, "Warrior"], [2, "Paladin"], [4, "Hunter"], [8, "Rogue"], [16, "Priest"], [64, "Shaman"], [128, "Mage"],
  [256, "Warlock"], [1024, "Druid"]]);
const ALL_CLASSES = CLASS_BITS.reduce((mask, [bit]) => mask | bit, 0);
// Quest ids above this are later expansions (same rule as atlasNormalize.js).
const LAST_VANILLA_QUEST_ID = 9299;
const MAX_GIVER_SPAWNS = 4;

// ------------------------------------------------------------- Extraction

// The client's facts for the given items, as compact rows (one per item).
// `tables`: ItemSparse, Item, ItemSet, ItemClass, ItemSubClass CSV rows.
export function extractItemFacts({ tables, itemIds = null }) {
  const wanted = itemIds ? new Set(itemIds) : null;
  const base = new Map((tables.Item || []).map((row) => [int(row.ID), row]));
  const sets = new Map((tables.ItemSet || []).map((row) => [int(row.ID), text(row.Name_lang)]));
  const items = [];
  for (const row of tables.ItemSparse || []) {
    const id = int(row.ID);
    if (!id || (wanted && !wanted.has(id))) continue;
    const item = base.get(id) || {};
    const stats = [];
    for (let i = 0; i < 10; i += 1) {
      const stat = int(row[`StatModifier_bonusStat_${i}`]);
      const amount = int(row[`StatModifier_bonusAmount_${i}`]);
      if (stat !== null && stat >= 0 && amount) stats.push([stat, amount]);
    }
    items.push({
      id, name: text(row.Display_lang), quality: int(row.OverallQualityID), icon: int(item.IconFileDataID) || null,
      classId: int(item.ClassID), subclassId: int(item.SubclassID), inventoryType: int(row.InventoryType) || 0,
      itemLevel: int(row.ItemLevel), requiredLevel: int(row.RequiredLevel), allowableClass: int(row.AllowableClass),
      bonding: int(row.Bonding) || 0, armor: int(row.Resistances_0) || 0,
      resistances: [1, 2, 3, 4, 5, 6].map((index) => int(row[`Resistances_${index}`]) || 0),
      minDamage: Number(row.MinDamage_0) || 0, maxDamage: Number(row.MaxDamage_0) || 0, delay: int(row.ItemDelay) || 0,
      stats, randomStats: (int(row.RandomSelect) || 0) > 0 || (int(row.ItemRandomSuffixGroupID) || 0) > 0,
      itemSet: int(row.ItemSet) || 0, setName: sets.get(int(row.ItemSet)) ?? null, startQuestId: int(row.StartQuestID) || 0,
    });
  }
  items.sort((a, b) => a.id - b.id);
  const classes = (tables.ItemClass || []).map((row) => [int(row.ClassID), text(row.ClassName_lang)]).sort((a, b) => a[0] - b[0]);
  const subclasses = (tables.ItemSubClass || []).map((row) => [int(row.ClassID), int(row.SubClassID), text(row.VerboseName_lang) || text(row.DisplayName_lang)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { items, classes, subclasses };
}

// What the reference loot keeps of a dungeon's drops (docs/dungeon-atlas-sources.md):
//   equipment (weapons, armour) of uncommon quality or better
//   bags and quivers of uncommon quality or better
//   any item of a set, any item of rare quality or better
//   trade goods, reagents and recipes of uncommon quality or better
//   items that start a quest
// Everything else (grey and white gear, consumables, plain trade goods,
// quest objectives) is left out. Returns the kind, or null to leave it out.
export function curateItem(item) {
  if (!item?.name) return null;
  const equipment = [CLASS.weapon, CLASS.armor].includes(item.classId) && item.inventoryType > 0;
  if (item.itemSet) return "set";
  if (equipment && item.quality >= 2) return item.bonding === 2 ? "boe" : "gear";
  if ([CLASS.container, CLASS.quiver].includes(item.classId) && item.quality >= 2) return "other";
  if ([CLASS.tradeGoods, CLASS.reagent].includes(item.classId) && item.quality >= 2) return "material";
  if (item.classId === CLASS.recipe && item.quality >= 2) return "other";
  if (item.startQuestId) return "other";
  if (item.quality >= 3 && !equipment) return "other";
  return null;
}

// Which creature (or chest) in which dungeon drops which curated item.
// Loot is resolved through references; quest-only rows and non-normal loot
// modes are left out. An item counts as a dungeon's only when nothing
// spawned outside the vanilla dungeons drops it (that keeps world drops
// out). `anchors` places the atlas's bosses and rares (npcId → instanceId)
// even when the emulator summons them instead of spawning them. Chests are
// gameobjects of the chest type, by their own name; nothing links a chest
// to a boss.
export function extractReferenceLoot({ lootRows = [], referenceRows = [], templateRows = [], spawnRows = [], objectLootRows = [], objectTemplateRows = [],
  objectRows = [], items = [], anchors = new Map() }) {
  const instances = new Set(VANILLA_INSTANCE_IDS);
  const facts = new Map(items.map((item) => [item.id, item]));
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const entry = int(row.Entry);
      if (!map.has(entry)) map.set(entry, []);
      map.get(entry).push(row);
    }
    return map;
  };
  const references = group(referenceRows);
  const resolved = new Map();
  const resolve = (rows, depth = 0) => {
    const out = new Set();
    if (depth > 8) return out;
    for (const row of rows || []) {
      if (row.QuestRequired === "1" || !((int(row.LootMode) ?? 1) & 1)) continue;
      const reference = int(row.Reference);
      if (reference) {
        if (!resolved.has(reference)) resolved.set(reference, resolve(references.get(reference), depth + 1));
        for (const id of resolved.get(reference)) out.add(id);
      } else if (int(row.Item)) out.add(int(row.Item));
    }
    return out;
  };
  const mapsOf = (rows, keys) => {
    const maps = new Map();
    for (const row of rows) {
      for (const key of keys) {
        const id = int(row[key]);
        if (!id) continue;
        if (!maps.has(id)) maps.set(id, new Set());
        maps.get(id).add(int(row.map));
      }
    }
    return maps;
  };
  // Where a source is: "outside" when any spawn is outside the vanilla
  // dungeons, else the dungeons it spawns in (or is anchored to).
  const placeOf = (spawned = new Set(), anchor = null) => {
    if ([...spawned].some((map) => !instances.has(map))) return "outside";
    const places = new Set(spawned);
    if (anchor) places.add(anchor);
    return places;
  };

  // Sources by key: "c:<npcId>" creatures, "o:<entry>" chests.
  const droppers = new Map();
  const names = new Map();
  const places = new Map();
  const addSource = (key, name, place, lootRowsOf) => {
    names.set(key, name);
    places.set(key, place);
    for (const itemId of resolve(lootRowsOf)) {
      if (!droppers.has(itemId)) droppers.set(itemId, new Set());
      droppers.get(itemId).add(key);
    }
  };
  const creatureLoot = group(lootRows);
  const creatureMaps = mapsOf(spawnRows, ["id1", "id2", "id3", "id"]);
  const ranks = new Map();
  for (const row of templateRows) {
    const npcId = int(row.entry);
    const lootId = int(row.lootid);
    if (!npcId || !lootId || !creatureLoot.has(lootId)) continue;
    ranks.set(`c:${npcId}`, int(row.rank) || 0);
    addSource(`c:${npcId}`, text(row.name), placeOf(creatureMaps.get(npcId), anchors.get(npcId)), creatureLoot.get(lootId));
  }
  const objectLoot = group(objectLootRows);
  const objectMaps = mapsOf(objectRows, ["id"]);
  for (const row of objectTemplateRows) {
    const entry = int(row.entry);
    const lootId = int(row.Data1);
    if (row.type !== GAMEOBJECT_CHEST || !entry || !lootId || !objectLoot.has(lootId)) continue;
    addSource(`o:${entry}`, text(row.name), placeOf(objectMaps.get(entry)), objectLoot.get(lootId));
  }

  const creatureLinks = [];
  const objectLinks = [];
  const used = new Set();
  for (const [itemId, keys] of droppers) {
    if (!curateItem(facts.get(itemId))) continue;
    if ([...keys].some((key) => places.get(key) === "outside")) continue;
    for (const key of keys) {
      if (!places.get(key).size) continue;
      const id = Number(key.slice(2));
      (key.startsWith("c:") ? creatureLinks : objectLinks).push([id, itemId]);
      used.add(key);
    }
  }
  const byIds = (a, b) => a[0] - b[0] || a[1] - b[1];
  const sourcesOf = (prefix, withRank) => [...used].filter((key) => key.startsWith(prefix)).map((key) => {
    const where = [...places.get(key)].sort((a, b) => a - b);
    return withRank ? [Number(key.slice(2)), names.get(key), ranks.get(key) || 0, where] : [Number(key.slice(2)), names.get(key), where];
  }).sort((a, b) => a[0] - b[0]);
  return { creature_loot: creatureLinks.sort(byIds), creatures: sourcesOf("c:", true), object_loot: objectLinks.sort(byIds), objects: sourcesOf("o:", false) };
}

// Quest details for the atlas's quests: objective, prerequisites, rewards
// and where the giver stands.
export function extractQuestDetails({ questRows = [], addonRows = [], starterRows = [], spawnRows = [], questIds = [] }) {
  const wanted = new Set(questIds);
  const titles = new Map(questRows.map((row) => [int(row.ID), text(row.LogTitle)]));
  const addons = new Map(addonRows.map((row) => [int(row.ID), row]));
  const details = [];
  const prerequisiteIds = new Set();
  for (const row of questRows) {
    const id = int(row.ID);
    if (!wanted.has(id)) continue;
    const prev = int(addons.get(id)?.PrevQuestID) || 0;
    if (prev > 0) prerequisiteIds.add(prev);
    details.push({
      ID: id, objective: text(row.LogDescription), prevQuestId: prev > 0 ? prev : null,
      rewardItems: [1, 2, 3, 4].map((n) => int(row[`RewardItem${n}`])).filter((itemId) => itemId > 0),
      choiceItems: [1, 2, 3, 4, 5, 6].map((n) => int(row[`RewardChoiceItemID${n}`])).filter((itemId) => itemId > 0),
    });
  }
  details.sort((a, b) => a.ID - b.ID);
  const givers = new Set();
  for (const row of starterRows) if (wanted.has(int(row.quest))) givers.add(int(row.id));
  const spawns = new Map();
  for (const row of spawnRows) {
    const npcId = int(row.id1 ?? row.id);
    if (!givers.has(npcId)) continue;
    if (!spawns.has(npcId)) spawns.set(npcId, []);
    spawns.get(npcId).push([npcId, int(row.map), round1(Number(row.position_x)), round1(Number(row.position_y))]);
  }
  const giverSpawns = [];
  for (const list of spawns.values()) {
    list.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
    // A giver with many spawns is a kind of creature, not a place; one is kept
    // only to say that (the adapter places only givers with one spawn).
    giverSpawns.push(...list.slice(0, MAX_GIVER_SPAWNS));
  }
  giverSpawns.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const questNames = [...prerequisiteIds].filter((id) => titles.has(id)).sort((a, b) => a - b).map((id) => [id, titles.get(id)]);
  return { quest_details: details, quest_names: questNames, quest_giver_spawns: giverSpawns };
}

// ---------------------------------------------------------------- Adapter

// The client's item row as a ReferenceItem (docs/dungeon-atlas-contract-sprint2.md),
// without the per-response fields (observed, verifiedForForever, provenance).
export function referenceItemOf(item, { classNames = new Map(), subclassNames = new Map(), kind = null } = {}) {
  const equipment = [CLASS.weapon, CLASS.armor].includes(item.classId) && item.inventoryType > 0;
  const mask = item.allowableClass;
  const restricted = mask !== null && mask > 0 && (mask & ALL_CLASSES) !== ALL_CLASSES;
  // Stats a random suffix decides ("of the Monkey"), or of a kind this
  // reader does not name, are not known: null rather than a partial list.
  const unknownStat = item.stats.some(([stat]) => !STAT[stat]);
  const stats = item.randomStats || unknownStat ? null : [
    ...item.stats.filter(([stat]) => STAT[stat]).map(([stat, value]) => ({ stat: STAT[stat], value })),
    ...item.resistances.map((value, index) => (value ? { stat: RESISTANCES[index], value } : null)).filter(Boolean),
  ];
  const weapon = item.classId === CLASS.weapon && item.maxDamage > 0 && item.delay > 0 ? {
    minDamage: Math.round(item.minDamage), maxDamage: Math.round(item.maxDamage), speed: Math.round(item.delay / 10) / 100,
    dps: round1((Math.round(item.minDamage) + Math.round(item.maxDamage)) / 2 / (item.delay / 1000)),
  } : null;
  return {
    itemId: item.id, itemKey: `i:${item.id}`, name: item.name, qualityId: item.quality ?? null, iconFileDataId: item.icon ?? null,
    slot: equipment || item.inventoryType ? slotLabel(item.inventoryType) || null : null,
    itemLevel: item.itemLevel || null, requiredLevel: item.requiredLevel || null,
    itemClass: classNames.get(item.classId) ?? null, itemSubclass: subclassNames.get(`${item.classId}:${item.subclassId}`) ?? null,
    classes: restricted ? CLASS_BITS.filter(([bit]) => mask & bit).map(([, name]) => name) : null,
    bindType: BIND[item.bonding] ?? null,
    armor: item.armor > 0 ? item.armor : null,
    weapon,
    stats,
    setName: item.setName ?? null,
    kind: kind ?? curateItem(item) ?? "other",
  };
}

// The served reference dataset (data/reference-loot.json) from the loot and
// item extracts and the normalized atlas (for its bosses, rares, quests).
//   items      itemId → ReferenceItem (shared by every dungeon)
//   dungeons   per dungeon: boss/rare item ids by npc, dungeonLoot (trash),
//              quest reward ids
export function normalizeReferenceLoot({ atlas, loot, items, generatedAt = null }) {
  const lootProv = loot ? { source: loot.source, revision: loot.revision ?? null, confidence: "medium", tier: "community-unverified",
    retrievedAt: loot.retrievedAt ?? null, url: loot.url ?? null, note: "creature_loot_template / reference_loot_template: which creature drops it (no drop chances)" } : null;
  const itemProv = items ? { source: items.source, revision: items.revision ?? null, confidence: "high", tier: "classic-reference",
    retrievedAt: items.retrievedAt ?? null, url: items.url ?? null, note: "ItemSparse, Item, ItemSet: item facts" } : null;
  const facts = new Map((items?.tables?.items || []).map((item) => [item.id, item]));
  const classNames = new Map((items?.tables?.classes || []).map(([id, name]) => [id, name]));
  const subclassNames = new Map((items?.tables?.subclasses || []).map(([classId, subclassId, name]) => [`${classId}:${subclassId}`, name]));
  const creatures = new Map((loot?.tables?.creatures || []).map(([npcId, name, rank, instances]) => [npcId, { npcId, name, rank, instances }]));
  const objects = new Map((loot?.tables?.objects || []).map(([entry, name, instances]) => [entry, { entry, name, instances }]));
  const linksOf = (rows) => {
    const map = new Map();
    for (const [sourceId, itemId] of rows || []) {
      if (!facts.has(itemId) || !curateItem(facts.get(itemId))) continue;
      if (!map.has(sourceId)) map.set(sourceId, []);
      map.get(sourceId).push(itemId);
    }
    return map;
  };
  const dropsOf = linksOf(loot?.tables?.creature_loot);
  const objectDrops = linksOf(loot?.tables?.object_loot);

  const used = new Map();
  const use = (itemId, kind) => {
    const previous = used.get(itemId);
    // A drop's kind beats "quest-reward"; otherwise the first kind stays.
    if (!previous || (previous === "quest-reward" && kind !== "quest-reward")) used.set(itemId, kind);
  };
  const dungeons = [];
  for (const dungeon of atlas?.dungeons || []) {
    const id = dungeon.instanceId;
    const here = [...creatures.values()].filter((creature) => creature.instances.includes(id));
    // A boss's loot npc: the atlas's npc id, else the one creature of that
    // exact name with loot in this dungeon.
    const lootNpcOf = (boss) => {
      if (boss.npcId) return boss.npcId;
      const named = here.filter((creature) => creature.name === (boss.atlasName || boss.name));
      return named.length === 1 ? named[0].npcId : null;
    };
    const taken = new Set();
    const bosses = [];
    for (const boss of dungeon.bosses) {
      const npcId = lootNpcOf(boss);
      const itemIds = npcId ? [...new Set(dropsOf.get(npcId) || [])].sort((a, b) => a - b) : [];
      if (npcId) taken.add(npcId);
      if (!itemIds.length) continue;
      for (const itemId of itemIds) use(itemId, curateItem(facts.get(itemId)));
      bosses.push({ encounterId: boss.encounterId, npcId, itemIds });
    }
    const bossItems = new Set(bosses.flatMap((boss) => boss.itemIds));
    const rares = [];
    for (const rare of dungeon.rares || []) {
      taken.add(rare.npcId);
      const itemIds = [...new Set(dropsOf.get(rare.npcId) || [])].sort((a, b) => a - b);
      if (!itemIds.length) continue;
      for (const itemId of itemIds) {
        const kind = curateItem(facts.get(itemId));
        // Gear only rare spawns drop is the dungeon's "rare" loot.
        use(itemId, kind === "gear" && !bossItems.has(itemId) ? "rare" : kind);
      }
      rares.push({ npcId: rare.npcId, itemIds });
    }
    const rareItems = new Set(rares.flatMap((rare) => rare.itemIds));
    // Trash and shared drops: items no boss or rare of this dungeon drops.
    const trash = new Map();
    for (const creature of here) {
      if (taken.has(creature.npcId)) continue;
      for (const itemId of dropsOf.get(creature.npcId) || []) {
        if (bossItems.has(itemId) || rareItems.has(itemId)) continue;
        if (!trash.has(itemId)) trash.set(itemId, new Set());
        trash.get(itemId).add(creature.npcId);
      }
    }
    // Chests (gameobjects) of this dungeon, by their own name.
    for (const object of objects.values()) {
      if (!object.instances.includes(id)) continue;
      for (const itemId of objectDrops.get(object.entry) || []) {
        if (bossItems.has(itemId) || rareItems.has(itemId)) continue;
        if (!trash.has(itemId)) trash.set(itemId, new Set());
        trash.get(itemId).add(`o:${object.entry}`);
      }
    }
    const dungeonLoot = [...trash].map(([itemId, sources]) => {
      use(itemId, curateItem(facts.get(itemId)));
      const [only] = sources.size === 1 ? [...sources] : [null];
      const object = typeof only === "string" ? objects.get(Number(only.slice(2))) : null;
      const creature = typeof only === "number" ? creatures.get(only) : null;
      return { itemId, npcId: creature?.npcId ?? null, sourceName: creature?.name ?? object?.name ?? null };
    }).sort((a, b) => a.itemId - b.itemId);
    const questRewards = [];
    for (const quest of dungeon.quests || []) {
      for (const reward of quest.rewards || []) {
        if (!facts.has(reward.itemId)) continue;
        use(reward.itemId, "quest-reward");
        questRewards.push(reward.itemId);
      }
    }
    const itemIds = [...new Set([...bossItems, ...rareItems, ...trash.keys(), ...questRewards])].sort((a, b) => a - b);
    dungeons.push({ instanceId: id, name: dungeon.name, itemIds, bosses, rares, dungeonLoot });
  }
  // Every item shares the same provenance; it is stored once and added to
  // each item when served (Atlas/referenceLoot.js).
  const provenance = [itemProv, lootProv].filter(Boolean);
  const out = {};
  for (const itemId of [...used.keys()].sort((a, b) => a - b)) {
    out[itemId] = referenceItemOf(facts.get(itemId), { classNames, subclassNames, kind: used.get(itemId) });
  }
  const revision = [items?.revision, loot?.revision].filter(Boolean).join(" + ") || null;
  return {
    schemaVersion: REFERENCE_LOOT_SCHEMA_VERSION, dataset: REFERENCE_LOOT_DATASET, revision, generatedAt, provenance,
    filter: "Dungeon-only drops of creatures and chests (nothing outside the vanilla dungeons drops them): uncommon+ weapons, armour, bags and quivers, set items, rare+ items, uncommon+ trade goods, reagents and recipes, quest starters; plus the atlas quests' reward items. No drop chances.",
    sources: [items, loot].filter(Boolean).map((extract) => ({ source: extract.source, revision: extract.revision ?? null, retrievedAt: extract.retrievedAt ?? null,
      url: extract.url ?? null, license: extract.license ?? null })),
    items: out, dungeons,
  };
}

// Quest details joined onto the atlas's quests (in place of nothing: every
// field is null / [] when the source has none).
export function questDetailsOf(loot, { zonePointOf = () => null, instanceName = new Map(), knownItem = () => true } = {}) {
  const t = loot?.tables || {};
  const names = new Map((t.quest_names || []).map(([id, name]) => [id, name]));
  const spawns = new Map();
  for (const [npcId, map, x, y] of t.quest_giver_spawns || []) {
    if (!spawns.has(npcId)) spawns.set(npcId, []);
    spawns.get(npcId).push({ map, x, y });
  }
  const details = new Map((t.quest_details || []).map((row) => [row.ID, row]));
  const provenance = loot ? { source: loot.source, revision: loot.revision ?? null, confidence: "medium", tier: "community-unverified",
    retrievedAt: loot.retrievedAt ?? null, url: loot.url ?? null, note: "quest_template (objective, rewards), quest_template_addon (prerequisite), creature: giver spawn" } : null;
  return (quest) => {
    const row = details.get(quest.questId);
    const giverSpawns = quest.giver?.npcId ? spawns.get(quest.giver.npcId) || [] : [];
    let location = null;
    if (giverSpawns.length === 1) {
      const [spawn] = giverSpawns;
      if (spawn.map === 0 || spawn.map === 1) {
        const point = zonePointOf(spawn.map, spawn.x, spawn.y);
        if (point) location = { zoneName: point.zoneName, mapId: point.mapId, x: point.x, y: point.y };
      } else if (instanceName.has(spawn.map)) location = { zoneName: instanceName.get(spawn.map), mapId: null, x: null, y: null };
    }
    const prevId = row?.prevQuestId && row.prevQuestId <= LAST_VANILLA_QUEST_ID ? row.prevQuestId : null;
    return {
      objective: cleanObjective(row?.objective),
      prerequisites: prevId ? [{ questId: prevId, name: names.get(prevId) ?? null }] : [],
      // Only items the client has; an emulator-only id is left out.
      rewards: row ? [...row.rewardItems.map((itemId) => ({ itemId, choice: false })), ...row.choiceItems.map((itemId) => ({ itemId, choice: true }))]
        .filter((reward) => knownItem(reward.itemId)) : [],
      location,
      provenance: row && provenance ? [provenance] : [],
    };
  };
}

// The quest log's objective line. $B is a line break; the other $-tokens
// stand for the reader's name, class and race.
export function cleanObjective(value) {
  const objective = text(value);
  if (!objective) return null;
  return objective.replace(/\$[Bb]/g, " ").replace(/\$[Nn]/g, "<name>").replace(/\$[Cc]/g, "<class>").replace(/\$[Rr]/g, "<race>")
    .replace(/\$[Gg]\s*([^:;]*):([^;]*);/g, "$1/$2").replace(/\s+/g, " ").trim() || null;
}

// Invariants of the reference dataset, against the atlas it was built from.
export function referenceLootProblems(reference, atlas) {
  const problems = [];
  const items = reference?.items || {};
  const dungeons = new Map((atlas?.dungeons || []).map((dungeon) => [dungeon.instanceId, dungeon]));
  for (const [key, item] of Object.entries(items)) {
    if (String(item.itemId) !== key || item.itemKey !== `i:${item.itemId}`) problems.push(`item ${key}: id mismatch`);
    if (!item.name) problems.push(`item ${key}: no name`);
    if (!REFERENCE_KINDS.includes(item.kind)) problems.push(`item ${key}: kind ${item.kind}`);
    if ("dropChance" in item || "chance" in item) problems.push(`item ${key}: drop chance`);
    if (item.verifiedForForever || item.observed) problems.push(`item ${key}: reference data claims observation`);
  }
  if (Object.keys(items).length && (!reference.provenance?.length
    || reference.provenance.some((line) => !line.source || !line.revision || line.tier === "official-client" || line.tier === "forever-reference"))) {
    problems.push("reference provenance must name Classic sources");
  }
  const seen = new Set();
  for (const dungeon of reference?.dungeons || []) {
    const where = `${dungeon.instanceId} ${dungeon.name}`;
    if (seen.has(dungeon.instanceId)) problems.push(`${where}: listed twice`);
    seen.add(dungeon.instanceId);
    const atlasDungeon = dungeons.get(dungeon.instanceId);
    if (!atlasDungeon) { problems.push(`${where}: not in the atlas`); continue; }
    const listed = new Set(dungeon.itemIds);
    if (listed.size !== dungeon.itemIds.length) problems.push(`${where}: duplicate item ids`);
    const check = (itemIds, label) => {
      if (new Set(itemIds).size !== itemIds.length) problems.push(`${where}: ${label} lists an item twice`);
      for (const itemId of itemIds) {
        if (!items[itemId]) problems.push(`${where}: ${label} item ${itemId} unknown`);
        if (!listed.has(itemId)) problems.push(`${where}: ${label} item ${itemId} missing from itemIds`);
      }
    };
    const encounters = new Set(atlasDungeon.bosses.map((boss) => boss.encounterId));
    for (const boss of dungeon.bosses) {
      if (!encounters.has(boss.encounterId)) problems.push(`${where}: boss ${boss.encounterId} not in the atlas`);
      check(boss.itemIds, `boss ${boss.encounterId}`);
    }
    const rareIds = new Set((atlasDungeon.rares || []).map((rare) => rare.npcId));
    for (const rare of dungeon.rares) {
      if (!rareIds.has(rare.npcId)) problems.push(`${where}: rare ${rare.npcId} not in the atlas`);
      check(rare.itemIds, `rare ${rare.npcId}`);
    }
    check(dungeon.dungeonLoot.map((entry) => entry.itemId), "dungeonLoot");
    for (const quest of atlasDungeon.quests || []) {
      for (const reward of quest.rewards || []) if (!items[reward.itemId]) problems.push(`${where}: quest ${quest.questId} reward ${reward.itemId} unknown`);
    }
  }
  return problems;
}
