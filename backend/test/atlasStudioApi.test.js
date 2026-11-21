// Dungeon Content Studio admin API: authorization on every route, the draft →
// validate → publish workflow, revisions, rollback and audit. Dungeons are
// the real imported atlas; the editorial content is synthetic.
import assert from "node:assert/strict";
import test from "node:test";

import { publishedEditorialQuestPlan } from "../src/Atlas/editorialQuestPlan.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const BASE = "/api/admin/atlas-studio";
const HALL = 3065;
const FALDRIM = "261306";
const DEADMINES = 36;
const override = (value, verified = false, source = "test") => ({ value, verified, source });

const WRITES = [
  ["PUT", `${BASE}/dungeons/${HALL}/draft`, { document: {}, expectedVersion: 0 }],
  ["DELETE", `${BASE}/dungeons/${HALL}/draft`],
  ["POST", `${BASE}/dungeons/${HALL}/validate`, { document: {} }],
  ["POST", `${BASE}/dungeons/${HALL}/publish`, {}],
  ["POST", `${BASE}/dungeons/${HALL}/rollback`, { revisionId: 1 }],
  ["POST", `${BASE}/dungeons/${HALL}/unpublish`, {}],
  ["POST", `${BASE}/dungeons/${HALL}/plan-preview`, {}],
];
const READS = [`${BASE}/schema`, `${BASE}/dungeons`, `${BASE}/dungeons/${HALL}`, `${BASE}/dungeons/${HALL}/audit`, `${BASE}/export/addon`];

test("every studio route is site-admin only: 401 signed out, 403 for members and other accounts", () => withHttpApp(async ({ request }) => {
  for (const [method, route, body] of WRITES) {
    assert.equal((await request(route, { method, body })).status, 401, `${method} ${route} signed out`);
    for (const persona of ["member", "outsider"]) {
      const response = await request(route, { method, body, persona });
      assert.equal(response.status, 403, `${method} ${route} as ${persona}`);
      assert.equal(response.json.error, "permission_required");
    }
  }
  for (const route of READS) {
    assert.equal((await request(route, { persona: "member" })).status, 403, `GET ${route} as member`);
  }
  // Nothing was written by the refused requests.
  const owner = await request(`${BASE}/dungeons/${HALL}`, { persona: "owner" });
  assert.equal(owner.status, 200, owner.text);
  assert.equal(owner.json.draft, null);
  assert.equal(owner.json.active, null);
  assert.deepEqual(owner.json.audit, []);
}));

