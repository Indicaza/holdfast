import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { atlasDetail } from "../src/Atlas/atlasRepository.js";
import { parseCsv } from "../src/Atlas/atlasSources.js";
import { buildItemDefinitions, categoryOf, definitionAsFacts, referenceItemInputs } from "../src/Atlas/itemDefinitions.js";
import { curateItem, referenceItemOf } from "../src/Atlas/atlasLoot.js";
import { extractForeverClientItems, foreverDbBuild, parseForeverDbGear, parseForeverDbLoot, parseForeverDbNames, parseLootEntry } from "../src/Atlas/lootSources.js";

// Loot intelligence, PR 1 (docs/loot-sources.md): the Forever client's item
// tables, ForeverDB's files, and canonical item definitions. Fixtures are
// excerpts in each source's own format (Witherfang in Ruins of Lordaeron,
// Hall of Thanes, Edwin VanCleef).

const DATA = new URL("../src/Atlas/data/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, DATA), "utf8"));

const HEADER = "-- Data: ForeverDB.net (https://foreverdb.net), build 1.60.1.70959. Reuse requires this credit: see NOTICE.txt (GPL-3.0 section 7(b)).\nlocal _, ns = ...\n";
const GEAR = `${HEADER}ns.weights = {WARRIOR={{name="Arms",w={[4]=1.0}}}}\nns.gear = {[5191]="13;2;7;19;38:12;155;0",[271201]="6;4;3;15;4:3,7:7;0;104",[271202]="9;4;2;15;3:4,45:5;0;37",[271203]="17;2;10;15;3:9,6:5;175;0"}\n`;
const NAMES = `${HEADER}ns.gfItemText = [==[\n${(5191).toString(36)}|Cruel Barb|d|s||||d^36^Edwin VanCleef^20^0^s\n${(271201).toString(36)}|Atrophic Girdle|d|s||||d^2999^Witherfang^23.53^0^s\n${(271202).toString(36)}|Witherbite Bracers|d|s||||\n${(271203).toString(36)}|Segmented Spider Leg|d|s||||\n]==]\n`;
const LOOT = `${HEADER}ns.lootDB = {
  v = 1, built = "2026-11-20",
  inst = {
    { id = 36, name = "The Deadmines", kind = "dungeon", lv = "17-24", zone = 1436, open = true,
      bosses = {
        { npc = 639, name = "Edwin VanCleef", loot = "5191:20:c::;5193:33.33:f:2:12:4" },
      },
      trash = "1210:0:f:2::3",
    },
    { id = 2999, name = "Ruins of Lordaeron", kind = "dungeon", lv = "15-22", zone = 1420, forever = true, open = true,
      bosses = {
        { name = "Witherfang", loot = "271202:47.06:f:2:17;271201:23.53:f:2:17;271203:23.53:f:2:17;774:5.88:f::17" },
        { name = "Lordaeron Captain", loot = "" },
      },
      trash = "",
    },
  },
}
`;
const SPARSE = [
  "ID,Display_lang,OverallQualityID,ItemLevel,RequiredLevel,InventoryType,AllowableClass,Bonding,ItemDelay,ItemSet,StartQuestID,SellPrice",
  "275443,Highly Toxic Strain,1,1,1,0,-1,4,0,0,0,0",
  "13401,\"The Cruel Hand of Timmy\",3,58,53,13,-1,1,1700,0,0,32456",
].join("\n");
const ITEM = ["ID,ClassID,SubclassID,Material,InventoryType,IconFileDataID", "5191,2,7,1,13,135325", "13401,2,4,2,13,133729", "271201,4,3,5,6,0",
  "271202,4,2,8,9,0", "271203,2,10,1,17,135146", "275443,12,0,0,0,132108"].join("\n");
const SET = "ID,Name_lang\n161,Defias Leather";

test("ForeverDB files: build, gear facts, names, loot with rates over looted kills", () => {
  assert.equal(foreverDbBuild(GEAR), "1.60.1.70959");
  const gear = parseForeverDbGear(GEAR);
  assert.deepEqual(gear.map((row) => row.id), [5191, 271201, 271202, 271203], "only ns.gear, not the weights");
  assert.deepEqual(gear[1], { id: 271201, inventoryType: 6, classId: 4, subclassId: 3, requiredLevel: 15, stats: [[4, 3], [7, 7]], dps: null, armor: 104 });
  assert.equal(gear[3].dps, 17.5);
  const names = parseForeverDbNames(NAMES);
  assert.equal(names.get(271201), "Atrophic Girdle");
  assert.equal(names.get(5191), "Cruel Barb");

  const loot = parseForeverDbLoot(LOOT);
  assert.deepEqual(loot.map((instance) => [instance.instanceId, instance.forever]), [[36, false], [2999, true]]);
  const witherfang = loot[1].bosses[0];
  assert.equal(witherfang.npcId, null, "Forever bosses come by name");
  assert.deepEqual(witherfang.loot[1], { itemId: 271201, pct: 23.53, observed: true, classic: false, hidden: "revealed", kills: 17, seen: null });
  assert.deepEqual(loot[1].bosses[1].loot, [], "a boss nobody has looted: no rows, not zero rates");
  const vancleef = loot[0].bosses[0];
  assert.equal(vancleef.npcId, 639);
  assert.deepEqual(vancleef.loot[0], { itemId: 5191, pct: 20, observed: false, classic: true, hidden: null, kills: null, seen: null }, "Classic data: no kills");
  assert.equal(loot[0].trash[0].pct, null, "0 means not known");
  assert.equal(loot[0].trash[0].seen, 3);
  assert.equal(parseLootEntry("x:1:f"), null);
  assert.equal(parseLootEntry("-4:1:f"), null);
});

test("the Forever client: named items, items it does not name, nothing invented", () => {
  const items = extractForeverClientItems({ tables: { ItemSparse: parseCsv(SPARSE).rows, Item: parseCsv(ITEM).rows, ItemSet: parseCsv(SET).rows } });
  const byId = new Map(items.map((row) => [row.id, row]));
  assert.equal(byId.get(275443).name, "Highly Toxic Strain");
  assert.equal(byId.get(275443).hidden, false);
  assert.equal(byId.get(13401).name, "The Cruel Hand of Timmy", "quoted CSV field");
  const girdle = byId.get(271201);
  assert.deepEqual(girdle, { id: 271201, classId: 4, subclassId: 3, inventoryType: 6, icon: null, hidden: true }, "class and slot only; no name, quality, stats");
  assert.equal(byId.get(271203).icon, 135146);
  assert.ok(!("stats" in byId.get(275443)) && !("armor" in byId.get(13401)), "the Forever format holds no stats or armour: left out, not zero");
  assert.deepEqual(extractForeverClientItems({ tables: { ItemSparse: parseCsv(SPARSE).rows, Item: parseCsv(ITEM).rows }, itemIds: [271201] }).map((row) => row.id), [271201]);
});

test("definitions: precedence per field, conflicts kept, unknowns stay unknown", () => {
  const forever = extractForeverClientItems({ tables: { ItemSparse: parseCsv(SPARSE).rows, Item: parseCsv(ITEM).rows, ItemSet: parseCsv(SET).rows } });
  const foreverdb = parseForeverDbGear(GEAR).map((row) => ({ ...row, name: parseForeverDbNames(NAMES).get(row.id) ?? null }));
  const classic = [{ id: 5191, name: "Cruel Barb", quality: 3, icon: 135325, classId: 2, subclassId: 7, inventoryType: 13, itemLevel: 24, requiredLevel: 19,
    allowableClass: -1, bonding: 1, armor: 0, resistances: [0, 0, 0, 0, 0, 0], minDamage: 30, maxDamage: 57, delay: 2800, stats: [], randomStats: false,
    itemSet: 0, setName: null, startQuestId: 0 },
  { id: 13401, name: "The Cruel Hand of Timmy", quality: 3, icon: 133729, classId: 2, subclassId: 4, inventoryType: 13, itemLevel: 58, requiredLevel: 52,
    allowableClass: -1, bonding: 1, armor: 0, resistances: [0, 0, 0, 0, 0, 0], minDamage: 52, maxDamage: 98, delay: 1700, stats: [], randomStats: false,
    itemSet: 0, setName: null, startQuestId: 0 }];
  const rows = { "wago-forever": forever, foreverdb, "wago-classic-era": classic };
  const { items, report } = buildItemDefinitions({ rows });
  const byId = new Map(items.map((item) => [item.itemId, item]));

  // Witherfang's drops: the client's class and slot, ForeverDB's name, stats and armour; no quality, icon or item level.
  const girdle = byId.get(271201);
  assert.equal(girdle.name, "Atrophic Girdle");
  assert.equal(girdle.category, "equipment");
  assert.equal(girdle.foreverClient, "hidden");
  assert.deepEqual(girdle.provenance, { "wago-forever": ["classId", "subclassId", "inventoryType"], foreverdb: ["name", "requiredLevel", "stats", "armor"] });
  assert.ok(!("quality" in girdle) && !("icon" in girdle) && !("itemLevel" in girdle), "unknown: left out");
  // A quest item from the client.
  assert.equal(byId.get(275443).category, "quest");
  // The Forever client beats the Classic one; the disagreement is kept.
  const timmy = byId.get(13401);
  assert.equal(timmy.requiredLevel, 53);
  assert.deepEqual(timmy.conflicts, [{ field: "requiredLevel", values: { "wago-forever": 53, "wago-classic-era": 52 } }]);
  // ForeverDB beats Classic on stats; Classic still supplies damage.
  const barb = byId.get(5191);
  assert.deepEqual(barb.stats, [[38, 12]]);
  assert.equal(barb.minDamage, 30);
  assert.equal(barb.foreverClient, "hidden", "an Item row only");
  assert.equal(report.items, 6);
  assert.equal(report.hiddenInClient, 4);
  assert.ok(report.conflicts >= 2);
  // Idempotent: the same rows give the same definitions.
  assert.deepEqual(buildItemDefinitions({ rows }), buildItemDefinitions({ rows }));
  // Order of the source rows does not matter.
  assert.deepEqual(buildItemDefinitions({ rows: { ...rows, foreverdb: [...foreverdb].reverse() } }).items, items);

  // As reference items: the girdle is gear of unknown quality, the strain a quest item.
  const girdleItem = referenceItemOf(definitionAsFacts(girdle), { classNames: new Map([[4, "Armor"]]), subclassNames: new Map([["4:3", "Mail"]]) });
  assert.deepEqual([girdleItem.slot, girdleItem.itemClass, girdleItem.itemSubclass, girdleItem.qualityId, girdleItem.kind], ["Waist", "Armor", "Mail", null, "gear"]);
  assert.deepEqual(girdleItem.stats, [{ stat: "Strength", value: 3 }, { stat: "Stamina", value: 7 }]);
  assert.equal(curateItem(definitionAsFacts(byId.get(275443))), "quest-item");
  assert.equal(categoryOf({ classId: 9 }), "recipe");
  assert.equal(categoryOf({}), null);
});

test("the checked-in definitions and the served loot: Witherfang, Hall of Thanes, VanCleef", () => {
  // The ForeverDB set (data/foreverdb/, its licence) and the MIT base.
  const definitions = read("foreverdb/item-definitions.json");
  assert.ok(definitions.notice.startsWith("-- Data: ForeverDB.net (https://foreverdb.net)"));
  assert.deepEqual(definitions.precedence, ["wago-forever", "foreverdb", "wago-classic-era"]);
  assert.deepEqual(definitions.sources.map((source) => source.source), ["wago-forever", "foreverdb", "wago-classic-era"]);
  const base = read("item-definitions.json");
  assert.deepEqual(base.precedence, ["wago-forever", "wago-classic-era"]);
  assert.ok(!JSON.stringify(base).includes("foreverdb"), "the base holds nothing from ForeverDB");
  assert.equal(base.items.find((item) => item.itemId === 271201).name, undefined, "without ForeverDB the client does not name it");
  assert.ok(definitions.sources.every((source) => source.revision && source.license));
  const byId = new Map(definitions.items.map((item) => [item.itemId, item]));
  for (const id of [271201, 271202, 271203, 275443]) assert.ok(byId.get(id)?.name, `Witherfang's ${id} is named`);
  assert.equal(byId.get(275443).category, "quest");
  // The same ids in each run (the importer's --check covers the bytes).
  const again = referenceItemInputs({ classic: read("sources/wago-classic-era-items.json"), forever: read("sources/wago-forever-items.json"),
    foreverdb: read("foreverdb/foreverdb-items.json") });
  assert.deepEqual(again.definitions.items.map((item) => item.itemId), definitions.items.map((item) => item.itemId));

  // Served: Witherfang's drops have names, slots and stats; the strain is a quest item.
  const ruins = atlasDetail(2999, []);
  const witherfang = ruins.bosses.find((boss) => boss.name === "Witherfang");
  const loot = new Map(witherfang.referenceLoot.map((entry) => [entry.itemId, entry]));
  assert.equal(loot.get(271201).name, "Atrophic Girdle");
  assert.equal(loot.get(271201).slot, "Waist");
  assert.equal(loot.get(271201).qualityId, null, "no source states its quality");
  assert.equal(loot.get(275443)?.kind, "quest-item");
  assert.equal(witherfang.unresolvedLoot.length, 0);
  // VanCleef keeps his Classic loot, now with the Forever client's facts where it has them.
  const vancleef = atlasDetail(36, []).bosses.find((boss) => boss.name === "Edwin VanCleef");
  const barb = vancleef.referenceLoot.find((entry) => entry.itemId === 5191);
  assert.equal(barb.name, "Cruel Barb");
  assert.ok(barb.factSources.includes("wago-classic-era"));
});

test("without ForeverDB's data the site serves the MIT base", () => {
  // A fresh process: the data is read once per process.
  const script = `import("./src/Atlas/atlasRepository.js").then(({ atlasDetail }) => {
    const boss = atlasDetail(2999, []).bosses.find((entry) => entry.name === "Witherfang");
    console.log(JSON.stringify({ named: boss.referenceLoot.filter((item) => item.itemId === 271201).length, unresolved: boss.unresolvedLoot.length }));
  })`;
  const run = (value) => JSON.parse(execFileSync(process.execPath, ["-e", script], { cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOLDFAST_FOREVERDB_DATA: value }, encoding: "utf8" }).trim());
  assert.deepEqual(run("off"), { named: 0, unresolved: 3 }, "the girdle, bracers and staff known by id only");
  assert.deepEqual(run(""), { named: 1, unresolved: 0 }, "with ForeverDB's data (the default when present)");
});
