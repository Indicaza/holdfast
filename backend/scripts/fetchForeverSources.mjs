#!/usr/bin/env node
// Writes src/Atlas/data/sources/forever-instances.json: WoW Forever's own
// instances from the Forever client's tables, as OpenMap
// (https://github.com/openmap-world/openmap, MIT) generates them into
// OpenMap/Data/Forever/Places.lua (see src/Atlas/atlasForever.js). Reads a
// local checkout; nothing is fetched.
//
//   node scripts/fetchForeverSources.mjs --openmap <OpenMap checkout> [--check]
//
// Then run importDungeonAtlas.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractForever, parseOpenMapPlaces } from "../src/Atlas/atlasForever.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
};
const from = arg("--openmap");
if (!from) {
  console.error("usage: node scripts/fetchForeverSources.mjs --openmap <OpenMap checkout> [--check]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", ["-C", from, ...args], { encoding: "utf8" }).trim();
let commit;
let committedAt;
try {
  commit = git("rev-parse", "HEAD");
  committedAt = new Date(git("show", "-s", "--format=%cI", commit)).toISOString();
} catch {
  console.error("The OpenMap checkout must be a git checkout (its commit is the extract's revision).");
  process.exit(2);
}
const placesPath = join(from, "OpenMap", "Data", "Forever", "Places.lua");
const text = readFileSync(placesPath, "utf8");
const build = /build (\d+\.\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
const tables = extractForever(parseOpenMapPlaces(text));

const extract = {
  source: "openmap-forever",
  url: `https://github.com/openmap-world/openmap/blob/${commit}/OpenMap/Data/Forever/Places.lua`,
  revision: `${commit}${build ? ` (client build ${build})` : ""}`,
  retrievedAt: committedAt,
  license: "OpenMap, MIT (https://github.com/openmap-world/openmap/blob/main/LICENSE). Places.lua is generated from the WoW Forever client's tables: names and numbers only, no art.",
};
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "Atlas", "data", "sources", "forever-instances.json");
const head = Object.entries(extract).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
const body = Object.entries(tables).map(([name, rows]) => `  ${JSON.stringify(name)}: [\n${rows.map((row) => `   ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
const output = `{\n${head.join(",\n")},\n "tables": {\n${body.join(",\n")}\n }\n}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(out, "utf8").replace(/\r\n/g, "\n"); } catch { current = ""; }
  if (current !== output) {
    console.error("src/Atlas/data/sources/forever-instances.json does not match this OpenMap checkout; regenerate it");
    process.exit(1);
  }
  console.log("forever-instances.json is current.");
} else {
  writeFileSync(out, output);
  console.log(`Wrote ${tables.instances.length} Forever instances and ${tables.encounters.length} encounters from OpenMap ${commit.slice(0, 7)}.`);
}
