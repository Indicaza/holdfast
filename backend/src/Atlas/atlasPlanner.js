// DungeonPlanner's boss drop lists as a second reference loot source.
//
// DungeonPlanner (https://github.com/xdk78/DungeonPlanner, MIT) keeps, per
// dungeon, its bosses with their NPC ids and drop lists. Its research cites
// Wowhead Classic NPC pages (drop lists, facts only) and warcraft.wiki.gg;
// see its docs/DATA-SOURCES.md. Its committed data files are read from a
// local checkout: no website is fetched or scraped here.
//
// Trusted for: which classic boss drops which item (a second opinion beside
// the AzerothCore emulator's tables, and the only one for Naxxramas, whose
// emulator loot is the WotLK version). Never for Forever: a reference source
// like the rest (tier community-unverified).

import { VANILLA_INSTANCE_IDS } from "./atlasSources.js";

export const PLANNER_SOURCE = "dungeon-planner";

const int = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

// The extract (src/Atlas/data/sources/dungeonplanner-loot.json tables) from
// DungeonPlanner's data-src files: `dungeons` (data-src/dungeons/*.json, for
// their instanceMapID) and `bosses` (data-src/bosses/*.json), keyed by slug.
//   creatures  [instanceId, npcId, name, slug]    one per boss
//   loot       [instanceId, npcId, itemId, src, notable, forever]
//   quests     [instanceId, slug, questId, name, level, minLevel, side, giverNpcId]
//              its dungeon quest list (side "a", "h" or "b"; nulls unknown)
// src is DungeonPlanner's own source id (1 Wowhead Classic, 2
// warcraft.wiki.gg, 3 Wowhead Forever); notable and forever are its flags
// (0/1). Only classic instances the atlas covers are kept.
export function extractPlannerLoot({ dungeons = {}, bosses = {} }) {
  const instances = new Set(VANILLA_INSTANCE_IDS);
  const creatures = [];
  const loot = [];
  const quests = [];
  const sourceNames = new Map();
  for (const slug of Object.keys(bosses).sort()) {
    const file = bosses[slug];
    const dungeon = dungeons[slug];
    const instanceId = int(dungeon?.instanceMapID);
    if (!file || file.origin !== "classic" || !instanceId || !instances.has(instanceId)) continue;
    for (const source of file.sources || []) if (int(source.id) && source.name) sourceNames.set(int(source.id), String(source.name));
    for (const quest of file.quests || []) {
      const questId = int(quest.id);
      if (!questId) continue;
      const side = ["a", "h", "b"].includes(quest.side) ? quest.side : null;
      quests.push([instanceId, slug, questId, quest.name ? String(quest.name) : null, int(quest.level), int(quest.req), side, int(quest.giver)]);
    }
    for (const boss of file.bosses || []) {
      const npcId = int(boss.npcID);
      if (!npcId || !boss.name) continue;
      creatures.push([instanceId, npcId, String(boss.name), slug]);
      for (const entry of boss.loot || []) {
        const itemId = int(entry.item);
        if (!itemId) continue;
        loot.push([instanceId, npcId, itemId, int(entry.src) || 0, entry.notable ? 1 : 0, entry.forever ? 1 : 0]);
      }
    }
  }
  // One row per (instance, npc, item): the first DungeonPlanner lists.
  const unique = (rows) => {
    const seen = new Map();
    for (const row of rows) {
      const key = JSON.stringify(row.slice(0, 3));
      if (!seen.has(key)) seen.set(key, row);
    }
    return [...seen.values()];
  };
  const byIds = (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] > b[2] ? 1 : a[2] < b[2] ? -1 : 0);
  return {
    creatures: unique(creatures).sort(byIds),
    loot: unique(loot).sort(byIds),
    // One row per wing file and quest (a wing's list is its dungeon's).
    quests: [...new Map(quests.map((row) => [`${row[1]}:${row[2]}`, row])).values()]
      .sort((a, b) => a[0] - b[0] || (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0) || a[2] - b[2]),
    sourceNames: [...sourceNames].sort((a, b) => a[0] - b[0]),
  };
}
