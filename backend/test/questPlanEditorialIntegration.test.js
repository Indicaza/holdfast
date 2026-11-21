// The quest planner over the Dungeon Content Studio's published quest edits:
// players get the published revision only, never a draft; editors preview a
// draft through the studio (site.admin). Dungeons and quest ids are the real
// imported catalog (Deadmines 36, The Hall of Thanes 3065); every editorial
// value here is SYNTHETIC test content, not a verified game fact.
import assert from "node:assert/strict";
import test from "node:test";

import { withHttpApp } from "../testSupport/httpHarness.js";

const STUDIO = "/api/admin/atlas-studio";
const DEADMINES = 36;
const HALL = 3065;
// The Defias chain up to 155 done: 166 and 214 can be taken.
const DEFIAS_CHAIN = [65, 132, 135, 141, 142, 155];
const state = (extra = {}) => ({ schemaVersion: 1, faction: "alliance", race: "Human", classToken: "WARRIOR", level: 20,
  completed: { coverage: "full", questIds: DEFIAS_CHAIN }, questLog: { coverage: "full", questIds: [] }, ...extra });

const WESTFALL_TURNIN = { name: "Synthetic turn-in NPC", location: { mapId: 1436, x: 0.5, y: 0.5, zoneName: "Westfall" } };
const deadminesDraft = { questPlan: {
  instructions: [{ section: "enter", text: "Synthetic: meet at the entrance.", verified: false, source: "test" }],
  quests: [
    { questId: 214, shareable: "no", verified: false, source: "test" },
    { questId: 166, turnIn: WESTFALL_TURNIN, steps: [{ text: "Synthetic step." }], verified: false, source: "test" },
  ],
} };
const hallDraft = { questPlan: { quests: [{ questId: 96394, prerequisites: [96393], verified: false, source: "test" }] } };

const sectionOf = (plan, key) => plan.sections.find((entry) => entry.key === key).steps;
const shares = (plan, questId) => sectionOf(plan, "share").some((step) => step.questId === questId);

test("players plan over published quest edits only; editors preview drafts in the studio", () => withHttpApp(async ({ request }) => {
  const admin = (route, options = {}) => request(route, { persona: "owner", ...options });
  const player = (dungeon, body) => request(`/api/player/loot/dungeons/${dungeon}/plan`, { method: "POST", persona: "member", body });

  // The catalog alone: 214 is shareable (AzerothCore's flag).
  const before = await player(DEADMINES, { state: state() });
  assert.equal(before.status, 200, before.text);
  assert.deepEqual(before.json.editorial, { used: false, revision: null });
  assert.ok(shares(before.json, 214));

  // A saved draft changes nothing for players...
  assert.equal((await admin(`${STUDIO}/dungeons/${DEADMINES}/draft`, { method: "PUT", body: { document: deadminesDraft, expectedVersion: 0 } })).status, 200);
  const drafted = await player(DEADMINES, { state: state() });
  assert.deepEqual(drafted.json, before.json, "a draft never reaches a player's plan");
  // ...even when a player sends a document of their own.
  assert.deepEqual((await player(DEADMINES, { state: state(), editorial: { schemaVersion: 1, instanceId: DEADMINES, quests: [{ questId: 214, shareable: "no" }] } })).json, before.json);

  // The studio previews it, and only for site admins.
  assert.equal((await request(`${STUDIO}/dungeons/${DEADMINES}/plan-preview`, { method: "POST", persona: "member", body: { state: state() } })).status, 403);
  const preview = await admin(`${STUDIO}/dungeons/${DEADMINES}/plan-preview`, { method: "POST", body: { state: state() } });
  assert.equal(preview.status, 200, preview.text);
  assert.equal(preview.json.draft, true);
  assert.equal(preview.json.editorial.used, true);
  assert.ok(!shares(preview.json, 214), "the draft says 214 cannot be shared");
  // An unsaved document previews too.
  const unsaved = await admin(`${STUDIO}/dungeons/${DEADMINES}/plan-preview`, { method: "POST", body: { state: state(), document: { questPlan: { quests: [] } } } });
  assert.equal(unsaved.json.editorial.used, false);

  // Published: players get it, with the revision it came from.
  const published = await admin(`${STUDIO}/dungeons/${DEADMINES}/publish`, { method: "POST", body: {} });
  assert.equal(published.status, 200, published.text);
  const after = await player(DEADMINES, { state: state({ questLog: { coverage: "full", entries: [{ questId: 166, isComplete: true }] } }) });
  assert.deepEqual(after.json.editorial, { used: true, revision: String(published.json.active.revision.id) });
  assert.ok(!shares(after.json, 214), "shareability follows the published edit");
  const handIn = sectionOf(after.json, "turnIn").find((step) => step.questId === 166);
  assert.equal(handIn.waypoint, "wp:turnin:166");
  assert.deepEqual(after.json.waypoints.find((entry) => entry.id === "wp:turnin:166"), { id: "wp:turnin:166", mapSystem: "uiMap", mapId: 1436, x: 0.5, y: 0.5,
    zoneName: "Westfall", target: "Synthetic turn-in NPC", targetType: "turn-in", source: "editorial", verified: false });
  assert.equal(after.json.sections.find((entry) => entry.key === "enter").notes[0].text, "Synthetic: meet at the entrance.");
  assert.deepEqual(after.json.problems, []);

  // An edited prerequisite chain (The Hall of Thanes, whose chains no source records).
  const hallBefore = await player(HALL, { state: state({ level: 30, completed: { coverage: "full", questIds: [] } }) });
  assert.ok(sectionOf(hallBefore.json, "collect").some((step) => step.questId === 96394));
  await admin(`${STUDIO}/dungeons/${HALL}/draft`, { method: "PUT", body: { document: hallDraft, expectedVersion: 0 } });
  await admin(`${STUDIO}/dungeons/${HALL}/publish`, { method: "POST", body: {} });
  const hallAfter = await player(HALL, { state: state({ level: 30, completed: { coverage: "full", questIds: [] } }) });
  assert.ok(!sectionOf(hallAfter.json, "collect").some((step) => step.questId === 96394), "96394 now waits on the dungeon quest 96393");
  assert.equal(sectionOf(hallAfter.json, "turnIn").find((step) => step.questId === 96394).kind, "follow-up");

  // Unpublished: back to the catalog alone.
  await admin(`${STUDIO}/dungeons/${DEADMINES}/unpublish`, { method: "POST", body: {} });
  assert.deepEqual((await player(DEADMINES, { state: state() })).json, before.json);
}));
