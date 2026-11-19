#!/usr/bin/env node
// Writes src/Atlas/data/sources/dungeonplanner-loot.json, the second
// reference loot source (see src/Atlas/atlasPlanner.js), from a local
// checkout of DungeonPlanner (https://github.com/xdk78/DungeonPlanner, MIT).
// It reads only the checkout's committed data-src files; nothing is fetched.
//
//   node scripts/fetchDungeonPlannerSources.mjs --from <DungeonPlanner checkout> [--commit <sha> --committed-at <iso>] [--check]
//
// Then run fetchDungeonAtlasSources.mjs --loot-only (item facts for its
// items) and importDungeonAtlas.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractPlannerLoot } from "../src/Atlas/atlasPlanner.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
};
const from = arg("--from");
if (!from) {
  console.error("usage: node scripts/fetchDungeonPlannerSources.mjs --from <DungeonPlanner checkout> [--commit <sha>]");
  process.exit(2);
}
let commit = arg("--commit");
if (!commit) {
  try { commit = execFileSync("git", ["-C", from, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { commit = null; }
}
// The commit's own date: when the data read here was published (the same
// checkout always gives the same date).
let committedAt = arg("--committed-at");
if (!committedAt && commit) {
  try { committedAt = new Date(execFileSync("git", ["-C", from, "show", "-s", "--format=%cI", commit], { encoding: "utf8" }).trim()).toISOString(); } catch { committedAt = null; }
}
if (!commit || !/^[0-9a-f]{40}$/.test(commit) || !committedAt) {
  console.error("A DungeonPlanner commit sha and its date are required (--commit and --committed-at, or a git checkout).");
  process.exit(2);
}

const readDir = (sub) => Object.fromEntries(readdirSync(join(from, "data-src", sub)).filter((name) => name.endsWith(".json")).sort()
  .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(join(from, "data-src", sub, name), "utf8"))]));
const tables = extractPlannerLoot({ dungeons: readDir("dungeons"), bosses: readDir("bosses") });

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "Atlas", "data", "sources", "dungeonplanner-loot.json");
const extract = {
  source: "dungeon-planner",
  url: `https://github.com/xdk78/DungeonPlanner/tree/${commit}/data-src/bosses`,
  revision: commit,
  retrievedAt: committedAt,
  license: "DungeonPlanner, MIT (https://github.com/xdk78/DungeonPlanner/blob/main/LICENSE). Boss drop lists are facts (item and NPC ids) its authors took from Wowhead Classic NPC pages and warcraft.wiki.gg (CC BY-SA 4.0, facts only); see its docs/DATA-SOURCES.md.",
};
const head = Object.entries(extract).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
const body = Object.entries(tables).map(([name, rows]) => `  ${JSON.stringify(name)}: [\n${rows.map((row) => `   ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
const text = `{\n${head.join(",\n")},\n "tables": {\n${body.join(",\n")}\n }\n}\n`;
if (process.argv.includes("--check")) {
  // The checked-in extract against the same checkout (line endings aside).
  let current = "";
  try { current = readFileSync(out, "utf8").replace(/\r\n/g, "\n"); } catch { current = ""; }
  if (current !== text) {
    console.error("src/Atlas/data/sources/dungeonplanner-loot.json does not match this DungeonPlanner checkout; regenerate it");
    process.exit(1);
  }
  console.log("dungeonplanner-loot.json is current.");
} else {
  writeFileSync(out, text);
  console.log(`Wrote ${tables.creatures.length} bosses and ${tables.loot.length} drops from DungeonPlanner ${commit.slice(0, 7)}.`);
}
