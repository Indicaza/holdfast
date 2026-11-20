import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { loadAtlas, loadQuestCatalog } from "../src/Atlas/atlasData.js";
import { buildQuestPlan, readEditorialQuestPlan } from "../src/Atlas/atlasQuestPlan.js";
import { atlasQuestPlanFromState, loadEditorialQuestPlan } from "../src/Atlas/atlasQuestPlanRepository.js";
import { readCharacterState } from "../src/Atlas/atlasReadiness.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { BUILD, connect, post } from "../testSupport/lootHarness.js";

// The dungeon quest preparation planner (docs/dungeon-quest-planner.md).
// Real catalog data (backend/src/Atlas/data/quest-catalog.json) where the
// case exists in it: The Deadmines (36, the Defias chain 65 → 132 → 135 →
// 141 → 142 → 155, shared by 166 and 214), Uldaman (70, nested chains,
// optional and repeatable quests, follow-ups), Blackrock Spire's wings
// (229) and The Hall of Thanes (3065, a Forever dungeon whose chains and
// giver locations are not known). Cases the catalog does not have (cycles,
// duplicates, bad coordinates) use SYNTHETIC quests, named as such.

const editorialFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/editorial-quest-plan.deadmines.json", import.meta.url), "utf8"));

const DEFIAS_CHAIN = [65, 132, 135, 141, 142, 155];

function stateOf(overrides = {}) {
  const { state, problems } = readCharacterState({ schemaVersion: 1, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 20,
    completed: { coverage: "full", questIds: [] }, questLog: { coverage: "full", questIds: [] }, ...overrides });
  assert.deepEqual(problems, []);
  return state;
}

function dungeonOf(instanceId) {
  const dungeon = loadAtlas().byId.get(instanceId);
  return { instanceId, dungeonKey: String(instanceId), name: dungeon.name, zoneName: dungeon.zoneName, entrance: dungeon.entrance };
}

function planFor(instanceId, options = {}) {
  return buildQuestPlan({ dungeon: dungeonOf(instanceId), quests: loadQuestCatalog().byId.get(instanceId).quests, ...options });
}

const section = (plan, key) => plan.sections.find((entry) => entry.key === key).steps;
const ids = (steps) => steps.map((entry) => entry.id);
const stepOf = (plan, id) => {
  const walk = (steps) => {
    for (const entry of steps) {
      if (entry.id === id) return entry;
      const found = walk(entry.children);
      if (found) return found;
    }
    return null;
  };
  for (const part of plan.sections) {
    const found = walk(part.steps);
    if (found) return found;
  }
  return null;
};
const waypointOf = (plan, id) => plan.waypoints.find((entry) => entry.id === id);

// SYNTHETIC catalog quests for the cases the real catalog does not have.
function synthetic(questId, fields = {}) {
  return { questId, name: `Synthetic ${questId}`, relevance: "dungeon", level: 20, minLevel: 10, maxLevel: null, faction: "alliance", races: null,
    classes: null, repeatable: false, shareable: "unknown", prerequisites: [], prerequisitesKnown: true, requiresReputation: null, startsFromItem: null,
    giver: { kind: "npc", id: questId, name: `Giver ${questId}`, location: { zoneName: "Westfall", mapId: 1436, x: 0.5, y: 0.5 } }, wing: null, ...fields };
}
const SYNTHETIC_DUNGEON = { instanceId: 900001, dungeonKey: "synthetic", name: "Synthetic Dungeon", zoneName: "Westfall", entrance: { mapId: 1436, x: 0.4, y: 0.7 } };

