#!/usr/bin/env node
// Refreshes the checked-in source extracts of the Dungeon Atlas from their
// upstreams. Run by hand (it needs the network); the site never calls these
// services at request time. Writes only the rows the atlas uses:
//
//   src/Atlas/data/sources/wago-classic-era.json   Blizzard client tables (Classic Era build) via wago.tools
//   src/Atlas/data/sources/azerothcore.json        AzerothCore world DB (GPL-2.0) at a pinned commit
//   src/Atlas/data/sources/azerothcore-creatures.json   spawns, ranks and creature spells (see Atlas/atlasContent.js)
//   src/Atlas/data/sources/wago-classic-era-spells.json the client's facts for those spells
//   src/Atlas/data/sources/azerothcore-loot.json   who drops which item, quest details (see Atlas/atlasLoot.js)
//   src/Atlas/data/sources/wago-classic-era-items.json  the client's facts for those items
//
// Then run `node scripts/importDungeonAtlas.mjs` to re-normalize.
//
//   node scripts/fetchDungeonAtlasSources.mjs [--azerothcore-ref <sha>] [--content-only | --loot-only] [--from <dir>]
//
// --content-only refreshes only the two content extracts; --loot-only only
// the two reference-loot extracts (it reads the current atlas.json for the
// bosses, rares and quests to attach them to). --from reads the
// upstream files from a local directory instead of the network (wago tables
// as <Table>.csv, AzerothCore tables as <table>.sql, scripts under cpp/ with
// cpp/list.txt naming their repository paths).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractCreatureContent, extractSpellContent } from "../src/Atlas/atlasContent.js";
import { extractItemFacts, extractQuestDetails, extractReferenceLoot } from "../src/Atlas/atlasLoot.js";
import { VANILLA_INSTANCE_IDS, parseCsv, parseScriptSpells, parseSqlInserts } from "../src/Atlas/atlasSources.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "Atlas", "data", "sources");
const refArg = process.argv.indexOf("--azerothcore-ref");
const AC_REF = refArg > 0 ? process.argv[refArg + 1] : "6ffb62abb867dabb258de6813ff5d06d6b011543";
const AC_BASE = `https://raw.githubusercontent.com/azerothcore/azerothcore-wotlk/${AC_REF}/data/sql/base/db_world/`;
const WAGO = (table) => `https://wago.tools/db2/${table}/csv?product=wow_classic_era`;

const fromArg = process.argv.indexOf("--from");
const FROM = fromArg > 0 ? process.argv[fromArg + 1] : null;
const CONTENT_ONLY = process.argv.includes("--content-only");
const LOOT_ONLY = process.argv.includes("--loot-only");
const AC_RAW = `https://raw.githubusercontent.com/azerothcore/azerothcore-wotlk/${AC_REF}/`;
const AC_LICENSE = "AzerothCore world database, GPL-2.0 (https://github.com/azerothcore/azerothcore-wotlk). A WotLK (3.3.5) emulator database: vanilla content as the emulator models it.";
const WAGO_LICENSE = "Factual game data extracted from the World of Warcraft Classic Era client (Blizzard Entertainment). Names and numbers only; no art.";

