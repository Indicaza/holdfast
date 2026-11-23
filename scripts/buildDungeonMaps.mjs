#!/usr/bin/env node
// The dungeon map pipeline (docs/dungeon-maps-plan.md).
//
//   metadata  read the add-on's generated table into the site's metadata
//     node scripts/buildDungeonMaps.mjs metadata --addon <DungeonJournalArt.generated.lua> --commit <sha>
//   build     assemble floors from <fileDataId>.blp tiles already in --tiles
//     node scripts/buildDungeonMaps.mjs build --tiles DIR --out DIR --asset-source "where the tiles came from" [--only 36]
//     With --download-wago <full build version> --confirm-asset-rights it first
//     fetches missing tiles, one at a time, from wago.tools. That flag states
//     that the operator has confirmed the right to obtain and publish this art.
//   import    add a build's floors to Content Studio media (uses GUILD_DATA_DIR)
//     node scripts/buildDungeonMaps.mjs import --out DIR --attribution "..." --license "..."
//   coverage  write the coverage report
//     node scripts/buildDungeonMaps.mjs coverage [--out DIR]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeBlp } from "../backend/src/Atlas/blpCodec.js";
import { assembleFloor, buildManifest, mapCoverage, parseAddonMaps } from "../backend/src/Atlas/journalMapPipeline.js";
import { encodePng } from "../backend/src/Atlas/Editorial/imageCodec.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METADATA = path.join(root, "backend/src/Atlas/data/sources/journal-maps.json");
const REPORT = path.join(root, "docs/dungeon-maps-coverage.md");
const [command, ...rest] = process.argv.slice(2);
const args = {};
rest.forEach((value, index) => {
  if (!value.startsWith("--")) return;
  const next = rest[index + 1];
  args[value.slice(2)] = next && !next.startsWith("--") ? next : true;
});
const need = (name) => { if (!args[name] || args[name] === true) throw new Error(`--${name} is required.`); return args[name]; };
const readMetadata = () => JSON.parse(readFileSync(METADATA, "utf8"));
const json = (value) => `${JSON.stringify(value, null, 1)}\n`;

async function downloadTile(id, version, file) {
  const response = await fetch(`https://wago.tools/api/casc/${id}?version=${encodeURIComponent(version)}`, { headers: { "User-Agent": "dungeon-map-pipeline/1.0" } });
  if (!response.ok) return false;
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function build() {
  const tiles = path.resolve(need("tiles"));
  const out = path.resolve(need("out"));
  const assetSource = need("asset-source");
  const version = args["download-wago"];
  if (version && args["confirm-asset-rights"] !== true) throw new Error("Downloading needs --confirm-asset-rights: confirm the right to obtain and publish this art first.");
  mkdirSync(tiles, { recursive: true });
  mkdirSync(out, { recursive: true });
  const metadata = readMetadata();
  const only = args.only ? new Set(String(args.only).split(",").map(Number)) : null;
  const scoped = { ...metadata, instances: metadata.instances.filter((instance) => !only || only.has(instance.instanceId)) };
  const results = [];
  for (const instance of scoped.instances) {
    for (const floor of instance.floors) {
      const missing = [];
      const invalid = [];
      const decoded = [];
      for (const id of floor.tiles) {
        const file = path.join(tiles, `${id}.blp`);
        if (!existsSync(file) && version && !(await downloadTile(id, version, file))) { missing.push(id); continue; }
        if (!existsSync(file)) { missing.push(id); continue; }
        try {
          const tile = decodeBlp(readFileSync(file));
          if (tile.width !== 256 || tile.height !== 256) invalid.push(id);
          else decoded.push(tile);
        } catch {
          invalid.push(id);
        }
      }
      if (missing.length || invalid.length) {
        results.push({ instanceId: instance.instanceId, floor: floor.index, status: "missing", missing, invalid });
        continue;
      }
      const bytes = encodePng(assembleFloor(decoded));
      const name = `journal-map-${instance.instanceId}-${floor.index}.png`;
      writeFileSync(path.join(out, name), bytes);
      results.push({ instanceId: instance.instanceId, floor: floor.index, status: "ok", file: name, bytes });
    }
  }
  const manifest = buildManifest(scoped, results, { assetSource });
  writeFileSync(path.join(out, "manifest.json"), json(manifest));
  console.log(`${manifest.floors.length} floors built, ${manifest.missing.length} missing or invalid. Version ${manifest.mapVersion}.`);
}

async function importMedia() {
  const out = path.resolve(need("out"));
  const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
  const { withGuildTransaction } = await import("../backend/src/Data/database.js");
  const { importJournalMapsInDatabase } = await import("../backend/src/Atlas/journalMaps.js");
  const options = { attribution: need("attribution"), license: need("license"), sourceUrl: typeof args["source-url"] === "string" ? args["source-url"] : "" };
  console.log(JSON.stringify(withGuildTransaction((db) => importJournalMapsInDatabase(db, manifest, out, options))));
}

async function coverage() {
  const { loadAtlas } = await import("../backend/src/Atlas/atlasData.js");
  const manifestFile = typeof args.out === "string" ? path.join(path.resolve(args.out), "manifest.json") : null;
  const manifest = manifestFile && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
  const { totals, rows } = mapCoverage(readMetadata(), loadAtlas().atlas.dungeons, manifest);
  const cell = (list) => (list.length ? list.join(", ") : "none");
  const lines = ["# Dungeon map coverage", "", "Generated by `scripts/buildDungeonMaps.mjs coverage`. Do not edit.", "",
    `- Rendered from real textures: **${totals.renderedDungeons} dungeons, ${totals.renderedFloors} floors**`,
    `- In the add-on's metadata: ${totals.instancesWithMetadata} instances, ${totals.floors} floors`,
    `- Boss pins matched to atlas bosses: ${totals.matchedPins} of ${totals.bosses} bosses; pins with no atlas boss: ${totals.unmatchedPins}`,
    `- Floors with missing textures: ${totals.missingTextureFloors ?? "not built"}`,
    `- Instances without a usable map: ${cell(totals.instancesWithoutMap)}`, "",
    "| Instance | Dungeon | Floors | Rendered | Pins / bosses | Unmatched pins | Bosses without a pin |", "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.instanceId} | ${row.name} | ${row.floors} | ${row.renderedFloors} | ${row.matchedPins} / ${row.bosses} | ${cell(row.unmatchedPins)} | ${cell(row.bossesWithoutPin)} |`), ""];
  writeFileSync(REPORT, lines.join("\n"));
  console.log(JSON.stringify(totals));
}

const commands = {
  metadata: async () => {
    const metadata = parseAddonMaps(readFileSync(need("addon"), "utf8"), { addonCommit: need("commit") });
    writeFileSync(METADATA, json(metadata));
    console.log(`${metadata.instances.length} instances, ${metadata.instances.reduce((n, i) => n + i.floors.length, 0)} floors, ${metadata.problems.length} problems.`);
  },
  build, import: importMedia, coverage,
};
if (!commands[command]) { console.error("Usage: buildDungeonMaps.mjs metadata|build|import|coverage"); process.exit(2); }
commands[command]().catch((error) => { console.error(error.message); process.exit(1); });
