import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeReferenceLoot, referenceLootProblems, worldDropItems } from "../src/Atlas/atlasLoot.js";
import { coverageReport } from "../src/Atlas/atlasLootCoverage.js";
import { extractPlannerLoot } from "../src/Atlas/atlasPlanner.js";
import { atlasDetail, loadAtlas } from "../src/Atlas/atlasRepository.js";
import { loadReferenceData } from "../src/Atlas/atlasData.js";

// Reference loot from two sources: the AzerothCore extract and DungeonPlanner's
// boss drop lists. Each boss keeps the union, every item says who lists it,
// world drops and items the Classic client lacks are left out (the latter
// recorded as gaps), encounters without one NPC find theirs through
// DungeonPlanner, chests a boss's list explains are that boss's, and shared
// drops keep every creature or chest that drops them.

const DATA = new URL("../src/Atlas/data/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, DATA), "utf8"));

// A made-up dungeon (instance 36 is used only because the importer's
// instance list knows it).
const item = (id, fields = {}) => ({ id, name: `Item ${id}`, quality: 3, icon: 100 + id, classId: 4, subclassId: 2, inventoryType: 5, itemLevel: 30,
  requiredLevel: 25, allowableClass: -1, bonding: 1, armor: 10, resistances: [0, 0, 0, 0, 0, 0], minDamage: 0, maxDamage: 0, delay: 0, stats: [],
  randomStats: false, itemSet: 0, setName: null, startQuestId: 0, ...fields });
const ITEMS = { source: "wago-classic-era", revision: "r1", retrievedAt: "2026-01-01T00:00:00.000Z", url: "u", tables: {
  items: [item(1), item(2), item(3), item(4), item(5), item(6), item(7), item(8), item(9, { quality: 0 }), item(10)], classes: [[4, "Armor"]], subclasses: [[4, 2, "Leather"]] } };
const ATLAS = { dungeons: [{ instanceId: 36, name: "Testmines", quests: [], rares: [],
  bosses: [
    { encounterId: 1, npcId: 100, name: "Gatekeeper" },
    { encounterId: 2, npcId: null, name: "The Council", atlasName: "The Council" },
    { encounterId: 3, npcId: null, name: "Geilhast" },
    { encounterId: 4, npcId: null, name: "Kirtonos" },
    { encounterId: 5, npcId: 500, name: "Chestkeeper" },
  ] }] };
const LOOT = { source: "azerothcore", revision: "ac1", retrievedAt: "2026-01-01T00:00:00.000Z", url: "u", tables: {
  creatures: [[100, "Gatekeeper", 1, [36]], [700, "Trash Brute", 0, [36]], [701, "Trash Mage", 0, [36]]],
  creature_loot: [[100, 1], [100, 2], [700, 6], [701, 6], [700, 1]],
  objects: [[9000, "Keeper's Chest", [36]], [9001, "Old Crate", [36]]],
  object_loot: [[9000, 7], [9000, 8], [9001, 10]],
  world_drops: [[5]],
} };
const PLANNER = { source: "dungeon-planner", revision: "dp1", retrievedAt: "2026-01-02T00:00:00.000Z", url: "u", tables: {
  creatures: [[36, 100, "Gatekeeper", "testmines"], [36, 200, "The Council", "testmines"], [36, 300, "Gelihast", "testmines"],
    [36, 400, "Kirtonos the Herald", "testmines"], [36, 500, "Chestkeeper", "testmines"]],
  // 2 both sources; 3 only DungeonPlanner; 4 a council drop; 5 a world drop; 9 uncurated; 99 not in the client (Forever).
  loot: [[36, 100, 2, 1, 1, 0], [36, 100, 3, 1, 0, 0], [36, 100, 5, 1, 0, 0], [36, 100, 9, 1, 0, 0], [36, 100, 99, 2, 0, 1],
    [36, 200, 4, 1, 1, 0], [36, 300, 3, 1, 0, 0], [36, 400, 4, 1, 0, 0], [36, 500, 7, 1, 1, 0], [36, 500, 8, 1, 1, 0]],
} };

test("two sources: union per boss, each item's sources, exclusions and gaps", () => {
  const reference = normalizeReferenceLoot({ atlas: ATLAS, loot: LOOT, items: ITEMS, planner: PLANNER, generatedAt: "x" });
  const [dungeon] = reference.dungeons;
  const boss = (encounterId) => dungeon.bosses.find((entry) => entry.encounterId === encounterId);
  assert.deepEqual(boss(1).itemIds, [1, 2, 3], "the union of both sources");
  assert.deepEqual(boss(1).sources, { azerothcore: [1, 2], "dungeon-planner": [2, 3] }, "who lists each item");
  assert.ok(!boss(1).itemIds.includes(5), "a world drop is left out whoever lists it");
  assert.ok(!boss(1).itemIds.includes(9), "uncurated items are left out");
  assert.deepEqual(reference.gaps, [{ instanceId: 36, npcId: 100, itemId: 99, source: "dungeon-planner", reason: "forever-item-without-client-facts" }],
    "an item the client has no facts for is a recorded gap, never invented");
  assert.deepEqual(reference.excluded, { "filtered-by-curation": 1, "world-drop": 1 });
  // Encounters without an NPC: DungeonPlanner's name, a documented alias, a unique prefix.
  assert.equal(boss(2).npcId, 200);
  assert.deepEqual(boss(2).itemIds, [4]);
  assert.equal(boss(3).npcId, 300, "the client's 'Geilhast' is Gelihast");
  assert.equal(boss(4).npcId, 400, "Kirtonos is Kirtonos the Herald");
  // A chest whose every drop one boss's list holds is that boss's.
  assert.deepEqual(boss(5).chests, [{ objectId: 9000, name: "Keeper's Chest" }]);
  assert.deepEqual(boss(5).sources, { azerothcore: [7, 8], "dungeon-planner": [7, 8] });
  // Shared drops: never a boss's item; every source named.
  const shared = new Map(dungeon.dungeonLoot.map((entry) => [entry.itemId, entry]));
  assert.ok(!shared.has(1), "a boss's item is never also trash");
  assert.ok(!shared.has(7), "a boss's chest is not shared");
  assert.deepEqual(shared.get(6), { itemId: 6, npcId: null, sourceName: null, sources: [{ npcId: 700, name: "Trash Brute" }, { npcId: 701, name: "Trash Mage" }] });
  assert.deepEqual(shared.get(10), { itemId: 10, npcId: null, sourceName: "Old Crate", sources: [{ objectId: 9001, name: "Old Crate" }] });
  assert.deepEqual(referenceLootProblems(reference, ATLAS), []);
  assert.deepEqual(normalizeReferenceLoot({ atlas: ATLAS, loot: LOOT, items: ITEMS, planner: PLANNER, generatedAt: "x" }), reference, "deterministic");
  // Without DungeonPlanner: the emulator alone, as before.
  const alone = normalizeReferenceLoot({ atlas: ATLAS, loot: LOOT, items: ITEMS, generatedAt: "x" });
  assert.deepEqual(alone.dungeons[0].bosses.map((entry) => entry.encounterId), [1]);
  assert.deepEqual(alone.gaps, []);
});

test("invariants catch a boss item no source lists, or an unknown source", () => {
  const reference = normalizeReferenceLoot({ atlas: ATLAS, loot: LOOT, items: ITEMS, planner: PLANNER, generatedAt: "x" });
  const broken = structuredClone(reference);
  broken.dungeons[0].bosses[0].sources = { azerothcore: [1] };
  assert.match(referenceLootProblems(broken, ATLAS).join("\n"), /item 2 has no source/);
  broken.dungeons[0].bosses[0].sources = { azerothcore: [1, 2, 3], wowhead: [1] };
  assert.match(referenceLootProblems(broken, ATLAS).join("\n"), /source wowhead unknown/);
});

test("DungeonPlanner's extract: the atlas's classic instances and Forever's with a map ID, deterministic", () => {
  const dungeons = { "the-deadmines": { instanceMapID: 36 }, "hall-of-thanes": { instanceMapID: 3065, maps: [{ floor: 1, name: "The Hall of Thanes" }] },
    "wailing-caverns": { instanceMapID: 43 }, "hyjal-summit": { instanceMapID: null }, "custom-classic": { instanceMapID: 9999 } };
  const bosses = {
    "wailing-caverns": { origin: "classic", sources: [{ id: 1, name: "Wowhead Classic" }], bosses: [{ name: "Kresh", npcID: 3653, loot: [{ item: 13245, src: 1 }] }] },
    "the-deadmines": { origin: "classic", bosses: [{ name: "Edwin VanCleef", npcID: 639, loot: [{ item: 5191, src: 1, notable: true }, { item: 5191, src: 2 }, { item: 0 }] }] },
    "hall-of-thanes": { origin: "forever", bosses: [{ name: "New Boss", npcID: 1, loot: [{ item: 1, forever: true }] }],
      quests: [{ id: 98423, name: "A Quest", level: 15, req: 13, side: "alliance", giver: 5 }] },
    "hyjal-summit": { origin: "forever", bosses: [{ name: "Raid Boss", npcID: 2 }] },
    "custom-classic": { origin: "classic", bosses: [{ name: "Not In The Atlas", npcID: 3 }] },
  };
  const out = extractPlannerLoot({ dungeons, bosses });
  assert.deepEqual(out.creatures, [[36, 639, "Edwin VanCleef", "the-deadmines"], [43, 3653, "Kresh", "wailing-caverns"], [3065, 1, "New Boss", "hall-of-thanes"]],
    "no instance without a map ID, no classic instance the atlas does not cover");
  assert.deepEqual(out.loot, [[36, 639, 5191, 1, 1, 0], [43, 3653, 13245, 1, 0, 0], [3065, 1, 1, 0, 0, 1]], "one row per boss and item");
  assert.deepEqual(out.floors, [[3065, 1, "The Hall of Thanes"]]);
  assert.deepEqual(out.quests, [[3065, "hall-of-thanes", 98423, "A Quest", 15, 13, "a", 5]], "a spelled-out side read as its letter");
  assert.deepEqual(extractPlannerLoot({ dungeons, bosses }), out);
  assert.deepEqual(out.sourceNames, [[1, "Wowhead Classic"]]);
});

test("world drops: items a creature spawned outside the dungeons drops", () => {
  const world = worldDropItems({
    lootRows: [{ Entry: "1", Item: "10" }, { Entry: "1", Reference: "50" }, { Entry: "2", Item: "11" }],
    referenceRows: [{ Entry: "50", Item: "12" }],
    templateRows: [{ entry: "1", lootid: "1" }, { entry: "2", lootid: "2" }],
    spawnRows: [{ id1: "1", map: "0" }, { id1: "2", map: "36" }],
    itemIds: [10, 11, 12, 13],
  });
  assert.deepEqual(world, [10, 12], "the open-world creature's drops, through references too; the dungeon creature's are not");
});

test("the checked-in data: coverage, wings and served sources", () => {
  const atlas = loadAtlas().atlas;
  const reference = loadReferenceData();
  const report = coverageReport({ atlas, reference, loot: read("sources/azerothcore-loot.json"), manifest: read("wing-manifest.json") });
  const t = report.totals;
  assert.equal(t.dungeonsWithLoot, 26);
  assert.ok(t.bossesWithLoot >= 230, `bosses with loot: ${t.bossesWithLoot}`);
  assert.equal(t.raresWithLoot, t.rares);
  assert.equal(t.unattributedItems, 0, "every shared drop names its creatures or chests");
  assert.equal(t.itemsWithoutIcon, 0);
  assert.equal(t.itemsWithoutFacts, 0);
  // Naxxramas: the emulator's loot is the WotLK version; DungeonPlanner's is the Classic one.
  const naxx = reference.dungeons.find((dungeon) => dungeon.instanceId === 533);
  assert.equal(naxx.bosses.length, 15, "every Naxxramas boss has reference loot");
  assert.ok(naxx.bosses.every((boss) => boss.sources["dungeon-planner"]?.length && !boss.sources.azerothcore));
  // Encounters of several creatures, through DungeonPlanner's representative NPC.
  const depths = reference.dungeons.find((dungeon) => dungeon.instanceId === 230);
  for (const npcId of [9027, 9039]) assert.ok(depths.bosses.some((boss) => boss.npcId === npcId), `BRD encounter ${npcId}`);
  // The bosses still without reference loot, each with a reason.
  // (Original dungeons: WoW Forever's have no Classic item facts; their
  // listed drops are gaps, tested in dungeonForever.test.js.)
  const empty = report.dungeons.filter((dungeon) => dungeon.instanceId < 2000)
    .flatMap((dungeon) => dungeon.bosses.filter((boss) => !boss.items).map((boss) => `${dungeon.instanceId}:${boss.name}`)).sort();
  assert.deepEqual(empty, ["230:The Vault", "329:Ezra Grimm", "33:Rethilgore", "34:Bazil Thredd", "34:Dextren Ward", "34:Hamhock", "34:Targorr the Dread",
    "389:Bazzalan", "389:Oggleflint", "409:The Molten Core"], "the known gaps, and no new ones");
  for (const dungeon of report.dungeons) for (const boss of dungeon.bosses) if (!boss.items) assert.ok(boss.missing, `${boss.name} has a reason`);
  // Served: a boss's items carry who lists them; a shared drop all its sources.
  const detail = atlasDetail(189, []);
  const doan = detail.bosses.find((boss) => boss.atlasName === "Arcanist Doan");
  assert.ok(doan.referenceLoot.length && doan.referenceLoot.every((entry) => entry.referenceSources?.length), "sources on every boss item");
  assert.ok(doan.referenceLoot.every((entry) => entry.observed === false && entry.verifiedForForever === false), "never Forever evidence");
  assert.ok(detail.dungeonLoot.every((entry) => Array.isArray(entry.sources) && entry.sources.length), "shared drops name their sources");
});
