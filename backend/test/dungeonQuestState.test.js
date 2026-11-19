import assert from "node:assert/strict";
import test from "node:test";

import { atlasCharacterReadiness } from "../src/Atlas/atlasRepository.js";
import { characterStateFromQuestPayload } from "../src/Character/characterQuestStateRepository.js";
import { canonicalQuestState, questStateProblem, questStateTelemetryHandler } from "../src/Character/Telemetry/handlers/questState.js";
import { knownTelemetryEventTypes } from "../src/Character/Telemetry/handlerRegistry.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { BUILD, connect, post, syncCharacter } from "../testSupport/lootHarness.js";

// Sprint step 4B: the add-on's quest_state telemetry (a character's World of
// Warcraft quests, not Guildweaver's guild quests), stored as the latest
// state per character and read by the readiness model for that character.

// Deadmines (36): required 166, 168, 214, 167, 2040 (alliance, level 14-15);
// 166 and 214 need 155 (the end of the Defias chain 65 → 132 → 135 → 141 → 142 → 155).
const DEADMINES_REQUIRED = [166, 167, 168, 214, 2040];

function payload(overrides = {}) {
  return {
    schemaVersion: 1, capturedAt: 1791800000, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 20,
    completed: { coverage: "full", questIds: [] },
    questLog: { coverage: "full", entries: [] },
    ...overrides,
  };
}

let revision = 0;
function sendQuestState(request, token, characterId, body, { streamKey = `quest_state:${characterId}`, kind = "state", rev, capturedAt } = {}) {
  revision += 1;
  const envelope = { schemaVersion: 1, eventType: "quest_state", capturedAt: capturedAt ?? body.capturedAt, gameBuild: BUILD, realm: "Live Realm", region: "US",
    installationId: "install-fixture", characterId, payloadSchemaVersion: 1, payload: body };
  return post(request, token, { streamKey, kind, revision: rev ?? revision, envelope });
}

const readiness = (request, cookie, dungeon, characterId) =>
  request(`/api/player/loot/dungeons/${encodeURIComponent(dungeon)}/readiness?character=${encodeURIComponent(characterId)}`, { rawCookie: cookie });

test("the quest_state contract: what is accepted and what is refused", () => {
  assert.ok(knownTelemetryEventTypes().includes("quest_state"));
  assert.equal(questStateProblem(payload()), null);
  assert.equal(questStateProblem(payload({ completed: { coverage: "checked", questIds: [166], checkedQuestIds: [166, 168] } })), null);
  assert.equal(questStateProblem(payload({ completed: { coverage: "none" }, questLog: { coverage: "none" } })), null, "nothing known is a valid report");
  assert.equal(questStateProblem(payload({ faction: null, race: null, classToken: null, level: null })), null);
  // Empty Lua tables arrive as {}.
  assert.equal(questStateProblem(payload({ completed: { coverage: "full", questIds: {} }, questLog: { coverage: "full", entries: {} } })), null);

  const refused = [
    [{ schemaVersion: 2 }, "schema"],
    [{ capturedAt: "yesterday" }, "capturedAt"],
    [{ faction: "neutral" }, "faction"],
    [{ classToken: "DEATHKNIGHT" }, "class"],
    [{ level: 0 }, "level"],
    [{ race: "Night Elf" }, "race token, not a name"],
    [{ name: "Rook" }, "no free text"],
    [{ completed: { coverage: "partial", questIds: [] } }, "coverage"],
    [{ completed: { coverage: "full", questIds: [0] } }, "ids are positive"],
    [{ completed: { coverage: "full", questIds: ["166"] } }, "ids are numbers"],
    [{ completed: { coverage: "none", questIds: [166] } }, "none carries no ids"],
    [{ completed: { coverage: "full", questIds: [166], checkedQuestIds: [166] } }, "full is not checked"],
    [{ completed: { coverage: "checked", questIds: [166] } }, "checked names what it asked"],
    [{ completed: { coverage: "checked", questIds: [166], checkedQuestIds: [168] } }, "a yes it did not ask"],
    [{ completed: { coverage: "full", questIds: [], titles: ["x"] } }, "no extra fields"],
    [{ questLog: { coverage: "none", entries: [{ questId: 166 }] } }, "an unread log is none, not a list"],
    [{ questLog: { coverage: "loading", entries: [] } }, "log coverage"],
    [{ questLog: { coverage: "full", entries: [{ questId: 166, title: "Red Silk Bandanas" }] } }, "no titles"],
    [{ questLog: { coverage: "full", entries: [{ questId: 166, isComplete: 1 }] } }, "isComplete is a boolean"],
    [{ questLog: { coverage: "full", entries: Array.from({ length: 101 }, (_, i) => ({ questId: i + 1 })) } }, "log size"],
  ];
  for (const [change, why] of refused) assert.notEqual(questStateProblem(payload(change)), null, why);

  // One stream per character, state only.
  const record = (overrides = {}) => ({ kind: "state", streamKey: "quest_state:character-rook", payloadSchemaVersion: 1,
    envelope: { characterId: "character-rook", payload: payload() }, ...overrides });
  assert.deepEqual(questStateTelemetryHandler.validate(record()), { ok: true });
  assert.equal(questStateTelemetryHandler.validate(record({ streamKey: "quest_state:character-fern" })).ok, false, "a stream cannot carry another character");
  assert.equal(questStateTelemetryHandler.validate(record({ kind: "event" })).ok, false);
  assert.equal(questStateTelemetryHandler.validate(record({ envelope: { payload: payload() } })).ok, false, "a character is required");

  // Canonical: sorted, unique, lists as lists.
  const canonical = canonicalQuestState(payload({ completed: { coverage: "checked", questIds: [168, 166, 166], checkedQuestIds: [168, 166, 214] },
    questLog: { coverage: "full", entries: [{ questId: 2040, isComplete: true }, { questId: 167 }, { questId: 2040, isComplete: true }] } }));
  assert.deepEqual(canonical.completed, { coverage: "checked", questIds: [166, 168], checkedQuestIds: [166, 168, 214] });
  assert.deepEqual(canonical.questLog.entries, [{ questId: 167, isComplete: null }, { questId: 2040, isComplete: true }]);
  const state = characterStateFromQuestPayload(canonical);
  assert.deepEqual([...state.questLog.questIds], [167, 2040]);
});