test("draft, publish, rollback and audit for The Hall of Thanes; the quest plan for Deadmines", () => withHttpApp(async ({ request }) => {
  const admin = (route, options = {}) => request(route, { persona: "owner", ...options });

  const list = await admin(`${BASE}/dungeons`);
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.dungeons.some((dungeon) => dungeon.instanceId === HALL && dungeon.origin === "forever"));
  assert.ok(list.json.dungeons.some((dungeon) => dungeon.instanceId === DEADMINES && dungeon.origin === "classic"));

  const detail = await admin(`${BASE}/dungeons/${HALL}`);
  assert.equal(detail.json.imported.name, "The Hall of Thanes");
  assert.ok(detail.json.imported.bosses.some((boss) => boss.key === FALDRIM && boss.name === "Faldrim Anvilmar"));

  const document = {
    dungeon: { subtitle: override("Synthetic subtitle") },
    bosses: { [FALDRIM]: { mechanics: override([{ id: "shadow-bolt", ability: "Shadow Bolt", type: "interrupt", priority: "high", instruction: "Interrupt whenever possible.", roles: ["dps", "tank"], verified: true }]) } },
  };
  const invalid = await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document: { bosses: { [FALDRIM]: { observedRate: override(1) } } }, expectedVersion: 0 } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.problems[0].code, "protected");

  const saved = await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document, expectedVersion: 0 } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.draft.version, 1);
  const stale = await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document, expectedVersion: 0 } });
  assert.equal(stale.status, 409, "a stale editor cannot overwrite a newer draft");

  // Edit the mechanic's instruction, as a second save.
  document.bosses[FALDRIM].mechanics.value[0].instruction = "Interrupt every cast; synthetic.";
  const edited = await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document, expectedVersion: 1 } });
  assert.equal(edited.json.draft.version, 2);

  const published = await admin(`${BASE}/dungeons/${HALL}/publish`, { method: "POST", body: { expectedVersion: 2, note: "First pass" } });
  assert.equal(published.status, 200, published.text);
  const first = published.json.active.revision;
  assert.equal(first.number, 1);
  const after = await admin(`${BASE}/dungeons/${HALL}`);
  assert.equal(after.json.draft, null, "publishing consumes the draft");
  assert.equal(after.json.active.document.bosses[FALDRIM].mechanics.value[0].instruction, "Interrupt every cast; synthetic.");
  assert.equal(after.json.addon.bosses[0].mech[0].i, "Interrupt every cast; synthetic.");

  // A second revision, then roll back to the first.
  document.dungeon.subtitle = override("Second subtitle");
  await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document, expectedVersion: 0 } });
  const second = await admin(`${BASE}/dungeons/${HALL}/publish`, { method: "POST", body: {} });
  assert.equal(second.json.active.revision.number, 2);
  const rolled = await admin(`${BASE}/dungeons/${HALL}/rollback`, { method: "POST", body: { revisionId: first.id } });
  assert.equal(rolled.status, 200, rolled.text);
  assert.equal(rolled.json.active.revision.number, 3);
  assert.equal(rolled.json.active.revision.kind, "rollback");
  assert.equal(rolled.json.active.document.dungeon.subtitle.value, "Synthetic subtitle");

  const audit = await admin(`${BASE}/dungeons/${HALL}/audit`);
  assert.deepEqual(audit.json.audit.map((entry) => entry.action).reverse(), ["draft.save", "draft.save", "publish", "draft.save", "publish", "rollback"]);
  assert.ok(audit.json.audit.every((entry) => entry.actorId === "e2e-commander"));

  const bundle = await admin(`${BASE}/export/addon`);
  assert.equal(bundle.json.schemaVersion, 1);
  assert.deepEqual(bundle.json.dungeons.map((entry) => entry.id), [HALL]);
  assert.equal(bundle.json.dungeons[0].sub, "Synthetic subtitle");

  // Publishing refuses a draft that does not validate.
  await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document: { dungeon: { cardArt: override("m_doesnotexist1") } }, expectedVersion: 0 } });
  const blocked = await admin(`${BASE}/dungeons/${HALL}/publish`, { method: "POST", body: {} });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.json.errors[0].code, "missing-asset");

  // Deadmines' quest plan reaches the planner's one integration point, published only.
  const plan = { questPlan: { quests: [{ questId: 166, shareable: "no", steps: [{ text: "Synthetic step." }], verified: false, source: "test" }] } };
  await admin(`${BASE}/dungeons/${DEADMINES}/draft`, { method: "PUT", body: { document: plan, expectedVersion: 0 } });
  assert.equal(publishedEditorialQuestPlan(DEADMINES), null, "a draft is never served");
  const deadmines = await admin(`${BASE}/dungeons/${DEADMINES}/publish`, { method: "POST", body: {} });
  assert.equal(deadmines.status, 200, deadmines.text);
  const served = publishedEditorialQuestPlan(DEADMINES);
  assert.equal(served.schemaVersion, 1);
  assert.equal(served.instanceId, DEADMINES);
  assert.equal(served.revision, String(deadmines.json.active.revision.id));
  assert.deepEqual(served.quests, plan.questPlan.quests);
  await admin(`${BASE}/dungeons/${DEADMINES}/unpublish`, { method: "POST", body: {} });
  assert.equal(publishedEditorialQuestPlan(DEADMINES), null);
}));
