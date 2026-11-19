// Dungeon quest sources: the AzerothCore quest tables trimmed to the quests
// that matter for a dungeon, with the evidence that ties each one to it.
// Pure; scripts/fetchDungeonAtlasSources.mjs --quests-only writes the result
// to data/sources/azerothcore-quests.json, and Atlas/atlasQuests.js turns it
// into data/quest-catalog.json.
//
// A quest is kept when
//   - its objectives or giver are inside a vanilla instance (evidence below),
//   - or its zone (QuestSortID) is a dungeon's (the atlas's old rule),
//   - or DungeonPlanner lists it for a dungeon (plannerQuestIds),
//   - or it is a prerequisite (PrevQuestID) or breadcrumb of a kept quest.
// Evidence, per instance: a creature or object it asks to kill or use, an
// item it asks for that a creature or object drops, or the creature or object
// that gives it, when every spawn of that creature or object is inside the
// instance (a creature that also lives outside proves nothing).

import { VANILLA_INSTANCE_IDS } from "./atlasSources.js";

const LAST_VANILLA_QUEST_ID = 9299;
const PLACEHOLDER_TITLE = /^\s*(<|\[)|unused|deprecated|test\b|zzold|\bOLD\b/i;
const MAX_GIVER_SPAWNS = 1;

const int = (value) => {
  const number = Number(value);
  return value === "" || value === null || value === undefined || !Number.isFinite(number) ? null : Math.trunc(number);
};
const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};
const round1 = (value) => Math.round(value * 10) / 10;

