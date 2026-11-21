// The Dungeon Content Studio's end-to-end demo, automated: The Hall of
// Thanes (3065, WoW Forever) and Deadmines (36, Classic) from the real
// imported atlas, with synthetic editorial content and a synthetic image.
//   replace the card art → add a mechanic to Faldrim Anvilmar and edit it →
//   website and add-on previews → save a draft → publish → the website API
//   serves it → the add-on export bundle has it.
import assert from "node:assert/strict";
import test from "node:test";

import { encodePng } from "../src/Atlas/Editorial/imageCodec.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const BASE = "/api/admin/atlas-studio";
const HALL = 3065;
const FALDRIM = "261306";
const DEADMINES = 36;
const override = (value, verified = false, source = "test") => ({ value, verified, source });

function image(width, height) {
  const pixels = Buffer.alloc(width * height * 4, 200);
  return encodePng({ width, height, pixels });
}

// The detail without what the editorial layer may add, to prove the rest
// (loot, observed rates, telemetry-derived facts) is untouched.
function withoutEditorial(detail) {
  const copy = structuredClone(detail);
  delete copy.atlas.editorial;
  for (const key of ["name", "subtitle", "artworkUrl", "description", "levelMin", "levelMax", "entrance", "maps"]) delete copy.atlas[key];
  delete copy.instance.name;
  copy.atlas.bosses = copy.atlas.bosses.map((boss) => {
    const rest = { ...boss };
    for (const key of ["name", "portraitUrl", "strategy", "description", "positioning", "interrupts", "dispels", "mechanics", "lootNotes"]) delete rest[key];
    return rest;
  }).sort((a, b) => String(a.npcId || a.atlasName).localeCompare(String(b.npcId || b.atlasName)));
  return copy;
}

test("demo: edit, preview, publish and serve The Hall of Thanes; Deadmines alongside", () => withHttpApp(async ({ request, base, cookie }) => {
  const admin = (route, options = {}) => request(route, { persona: "owner", ...options });
  const before = await request(`/api/player/loot/dungeons/${HALL}`, { persona: "member" });
  assert.equal(before.status, 200, before.text);
  assert.equal(before.json.atlas.editorial, undefined, "nothing editorial before publishing");

  // 1–2. Open the editor and replace the card art.
  const opened = await admin(`${BASE}/dungeons/${HALL}`);
  assert.equal(opened.json.imported.artworkUrl, null);
  const uploaded = await fetch(`${base}${BASE}/media?name=hall-card.png&purpose=card&attribution=Synthetic`, {
    method: "POST", headers: { Origin: "https://holdfast.example", Cookie: cookie("owner"), "Content-Type": "image/png" }, body: image(640, 360),
  }).then((response) => response.json());
  const card = uploaded.media;

  // 3. Add a mechanic to Faldrim Anvilmar, then edit its instructions.
  const document = {
    dungeon: { cardArt: override(card.id, true, "Synthetic test art"), tips: override(["Synthetic tip."]) },
    bosses: { [FALDRIM]: { mechanics: override([{ id: "shadow-bolt", ability: "Shadow Bolt", type: "interrupt", priority: "high", instruction: "Interrupt.", roles: ["dps", "tank"], verified: true }]) } },
  };
  document.bosses[FALDRIM].mechanics.value[0].instruction = "Interrupt whenever possible.";

  // 4–5. Both previews, from the unsaved document.
  const preview = await admin(`${BASE}/dungeons/${HALL}/preview`, { method: "POST", body: { document } });
  assert.equal(preview.json.website.atlas.artworkUrl, card.urls.web);
  assert.equal(preview.json.addon.bosses.find((boss) => boss.key === FALDRIM).mechanics[0].i, "Interrupt whenever possible.");

  // 6–7. Save a draft and publish it; Deadmines gets a published quest plan and boss strategy.
  assert.equal((await admin(`${BASE}/dungeons/${HALL}/draft`, { method: "PUT", body: { document, expectedVersion: 0 } })).status, 200);
  assert.equal((await request(`/api/player/loot/dungeons/${HALL}`, { persona: "member" })).json.atlas.editorial, undefined, "a draft is not served");
  const published = await admin(`${BASE}/dungeons/${HALL}/publish`, { method: "POST", body: { note: "demo" } });
  assert.equal(published.status, 200, published.text);
  const deadminesBoss = String((await admin(`${BASE}/dungeons/${DEADMINES}`)).json.imported.bosses[0].key);
  await admin(`${BASE}/dungeons/${DEADMINES}/draft`, { method: "PUT", body: { document: {
    dungeon: { subtitle: override("Synthetic subtitle") }, bosses: { [deadminesBoss]: { strategy: override("Synthetic strategy.") } },
    questPlan: { quests: [{ questId: 166, shareable: "no", verified: false, source: "test" }] },
  }, expectedVersion: 0 } });
  assert.equal((await admin(`${BASE}/dungeons/${DEADMINES}/publish`, { method: "POST", body: {} })).status, 200);

  // 8. The website API serves the published content; loot and observed rates are unchanged.
  const after = await request(`/api/player/loot/dungeons/${HALL}`, { persona: "member" });
  assert.equal(after.json.atlas.artworkUrl, card.urls.web);
  assert.equal(after.json.atlas.editorial.revision, String(published.json.active.revision.id));
  assert.deepEqual(after.json.atlas.editorial.tips, ["Synthetic tip."]);
  const faldrim = after.json.atlas.bosses.find((boss) => boss.npcId === 261306);
  assert.equal(faldrim.mechanics[0].instruction, "Interrupt whenever possible.");
  assert.deepEqual(withoutEditorial(after.json), withoutEditorial(before.json), "everything else is exactly what was served before");
  const list = await request("/api/player/loot/dungeons", { persona: "member" });
  const entry = [...list.json.dungeons, ...list.json.atlasDungeons].find((dungeon) => dungeon.instanceId === HALL);
  assert.equal(entry.atlas.artworkUrl, card.urls.web, "the explore card shows the new art");
  const deadmines = await request(`/api/player/loot/dungeons/${DEADMINES}`, { persona: "member" });
  assert.equal(deadmines.json.atlas.subtitle, "Synthetic subtitle");
  assert.equal(deadmines.json.atlas.bosses.find((boss) => String(boss.encounterId || boss.npcId) === deadminesBoss).strategy.summary, "Synthetic strategy.");
  const quests = await request(`/api/player/loot/dungeons/${DEADMINES}/quests`, { persona: "member" });
  assert.equal(quests.status, 200, "the quest catalog route is unchanged");

  // 9. The add-on export bundle.
  const bundle = await admin(`${BASE}/export/addon`);
  assert.deepEqual(bundle.json.dungeons.map((dungeon) => dungeon.id), [DEADMINES, HALL]);
  assert.equal(bundle.json.dungeons[1].bosses[0].mech[0].i, "Interrupt whenever possible.");
  assert.equal(bundle.json.art[HALL].card, ["Interface", "AddOns", "Guildweaver", "Media", "Atlas", "3065_card"].join(String.fromCharCode(92)), "the PNG card art is packaged as a texture");
  assert.deepEqual(bundle.json.artSkipped, []);

  // Unpublishing returns the site to the imported atlas.
  await admin(`${BASE}/dungeons/${HALL}/unpublish`, { method: "POST", body: {} });
  assert.equal((await request(`/api/player/loot/dungeons/${HALL}`, { persona: "member" })).json.atlas.editorial, undefined);
}));
