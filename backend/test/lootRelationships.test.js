import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { atlasDetail } from "../src/Atlas/atlasRepository.js";
import { buildLootRelationships, ratesByItem } from "../src/Atlas/lootRelationships.js";

// Loot intelligence, PR 2 (docs/loot-sources.md): boss loot relationships
// and reference drop rates, each source's own, never averaged.

const DATA = new URL("../src/Atlas/data/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, DATA), "utf8"));

// A Classic dungeon and a Forever one, both sources.
const atlas = { dungeons: [
  { instanceId: 36, name: "The Deadmines", bosses: [{ encounterId: 2749, npcId: 639, name: "Edwin VanCleef" }, { encounterId: 2750, npcId: 645, name: "Cookie" }] },
  { instanceId: 2999, name: "Ruins of Lordaeron", bosses: [{ encounterId: null, npcId: 250483, name: "Witherfang" }, { encounterId: null, npcId: null, name: "The Abandoned" },
    { encounterId: null, npcId: null, name: "Lordaeron Captain" }] },
  { instanceId: 43, name: "Wailing Caverns", bosses: [{ encounterId: 2753, npcId: 3653, name: "Kresh" }] },
  { instanceId: 47, name: "Razorfen Kraul", bosses: [{ encounterId: 2754, npcId: 4421, name: "Charlga Razorflank" }] },
] };
const reference = { dungeons: [
  { instanceId: 36, bosses: [{ encounterId: 2749, npcId: 639, itemIds: [5191, 5193], sources: { azerothcore: [5191, 5193], "dungeon-planner": [5191] } },
    { encounterId: 2750, npcId: 645, itemIds: [5197], sources: { azerothcore: [5197] } }] },
  { instanceId: 2999, bosses: [{ encounterId: null, npcId: 250483, itemIds: [271201], sources: { "dungeon-planner": [271201] } }] },
] };
const row = (instanceId, bossIndex, bossName, npcId, itemId, pct, src, kills = null, seen = null, hidden = null) =>
  [instanceId, bossIndex, bossName, npcId, itemId, pct, src, hidden, kills, seen];
const foreverDb = { source: "foreverdb", url: "https://foreverdb.net/dungeons", revision: "2026-11-20.test (client 1.60.1.70959)", retrievedAt: "2026-11-20T00:00:00Z",
  license: "GPL-3.0", attribution: "Data from ForeverDB.net",
  tables: { instances: [[36, "The Deadmines", 0], [2999, "Ruins of Lordaeron", 1], [43, "Wailing Caverns", 0], [47, "Razorfen Kraul", 0]], loot: [
    // VanCleef: one observed rate (27 looted kills), one Classic rate; Cookie's list says 5197, Forever saw it on VanCleef.
    row(36, 1, "Edwin VanCleef", 639, 5191, 22.22, "f", 27), row(36, 1, "Edwin VanCleef", 639, 5193, 33.33, "c"),
    row(36, 1, "Edwin VanCleef", 639, 5197, 3.7, "f", 27), row(36, 1, "Edwin VanCleef", 639, 1210, 7.4, "f", 27),
    // Witherfang: its guide-listed drop, a Forever item seen only here, a Forever item seen on two bosses, a Classic green.
    row(2999, 1, "Witherfang", null, 271201, 23.53, "f", 17, null, "revealed"), row(2999, 1, "Witherfang", null, 271202, 47.06, "f", 17),
    row(2999, 1, "Witherfang", null, 286978, 11.76, "f", 17), row(2999, 1, "Witherfang", null, 2970, 5.88, "f", 17),
    row(2999, 2, "The Abandoned", null, 286978, 11.11, "f", 18), row(2999, 2, "The Abandoned", null, 1210, 5.56, "f", 18),
    row(2999, 3, "Someone Unknown", null, 271299, 50, "f", 2),
    row(2999, 0, null, null, 3196, null, "f", null, 20),
    // 1210 on bosses of three instances: a world drop.
    row(43, 1, "Kresh", 3653, 1210, 4.1, "f", 24), row(47, 1, "Charlga Razorflank", 4421, 1210, 3.2, "f", 12),
  ] } };

test("relationships: who lists each drop, each source's rate, scope, discrepancies", () => {
  const built = buildLootRelationships({ atlas, reference, foreverDb, worldDrops: new Set([3196]), categoryOf: (id) => (id === 1210 ? "material" : "equipment"),
    generatedAt: "2026-11-20T00:00:00Z" });
  const dungeon = (id) => built.dungeons.find((entry) => entry.instanceId === id);
  const item = (boss, id) => boss.items.find((entry) => entry.itemId === id);

  const vancleef = dungeon(36).bosses[0];
  assert.equal(vancleef.foreverDbName, "Edwin VanCleef", "matched by npc id");
  assert.deepEqual(item(vancleef, 5191).listedBy, ["azerothcore", "dungeon-planner"]);
  assert.deepEqual(item(vancleef, 5191).rates, [{ source: "foreverdb", method: "observed", percent: 22.22, kills: 27, seen: null,
    revision: "2026-11-20.test (client 1.60.1.70959)" }]);
  assert.equal(item(vancleef, 5193).rates[0].method, "classic", "Classic data is labelled, not passed off as Forever's");
  assert.equal(item(vancleef, 5193).rates[0].kills, null);
  // 1210: seen on bosses of three instances: a world drop, kept with its rate, not VanCleef's loot.
  assert.equal(item(vancleef, 1210).scope, "world");
  assert.equal(item(vancleef, 1210).rates[0].percent, 7.4);
  // 5197: the guides put it on Cookie; Forever saw it on VanCleef.
  assert.equal(item(vancleef, 5197).scope, "corpse", "an original item only seen on a corpse is not the boss's");
  assert.deepEqual(built.report.placementDiscrepancies, [{ instanceId: 36, itemId: 5197, listedOn: "Cookie", seenOn: ["Edwin VanCleef"] }]);

  const witherfang = dungeon(2999).bosses[0];
  assert.equal(witherfang.foreverDbName, "Witherfang", "matched by name");
  assert.equal(item(witherfang, 271201).scope, "boss");
  assert.equal(item(witherfang, 271201).rates[0].hidden, "revealed");
  assert.equal(item(witherfang, 271202).scope, "boss", "a Forever item seen only on this boss");
  assert.equal(item(witherfang, 286978).scope, "dungeon", "seen on two bosses of the dungeon: shared, not each boss's");
  assert.equal(item(witherfang, 2970).scope, "corpse");
  assert.equal(dungeon(2999).bosses[1].foreverDbName, "The Abandoned");
  assert.equal(dungeon(2999).bosses[2].items.length, 0, "Lordaeron Captain: nobody's data, no rows");
  assert.deepEqual(built.report.unmatchedBosses, ["2999:Someone Unknown"]);
  assert.deepEqual(dungeon(2999).trash, [{ itemId: 3196, scope: "world", category: "equipment", rates: [{ source: "foreverdb", method: "observed",
    percent: null, kills: null, seen: 20, revision: "2026-11-20.test (client 1.60.1.70959)" }] }], "trash: seen 20 times, rate unknown");
  assert.equal(built.sources[0].attribution, "Data from ForeverDB.net");
  assert.equal(built.report.bossesMatched, 5);
  assert.deepEqual(ratesByItem(vancleef).get(5191)[0].kills, 27);
  // Deterministic.
  assert.deepEqual(buildLootRelationships({ atlas, reference, foreverDb, worldDrops: new Set([3196]), categoryOf: () => null, generatedAt: "x" }).report,
    buildLootRelationships({ atlas, reference, foreverDb, worldDrops: new Set([3196]), categoryOf: () => null, generatedAt: "x" }).report);
  // No ForeverDB file: the reference lists alone, no rates.
  const alone = buildLootRelationships({ atlas, reference, foreverDb: null });
  assert.ok(alone.dungeons.every((entry) => entry.bosses.every((boss) => boss.items.every((relation) => !relation.rates))));
});

test("conflicting rates from two sources stay two rates", () => {
  const twice = { ...foreverDb, tables: { ...foreverDb.tables, loot: [row(36, 1, "Edwin VanCleef", 639, 5191, 22.22, "f", 27), row(36, 1, "Edwin VanCleef", 639, 5191, 20, "c")] } };
  const built = buildLootRelationships({ atlas, reference, foreverDb: twice });
  const rates = built.dungeons[0].bosses[0].items.find((entry) => entry.itemId === 5191).rates;
  assert.deepEqual(rates.map((rate) => [rate.method, rate.percent]), [["observed", 22.22], ["classic", 20]], "not averaged, not overwritten");
});

test("the checked-in relationships and the served rates", () => {
  const data = read("loot-relationships.json");
  assert.equal(data.dataset, "loot-relationships");
  assert.equal(data.sources[0].attribution, "Data from ForeverDB.net");
  assert.ok(data.report.bossesMatched >= 250, `bosses matched: ${data.report.bossesMatched}`);
  assert.ok(data.report.observedRates >= 1500 && data.report.ratesWithKills >= 1000);
  // Every rate names its source, method and revision; observed ones their kills.
  for (const dungeon of data.dungeons) {
    for (const boss of dungeon.bosses) {
      for (const relation of boss.items) {
        assert.ok(["boss", "dungeon", "corpse", "world"].includes(relation.scope));
        for (const rate of relation.rates || []) {
          assert.ok(rate.source === "foreverdb" && ["observed", "classic", "unknown"].includes(rate.method) && rate.revision);
          if (rate.percent !== null) assert.ok(rate.percent > 0 && rate.percent <= 100);
        }
      }
    }
  }
  // Witherfang: its four drops, three with Forever rates over looted kills.
  const ruins = atlasDetail(2999, []);
  const witherfang = ruins.bosses.find((boss) => boss.name === "Witherfang");
  const girdle = witherfang.referenceLoot.find((entry) => entry.itemId === 271201);
  assert.equal(girdle.referenceRates[0].method, "observed");
  assert.ok(girdle.referenceRates[0].kills > 0 && girdle.referenceRates[0].percent > 0);
  // VanCleef: observed Forever rates on his Classic loot.
  const vancleef = atlasDetail(36, []).bosses.find((boss) => boss.name === "Edwin VanCleef");
  const barb = vancleef.referenceLoot.find((entry) => entry.itemId === 5191);
  assert.ok(barb.referenceRates.some((rate) => rate.method === "observed" && rate.kills > 0));
  // Hall of Thanes: loot only ForeverDB places on a boss is served apart, credited, not as Classic reference.
  const hall = atlasDetail(3065, []);
  const foreverOnly = hall.bosses.flatMap((boss) => boss.foreverLoot || []);
  assert.ok(foreverOnly.length > 0, "Infurnus' loot comes from ForeverDB");
  assert.ok(foreverOnly.every((entry) => entry.source === "foreverdb" && entry.attribution === "Data from ForeverDB.net" && entry.name && entry.verifiedForForever === false));
  // The reference loot stays chance-free (its own contract).
  assert.ok(!/"[^"]*chance[^"]*"\s*:/i.test(readFileSync(new URL("reference-loot.json", DATA), "utf8")));
});
