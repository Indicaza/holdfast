import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ABILITY_CATEGORIES, TIERS, atlasProblems, normalize, zonePoint } from "../src/Atlas/atlasNormalize.js";
import { atlasDetail, atlasSummary, loadAtlas } from "../src/Atlas/atlasRepository.js";
import { parseCsv, parseSqlInserts } from "../src/Atlas/atlasSources.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { ITEMS, connect, corpseLoot, seedItems, syncCharacter } from "../testSupport/lootHarness.js";

// The Dungeon Atlas: source extracts → normalized facts with provenance →
// `atlas` on the loot catalog's dungeon list and detail. Nothing is invented.

const extract = (source, tables) => ({ source, revision: "r1", retrievedAt: "2026-11-17T00:00:00.000Z", url: `https://example.test/${source}`, tables });

const WAGO = extract("wago-classic-era", {
  Map: [{ ID: "36", MapName_lang: "Deadmines", MapDescription0_lang: "", MapDescription1_lang: "", InstanceType: "1", MaxPlayers: "10", AreaTableID: "0" },
    { ID: "533", MapName_lang: "Naxxramas", MapDescription0_lang: "", MapDescription1_lang: "", InstanceType: "2", MaxPlayers: "40", AreaTableID: "3456" }],
  LFGDungeons: [{ ID: "5", Name_lang: "Deadmines", MinLevel: "15", MaxLevel: "28", TypeID: "1", Faction: "-1", MapID: "0" }],
  DungeonEncounter: [
    { ID: "2747", Name_lang: "Edwin VanCleef", MapID: "36", DifficultyID: "0", OrderIndex: "6000" },
    { ID: "2741", Name_lang: "Rhahk'Zor", MapID: "36", DifficultyID: "0", OrderIndex: "0" },
    { ID: "9999", Name_lang: "Season Boss", MapID: "36", DifficultyID: "198", OrderIndex: "1" },
  ],
  AreaTrigger: [{ ID: "78", ContinentID: "0", Pos_0: "-11208.3", Pos_1: "1672.52", Pos_2: "24.66" }],
  UiMapAssignment: [{ UiMapID: "1436", MapID: "0", Region_0: "-11300", Region_1: "-500", Region_3: "-10000", Region_4: "2500" }],
  UiMap: [{ ID: "1436", Name_lang: "Westfall", Type: "3" }],
  AreaTable: [{ ID: "1581", AreaName_lang: "The Deadmines", ContinentID: "36" }],
});
const AC = extract("azerothcore", {
  areatrigger_teleport: [{ ID: "78", Name: "DeadMines Entrance", target_map: "36" }],
  quest_template: [
    { ID: "166", LogTitle: "The Defias Brotherhood", QuestLevel: "22", MinLevel: "14", QuestSortID: "1581", AllowableRaces: "1101" },
    { ID: "9500", LogTitle: "A later quest", QuestLevel: "70", MinLevel: "68", QuestSortID: "1581", AllowableRaces: "0" },
    { ID: "200", LogTitle: "<UNUSED> old", QuestLevel: "20", MinLevel: "15", QuestSortID: "1581", AllowableRaces: "0" },
  ],
  creature_queststarter: [{ id: "234", quest: "166" }],
  creature_template: [{ entry: "234", name: "Gryan Stoutmantle" }, { entry: "639", name: "Edwin VanCleef" }, { entry: "644", name: "Rhahk'Zor" },
    { entry: "1644", name: "Rhahk'Zor" }],
});

test("source readers parse CSV and mysqldump inserts", () => {
  const csv = parseCsv("ID,Name_lang\r\n1,\"Zul'Farak, \"\"the\"\"\"\r\n2,Plain\r\n");
  assert.deepEqual(csv.rows, [{ ID: "1", Name_lang: "Zul'Farak, \"the\"" }, { ID: "2", Name_lang: "Plain" }]);
  const sql = "CREATE TABLE `t` (\n  `ID` int,\n  `Name` text\n) ENGINE=InnoDB;\nINSERT INTO `t` VALUES\n(1,'It\\'s, here'),\n(2,NULL);\n";
  assert.deepEqual(parseSqlInserts(sql, "t"), [{ ID: "1", Name: "It's, here" }, { ID: "2", Name: null }]);
});