// A local copy when --from is given: wago URLs → <Table>.csv, AzerothCore
// SQL → <table>.sql, scripts → cpp/<path with / as _>.
function localPath(url) {
  const wagoTable = /\/db2\/(\w+)\/csv/.exec(url);
  if (wagoTable) return join(FROM, `${wagoTable[1]}.csv`);
  const sql = /db_world\/(\w+\.sql)$/.exec(url);
  if (sql) return join(FROM, sql[1]);
  return join(FROM, "cpp", url.slice(AC_RAW.length).replace(/\//g, "_"));
}

async function text(url) {
  if (FROM) return readFileSync(localPath(url), "utf8");
  const response = await fetch(url, { headers: { "User-Agent": "holdfast-dungeon-atlas-importer" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));
const instanceSet = new Set(VANILLA_INSTANCE_IDS);
const retrievedAt = new Date().toISOString();

async function wago() {
  const [map, lfg, encounters, triggers, assignments, uiMaps, areas] = await Promise.all(
    ["Map", "LFGDungeons", "DungeonEncounter", "AreaTrigger", "UiMapAssignment", "UiMap", "AreaTable"].map((table) => text(WAGO(table)).then(parseCsv)));
  const build = (lfg.header.find((name) => /^Field_\d+_\d+_\d+_\d+_/.test(name)) || "").replace(/^Field_(\d+)_(\d+)_(\d+)_(\d+)_.*$/, "$1.$2.$3.$4") || null;
  return {
    source: "wago-classic-era", url: "https://wago.tools/db2?product=wow_classic_era", revision: build ? `wow_classic_era ${build}+` : "wow_classic_era (latest)", retrievedAt,
    license: WAGO_LICENSE,
    tables: {
      Map: map.rows.filter((row) => instanceSet.has(Number(row.ID))).map((row) => pick(row, ["ID", "MapName_lang", "MapDescription0_lang", "MapDescription1_lang", "InstanceType", "MaxPlayers", "AreaTableID"])),
      LFGDungeons: lfg.rows.filter((row) => ["1", "2"].includes(row.TypeID)).map((row) => pick(row, ["ID", "Name_lang", "MinLevel", "MaxLevel", "TypeID", "Faction", "MapID"])),
      DungeonEncounter: encounters.rows.filter((row) => instanceSet.has(Number(row.MapID))).map((row) => pick(row, ["ID", "Name_lang", "MapID", "DifficultyID", "OrderIndex"])),
      AreaTrigger: triggers.rows.filter((row) => ["0", "1"].includes(row.ContinentID)).map((row) => pick(row, ["ID", "ContinentID", "Pos_0", "Pos_1", "Pos_2"])),
      UiMapAssignment: assignments.rows.filter((row) => ["0", "1"].includes(row.MapID)).map((row) => pick(row, ["UiMapID", "MapID", "Region_0", "Region_1", "Region_3", "Region_4"])),
      UiMap: uiMaps.rows.filter((row) => row.Type === "3").map((row) => pick(row, ["ID", "Name_lang", "Type"])),
      AreaTable: areas.rows.filter((row) => instanceSet.has(Number(row.ContinentID)) && row.ParentAreaID === "0").map((row) => pick(row, ["ID", "AreaName_lang", "ContinentID"])),
    },
  };
}

async function azerothcore() {
  const [teleports, quests, starters] = await Promise.all(["areatrigger_teleport", "quest_template", "creature_queststarter"].map((name) => text(`${AC_BASE}${name}.sql`)));
  const teleportRows = parseSqlInserts(teleports, "areatrigger_teleport").filter((row) => instanceSet.has(Number(row.target_map)))
    .map((row) => pick(row, ["ID", "Name", "target_map"]));
  // Quests are kept when their zone is one of the dungeons' (see atlasSources.js
  // for the area filter); the area ids come from the wago extract.
  const questRows = parseSqlInserts(quests, "quest_template").map((row) => pick(row, ["ID", "LogTitle", "QuestLevel", "MinLevel", "QuestSortID", "AllowableRaces", "SuggestedGroupNum"]));
  const starterRows = parseSqlInserts(starters, "creature_queststarter");
  return { teleportRows, questRows, starterRows };
}

// The C++ scripts of the vanilla dungeons' creatures, as repository paths.
const SCRIPT_DIRS = /^src\/server\/scripts\/(EasternKingdoms|Kalimdor)\/(BlackfathomDeeps|BlackrockMountain|Deadmines|DireMaul|Gnomeregan|Maraudon|OnyxiasLair|RagefireChasm|RazorfenDowns|RazorfenKraul|ScarletMonastery|Scholomance|ShadowfangKeep|Stratholme|SunkenTemple|TheStockade|Uldaman|WailingCaverns|ZulFarrak|ZulGurub)\/.*\.cpp$/;
async function scriptPaths() {
  if (FROM) return readFileSync(join(FROM, "cpp", "list.txt"), "utf8").split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
  const tree = JSON.parse(await text(`https://api.github.com/repos/azerothcore/azerothcore-wotlk/git/trees/${AC_REF}?recursive=1`));
  return tree.tree.filter((entry) => entry.type === "blob" && SCRIPT_DIRS.test(entry.path)).map((entry) => entry.path);
}

async function content(dungeonNames) {
  const sql = (name) => text(`${AC_BASE}${name}.sql`).then((body) => parseSqlInserts(body, name));
  const [spawnRows, templateRows, smartRows, ctsRows, encounterRows] = await Promise.all(
    ["creature", "creature_template", "smart_scripts", "creature_template_spell", "instance_encounters"].map(sql));
  const scriptFiles = [];
  for (const path of (await scriptPaths()).sort()) scriptFiles.push({ path, ...parseScriptSpells(await text(`${AC_RAW}${path}`)) });
  const creatures = extractCreatureContent({ spawnRows, templateRows, smartRows, ctsRows, encounterRows, scriptFiles });
  const spellIds = [...new Set(creatures.creature_spells.map((row) => row[1]))];
  const tableNames = ["SpellName", "Spell", "SpellMisc", "SpellCastTimes", "SpellInterrupts", "SpellCategories", "SpellEffect", "AreaTable"];
  const tables = Object.fromEntries(await Promise.all(tableNames.map(async (name) => [name, parseCsv(await text(WAGO(name))).rows])));
  const spells = extractSpellContent({ spellIds, tables, dungeonNames });
  writeFileSync(join(outDir, "azerothcore-creatures.json"), `${JSON.stringify({ source: "azerothcore", url: `https://github.com/azerothcore/azerothcore-wotlk/tree/${AC_REF}`,
    revision: AC_REF, retrievedAt, license: AC_LICENSE, tables: creatures })}
`);
  writeFileSync(join(outDir, "wago-classic-era-spells.json"), `${JSON.stringify({ source: "wago-classic-era", url: "https://wago.tools/db2?product=wow_classic_era",
    revision: "wow_classic_era (latest)", retrievedAt, license: WAGO_LICENSE, tables: spells })}
`);
  console.log(`Wrote content extracts: ${creatures.spawns.length} spawns, ${creatures.creatures.length} creatures, ${creatures.creature_spells.length} creature spells, `
    + `${spells.spells.length} spells, ${spells.dungeonAreas.length} dungeon areas.`);
}

// One table row per line, so a refresh reviews as a readable diff.
function rowsJson(extract) {
  const tables = Object.entries(extract.tables).map(([name, rows]) => `  ${JSON.stringify(name)}: [\n${rows.map((row) => `   ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
  const head = Object.entries(extract).filter(([key]) => key !== "tables").map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${head.join(",\n")},\n "tables": {\n${tables.join(",\n")}\n }\n}\n`;
}

async function loot() {
  const atlas = JSON.parse(readFileSync(join(outDir, "..", "atlas.json"), "utf8"));
  const anchors = new Map();
  for (const dungeon of atlas.dungeons) {
    for (const creature of [...dungeon.bosses, ...dungeon.rares]) if (creature.npcId) anchors.set(creature.npcId, dungeon.instanceId);
  }
  const questIds = atlas.dungeons.flatMap((dungeon) => dungeon.quests.map((quest) => quest.questId));
  const sql = (name) => text(`${AC_BASE}${name}.sql`).then((body) => parseSqlInserts(body, name));
  const [lootRows, referenceRows, templateRows, spawnRows, questRows, addonRows, starterRows, objectLootRows, objectTemplateRows, objectRows] = await Promise.all(
    ["creature_loot_template", "reference_loot_template", "creature_template", "creature", "quest_template", "quest_template_addon", "creature_queststarter",
      "gameobject_loot_template", "gameobject_template", "gameobject"].map(sql));
  const tables = Object.fromEntries(await Promise.all(["ItemSparse", "Item", "ItemSet", "ItemClass", "ItemSubClass"]
    .map(async (name) => [name, parseCsv(await text(WAGO(name))).rows])));
  // The newest client build a column of the table is named after.
  const build = Object.keys(tables.ItemSparse[0] || {}).map((name) => /^Field_(\d+)_(\d+)_(\d+)_(\d+)_/.exec(name)).filter(Boolean)
    .map((match) => match.slice(1, 5).map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]).at(-1)?.join(".") || null;
  const all = extractItemFacts({ tables });
  const links = extractReferenceLoot({ lootRows, referenceRows, templateRows, spawnRows, objectLootRows, objectTemplateRows, objectRows,
    items: all.items, anchors });
  const quests = extractQuestDetails({ questRows, addonRows, starterRows, spawnRows, questIds });
  const itemIds = new Set([...links.creature_loot.map((row) => row[1]), ...links.object_loot.map((row) => row[1]), ...quests.quest_details.flatMap((row) => [...row.rewardItems, ...row.choiceItems])]);
  const items = { ...all, items: all.items.filter((item) => itemIds.has(item.id)) };
  writeFileSync(join(outDir, "azerothcore-loot.json"), rowsJson({ source: "azerothcore", url: `https://github.com/azerothcore/azerothcore-wotlk/tree/${AC_REF}/data/sql/base/db_world`,
    revision: AC_REF, retrievedAt, license: AC_LICENSE, tables: { ...links, ...quests } }));
  writeFileSync(join(outDir, "wago-classic-era-items.json"), rowsJson({ source: "wago-classic-era", url: "https://wago.tools/db2?product=wow_classic_era",
    revision: build ? `wow_classic_era ${build}+` : "wow_classic_era (latest)", retrievedAt, license: WAGO_LICENSE, tables: items }));
  console.log(`Wrote loot extracts: ${links.creature_loot.length} creature drops from ${links.creatures.length} creatures, `
    + `${links.object_loot.length} chest drops from ${links.objects.length} chests, ${items.items.length} items, `
    + `${quests.quest_details.length} quest details, ${quests.quest_giver_spawns.length} giver spawns.`);
}

mkdirSync(outDir, { recursive: true });
if (LOOT_ONLY) {
  await loot();
  process.exit(0);
}
if (CONTENT_ONLY) {
  const existing = JSON.parse(readFileSync(join(outDir, "wago-classic-era.json"), "utf8"));
  await content(existing.tables.Map.map((row) => row.MapName_lang));
  process.exit(0);
}

const wagoExtract = await wago();
const areaIds = new Set(wagoExtract.tables.AreaTable.map((row) => Number(row.ID)));
const ac = await azerothcore();
const questTemplate = ac.questRows.filter((row) => areaIds.has(Number(row.QuestSortID)));
const questIds = new Set(questTemplate.map((row) => Number(row.ID)));
const queststarter = ac.starterRows.filter((row) => questIds.has(Number(row.quest))).map((row) => ({ id: row.id, quest: row.quest }));
const creatureIds = new Set(queststarter.map((row) => Number(row.id)));
const bossNames = new Set(wagoExtract.tables.DungeonEncounter.map((row) => row.Name_lang));
const creatures = parseSqlInserts(await text(`${AC_BASE}creature_template.sql`), "creature_template")
  .filter((row) => creatureIds.has(Number(row.entry)) || bossNames.has(row.name)).map((row) => pick(row, ["entry", "name", "subname", "rank"]));

writeFileSync(join(outDir, "wago-classic-era.json"), `${JSON.stringify(wagoExtract, null, 1)}\n`);
writeFileSync(join(outDir, "azerothcore.json"), `${JSON.stringify({
  source: "azerothcore", url: `https://github.com/azerothcore/azerothcore-wotlk/tree/${AC_REF}/data/sql/base/db_world`, revision: AC_REF, retrievedAt,
  license: AC_LICENSE,
  tables: { areatrigger_teleport: ac.teleportRows, quest_template: questTemplate, creature_queststarter: queststarter, creature_template: creatures },
}, null, 1)}\n`);
console.log(`Wrote ${outDir}: ${wagoExtract.tables.DungeonEncounter.length} encounters, ${questTemplate.length} quests, ${creatures.length} creatures.`);
await content(wagoExtract.tables.Map.map((row) => row.MapName_lang));
console.log("Run node scripts/importDungeonAtlas.mjs, then --loot-only (it reads the new atlas.json), then import again.");