test("readiness for a character: completed, accepted, prerequisites, coverage", () => {
  const stored = (body) => ({ state: characterStateFromQuestPayload(canonicalQuestState(body)), questLog: canonicalQuestState(body).questLog,
    capturedAt: "2026-10-01T00:00:00.000Z", receivedAt: "2026-10-01T00:00:01.000Z" });
  const states = (result) => Object.fromEntries(result.quests.map((quest) => [quest.questId, quest.state]));

  // Nothing done, full lists: the chain blocks 166 and 214; the rest can be taken.
  const fresh = atlasCharacterReadiness(36, stored(payload()));
  assert.equal(fresh.readiness, "missing");
  assert.deepEqual(states(fresh), { 166: "prerequisites", 167: "available", 168: "available", 214: "prerequisites", 2040: "available" });
  const bandanas = fresh.quests.find((quest) => quest.questId === 214);
  assert.deepEqual(bandanas.prerequisites.map(({ questId, status }) => ({ questId, status })), [{ questId: 155, status: "missing" }]);
  assert.ok(fresh.quests.find((quest) => quest.questId === 168).giver?.name, "the giver is served");
  assert.equal(fresh.questList, "curated");
  assert.equal(fresh.character.completedCoverage, "full");

  // Chain done, two accepted (one with its objectives done), the rest completed: ready.
  const ready = atlasCharacterReadiness(36, stored(payload({ completed: { coverage: "full", questIds: [65, 132, 135, 141, 142, 155, 166, 214, 167] },
    questLog: { coverage: "full", entries: [{ questId: 168, isComplete: true }, { questId: 2040, isComplete: false }] } })));
  assert.equal(ready.readiness, "ready");
  assert.equal(ready.counts.completed, 3);
  assert.equal(ready.counts.accepted, 2);
  assert.equal(ready.quests.find((quest) => quest.questId === 168).objectivesComplete, true);
  assert.equal(ready.quests.find((quest) => quest.questId === 2040).objectivesComplete, false);

  // Abandoning one (out of the log, not completed) makes it missing again.
  const abandoned = atlasCharacterReadiness(36, stored(payload({ completed: { coverage: "full", questIds: [65, 132, 135, 141, 142, 155, 166, 214, 167] },
    questLog: { coverage: "full", entries: [{ questId: 168, isComplete: true }] } })));
  assert.equal(abandoned.readiness, "missing");
  assert.equal(states(abandoned)[2040], "available");

  // Only some ids checked: the rest stay unknown; never ready from a partial check.
  const checked = atlasCharacterReadiness(36, stored(payload({ completed: { coverage: "checked", questIds: [155, 166, 214, 167], checkedQuestIds: [155, 166, 214, 167] },
    questLog: { coverage: "full", entries: [{ questId: 168 }] } })));
  assert.deepEqual(states(checked), { 166: "completed", 167: "completed", 168: "accepted", 214: "completed", 2040: "unknown" });
  assert.equal(checked.readiness, "unknown");

  // A quest log that was not read: nothing is "available", so never ready.
  const noLog = atlasCharacterReadiness(36, stored(payload({ completed: { coverage: "full", questIds: [155, 166, 214, 167] }, questLog: { coverage: "none" } })));
  assert.equal(noLog.readiness, "unknown");

  // No report at all: unknown, never ready, and it says so.
  const none = atlasCharacterReadiness(36, null);
  assert.equal(none.readiness, "unknown");
  assert.equal(none.character, null);
  assert.ok(none.quests.every((quest) => quest.state === "unknown"));

  // Faction: a horde character is ineligible for every Deadmines quest, so none applies.
  const horde = atlasCharacterReadiness(36, stored(payload({ faction: "horde", race: "Orc" })));
  assert.equal(horde.readiness, "none");
  assert.ok(horde.quests.every((quest) => quest.state === "ineligible" && quest.reasons[0] === "faction"));
});

