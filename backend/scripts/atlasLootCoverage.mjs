#!/usr/bin/env node
// Coverage report of the Dungeon Atlas's reference loot: per dungeon, which
// bosses and rares have reference loot, which do not (and why, as far as the
// checked-in extracts can tell), shared and unattributed drops, missing item
// facts, items listed under two sources, and wing conflicts. Read-only.
//
//   node scripts/atlasLootCoverage.mjs [--json] [--markdown]

import { readFileSync } from "node:fs";

import { coverageReport, coverageMarkdown } from "../src/Atlas/atlasLootCoverage.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const report = coverageReport({
  atlas: read("../src/Atlas/data/atlas.json"),
  reference: read("../src/Atlas/data/reference-loot.json"),
  loot: read("../src/Atlas/data/sources/azerothcore-loot.json"),
  manifest: read("../src/Atlas/data/wing-manifest.json"),
});
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else console.log(coverageMarkdown(report));