export function extractQuestSources({ questRows = [], addonRows = [], starterRows = [], objectStarterRows = [], templateRows = [], spawnRows = [],
  objectRows = [], objectTemplateRows = [], lootRows = [], objectLootRows = [], areaToInstance = new Map(), plannerQuestIds = [] }) {
  const instances = new Set(VANILLA_INSTANCE_IDS);
  // Where creatures and objects are: the instance when every spawn is in one.
  const homeOf = (rows, keys) => {
    const maps = new Map();
    for (const row of rows) {
      for (const key of keys) {
        const id = int(row[key]);
        if (!id) continue;
        if (!maps.has(id)) maps.set(id, new Set());
        maps.get(id).add(int(row.map));
      }
    }
    const home = new Map();
    for (const [id, set] of maps) {
      const all = [...set];
      if (all.length && all.every((map) => instances.has(map)) && new Set(all).size === 1) home.set(id, all[0]);
    }
    return home;
  };
  const creatureHome = homeOf(spawnRows, ["id1", "id2", "id3", "id"]);
  const objectHome = homeOf(objectRows, ["id"]);
  const creatureNames = new Map(templateRows.map((row) => [int(row.entry), text(row.name)]));
  const objectNames = new Map(objectTemplateRows.map((row) => [int(row.entry), text(row.name)]));

  // Quest items: which creatures (quest-flagged loot) and objects drop them.
  const lootOwners = new Map();
  for (const row of templateRows) if (int(row.lootid)) {
    const lootId = int(row.lootid);
    if (!lootOwners.has(lootId)) lootOwners.set(lootId, []);
    lootOwners.get(lootId).push(int(row.entry));
  }
  const itemCreatures = new Map();
  for (const row of lootRows) {
    if (row.QuestRequired !== "1" || !int(row.Item)) continue;
    for (const npcId of lootOwners.get(int(row.Entry)) || []) {
      if (!itemCreatures.has(int(row.Item))) itemCreatures.set(int(row.Item), new Set());
      itemCreatures.get(int(row.Item)).add(npcId);
    }
  }
  const objectLootOwners = new Map();
  for (const row of objectTemplateRows) if (int(row.Data1) && row.type === "3") {
    if (!objectLootOwners.has(int(row.Data1))) objectLootOwners.set(int(row.Data1), []);
    objectLootOwners.get(int(row.Data1)).push(int(row.entry));
  }
  const itemObjects = new Map();
  for (const row of objectLootRows) {
    if (!int(row.Item)) continue;
    for (const objectId of objectLootOwners.get(int(row.Entry)) || []) {
      if (!itemObjects.has(int(row.Item))) itemObjects.set(int(row.Item), new Set());
      itemObjects.get(int(row.Item)).add(objectId);
    }
  }

  const starters = new Map();
  const addStarter = (questId, entry) => {
    if (!starters.has(questId)) starters.set(questId, []);
    starters.get(questId).push(entry);
  };
  for (const row of starterRows) addStarter(int(row.quest), ["npc", int(row.id)]);
  for (const row of objectStarterRows) addStarter(int(row.quest), ["object", int(row.id)]);

  const addons = new Map(addonRows.map((row) => [int(row.ID), row]));
  const rows = new Map();
  for (const row of questRows) {
    const id = int(row.ID);
    if (!id || id > LAST_VANILLA_QUEST_ID || !text(row.LogTitle) || PLACEHOLDER_TITLE.test(text(row.LogTitle))) continue;
    rows.set(id, row);
  }

  // Evidence per quest: [instanceId, kind, refId].
  const evidenceOf = (id, row) => {
    const out = [];
    for (let n = 1; n <= 4; n += 1) {
      const target = int(row[`RequiredNpcOrGo${n}`]);
      if (target > 0 && creatureHome.has(target)) out.push([creatureHome.get(target), "npc", target]);
      if (target < 0 && objectHome.has(-target)) out.push([objectHome.get(-target), "object", -target]);
    }
    for (let n = 1; n <= 6; n += 1) {
      const itemId = int(row[`RequiredItemId${n}`]);
      if (!itemId) continue;
      for (const npcId of itemCreatures.get(itemId) || []) if (creatureHome.has(npcId)) out.push([creatureHome.get(npcId), "item", itemId]);
      for (const objectId of itemObjects.get(itemId) || []) if (objectHome.has(objectId)) out.push([objectHome.get(objectId), "item", itemId]);
    }
    for (const [kind, giverId] of starters.get(id) || []) {
      const home = kind === "npc" ? creatureHome.get(giverId) : objectHome.get(giverId);
      if (home) out.push([home, "giver", giverId]);
    }
    const unique = new Map(out.map((entry) => [entry.join(":"), entry]));
    return [...unique.values()].sort((a, b) => a[0] - b[0] || (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0) || a[2] - b[2]);
  };

  const planner = new Set(plannerQuestIds);
  const keep = new Set();
  const evidence = new Map();
  for (const [id, row] of rows) {
    const found = evidenceOf(id, row);
    if (found.length) evidence.set(id, found);
    if (found.length || areaToInstance.has(int(row.QuestSortID)) || planner.has(id)) keep.add(id);
  }
  // Prerequisites and breadcrumbs of kept quests, to the start of each chain.
  const queue = [...keep];
  while (queue.length) {
    const id = queue.pop();
    const prev = Math.abs(int(addons.get(id)?.PrevQuestID) || 0);
    if (prev && rows.has(prev) && !keep.has(prev)) { keep.add(prev); queue.push(prev); }
  }
  for (const [id, addon] of addons) {
    const target = int(addon.BreadcrumbForQuestId);
    if (target && keep.has(target) && rows.has(id) && !keep.has(id)) keep.add(id);
  }
  // Prerequisites of those breadcrumbs too.
  for (const id of [...keep]) {
    let prev = Math.abs(int(addons.get(id)?.PrevQuestID) || 0);
    while (prev && rows.has(prev) && !keep.has(prev)) { keep.add(prev); prev = Math.abs(int(addons.get(prev)?.PrevQuestID) || 0); }
  }

  const quests = [];
  const givers = new Map();
  for (const id of [...keep].sort((a, b) => a - b)) {
    const row = rows.get(id);
    const addon = addons.get(id) || {};
    const starts = (starters.get(id) || []).sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0) || a[1] - b[1]);
    for (const [kind, giverId] of starts) givers.set(`${kind}:${giverId}`, [kind, giverId]);
    quests.push({
      id, title: text(row.LogTitle), level: int(row.QuestLevel), minLevel: int(row.MinLevel), maxLevel: int(addon.MaxLevel) || null,
      sort: int(row.QuestSortID), races: int(row.AllowableRaces) || 0, classes: int(addon.AllowableClasses) || 0,
      flags: int(row.Flags) || 0, special: int(addon.SpecialFlags) || 0,
      prev: int(addon.PrevQuestID) || 0, next: int(addon.NextQuestID) || 0, group: int(addon.ExclusiveGroup) || 0,
      breadcrumbFor: int(addon.BreadcrumbForQuestId) || 0,
      rep: int(addon.RequiredMinRepFaction) ? [int(addon.RequiredMinRepFaction), int(addon.RequiredMinRepValue) || 0] : null,
      objective: text(row.LogDescription), startItem: int(row.StartItem) || 0,
      rewards: [1, 2, 3, 4].map((n) => int(row[`RewardItem${n}`])).filter((itemId) => itemId > 0),
      choices: [1, 2, 3, 4, 5, 6].map((n) => int(row[`RewardChoiceItemID${n}`])).filter((itemId) => itemId > 0),
      givers: starts, evidence: evidence.get(id) || [],
    });
  }
  // Givers: names, and the one spawn of a giver that has exactly one.
  const spawnsOf = (rows_, keys) => {
    const out = new Map();
    for (const row of rows_) for (const key of keys) {
      const id = int(row[key]);
      if (!id) continue;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push([int(row.map), round1(Number(row.position_x)), round1(Number(row.position_y))]);
    }
    return out;
  };
  const creatureSpawns = spawnsOf(spawnRows, ["id1", "id"]);
  const objectSpawns = spawnsOf(objectRows, ["id"]);
  const giverRows = [...givers.values()].sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0) || a[1] - b[1]).map(([kind, giverId]) => {
    const spawns = (kind === "npc" ? creatureSpawns : objectSpawns).get(giverId) || [];
    const spot = spawns.length === MAX_GIVER_SPAWNS ? spawns[0] : null;
    return [kind, giverId, (kind === "npc" ? creatureNames : objectNames).get(giverId) ?? null, spot ? spot[0] : null, spot ? spot[1] : null, spot ? spot[2] : null];
  });
  return { quests, givers: giverRows };
}