test("a quest without prerequisites: travel to its giver, accept it", () => {
  const plan = planFor(36, { state: stateOf() });
  const quest = stepOf(plan, "collect:q168");
  assert.equal(quest.kind, "quest");
  assert.equal(quest.status, "todo");
  assert.deepEqual(ids(quest.children), ["collect:q168:travel", "collect:q168:accept"]);
  const waypoint = waypointOf(plan, quest.children[0].waypoint);
  assert.deepEqual(waypoint, { id: "wp:giver:168", mapSystem: "uiMap", mapId: 1453, x: 0.6544, y: 0.2121, zoneName: "Stormwind City",
    target: "Wilder Thistlenettle", targetType: "quest-giver", source: "catalog", verified: false });
  assert.equal(plan.next, "collect:q168:travel", "the first thing to do");
  // 167 has the same giver at the same spot: no second trip.
  assert.deepEqual(ids(stepOf(plan, "collect:q167").children), ["collect:q167:accept"]);
});

test("a chain: prerequisites first, in order, a shared prerequisite once", () => {
  const plan = planFor(36, { state: stateOf() });
  const order = ids(section(plan, "collect")).map((id) => Number(id.slice("collect:q".length)));
  for (let index = 1; index < DEFIAS_CHAIN.length; index += 1) {
    assert.ok(order.indexOf(DEFIAS_CHAIN[index - 1]) < order.indexOf(DEFIAS_CHAIN[index]), `${DEFIAS_CHAIN[index - 1]} before ${DEFIAS_CHAIN[index]}`);
  }
  assert.ok(order.indexOf(155) < order.indexOf(166) && order.indexOf(155) < order.indexOf(214), "155 before both quests that need it");
  assert.equal(order.filter((id) => id === 155).length, 1, "the shared prerequisite appears once");
  assert.equal(stepOf(plan, "collect:q65").status, "todo");
  assert.equal(stepOf(plan, "collect:q132").status, "blocked");
  assert.equal(stepOf(plan, "collect:q65").kind, "prerequisite");
  assert.deepEqual(ids(stepOf(plan, "collect:q65").children), ["collect:q65:travel", "collect:q65:accept", "collect:q65:complete"]);
  assert.equal(waypointOf(plan, "wp:giver:65").targetType, "prerequisite-giver");
  // The zone of the step before is kept: the three Stormwind quests together.
  assert.deepEqual(order.slice(0, 3), [168, 167, 2040]);
  assert.equal(plan.readiness.readiness, "missing");
});

test("nested chains (Uldaman): every link before the quest that needs it", () => {
  const plan = planFor(70, { state: stateOf({ level: 42 }) });
  const order = ids(section(plan, "collect")).map((id) => Number(id.slice("collect:q".length)));
  // 704 needs 739, which needs 738, which needs 707.
  for (const [before, after] of [[707, 738], [738, 739], [739, 704], [720, 721], [2500, 17]]) {
    assert.ok(order.includes(before) && order.indexOf(before) < order.indexOf(after), `${before} before ${after}`);
  }
  assert.equal(new Set(order).size, order.length, "each quest once");
  assert.deepEqual(plan.problems, [{ code: "prerequisite-not-in-catalog", questId: 2745, prerequisiteId: 350 }], "the catalog's one broken chain here");
});

test("completed prerequisites collapse; accepted quests are collected", () => {
  const plan = planFor(36, { state: stateOf({ completed: { coverage: "full", questIds: DEFIAS_CHAIN }, questLog: { coverage: "full", questIds: [168] } }) });
  const collect = section(plan, "collect");
  assert.ok(!collect.some((entry) => DEFIAS_CHAIN.includes(entry.questId)), "a done chain is not listed");
  assert.equal(stepOf(plan, "collect:q166").status, "todo");
  const held = stepOf(plan, "collect:q168");
  assert.equal(held.status, "done");
  assert.equal(held.collapsed, true);
  assert.deepEqual(held.children, []);

  const ready = planFor(36, { state: stateOf({ completed: { coverage: "full", questIds: [...DEFIAS_CHAIN, 166, 167] },
    questLog: { coverage: "full", questIds: [168, 214, 2040] } }) });
  assert.equal(ready.readiness.readiness, "ready");
  assert.equal(stepOf(ready, "enter:verify").status, "done");
  assert.equal(stepOf(ready, "enter:enter").status, "todo");
  assert.equal(ready.next, "enter:travel", "go in");
  assert.equal(waypointOf(ready, "wp:entrance").mapId, 1436);
  assert.equal(waypointOf(ready, "wp:entrance").source, "atlas");
});

