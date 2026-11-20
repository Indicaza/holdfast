#!/usr/bin/env node
// Re-normalizes the Dungeon Atlas from the checked-in source extracts
// (src/Atlas/data/sources, refreshed by fetchDungeonAtlasSources.mjs) into
// src/Atlas/data/atlas.json and src/Atlas/data/reference-loot.json, which
// the API serves. Offline and idempotent: the same extracts always write the
// same files. --check fails when a file is stale or breaks an invariant,
// without writing.
//
//   node scripts/importDungeonAtlas.mjs [--check]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeReferenceLoot, referenceLootProblems } from "../src/Atlas/atlasLoot.js";
import { referenceItemInputs } from "../src/Atlas/itemDefinitions.js";
import { atlasProblems, normalize, zonePoint, zoneRegions } from "../src/Atlas/atlasNormalize.js";
import { buildQuestCatalog, questCatalogProblems } from "../src/Atlas/atlasQuests.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "Atlas", "data");
const read = (name) => {
  const path = join(dataDir, "sources", name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
// ForeverDB's data, under its own licence (data/foreverdb/README.md): read from
// its own directory, and everything built with it is written back there.
const readForeverDb = (name) => {
  const path = join(dataDir, "foreverdb", name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const wago = read("wago-classic-era.json");
const azerothcore = read("azerothcore.json");
const creatures = read("azerothcore-creatures.json");
const spells = read("wago-classic-era-spells.json");
const loot = read("azerothcore-loot.json");
const items = read("wago-classic-era-items.json");
// Optional second loot source (scripts/fetchDungeonPlannerSources.mjs).
const planner = read("dungeonplanner-loot.json");
// generatedAt follows the newest extract, so re-running changes nothing.
const newest = (...extracts) => extracts.map((extract) => extract?.retrievedAt).filter(Boolean).sort().at(-1) ?? null;
// WoW Forever's own instances (scripts/fetchForeverSources.mjs).
const forever = read("forever-instances.json");
const atlas = normalize({ wago, azerothcore, creatures, spells, loot, items, forever, planner,
  generatedAt: newest(wago, azerothcore, creatures, spells, loot, items, forever) });
// Canonical item definitions (docs/loot-sources.md): the Forever client's
// tables (scripts/fetchLootSources.mjs), ForeverDB's gear facts and the
// Classic Era client's, merged field by field by precedence, with every
// disagreement kept. The reference loot reads its item facts from them.
// Two sets: the base (MIT; the Forever and Classic clients only) and, when
// ForeverDB's extract is present, the same with its facts merged in, written
// to data/foreverdb/ under its licence. The site serves the second when it
// is there (Atlas/atlasData.js).
const foreverItems = read("wago-forever-items.json");
const foreverDbItems = readForeverDb("foreverdb-items.json");
const foreverDbNotice = foreverDbItems?.notice ?? null;
function itemSet(foreverdb) {
  const { definitions, factItems, sources } = referenceItemInputs({ classic: items, forever: foreverItems, foreverdb });
  const precedence = foreverdb ? ["wago-forever", "foreverdb", "wago-classic-era"] : ["wago-forever", "wago-classic-era"];
  const head = foreverdb ? { notice: foreverDbNotice, license: "GPL-3.0 with ForeverDB.net's attribution term (data/foreverdb/README.md); not MIT" } : {};
  const itemDefinitions = { ...head, schemaVersion: definitions.schemaVersion, dataset: "item-definitions", generatedAt: newest(foreverItems, foreverdb, items),
    precedence, sources, report: definitions.report, items: definitions.items };
  const reference = { ...head, ...normalizeReferenceLoot({ atlas, loot, items: factItems, planner, sources,
    generatedAt: newest(loot, items, foreverItems, foreverdb) }) };
  return { definitions, itemDefinitions, reference };
}
const base = itemSet(null);
const withForeverDb = foreverDbItems ? itemSet(foreverDbItems) : null;
// What the rest of this script builds on: the fullest set.
const { definitions, itemDefinitions, reference } = withForeverDb || base;
// The dungeon quest catalog (fetchDungeonAtlasSources.mjs --quests-only).
const questSources = read("azerothcore-quests.json");
const zones = wago ? zoneRegions(wago.tables) : [];
const questCatalog = questSources ? buildQuestCatalog({ atlas, quests: questSources, planner,
  areaToInstance: new Map((wago?.tables?.AreaTable || []).map((row) => [Number(row.ID), Number(row.ContinentID)])),
  zonePointOf: (continentId, x, y) => zonePoint(zones, continentId, x, y), generatedAt: newest(questSources, planner) }) : null;
const problems = [...atlasProblems(atlas), ...referenceLootProblems(base.reference, atlas), ...(withForeverDb ? referenceLootProblems(withForeverDb.reference, atlas) : []),
  ...(questCatalog ? questCatalogProblems(questCatalog, atlas) : [])];
if (problems.length) {
  console.error(`Atlas invariants broken:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

// The reference dataset: one item / dungeon per line, for readable diffs.
function referenceJson(data) {
  const { items: byId, dungeons, ...head } = data;
  const lines = Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const itemLines = Object.entries(byId).map(([id, item]) => `  ${JSON.stringify(id)}: ${JSON.stringify(item)}`);
  return `{\n${lines.join(",\n")},\n "items": {\n${itemLines.join(",\n")}\n },\n "dungeons": [\n${dungeons.map((d) => `  ${JSON.stringify(d)}`).join(",\n")}\n ]\n}\n`;
}

// The quest catalog: one dungeon per line.
function catalogJson(data) {
  const { dungeons, ...head } = data;
  const lines = Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${lines.join(",\n")},\n "dungeons": [\n${dungeons.map((d) => `  ${JSON.stringify(d)}`).join(",\n")}\n ]\n}\n`;
}

// Item definitions: one item per line.
function definitionsJson(data) {
  const { items: list, ...head } = data;
  const lines = Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${lines.join(",\n")},\n "items": [\n${list.map((item) => `  ${JSON.stringify(item)}`).join(",\n")}\n ]\n}\n`;
}

const outputs = [["atlas.json", `${JSON.stringify(atlas, null, 1)}\n`], ["reference-loot.json", referenceJson(base.reference)],
  ["item-definitions.json", definitionsJson(base.itemDefinitions)],
  ...(withForeverDb ? [["foreverdb/reference-loot.json", referenceJson(withForeverDb.reference)], ["foreverdb/item-definitions.json", definitionsJson(withForeverDb.itemDefinitions)]] : []),
  ...(questCatalog ? [["quest-catalog.json", catalogJson(questCatalog)]] : [])];
if (process.argv.includes("--check")) {
  let stale = false;
  for (const [name, output] of outputs) {
    // Line endings may follow the checkout (core.autocrlf); content may not.
    const path = join(dataDir, name);
    const current = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== output) {
      console.error(`src/Atlas/data/${name} is stale; run node scripts/importDungeonAtlas.mjs`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log("Atlas is current.");
} else {
  for (const [name, output] of outputs) writeFileSync(join(dataDir, name), output);
}
const count = (fn) => atlas.dungeons.reduce((sum, dungeon) => sum + fn(dungeon), 0);
console.log(`${atlas.dungeons.length} dungeons, ${count((d) => d.bosses.length)} bosses (${count((d) => d.bosses.filter((b) => b.npcId).length)} with npc ids), `
  + `${count((d) => d.bosses.reduce((n, b) => n + b.abilities.length, 0))} abilities, ${count((d) => d.quests.length)} quests, `
  + `${count((d) => d.rares.length)} rares, ${count((d) => d.creatures.length)} dangerous trash, ${count((d) => d.maps.length)} layouts, ${atlas.dungeons.filter((d) => d.entrance).length} entrances, ${atlas.dungeons.filter((d) => d.levelMin !== null).length} level bands.`);
const defReport = itemDefinitions.report;
console.log(`Base (MIT): ${Object.keys(base.reference.items).length} reference items, ${base.reference.gaps.length} gaps. `
  + (withForeverDb ? `With ForeverDB (data/foreverdb/, GPL-3.0): ${Object.keys(withForeverDb.reference.items).length} items, ${withForeverDb.reference.gaps.length} gaps.` : "No ForeverDB data."));
console.log(`Item definitions: ${defReport.items} items (${defReport.foreverClient} named by the Forever client, ${defReport.hiddenInClient} not named by it), `
  + `${defReport.unknownName} without a name, ${defReport.unknownQuality} without a quality, ${defReport.conflicts} with disagreeing sources.`);
const refCount = (fn) => reference.dungeons.reduce((sum, dungeon) => sum + fn(dungeon), 0);
console.log(`Reference loot: ${Object.keys(reference.items).length} items, ${reference.dungeons.filter((d) => d.itemIds.length).length} dungeons, `
  + `${refCount((d) => d.bosses.length)} bosses, ${refCount((d) => d.rares.length)} rares, ${refCount((d) => d.dungeonLoot.length)} trash/shared drops; `
  + `quests: ${count((d) => d.quests.filter((q) => q.objective).length)} with objectives, ${count((d) => d.quests.filter((q) => q.rewards?.length).length)} with rewards, `
  + `${count((d) => d.quests.filter((q) => q.prerequisites?.length).length)} with prerequisites, ${count((d) => d.quests.filter((q) => q.location).length)} with giver locations.`);