test("readiness: class rules, wings, Forever chains, dungeons without a quest list", () => {
  const stored = (body) => ({ state: characterStateFromQuestPayload(canonicalQuestState(body)), questLog: canonicalQuestState(body).questLog,
    capturedAt: "2026-10-01T00:00:00.000Z", receivedAt: "2026-10-01T00:00:01.000Z" });
  // Blackrock Spire: 8966 is warrior and mage only; 8989 paladin, shaman, druid.
  const warrior = atlasCharacterReadiness(229, stored(payload({ level: 58 })));
  const state = (result, id) => result.quests.find((quest) => quest.questId === id)?.state;
  assert.equal(state(warrior, 8989), "ineligible");
  assert.equal(warrior.quests.find((quest) => quest.questId === 8989).reasons[0], "class");
  assert.notEqual(state(warrior, 8966), "ineligible");

  // Wings: Lower Spire leaves out the Upper Spire's quest (5102) and keeps its own (5081).
  const lower = atlasCharacterReadiness("blackrock-spire:lower", stored(payload({ level: 58 })));
  const upper = atlasCharacterReadiness("blackrock-spire:upper", stored(payload({ level: 58 })));
  assert.equal(lower.dungeon.dungeonKey, "blackrock-spire:lower");
  assert.ok(lower.quests.some((quest) => quest.questId === 5081) && !lower.quests.some((quest) => quest.questId === 5102));
  assert.ok(upper.quests.some((quest) => quest.questId === 5102) && !upper.quests.some((quest) => quest.questId === 5081));
  assert.ok(lower.quests.some((quest) => quest.questId === 4729) && upper.quests.some((quest) => quest.questId === 4729), "shared quests stay on both");

  // A Forever dungeon: chains are not known, so a quest not yet taken stays unknown.
  const thanes = atlasCharacterReadiness(3065, stored(payload({ level: 20 })));
  assert.equal(thanes.readiness, "unknown");
  assert.ok(thanes.quests.filter((quest) => quest.faction !== "horde").every((quest) => quest.state === "unknown" && quest.prerequisitesKnown === false));
  assert.ok(thanes.quests.some((quest) => quest.reasons.includes("prerequisites-not-known")));
  // ...but what the client reports still counts.
  const ids = thanes.quests.filter((quest) => quest.faction !== "horde").map((quest) => quest.questId);
  const done = atlasCharacterReadiness(3065, stored(payload({ level: 20, completed: { coverage: "full", questIds: ids } })));
  assert.equal(done.readiness, "ready");

  // Blackmaw Hold (2974): no source lists its quests: "none" here means no list, not no quests.
  const blackmaw = atlasCharacterReadiness(2974, stored(payload()));
  assert.equal(blackmaw.readiness, "none");
  assert.equal(blackmaw.questList, "unknown");

  // Repeatable quests: reported apart, never completed for good, never required.
  const ragefire = atlasCharacterReadiness(389, stored(payload({ faction: "horde", race: "Orc" })));
  for (const quest of ragefire.repeatable) assert.equal(quest.repeatable, true);
});