test("accepted but unfinished: finish it, then turn it in; turn-ins after the run", () => {
  const questLog = { entries: [{ questId: 142, isComplete: false }, { questId: 2040, isComplete: true }, { questId: 167, isComplete: false }, { questId: 168 }] };
  const plan = planFor(36, { questLog, state: stateOf({ completed: { coverage: "full", questIds: [65, 132, 135, 141] },
    questLog: { coverage: "full", questIds: [142, 2040, 167, 168] } }) });
  const pending = stepOf(plan, "collect:q142");
  assert.equal(pending.status, "todo", "a prerequisite in the log is still to finish");
  assert.deepEqual(ids(pending.children), ["collect:q142:complete"]);
  assert.equal(pending.children[0].objectivesComplete, false);
  assert.equal(stepOf(plan, "collect:q155").status, "blocked");

  const turnIn = section(plan, "turnIn");
  const handIn = turnIn.find((entry) => entry.questId === 2040);
  assert.equal(handIn.kind, "turn-in");
  assert.equal(handIn.status, "todo");
  assert.equal(handIn.waypoint, null, "no source gives where a quest is turned in");
  assert.equal(handIn.location, "not-in-our-data");
  assert.equal(turnIn.find((entry) => entry.questId === 167).kind, "finish-objectives");
  const unread = turnIn.find((entry) => entry.questId === 168);
  assert.equal(unread.status, "unknown", "the log did not say");
  assert.equal(unread.objectivesComplete, null);
  assert.ok(!turnIn.some((entry) => entry.questId === 142), "a prerequisite in the log is finished in collect");
  assert.equal(plan.next, "collect:q142:complete");
});

test("follow-up quests a dungeon quest unlocks are listed after the run", () => {
  const plan = planFor(70, { state: stateOf({ level: 42, questLog: { coverage: "full", questIds: [2198] } }), questLog: { entries: [{ questId: 2198, isComplete: true }] } });
  const followUp = section(plan, "turnIn").find((entry) => entry.questId === 2199);
  assert.equal(followUp.kind, "follow-up");
  assert.equal(followUp.status, "blocked");
  assert.ok(!section(plan, "collect").some((entry) => entry.questId === 2199), "not something to collect before going in");
  assert.ok(section(plan, "turnIn").some((entry) => entry.id === "turnin:q2198"));
  // 1139 waits on 722, itself a dungeon quest: after the dungeon.
  assert.ok(section(plan, "turnIn").some((entry) => entry.id === "followup:q1139"));
});

test("unknown state: nothing is claimed, nothing is next; Forever chains stay unknown", () => {
  const plan = planFor(36, {});
  assert.ok(section(plan, "collect").every((entry) => entry.status === "unknown"));
  assert.equal(plan.readiness.readiness, "unknown");
  assert.equal(stepOf(plan, "enter:enter").status, "unknown");
  assert.equal(plan.next, null);
  assert.deepEqual(section(plan, "share"), [], "nothing is known to be shareable now");

  const thanes = planFor(3065, { state: stateOf({ level: 30 }) });
  const quests = section(thanes, "collect");
  assert.equal(quests.length, 5);
  for (const entry of quests) {
    assert.equal(entry.status, "unknown");
    assert.ok(entry.reasons.includes("prerequisites-not-known"));
  }
  assert.equal(stepOf(thanes, "collect:q98423:travel").location, "not-in-our-data");
  assert.equal(thanes.readiness.readiness, "unknown", "never ready on an unknown chain");
});

