import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadAtlas, loadQuestCatalog } from "../src/Atlas/atlasData.js";
import { atlasDetail, atlasQuests } from "../src/Atlas/atlasRepository.js";
import { buildQuestCatalog, classRule, questCatalogProblems, raceRule } from "../src/Atlas/atlasQuests.js";
import { extractQuestSources } from "../src/Atlas/atlasQuestSources.js";
import { evaluateReadiness, questState, readCharacterState } from "../src/Atlas/atlasReadiness.js";
import { zonePoint, zoneRegions } from "../src/Atlas/atlasNormalize.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { connect } from "../testSupport/lootHarness.js";

// Dungeon quests: the catalog's relevance model, the readiness rules with
// their explicit character-state contract, and the API.

const DATA = new URL("../src/Atlas/data/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, DATA), "utf8"));
const state = (fields = {}) => readCharacterState({ schemaVersion: 1, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 30,
  completed: { coverage: "full", questIds: [] }, questLog: { coverage: "full", questIds: [] }, ...fields }).state;
const quest = (fields = {}) => ({ questId: 1, name: "Q", relevance: "dungeon", faction: "both", races: null, classes: null, minLevel: 10, maxLevel: null,
  repeatable: false, prerequisites: [], requiresReputation: null, wing: null, ...fields });

test("quest states: completed, accepted, available, prerequisites, ineligible, unknown", () => {
  assert.equal(questState(quest(), state({ completed: { coverage: "full", questIds: [1] } })).state, "completed");
  assert.equal(questState(quest(), state({ questLog: { coverage: "full", questIds: [1] } })).state, "accepted");
  assert.equal(questState(quest(), state()).state, "available");
  assert.deepEqual(questState(quest({ prerequisites: [{ questId: 7 }] }), state()), { state: "prerequisites", reasons: ["prerequisite:7"] });
  assert.equal(questState(quest({ prerequisites: [{ questId: 7 }] }), state({ completed: { coverage: "full", questIds: [7] } })).state, "available");
  assert.equal(questState(quest({ prerequisites: [{ questId: 7, mustBeActive: true }] }), state({ questLog: { coverage: "full", questIds: [7] } })).state, "available",
    "a prerequisite that must be in the log at the same time");
  assert.deepEqual(questState(quest({ faction: "horde" }), state()).reasons, ["faction"]);
  assert.deepEqual(questState(quest({ races: ["Dwarf"] }), state()).reasons, ["race"]);
  assert.deepEqual(questState(quest({ classes: ["PRIEST"] }), state()).reasons, ["class"]);
  assert.deepEqual(questState(quest({ minLevel: 40 }), state()).reasons, ["level-below-minimum"]);
  assert.deepEqual(questState(quest({ maxLevel: 20 }), state()).reasons, ["level-above-maximum"]);
});

test("missing data is unknown, never missing", () => {
  // No completion list: not done is not known.
  assert.equal(questState(quest(), state({ completed: { coverage: "none" } })).state, "unknown");
  assert.ok(questState(quest(), state({ completed: { coverage: "none" } })).reasons.includes("completion-not-reported"));
  // No quest-log scan: not taken is not known.
  assert.equal(questState(quest(), state({ questLog: { coverage: "none" } })).state, "unknown");
  // Checked list: only the checked ids are known.
  const checked = state({ completed: { coverage: "checked", questIds: [2], checkedQuestIds: [1, 2] } });
  assert.equal(questState(quest(), checked).state, "available", "checked and not completed");
  assert.equal(questState(quest({ questId: 3 }), checked).state, "unknown", "never checked");
  // Unreported eligibility facts.
  assert.equal(questState(quest({ faction: "alliance" }), state({ faction: null })).state, "unknown");
  assert.equal(questState(quest({ classes: ["WARRIOR"] }), state({ classToken: null })).state, "unknown");
  assert.equal(questState(quest(), state({ level: null })).state, "unknown");
  assert.ok(questState(quest({ requiresReputation: { factionId: 529, minValue: 3000 } }), state()).reasons.includes("reputation-not-reported"));
  // A prerequisite whose state is not reported.
  assert.equal(questState(quest({ prerequisites: [{ questId: 7 }] }), state({ completed: { coverage: "checked", questIds: [], checkedQuestIds: [1] } })).state, "unknown");
  // Repeatable: done before is no reason not to take it again.
  assert.equal(questState(quest({ repeatable: true }), state({ completed: { coverage: "full", questIds: [1] } })).state, "available");
});

test("readiness: ready, missing, blocked, unknown, none; optional never blocks", () => {
  const quests = [quest({ questId: 1 }), quest({ questId: 2, prerequisites: [{ questId: 9 }] }), quest({ questId: 3, relevance: "optional" }),
    quest({ questId: 4, relevance: "zone" }), quest({ questId: 5, faction: "horde" })];
  const done = (ids, log = []) => state({ completed: { coverage: "full", questIds: ids }, questLog: { coverage: "full", questIds: log } });
  assert.equal(evaluateReadiness(quests, done([1, 2])).readiness, "ready", "the horde quest does not apply; the optional one never blocks");
  assert.equal(evaluateReadiness(quests, done([9], [1, 2])).readiness, "ready", "accepted counts");
  assert.equal(evaluateReadiness(quests, done([9])).readiness, "missing");
  assert.equal(evaluateReadiness(quests, done([], [1])).readiness, "blocked", "the rest waits on quest 9");
  assert.equal(evaluateReadiness(quests, state({ completed: { coverage: "none" }, questLog: { coverage: "none" } })).readiness, "unknown");
  assert.equal(evaluateReadiness(quests, state({ completed: { coverage: "none" } })).readiness, "unknown", "no completion list: never ready");
  // A known missing quest is reported even when another is unknown.
  assert.equal(evaluateReadiness([quest({ questId: 1, classes: ["WARRIOR"] }), quest({ questId: 2, classes: ["MAGE"] })], state({ classToken: null })).readiness,
    "unknown", "every required quest unsettled: never ready");
  assert.equal(evaluateReadiness([quest({ questId: 1, classes: null }), quest({ questId: 2, faction: "alliance" })], state({ faction: null })).readiness, "missing");
  assert.equal(evaluateReadiness([quest({ relevance: "optional" })], done([])).readiness, "none");
  const result = evaluateReadiness(quests, done([9]));
  assert.deepEqual(result.optional.map((entry) => entry.questId), [3]);
  assert.ok(!JSON.stringify(result).includes('"questId":4'), "zone quests are left out");
  // A wing leaves out a sibling wing's quests.
  const wings = [quest({ questId: 1, wing: "x:a" }), quest({ questId: 2, wing: "x:b" }), quest({ questId: 3 })];
  assert.deepEqual(evaluateReadiness(wings, done([]), { wingKey: "x:a" }).quests.map((entry) => entry.questId), [1, 3]);
});

test("the character state contract is checked", () => {
  assert.deepEqual(readCharacterState({ schemaVersion: 2 }).problems, ["schemaVersion must be 1"]);
  assert.ok(readCharacterState({ schemaVersion: 1, faction: "neutral" }).problems.includes("faction must be alliance, horde or null"));
  assert.ok(readCharacterState({ schemaVersion: 1, completed: { coverage: "most" } }).problems.some((line) => line.startsWith("completed.coverage")));
  assert.ok(readCharacterState({ schemaVersion: 1, questLog: { coverage: "checked" } }).problems.some((line) => line.startsWith("questLog.coverage")),
    "a quest log is scanned whole or not at all");
  const { state: parsed } = readCharacterState({ schemaVersion: 1, completed: { coverage: "full", questIds: [1, -2, "x", 3] } });
  assert.deepEqual([...parsed.completed.questIds], [1, 3], "only quest ids");
  assert.equal(parsed.questLog.coverage, "none", "absent: nothing known");
});

test("races and classes: only what the masks say", () => {
  assert.deepEqual(raceRule(0), { faction: "both", races: null });
  assert.deepEqual(raceRule(77), { faction: "alliance", races: null }, "every Alliance race");
  assert.deepEqual(raceRule(1101), { faction: "alliance", races: null }, "with Draenei (3.3.5 masks)");
  assert.deepEqual(raceRule(178), { faction: "horde", races: null });
  assert.deepEqual(raceRule(4), { faction: "alliance", races: ["Dwarf"] });
  assert.equal(classRule(0), null);
  assert.deepEqual(classRule(16 | 128), ["PRIEST", "MAGE"]);
});

test("the source extract: evidence inside an instance, chains and breadcrumbs", () => {
  const row = (id, fields = {}) => ({ ID: String(id), LogTitle: `Quest ${id}`, QuestLevel: "20", MinLevel: "15", QuestSortID: "0", AllowableRaces: "0",
    Flags: "0", StartItem: "0", LogDescription: "Do it.", ...fields });
  const out = extractQuestSources({
    questRows: [row(1, { RequiredNpcOrGo1: "100" }), row(2), row(3, { RequiredItemId1: "500" }), row(4, { RequiredNpcOrGo1: "200" }), row(5, { QuestSortID: "1581" }),
      row(6), row(9999, { RequiredNpcOrGo1: "100" }), row(7, { LogTitle: "<UNUSED> old", RequiredNpcOrGo1: "100" })],
    addonRows: [{ ID: "1", PrevQuestID: "2" }, { ID: "6", BreadcrumbForQuestId: "1" }],
    starterRows: [{ id: "300", quest: "1" }],
    templateRows: [{ entry: "100", name: "Boss" }, { entry: "200", name: "Wolf" }, { entry: "101", name: "Mob", lootid: "101" }, { entry: "300", name: "Giver" }],
    spawnRows: [{ id1: "100", map: "36", position_x: "1", position_y: "1" }, { id1: "200", map: "36" }, { id1: "200", map: "0" },
      { id1: "101", map: "36" }, { id1: "300", map: "0", position_x: "10", position_y: "20" }],
    lootRows: [{ Entry: "101", Item: "500", QuestRequired: "1" }],
    areaToInstance: new Map([[1581, 36]]),
  });
  const byId = new Map(out.quests.map((entry) => [entry.id, entry]));
  assert.deepEqual(byId.get(1).evidence, [[36, "npc", 100]], "a creature that lives only in the dungeon");
  assert.ok(byId.has(2), "its prerequisite");
  assert.deepEqual(byId.get(3).evidence, [[36, "item", 500]], "an item a dungeon creature drops for it");
  assert.ok(!byId.has(4), "a creature that also lives outside proves nothing");
  assert.ok(byId.has(5) && !byId.get(5).evidence.length, "the zone rule");
  assert.ok(byId.has(6), "a breadcrumb to a kept quest");
  assert.ok(!byId.has(9999) && !byId.has(7), "no later-expansion or placeholder quests");
  assert.deepEqual(out.givers, [["npc", 300, "Giver", 0, 10, 20]]);
});

test("the checked-in catalog: current, relevant, no silent truncation", () => {
  const { atlas } = loadAtlas();
  const { catalog } = loadQuestCatalog();
  assert.deepEqual(questCatalogProblems(catalog, atlas), []);
  const wago = read("sources/wago-classic-era.json");
  const zones = zoneRegions(wago.tables);
  const rebuilt = buildQuestCatalog({ atlas, quests: read("sources/azerothcore-quests.json"), planner: read("sources/dungeonplanner-loot.json"),
    areaToInstance: new Map(wago.tables.AreaTable.map((row) => [Number(row.ID), Number(row.ContinentID)])),
    zonePointOf: (continentId, x, y) => zonePoint(zones, continentId, x, y), generatedAt: catalog.generatedAt });
  assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), catalog, "run node scripts/importDungeonAtlas.mjs");
  assert.equal(catalog.dungeons.length, atlas.dungeons.length, "every dungeon and raid has a list");
  const by = (id) => catalog.dungeons.find((dungeon) => dungeon.instanceId === id);
  const count = (id, relevance) => by(id).quests.filter((entry) => entry.relevance === relevance).length;
  // Dungeons the old zone rule missed entirely.
  for (const id of [47, 70, 90, 209, 229, 230]) assert.ok(count(id, "dungeon") >= 6, `instance ${id} has its dungeon quests`);
  // The raids' turn-ins and zone quests: hidden by default, never dropped.
  assert.ok(count(533, "zone") >= 80, "Naxxramas' armour turn-ins kept as zone quests");
  assert.ok(count(531, "zone") + count(531, "optional") + count(531, "repeatable") >= 79, "every Ahn'Qiraj Temple quest is kept");
  // Every quest the old atlas listed is still in the catalog.
  for (const dungeon of atlas.dungeons) {
    const ids = new Set(by(dungeon.instanceId).quests.map((entry) => entry.questId));
    for (const old of dungeon.quests) assert.ok(ids.has(old.questId), `${dungeon.name}: quest ${old.questId} kept`);
  }
  // Deadmines: the Defias Brotherhood chain, every link a prerequisite.
  const deadmines = by(36).quests;
  const chain = [];
  let link = deadmines.find((entry) => entry.questId === 166);
  while (link) {
    chain.push(link.questId);
    link = link.prerequisites[0] && deadmines.find((entry) => entry.questId === link.prerequisites[0].questId);
  }
  assert.deepEqual(chain, [166, 155, 142, 141, 135, 132, 65]);
  assert.ok(deadmines.filter((entry) => chain.slice(1).includes(entry.questId)).every((entry) => entry.relevance === "prerequisite"));
  assert.equal(deadmines.find((entry) => entry.questId === 166).faction, "alliance");
  // Wings: a quest names a wing only when its evidence is that wing's.
  for (const id of [189, 429, 329, 229]) {
    for (const entry of by(id).quests) if (entry.wing) assert.ok(entry.wing.startsWith(`${atlasDetail(id).dungeonKey}:`));
  }
});