test("ingest and the API: stored per character, private, newest wins", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-quest-ash", username: "ash" });
  const bram = await connect(request, { id: "discord-quest-bram", username: "bram" });
  const rook = await syncCharacter(request, ash.token, "character-rook", "Rook");
  const fern = await syncCharacter(request, ash.token, "character-fern", "Fern");
  const thorn = await syncCharacter(request, bram.token, "character-thorn", "Thorn");

  // No report yet: unknown, and the response says nothing was synced.
  const before = (await readiness(request, ash.cookie, 36, rook)).json;
  assert.equal(before.readiness, "unknown");
  assert.equal(before.character, null);

  const first = await sendQuestState(request, ash.token, "character-rook", payload({ capturedAt: 1791800000,
    questLog: { coverage: "full", entries: [{ questId: 168 }] } }));
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.telemetryHandler, "quest_state");

  const rookState = (await readiness(request, ash.cookie, 36, rook)).json;
  assert.equal(rookState.readiness, "missing");
  assert.equal(rookState.quests.find((quest) => quest.questId === 168).state, "accepted");
  assert.equal(rookState.character.capturedAt, new Date(1791800000 * 1000).toISOString());
  assert.equal(rookState.characterId, rook);

  // Fern has not reported: Rook's quests are not Fern's.
  const fernState = (await readiness(request, ash.cookie, 36, fern)).json;
  assert.equal(fernState.character, null);
  assert.equal(fernState.quests.find((quest) => quest.questId === 168).state, "unknown");

  // Fern reports; switching characters gives each its own.
  await sendQuestState(request, ash.token, "character-fern", payload({ capturedAt: 1791800100, completed: { coverage: "full", questIds: [168] } }));
  assert.equal((await readiness(request, ash.cookie, 36, fern)).json.quests.find((quest) => quest.questId === 168).state, "completed");
  assert.equal((await readiness(request, ash.cookie, 36, rook)).json.quests.find((quest) => quest.questId === 168).state, "accepted");

  // Private: another account's character answers 404, and so does an unknown one.
  assert.equal((await readiness(request, bram.cookie, 36, rook)).status, 404);
  assert.equal((await readiness(request, ash.cookie, 36, thorn)).status, 404);
  assert.equal((await readiness(request, ash.cookie, 36, "no-such-character")).status, 404);
  assert.equal((await request(`/api/player/loot/dungeons/36/readiness?character=${rook}`)).status, 401);
  assert.equal((await readiness(request, ash.cookie, 99999, rook)).status, 404);

  // A device cannot write one character's quests on another account's stream.
  const foreign = await sendQuestState(request, bram.token, "character-rook", payload({ capturedAt: 1791800500, completed: { coverage: "full", questIds: [166, 167, 168, 214, 2040] } }));
  assert.equal(foreign.status, 201);
  assert.equal((await readiness(request, ash.cookie, 36, rook)).json.quests.find((quest) => quest.questId === 168).state, "accepted", "bram's upload is bram's, not ash's");

  // A stream key naming another character is refused.
  const crossed = await sendQuestState(request, ash.token, "character-rook", payload(), { streamKey: "quest_state:character-fern" });
  assert.equal(crossed.status, 400);
  assert.equal(crossed.json.error, "invalid_quest_state");

  // Out of order: an older capture arriving later does not replace the newer one.
  await sendQuestState(request, ash.token, "character-rook", payload({ capturedAt: 1791800300, completed: { coverage: "full", questIds: [168] } }));
  await sendQuestState(request, ash.token, "character-rook", payload({ capturedAt: 1791800200, questLog: { coverage: "full", entries: [] } }));
  const newest = (await readiness(request, ash.cookie, 36, rook)).json;
  assert.equal(newest.quests.find((quest) => quest.questId === 168).state, "completed");
  assert.equal(newest.character.capturedAt, new Date(1791800300 * 1000).toISOString());

  // Retried upload (same idempotency key and revision): a duplicate, nothing new stored.
  const body = { streamKey: "quest_state:character-rook", kind: "state", revision: 900, envelope: { schemaVersion: 1, eventType: "quest_state", capturedAt: 1791800400,
    characterId: "character-rook", payloadSchemaVersion: 1, payload: payload({ capturedAt: 1791800400 }) } };
  const once = await request("/api/bridge/telemetry", { method: "POST", headers: { Authorization: `Bearer ${ash.token}`, "Idempotency-Key": "quest-retry" }, body });
  const twice = await request("/api/bridge/telemetry", { method: "POST", headers: { Authorization: `Bearer ${ash.token}`, "Idempotency-Key": "quest-retry" }, body });
  assert.equal(once.status, 201);
  assert.equal(twice.status, 200);
  assert.equal(twice.json.status, "duplicate");

  // Invalid reports change nothing.
  const bad = await sendQuestState(request, ash.token, "character-rook", payload({ capturedAt: 1791900000, completed: { coverage: "none", questIds: [166] } }));
  assert.equal(bad.status, 400);
  assert.equal((await readiness(request, ash.cookie, 36, rook)).json.character.capturedAt, new Date(1791800400 * 1000).toISOString());

  // Wing keys work through the same route.
  const wing = await readiness(request, ash.cookie, "blackrock-spire:lower", rook);
  assert.equal(wing.status, 200);
  assert.equal(wing.json.dungeon.dungeonKey, "blackrock-spire:lower");
}));