test("missing or invalid coordinates never make a waypoint", () => {
  const uldaman = planFor(70, { state: stateOf({ level: 42 }) });
  const travel = stepOf(uldaman, "collect:q2278:travel");
  assert.equal(travel.waypoint, null, "the catalog has no spawn for its giver");
  assert.equal(travel.location, "not-in-our-data");
  // SYNTHETIC: coordinates outside 0-1 and a giver without a map.
  const plan = buildQuestPlan({ dungeon: SYNTHETIC_DUNGEON, state: stateOf(), quests: [
    synthetic(1, { giver: { kind: "npc", id: 1, name: "Far Away", location: { zoneName: "Westfall", mapId: 1436, x: 1.5, y: 0.2 } } }),
    synthetic(2, { giver: { kind: "npc", id: 2, name: "No Map", location: { zoneName: "Westfall", mapId: null, x: 0.2, y: 0.2 } } }),
  ] });
  assert.equal(stepOf(plan, "collect:q1:travel").waypoint, null);
  assert.equal(stepOf(plan, "collect:q2:travel").waypoint, null);
  assert.deepEqual(plan.waypoints.map((entry) => entry.id), ["wp:entrance"]);
});

test("faction, class and level rules leave quests out", () => {
  const horde = planFor(36, { state: stateOf({ faction: "horde", race: "Orc" }) });
  assert.deepEqual(section(horde, "collect"), [], "every Deadmines quest is Alliance");
  assert.equal(stepOf(horde, "enter:verify").status, "done");
  assert.ok(horde.hidden.ineligible > 0);
  const young = planFor(36, { state: stateOf({ level: 5 }) });
  assert.deepEqual(section(young, "collect"), []);
  // SYNTHETIC: a class quest.
  const quests = [synthetic(1, { classes: ["MAGE"] }), synthetic(2)];
  assert.deepEqual(ids(section(buildQuestPlan({ dungeon: SYNTHETIC_DUNGEON, quests, state: stateOf() }), "collect")), ["collect:q2"]);
  assert.deepEqual(ids(section(buildQuestPlan({ dungeon: SYNTHETIC_DUNGEON, quests, state: stateOf({ classToken: "MAGE" }) }), "collect")), ["collect:q1", "collect:q2"]);
});

test("share: only shareable quests that can be taken now; travel is the fallback", () => {
  const plan = planFor(36, { state: stateOf(), party: { size: 3 } });
  const share = section(plan, "share");
  assert.deepEqual(ids(share), ["share:q168", "share:q167", "share:q2040", "share:q65"]);
  assert.deepEqual(share[0].children.map((entry) => [entry.kind, entry.optional === true]), [["ask-share", false], ["travel", true]]);
  assert.match(share[0].children[0].text, /Ask your group/);
  // SYNTHETIC: not shareable, and shareable but blocked.
  const quests = [synthetic(1, { shareable: "no" }), synthetic(2, { shareable: "yes", prerequisites: [{ questId: 3 }] }), synthetic(3, { relevance: "prerequisite", shareable: "unknown" })];
  assert.deepEqual(section(buildQuestPlan({ dungeon: SYNTHETIC_DUNGEON, quests, state: stateOf() }), "share"), []);
});

test("optional and repeatable quests are their own sections", () => {
  const plan = planFor(70, { state: stateOf({ level: 42 }) });
  assert.ok(section(plan, "optional").length > 0);
  assert.ok(section(plan, "optional").every((entry) => entry.kind === "optional" && entry.id.startsWith("optional:q")));
  assert.ok(section(plan, "repeatable").every((entry) => entry.kind === "repeatable"));
  assert.ok(section(plan, "repeatable").some((entry) => entry.questId === 9259));
  assert.ok(!section(plan, "collect").some((entry) => entry.questId === 9259));
});