test("the API: catalog by id or wing key, readiness from a posted state", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-quests-ash", username: "ash" });
  const get = (path) => request(`/api/player/loot/dungeons/${path}`, { rawCookie: ash.cookie });
  const catalog = (await get("36/quests")).json;
  assert.equal(catalog.dungeon.dungeonKey, "deadmines");
  assert.ok(catalog.quests.some((entry) => entry.questId === 166 && entry.relevance === "dungeon" && entry.verifiedForForever === false));
  assert.ok(catalog.quests.every((entry) => entry.relevance !== "zone"));
  const naxx = (await get("533/quests")).json;
  assert.ok(naxx.hiddenZoneQuests >= 80);
  assert.ok((await get("533/quests?include=all")).json.quests.length > naxx.quests.length, "?include=all shows them");
  const library = (await get(encodeURIComponent("scarlet-monastery:library") + "/quests")).json;
  assert.equal(library.dungeon.wing, "Library");
  assert.equal((await get("not-a-dungeon/quests")).status, 404);
  // The existing detail is unchanged.
  assert.ok(Array.isArray((await get("36")).json.atlas.quests));

  const post = (path, body) => request(`/api/player/loot/dungeons/${path}/readiness`, { method: "POST", rawCookie: ash.cookie, body });
  const ready = await post("36", { state: { schemaVersion: 1, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 22,
    completed: { coverage: "full", questIds: [65, 132, 135, 141, 142, 155, 166, 167, 168, 214, 2040] }, questLog: { coverage: "full", questIds: [] } } });
  assert.equal(ready.status, 200, ready.text);
  assert.equal(ready.json.readiness, "ready");
  const unknown = await post("36", { state: { schemaVersion: 1, faction: "alliance", level: 22 } });
  assert.equal(unknown.json.readiness, "unknown", "no quest data: unknown, never missing");
  const invalid = await post("36", { state: { schemaVersion: 9 } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error, "invalid_quest_state");
  assert.equal((await post("not-a-dungeon", { state: { schemaVersion: 1 } })).status, 404);
}));
