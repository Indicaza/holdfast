#!/usr/bin/env node
// Fetches the loot intelligence sources (docs/loot-sources.md) and writes
// their extracts under src/Atlas/data/sources/:
//
//   wago-forever-items.json  the WoW Forever client's item tables (ItemSparse,
//                            Item, ItemSet) via wago.tools, product "wowf", at
//                            one pinned build, for the items the atlas needs
//   foreverdb-items.json     ForeverDB's gear facts and names for those items
//   foreverdb-loot.json      ForeverDB's per-boss loot of the atlas's
//                            instances, with drop rates over looted kills
//
//   node scripts/fetchLootSources.mjs [--build <wowf version>] [--cache <dir>] [--from <dir>] [--check]
//
//   --build  a full wowf version from https://wago.tools/api/builds (default:
//            the latest wowf build there)
//   --cache  keep what is downloaded in <dir> (wago CSVs, ForeverDB files and
//            its manifest), so a rerun or --from can reuse it
//   --from   read <dir> (a --cache directory) instead of the network
//   --check  compare with the committed extracts (their tables) and exit 1 if
//            they differ; writes nothing
//
// Politeness: wago.tools asks for CSV exports and /api/ only (robots.txt), one
// request at a time here; ForeverDB's add-on files are public downloads,
// checked against the SHA-256 its manifest lists. Nothing else is touched.
// Then run scripts/importDungeonAtlas.mjs.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../src/Atlas/atlasSources.js";
import { extractForeverClientItems, foreverDbBuild, parseForeverDbGear, parseForeverDbLoot, parseForeverDbNames } from "../src/Atlas/lootSources.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
};
const FROM = arg("--from");
const CACHE = arg("--cache") || FROM;
const CHECK = process.argv.includes("--check");
const USER_AGENT = "holdfast-loot-importer (+https://github.com/Indicaza/holdfast)";
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "src", "Atlas", "data");
const outDir = join(dataDir, "sources");
const FOREVERDB = "https://foreverdb.net/";
const FOREVERDB_FILES = ["Gear.lua", "GearSources.lua", "Loot.lua"];
const WAGO_LICENSE = "Factual game data extracted from the World of Warcraft: Forever client (Blizzard Entertainment), via wago.tools CSV exports. Names and numbers only; no art.";
const FOREVERDB_LICENSE = "ForeverDB.net add-on data, GPL-3.0 with an attribution term (section 7(b)): credit \"Data from ForeverDB.net\" with a link to https://foreverdb.net wherever it is shown.";

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function download(url, cacheName) {
  const cached = CACHE ? join(CACHE, cacheName) : null;
  if (FROM) {
    if (!existsSync(cached)) throw new Error(`--from: ${cached} is missing`);
    return readFileSync(cached);
  }
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (cached) {
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, body);
  }
  await sleep(1000);
  return body;
}

// The build: given, or the latest wowf build wago.tools lists.
async function wowfBuild() {
  const given = arg("--build");
  if (given) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(given)) throw new Error("--build must be a full version such as 1.60.1.70959");
    return given;
  }
  const builds = JSON.parse((await download("https://wago.tools/api/builds", "wago/builds.json")).toString("utf8"));
  const latest = (builds.wowf || []).filter((build) => !build.is_bgdl)[0]?.version;
  if (!latest) throw new Error("wago.tools lists no wowf build");
  return latest;
}

// The items the atlas needs facts for: its reference loot, the guides' lists,
// quest rewards, and ForeverDB's loot of the atlas's instances.
function wantedItems(foreverDbLoot, atlasIds) {
  const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
  const ids = new Set();
  for (const row of read("wago-classic-era-items.json").tables.items) ids.add(row.id);
  for (const row of read("dungeonplanner-loot.json").tables.loot) ids.add(row[2]);
  const catalog = JSON.parse(readFileSync(join(dataDir, "quest-catalog.json"), "utf8"));
  for (const dungeon of catalog.dungeons) for (const quest of dungeon.quests) for (const reward of quest.rewards || []) ids.add(reward.itemId);
  for (const instance of foreverDbLoot) {
    if (!atlasIds.has(instance.instanceId)) continue;
    for (const boss of instance.bosses) for (const entry of boss.loot) ids.add(entry.itemId);
    for (const entry of instance.trash) ids.add(entry.itemId);
  }
  return ids;
}