test("cycles, broken chains and duplicates are problems, never a crash", () => {
  // SYNTHETIC: 1 needs 2, 2 needs 1; 3 needs 1; 4 needs a quest not in the catalog; 5 is listed twice.
  const quests = [synthetic(1, { prerequisites: [{ questId: 2 }] }), synthetic(2, { relevance: "prerequisite", prerequisites: [{ questId: 1 }] }),
    synthetic(3, { prerequisites: [{ questId: 1 }] }), synthetic(4, { prerequisites: [{ questId: 777 }] }), synthetic(5), synthetic(5, { name: "Second copy" })];
  const plan = buildQuestPlan({ dungeon: SYNTHETIC_DUNGEON, quests, state: stateOf() });
  assert.deepEqual(plan.problems, [
    { code: "duplicate-quest", questId: 5 },
    { code: "prerequisite-not-in-catalog", questId: 4, prerequisiteId: 777 },
    { code: "prerequisite-cycle", questIds: [1, 2] },
  ]);
  assert.deepEqual(ids(section(plan, "unknown")), ["unknown:q1", "unknown:q2"]);
  assert.deepEqual(section(plan, "unknown")[0].reasons, ["prerequisite-cycle"]);
  assert.equal(stepOf(plan, "collect:q3").status, "blocked", "waits on a quest in a cycle");
  const broken = stepOf(plan, "collect:q4");
  assert.equal(broken.status, "blocked");
  assert.equal(broken.children[0].kind, "complete-prerequisite");
  assert.equal(broken.children[0].questId, 777);
  assert.equal(stepOf(plan, "collect:q5").text, "Get Synthetic 5", "the first copy is kept");
});

test("wings: Lower and Upper Blackrock Spire each plan their own quests", () => {
  const state = stateOf({ level: 58 });
  const quests = loadQuestCatalog().byId.get(229).quests;
  const lower = buildQuestPlan({ dungeon: dungeonOf(229), quests, state, wingKey: "blackrock-spire:lower" });
  const upper = buildQuestPlan({ dungeon: dungeonOf(229), quests, state, wingKey: "blackrock-spire:upper" });
  const planned = (plan) => new Set(plan.sections.flatMap((part) => part.steps.map((entry) => entry.questId)));
  assert.ok(planned(lower).has(4701) && !planned(lower).has(5102), "Lower Spire");
  assert.ok(planned(upper).has(5102) && !planned(upper).has(4701), "Upper Spire");
  assert.equal(lower.dungeon.wingKey, "blackrock-spire:lower");
});

test("deterministic: the same input is the same plan, byte for byte", () => {
  const options = { state: stateOf({ level: 42, completed: { coverage: "full", questIds: [707] } }), questLog: { entries: [] } };
  const first = JSON.stringify(planFor(70, options));
  assert.equal(JSON.stringify(planFor(70, options)), first);
  const reversed = [...loadQuestCatalog().byId.get(70).quests].reverse();
  assert.equal(JSON.stringify(buildQuestPlan({ dungeon: dungeonOf(70), quests: reversed, ...options })), first, "catalog order does not matter");
});

