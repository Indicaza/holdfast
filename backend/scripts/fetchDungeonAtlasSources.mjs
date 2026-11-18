#!/usr/bin/env node
// Refreshes the checked-in source extracts of the Dungeon Atlas from their
// upstreams. Run by hand (it needs the network); the site never calls these
// services at request time. Writes only the rows the atlas uses:
//
//   src/Atlas/data/sources/wago-classic-era.json   Blizzard client tables (Classic Era build) via wago.tools
//   src/Atlas/data/sources/azerothcore.json        AzerothCore world DB (GPL-2.0) at a pinned commit
//
// Then run `node scripts/importDungeonAtlas.mjs` to re-normalize.
//
//   node scripts/fetchDungeonAtlasSources.mjs [--azerothcore-ref <sha>]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VANILLA_INSTANCE_IDS, parseCsv, parseSqlInserts } from "../src/Atlas/atlasSources.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "Atlas", "data", "sources");
const refArg = process.argv.indexOf("--azerothcore-ref");
const AC_REF = refArg > 0 ? process.argv[refArg + 1] : "6ffb62abb867dabb258de6813ff5d06d6b011543";
const AC_BASE = `https://raw.githubusercontent.com/azerothcore/azerothcore-wotlk/${AC_REF}/data/sql/base/db_world/`;
const WAGO = (table) => `https://wago.tools/db2/${table}/csv?product=wow_classic_era`;

async function text(url) {
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
    license: "Factual game data extracted from the World of Warcraft Classic Era client (Blizzard Entertainment). Names and numbers only; no art.",
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

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "wago-classic-era.json"), `${JSON.stringify(wagoExtract, null, 1)}\n`);
writeFileSync(join(outDir, "azerothcore.json"), `${JSON.stringify({
  source: "azerothcore", url: `https://github.com/azerothcore/azerothcore-wotlk/tree/${AC_REF}/data/sql/base/db_world`, revision: AC_REF, retrievedAt,
  license: "AzerothCore world database, GPL-2.0 (https://github.com/azerothcore/azerothcore-wotlk). A WotLK (3.3.5) emulator database: vanilla content as the emulator models it.",
  tables: { areatrigger_teleport: ac.teleportRows, quest_template: questTemplate, creature_queststarter: queststarter, creature_template: creatures },
}, null, 1)}\n`);
console.log(`Wrote ${outDir}: ${wagoExtract.tables.DungeonEncounter.length} encounters, ${questTemplate.length} quests, ${creatures.length} creatures.`);