test("adapters normalize sourced facts and leave the rest null", () => {
  const atlas = normalize({ wago: WAGO, azerothcore: AC, generatedAt: "x" });
  assert.deepEqual(atlasProblems(atlas), []);
  const deadmines = atlas.dungeons.find((d) => d.instanceId === 36);
  assert.equal(deadmines.kind, "dungeon");
  assert.deepEqual([deadmines.levelMin, deadmines.levelMax, deadmines.recommendedLevel], [15, 28, null], "no source gives a recommended level");
  assert.deepEqual(deadmines.bosses.map((b) => b.name), ["Rhahk'Zor", "Edwin VanCleef"], "client order; other difficulties left out");
  assert.equal(deadmines.bosses[1].npcId, 639);
  assert.equal(deadmines.bosses[0].npcId, null, "an ambiguous name match gives no npc id");
  for (const boss of deadmines.bosses) {
    assert.deepEqual([boss.mapPosition, boss.floorId, boss.portraitUrl, boss.abilities], [null, null, null, []]);
  }
  assert.equal(deadmines.zoneName, "Westfall");
  assert.equal(deadmines.entrance.mapId, 1436);
  assert.ok(deadmines.entrance.x > 0 && deadmines.entrance.x < 1 && deadmines.entrance.y > 0 && deadmines.entrance.y < 1);
  assert.deepEqual(deadmines.quests, [{ questId: 166, name: "The Defias Brotherhood", level: 22, minLevel: 14, faction: "alliance",
    giver: { npcId: 234, name: "Gryan Stoutmantle" } }], "later-expansion and placeholder quests are dropped");
  assert.deepEqual([deadmines.maps, deadmines.rares, deadmines.creatures, deadmines.artworkUrl], [[], [], [], null]);
  assert.ok(deadmines.provenance.every((line) => TIERS.includes(line.tier) && line.source && line.revision));

  const naxx = atlas.dungeons.find((d) => d.instanceId === 533);
  assert.deepEqual([naxx.kind, naxx.levelMin, naxx.entrance, naxx.zoneName, naxx.quests], ["raid", null, null, null, []], "unknown stays unknown");
  assert.deepEqual(normalize({ wago: WAGO, azerothcore: AC, generatedAt: "x" }), atlas, "idempotent");
});

test("zone framing: cities win, then the nearest zone centre", () => {
  const zones = [{ mapId: 1429, name: "Elwynn", continentId: 0, minX: -10000, minY: -1000, maxX: -8000, maxY: 1000 },
    { mapId: 1453, name: "Stormwind City", continentId: 0, minX: -9200, minY: 0, maxX: -8800, maxY: 400 }];
  assert.equal(zonePoint(zones, 0, -9000, 200).zoneName, "Stormwind City");
  assert.equal(zonePoint(zones, 0, -9900, -900).zoneName, "Elwynn");
  assert.equal(zonePoint(zones, 1, -9000, 200), null, "another continent");
  assert.deepEqual(zonePoint(zones, 0, -8000, 1000), { mapId: 1429, zoneName: "Elwynn", x: 0, y: 0 }, "top left is north-west");
});

test("invariants reject fabricated verification, bad positions and remote art", () => {
  const atlas = normalize({ wago: WAGO, azerothcore: AC, generatedAt: "x" });
  const boss = atlas.dungeons[0].bosses[0];
  boss.abilities.push({ spellId: 1, name: "Thrash", category: "tank-danger", priority: "high", interruptible: false, summary: "", details: "",
    source: "classic-reference", verifiedForForever: true });
  boss.mapPosition = { x: 2, y: 0.5 };
  atlas.dungeons[0].artworkUrl = "https://wow.zamimg.com/x.jpg";
  const problems = atlasProblems(atlas).join("\n");
  assert.match(problems, /claims Forever verification/);
  assert.match(problems, /mapPosition/);
  assert.match(problems, /art must be a local asset/);
});