test("editorial data (SYNTHETIC fixture) overrides the catalog and is marked", () => {
  const state = stateOf({ completed: { coverage: "full", questIds: DEFIAS_CHAIN }, questLog: { coverage: "full", questIds: [166] } });
  const plan = planFor(36, { state, editorial: editorialFixture, questLog: { entries: [{ questId: 166, isComplete: true }] } });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.editorial, { used: true, revision: null });
  const handIn = section(plan, "turnIn").find((entry) => entry.questId === 166);
  assert.equal(handIn.waypoint, "wp:turnin:166");
  assert.deepEqual(waypointOf(plan, "wp:turnin:166"), { id: "wp:turnin:166", mapSystem: "uiMap", mapId: 1436, x: 0.5633, y: 0.4752, zoneName: "Westfall",
    target: "Gryan Stoutmantle", targetType: "turn-in", source: "editorial", verified: false });
  assert.equal(plan.sections.find((entry) => entry.key === "enter").notes[0].text, "Synthetic: gather the group at the entrance.");
  // 214: editorial says shareable; its step carries the editorial source.
  const fresh = planFor(36, { state: stateOf({ completed: { coverage: "full", questIds: DEFIAS_CHAIN } }), editorial: editorialFixture });
  assert.ok(section(fresh, "share").some((entry) => entry.questId === 214));
  assert.equal(stepOf(fresh, "collect:q214").source, "editorial");
  assert.equal(stepOf(fresh, "collect:q214").verified, false);
  assert.ok(!section(fresh, "share").some((entry) => entry.questId === 166), "editorial says 166 cannot be shared");
  assert.equal(stepOf(fresh, "collect:q166:note1").text, "Synthetic step: bring the head back.");
  // Editorial prerequisites replace the chain and make it known.
  const chained = planFor(3065, { state: stateOf({ level: 30 }), editorial: { schemaVersion: 1, instanceId: 3065, quests: [{ questId: 96394, prerequisites: [96393] }] } });
  // 96393 is itself a dungeon quest: 96394 can only be had after a run.
  const followUp = section(chained, "turnIn").find((entry) => entry.questId === 96394);
  assert.equal(followUp.kind, "follow-up");
  assert.equal(followUp.status, "blocked");
  assert.ok(!section(chained, "collect").some((entry) => entry.questId === 96394));
  assert.equal(stepOf(chained, "collect:q96393").source, "catalog");
});

test("editorial validation: wrong schema or dungeon is ignored; bad parts are dropped and named", () => {
  assert.deepEqual(readEditorialQuestPlan({ schemaVersion: 2, instanceId: 36 }, 36).problems.map((entry) => entry.code), ["editorial-schema"]);
  assert.equal(readEditorialQuestPlan({ schemaVersion: 1, instanceId: 48 }, 36).editorial, null);
  const { editorial, problems } = readEditorialQuestPlan({ schemaVersion: 1, instanceId: 36,
    entrance: { mapId: 1436, x: 2, y: 0.5 },
    instructions: [{ section: "nowhere", text: "x" }],
    quests: [{ questId: 166, shareable: "maybe", turnIn: { name: "Someone", location: { mapId: 0, x: 0.1, y: 0.1 } } }, { questId: 166 }, { questId: -1 }] }, 36);
  assert.equal(editorial.entrance, null);
  assert.deepEqual(problems.map((entry) => entry.code), ["editorial-location-dropped", "editorial-instruction-dropped", "editorial-invalid-field",
    "editorial-location-dropped", "editorial-duplicate-quest", "editorial-quest-dropped"]);
  assert.deepEqual(editorial.quests.get(166).turnIn, { name: "Someone", location: null });
  const plan = planFor(36, { state: stateOf(), editorial: { schemaVersion: 1, instanceId: 36, quests: [{ questId: 424242 }] } });
  assert.deepEqual(plan.problems, [{ code: "editorial-quest-not-in-catalog", questId: 424242 }]);
  assert.equal(loadEditorialQuestPlan(36), null, "no published editorial data yet (CMS hook)");
});

test("POST /plan: from a sent state, checked like readiness", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-plan-ash", username: "ash" });
  const send = (dungeon, body) => request(`/api/player/loot/dungeons/${encodeURIComponent(dungeon)}/plan`, { method: "POST", rawCookie: ash.cookie, body });
  const state = { schemaVersion: 1, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 20,
    completed: { coverage: "full", questIds: [] }, questLog: { coverage: "full", entries: [{ questId: 168, isComplete: false }] } };
  const ok = await send(36, { state, party: { size: 2 } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.dungeon.instanceId, 36);
  assert.equal(ok.json.sections.find((entry) => entry.key === "turnIn").steps[0].kind, "finish-objectives");
  assert.deepEqual(ok.json, atlasQuestPlanFromState("36", { state, party: { size: 2 } }).result);
  assert.equal((await send(36, { state: { schemaVersion: 2 } })).status, 400);
  assert.equal((await send(36, { state, editorial: "text" })).status, 400);
  assert.equal((await send(99999, { state })).status, 404);
  const wing = await send("blackrock-spire:upper", { state });
  assert.equal(wing.status, 200);
  assert.equal(wing.json.dungeon.dungeonKey, "blackrock-spire:upper");
  const preview = await send(36, { state, editorial: editorialFixture });
  assert.equal(preview.json.editorial.used, true);
}));

