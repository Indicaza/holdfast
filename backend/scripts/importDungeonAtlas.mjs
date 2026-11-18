#!/usr/bin/env node
// Re-normalizes the Dungeon Atlas from the checked-in source extracts
// (src/Atlas/data/sources, refreshed by fetchDungeonAtlasSources.mjs) into
// src/Atlas/data/atlas.json, which the API serves. Offline and idempotent:
// the same extracts always write the same file. --check fails when the file
// is stale or breaks an invariant, without writing.
//
//   node scripts/importDungeonAtlas.mjs [--check]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { atlasProblems, normalize } from "../src/Atlas/atlasNormalize.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "Atlas", "data");
const read = (name) => {
  const path = join(dataDir, "sources", name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const wago = read("wago-classic-era.json");
const azerothcore = read("azerothcore.json");
const creatures = read("azerothcore-creatures.json");
const spells = read("wago-classic-era-spells.json");
// generatedAt follows the newest extract, so re-running changes nothing.
const generatedAt = [wago?.retrievedAt, azerothcore?.retrievedAt, creatures?.retrievedAt, spells?.retrievedAt].filter(Boolean).sort().at(-1) ?? null;
const atlas = normalize({ wago, azerothcore, creatures, spells, generatedAt });
const problems = atlasProblems(atlas);
if (problems.length) {
  console.error(`Atlas invariants broken:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const output = `${JSON.stringify(atlas, null, 1)}\n`;
const target = join(dataDir, "atlas.json");
if (process.argv.includes("--check")) {
  // Line endings may follow the checkout (core.autocrlf); content may not.
  const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== output) {
    console.error("src/Atlas/data/atlas.json is stale; run node scripts/importDungeonAtlas.mjs");
    process.exit(1);
  }
  console.log("Atlas is current.");
} else {
  writeFileSync(target, output);
}
const count = (fn) => atlas.dungeons.reduce((sum, dungeon) => sum + fn(dungeon), 0);
console.log(`${atlas.dungeons.length} dungeons, ${count((d) => d.bosses.length)} bosses (${count((d) => d.bosses.filter((b) => b.npcId).length)} with npc ids), `
  + `${count((d) => d.bosses.reduce((n, b) => n + b.abilities.length, 0))} abilities, ${count((d) => d.quests.length)} quests, `
  + `${count((d) => d.rares.length)} rares, ${count((d) => d.creatures.length)} dangerous trash, ${count((d) => d.maps.length)} layouts, ${atlas.dungeons.filter((d) => d.entrance).length} entrances, ${atlas.dungeons.filter((d) => d.levelMin !== null).length} level bands.`);