test("the checked-in atlas is current, sourced and fabrication-free", () => {
  const { atlas } = loadAtlas();
  assert.deepEqual(atlasProblems(atlas), []);
  const read = (name) => JSON.parse(readFileSync(new URL(`../src/Atlas/data/sources/${name}`, import.meta.url), "utf8"));
  const regenerated = normalize({ wago: read("wago-classic-era.json"), azerothcore: read("azerothcore.json"), creatures: read("azerothcore-creatures.json"),
    spells: read("wago-classic-era-spells.json"), loot: read("azerothcore-loot.json"), items: read("wago-classic-era-items.json"), generatedAt: atlas.generatedAt });
  assert.deepEqual(regenerated, atlas, "run node scripts/importDungeonAtlas.mjs");
  assert.ok(atlas.dungeons.length >= 20);
  for (const dungeon of atlas.dungeons) {
    assert.equal(dungeon.artworkUrl, null);
    for (const boss of dungeon.bosses) {
      assert.equal(boss.portraitUrl, null);
      if (boss.mapPosition) assert.equal(boss.floorId, "layout", "positions are on the spawn layout");
    }
    for (const map of dungeon.maps) assert.deepEqual([map.floorId, map.kind, map.imageUrl], ["layout", "spawn-layout", null], "no map art is shipped");
    for (const creature of [...dungeon.bosses, ...dungeon.creatures, ...dungeon.rares]) {
      for (const ability of creature.abilities) {
        assert.ok(ABILITY_CATEGORIES.includes(ability.category));
        assert.equal(ability.verifiedForForever, false, "nothing here is checked against Forever");
        assert.equal(ability.source, "classic-reference");
      }
    }
  }
  const deadmines = atlas.dungeons.find((dungeon) => dungeon.instanceId === 36);
  assert.deepEqual(deadmines.rares.map((rare) => rare.name), ["Miner Johnson"]);
  assert.ok(deadmines.bosses.find((boss) => boss.name === "Cookie").abilities.some((ability) => ability.category === "interrupt"));
  for (const [id, zone] of [[48, "Ashenvale"], [209, "Tanaris"]]) assert.equal(atlas.dungeons.find((d) => d.instanceId === id).zoneName, zone);
  for (const id of [90, 109]) assert.ok(atlas.dungeons.find((d) => d.instanceId === id).bosses.length >= 4, "the emulator's encounter list fills the client's gap");
});

test("dungeon list and detail carry atlas and keep every catalog field", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, { id: "discord-atlas-ash", username: "ash" });
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  assert.equal((await corpseLoot(request, ash.token, { npcId: 639, npcName: "Edwin VanCleef", serial: 1, items: [ITEMS.barb] })).status, 201);

  const list = (await request("/api/player/loot/dungeons", { rawCookie: ash.cookie })).json;
  const deadmines = list.dungeons.find((entry) => entry.instanceId === 36);
  for (const key of ["instanceId", "name", "type", "journalInstanceId", "firstSeenAt", "lastSeenAt", "itemCount", "sourceCount", "lastEvidenceAt"]) {
    assert.ok(key in deadmines, `list keeps ${key}`);
  }
  assert.deepEqual(Object.keys(deadmines.atlas).sort(), ["artworkUrl", "bossCount", "entrance", "kind", "levelMax", "levelMin", "lootSlots", "questCount",
    "rareCount", "recommendedLevel", "referenceItemIds", "referenceLootCount", "referenceSlots", "zoneMapId", "zoneName"]);
  assert.deepEqual(deadmines.atlas.lootSlots, ["One-Hand"], "the catalog's own slot names");
  assert.equal(deadmines.atlas.entrance.mapId, 1436, "zone uiMapID");
  assert.ok(deadmines.atlas.entrance.x >= 0 && deadmines.atlas.entrance.x <= 1 && deadmines.atlas.entrance.y >= 0 && deadmines.atlas.entrance.y <= 1);
  assert.equal(deadmines.atlas.kind, "dungeon");
  assert.equal(deadmines.atlas.rareCount, 1, "one rare spawn (Miner Johnson)");
  assert.ok(list.atlasDungeons.length > 0 && list.atlasDungeons.every((entry) => entry.atlas && entry.instanceId !== 36));

  const detail = (await request("/api/player/loot/dungeons/36", { rawCookie: ash.cookie })).json;
  for (const key of ["schemaVersion", "revision", "instance", "difficulties", "sources", "changes", "evidence"]) assert.ok(key in detail, `detail keeps ${key}`);
  const vancleef = detail.atlas.bosses.find((boss) => boss.name === "Edwin VanCleef");
  assert.deepEqual(vancleef.loot, ["i:5191"], "boss points at loot the catalog already holds");
  assert.ok(detail.sources.some((source) => source.name === vancleef.name), "boss name is the catalog's source name");
  assert.equal(vancleef.atlasName, "Edwin VanCleef");
  assert.deepEqual(detail.atlas.bosses.find((boss) => boss.name === "Sneed")?.loot, [], "no catalog loot, no claimed loot");
  assert.ok(Array.isArray(detail.atlas.provenance) && detail.atlas.provenance.length);

  const naxx = await request("/api/player/loot/dungeons/533", { rawCookie: ash.cookie });
  assert.equal(naxx.status, 200, "an atlas-only dungeon answers with empty loot");
  assert.deepEqual([naxx.json.sources, naxx.json.atlas.entrance, naxx.json.atlas.levelMin], [[], null, null]);
  assert.equal((await request("/api/player/loot/dungeons/999", { rawCookie: ash.cookie })).status, 404);
}));

test("summary and detail answer null for an unknown dungeon", () => {
  assert.equal(atlasSummary(999), null);
  assert.equal(atlasDetail(999), null);
});
