#!/usr/bin/env node
// The Dungeon Atlas's instance census for catalog maintainers: every
// instance the atlas has (original game and WoW Forever), where its ID comes
// from, and how much is known of it; and what is announced but not in the
// client's tables yet. Read-only.
//
//   node scripts/atlasCensus.mjs [--json]

import { readFileSync } from "node:fs";

import { wingsOf } from "../src/Atlas/atlasWings.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const atlas = read("../src/Atlas/data/atlas.json");
const reference = read("../src/Atlas/data/reference-loot.json");
const quests = read("../src/Atlas/data/quest-catalog.json");

// Announced instances the Forever client's tables (OpenMap Places.lua,
// build 1.60.1) do not list: no ID, so not in the atlas.
const ANNOUNCED_WITHOUT_ID = [
  { name: "Hyjal Summit", kind: "raid", source: "warcraft.wiki.gg World of Warcraft: Forever; DungeonPlanner (no instance map ID)" },
  { name: "Barrow Deeps", kind: "raid", source: "warcraft.wiki.gg World of Warcraft: Forever (no instance map ID)" },
];

const rows = atlas.dungeons.map((dungeon) => {
  const ref = reference.dungeons.find((entry) => entry.instanceId === dungeon.instanceId);
  const catalog = quests.dungeons.find((entry) => entry.instanceId === dungeon.instanceId);
  const gaps = (reference.gaps || []).filter((gap) => gap.instanceId === dungeon.instanceId).length;
  return {
    instanceId: dungeon.instanceId, name: dungeon.name, kind: dungeon.kind, origin: dungeon.origin || "classic",
    idSource: dungeon.origin === "forever" ? "Forever client tables (OpenMap)" : "Classic Era client Map table (wago)",
    wings: wingsOf(dungeon).length, bosses: dungeon.bosses.length, bossesWithNpc: dungeon.bosses.filter((boss) => boss.npcId).length,
    encounterIds: dungeon.bosses.filter((boss) => boss.encounterId).length, maps: dungeon.maps.length + (dungeon.floorNames?.length ? 0 : 0),
    floorNames: dungeon.floorNames?.length ?? null, referenceItems: ref?.itemIds.length ?? 0, itemsWithoutFacts: gaps,
    dungeonQuests: catalog ? catalog.quests.filter((quest) => quest.relevance === "dungeon").length : 0, curatedQuests: catalog?.curated ?? false,
  };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ instances: rows, announcedWithoutId: ANNOUNCED_WITHOUT_ID }, null, 2));
} else {
  console.log("| ID | Instance | Origin | Kind | Wings | Bosses (NPC / encounter IDs) | Reference items | Items without facts | Dungeon quests |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(`| ${row.instanceId} | ${row.name} | ${row.origin} | ${row.kind} | ${row.wings || ""} | ${row.bosses} (${row.bossesWithNpc} / ${row.encounterIds}) | `
      + `${row.referenceItems} | ${row.itemsWithoutFacts} | ${row.dungeonQuests}${row.curatedQuests ? "" : " (no curated list)"} |`);
  }
  console.log(`\n${rows.length} instances: ${rows.filter((row) => row.origin === "classic").length} original, ${rows.filter((row) => row.origin === "forever").length} WoW Forever.`);
  console.log("Announced, no client ID yet (not in the atlas):");
  for (const entry of ANNOUNCED_WITHOUT_ID) console.log(`- ${entry.name} (${entry.kind}): ${entry.source}`);
}