// Realm isolation: the add-on keys a character by realm and name, so the same
// name on two realms is two characters with their own quest state and plan.
let key = 0;
function telemetry(request, token, envelope, streamKey) {
  key += 1;
  return post(request, token, { streamKey, kind: "state", revision: 1000 + key, envelope: { schemaVersion: 1, gameBuild: BUILD, region: "US",
    installationId: "install-plan", payloadSchemaVersion: 1, ...envelope } });
}
async function syncOn(request, token, characterId, realm) {
  const response = await telemetry(request, token, { eventType: "character", capturedAt: 1791761000 + key, characterId, realm,
    payload: { schemaVersion: 1, name: "Rook", realm, region: "US", level: 20, class: { id: 1, name: "Warrior", token: "WARRIOR" }, race: { id: 1, name: "Human", token: "Human" } } },
    `character:${characterId}`);
  assert.equal(response.status, 201, response.text);
  return response.json.characterId;
}
function questStateOn(request, token, characterId, realm, completed) {
  return telemetry(request, token, { eventType: "quest_state", capturedAt: 1791800000 + key, characterId, realm,
    payload: { schemaVersion: 1, capturedAt: 1791800000 + key, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 20,
      completed: { coverage: "full", questIds: completed }, questLog: { coverage: "full", entries: [] } } }, `quest_state:${characterId}`);
}

test("GET /plan: each realm's character has its own plan; others' answer 404", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-plan-realm-ash", username: "ash" });
  const bram = await connect(request, { id: "discord-plan-realm-bram", username: "bram" });
  const rp = await syncOn(request, ash.token, "character-rook-rp", "Forever RP-PvP");
  const pvp = await syncOn(request, ash.token, "character-rook-pvp", "Forever PvP");
  assert.notEqual(rp, pvp, "two characters named Rook");
  const read = (cookie, dungeon, character) => request(`/api/player/loot/dungeons/${encodeURIComponent(dungeon)}/plan?character=${encodeURIComponent(character)}`, { rawCookie: cookie });

  const before = (await read(ash.cookie, 36, rp)).json;
  assert.equal(before.character, null, "nothing synced yet");
  assert.equal(before.next, null);

  assert.equal((await questStateOn(request, ash.token, "character-rook-rp", "Forever RP-PvP", DEFIAS_CHAIN)).status, 201);
  assert.equal((await questStateOn(request, ash.token, "character-rook-pvp", "Forever PvP", [])).status, 201);
  const rpPlan = (await read(ash.cookie, 36, rp)).json;
  const pvpPlan = (await read(ash.cookie, 36, pvp)).json;
  assert.equal(rpPlan.characterId, rp);
  assert.equal(pvpPlan.characterId, pvp);
  assert.ok(!section(rpPlan, "collect").some((entry) => entry.questId === 65), "the RP-PvP Rook finished the chain");
  assert.equal(stepOf(pvpPlan, "collect:q65").status, "todo", "the PvP Rook has not");
  assert.notDeepEqual(ids(section(rpPlan, "collect")), ids(section(pvpPlan, "collect")));

  assert.equal((await read(bram.cookie, 36, rp)).status, 404, "another account's character");
  assert.equal((await read(ash.cookie, 36, "no-such-character")).status, 404);
  assert.equal((await request(`/api/player/loot/dungeons/36/plan?character=${rp}`)).status, 401);
  assert.equal((await read(ash.cookie, 99999, rp)).status, 404);
  assert.equal((await read(ash.cookie, "blackrock-spire:lower", rp)).json.dungeon.dungeonKey, "blackrock-spire:lower");
}));