const rowsJson = (head, tables) => {
  const lines = Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const body = Object.entries(tables).map(([name, rows]) => `  ${JSON.stringify(name)}: [\n${rows.map((row) => `   ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
  return `{\n${lines.join(",\n")},\n "tables": {\n${body.join(",\n")}\n }\n}\n`;
};

const atlas = JSON.parse(readFileSync(join(dataDir, "atlas.json"), "utf8"));
const atlasIds = new Set(atlas.dungeons.map((dungeon) => dungeon.instanceId));
const retrievedAt = new Date().toISOString();

// ForeverDB: the manifest, then each file checked against its SHA-256.
const manifest = JSON.parse((await download(`${FOREVERDB}downloads/addon-manifest.json`, "foreverdb/addon-manifest.json")).toString("utf8"));
const files = {};
for (const name of FOREVERDB_FILES) {
  const entry = manifest.data.files.find((file) => file.path === `Data/${name}`);
  if (!entry) throw new Error(`ForeverDB's manifest lists no Data/${name}`);
  const body = await download(`${FOREVERDB}${entry.url}`, `foreverdb/${name}`);
  if (sha256(body) !== entry.sha256) throw new Error(`ForeverDB ${name}: SHA-256 differs from its manifest (stale cache or a changed file)`);
  files[name] = { text: body.toString("utf8"), sha256: entry.sha256 };
}
const foreverDbVersion = manifest.data.version;
const foreverDbClient = foreverDbBuild(files["Loot.lua"].text);
const gear = parseForeverDbGear(files["Gear.lua"].text);
const names = parseForeverDbNames(files["GearSources.lua"].text);
const loot = parseForeverDbLoot(files["Loot.lua"].text);
if (gear.length < 1000 || loot.length < 10) throw new Error(`ForeverDB files look wrong: ${gear.length} gear rows, ${loot.length} instances`);

// The Forever client's tables at one build.
const build = await wowfBuild();
const tables = {};
for (const table of ["ItemSparse", "Item", "ItemSet"]) {
  tables[table] = parseCsv((await download(`https://wago.tools/db2/${table}/csv?version=${build}`, `wago/${build}/${table}.csv`)).toString("utf8")).rows;
}
const wanted = wantedItems(loot, atlasIds);
const client = extractForeverClientItems({ tables, itemIds: wanted });
if (client.length < 500) throw new Error(`wago.tools ${build}: only ${client.length} of ${wanted.size} items found; refusing a partial extract`);

// ForeverDB's gear layout is its own: check it against the client on every
// item both know (inventory type and required level), and refuse it if they
// disagree on more than one in a thousand.
const visible = new Map(client.filter((row) => !row.hidden).map((row) => [row.id, row]));
let agree = 0;
let disagree = 0;
for (const row of gear) {
  const facts = visible.get(row.id);
  if (!facts) continue;
  if (facts.inventoryType === row.inventoryType && facts.requiredLevel === row.requiredLevel) agree += 1;
  else disagree += 1;
}
if (agree < 100 || disagree > agree / 1000) throw new Error(`ForeverDB gear layout check failed: ${agree} agree, ${disagree} disagree with the client`);

const foreverDbItems = gear.filter((row) => wanted.has(row.id)).map((row) => ({ ...row, name: names.get(row.id) ?? null }));
const lootRows = [];
const instances = [];
for (const instance of loot) {
  if (!atlasIds.has(instance.instanceId)) continue;
  instances.push([instance.instanceId, instance.name, instance.forever ? 1 : 0]);
  const add = (boss, bossIndex, entry) => lootRows.push([instance.instanceId, bossIndex, boss ? boss.name : null, boss?.npcId ?? null, entry.itemId,
    entry.pct, entry.observed ? "f" : entry.classic ? "c" : null, entry.hidden, entry.kills, entry.seen]);
  instance.bosses.forEach((boss, index) => { for (const entry of boss.loot) add(boss, index + 1, entry); });
  for (const entry of instance.trash) add(null, 0, entry);
}

const outputs = {
  "wago-forever-items.json": rowsJson({ source: "wago-forever", url: "https://wago.tools/db2?product=wowf", revision: `wowf ${build}`, retrievedAt, license: WAGO_LICENSE },
    { items: client }),
  "foreverdb-items.json": rowsJson({ source: "foreverdb", url: "https://foreverdb.net", revision: `${foreverDbVersion} (client ${foreverDbClient})`, retrievedAt,
    license: FOREVERDB_LICENSE, attribution: "Data from ForeverDB.net", files: { "Gear.lua": files["Gear.lua"].sha256, "GearSources.lua": files["GearSources.lua"].sha256 },
    note: `Gear.lua layout checked against the Forever client: ${agree} items agree, ${disagree} disagree.` }, { items: foreverDbItems }),
  "foreverdb-loot.json": rowsJson({ source: "foreverdb", url: "https://foreverdb.net/dungeons", revision: `${foreverDbVersion} (client ${foreverDbClient})`, retrievedAt,
    license: FOREVERDB_LICENSE, attribution: "Data from ForeverDB.net", files: { "Loot.lua": files["Loot.lua"].sha256 },
    columns: ["instanceId", "bossIndex", "bossName", "npcId", "itemId", "pct", "src", "hidden", "kills", "seen"],
    note: "Per boss (bossIndex 0: the instance's trash). src f: seen in WoW Forever, pct measured over `kills` looted kills; src c: Classic data (CMaNGOS); pct null: not known; seen: drops players saw." },
  { instances, loot: lootRows }),
};

const tablesOf = (json) => JSON.stringify(JSON.parse(json).tables);
if (CHECK) {
  const stale = Object.entries(outputs).filter(([name, json]) => {
    const path = join(outDir, name);
    return !existsSync(path) || tablesOf(readFileSync(path, "utf8")) !== tablesOf(json);
  }).map(([name]) => name);
  if (stale.length) {
    console.error(`Not current: ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log("Loot source extracts are current.");
} else {
  for (const [name, json] of Object.entries(outputs)) writeFileSync(join(outDir, name), json);
  console.log(`wowf ${build}: ${client.length} of ${wanted.size} wanted items (${client.filter((row) => row.hidden).length} hidden by the client). `
    + `ForeverDB ${foreverDbVersion}: ${foreverDbItems.length} gear facts, ${lootRows.length} loot rows in ${instances.length} atlas instances `
    + `(gear layout: ${agree} agree, ${disagree} disagree).`);
}
