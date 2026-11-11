import assert from "node:assert/strict";
import test from "node:test";

import { closeGuildDatabase, withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { upsertGameDataEntityInDatabase } from "../src/GameData/gameDataCatalog.js";
import { readIconInDatabase, resolveIcon, storeIcons } from "../src/GameData/iconRegistry.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// The icon registry: where each icon's image comes from, remembered across
// restarts; misses back off; copies go to object storage when configured.

const NOW = 1794300000;

function blizzardItem(db, id, iconFileId, mediaUrl) {
  upsertGameDataEntityInDatabase(db, { type: "item", id, name: `Item ${id} name`, iconFileId, source: "blizzard", locale: "en_US", metadata: { mediaUrl } });
}

test("an icon Blizzard's item data knows is served, not refused; its URL is remembered", () => withHttpApp(async ({ request }) => {
  let asked = 0;
  const resolver = { resolve: async () => { asked += 1; return ""; } };
  withGuildTransaction((db) => blizzardItem(db, 7078, 135805, "https://render.worldofwarcraft.com/us/icons/56/inv_elemental_primal_fire.jpg"));
  const found = await resolveIcon(135805, { resolver, now: NOW });
  assert.deepEqual(found, { kind: "redirect", url: "https://render.worldofwarcraft.com/us/icons/56/inv_elemental_primal_fire.jpg", source: "blizzard_item" });
  assert.equal(asked, 0, "the item's own image first: no media search");
  // Remembered across a restart.
  closeGuildDatabase();
  assert.equal(withGuildDatabase((db) => readIconInDatabase(db, 135805)).status, "linked");
  // The public route serves it (it used to answer icon_not_observed).
  const response = await request("/api/game-data/v1/icons/135805");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://render.worldofwarcraft.com/us/icons/56/inv_elemental_primal_fire.jpg");
  assert.equal((await request("/api/game-data/v1/icons/999999")).status, 404, "an icon no known item uses is not looked up");
}));

test("a missing icon backs off instead of asking Blizzard on every view", () => withHttpApp(async () => {
  let asked = 0;
  const resolver = { resolve: async () => { asked += 1; return ""; } };
  assert.equal(await resolveIcon(1000001, { resolver, now: NOW }), null);
  assert.equal(await resolveIcon(1000001, { resolver, now: NOW + 60 }), null);
  assert.equal(asked, 1, "asked once, then waited");
  const row = withGuildDatabase((db) => readIconInDatabase(db, 1000001));
  assert.deepEqual([row.status, row.failures, row.next_attempt_at], ["missing", 1, NOW + 3600]);
  assert.equal(await resolveIcon(1000001, { resolver, now: NOW + 3601 }), null);
  assert.equal(asked, 2, "asked again after the back-off");
  assert.equal(withGuildDatabase((db) => readIconInDatabase(db, 1000001)).next_attempt_at, NOW + 3601 + 7200, "and waits longer each time");
  const found = { resolve: async () => "https://render.worldofwarcraft.com/us/icons/56/inv_misc_coin_01.jpg" };
  assert.equal((await resolveIcon(1000001, { resolver: found, now: NOW + 20000 })).source, "blizzard_media");
  assert.equal(withGuildDatabase((db) => readIconInDatabase(db, 1000001)).failures, 0);
  assert.equal(await resolveIcon(1000002, { resolver: { resolve: async () => { throw new Error("boom"); } }, now: NOW }), null, "a failing lookup is a miss, not a crash");
}));

test("copies of icons go to object storage, verified, and are served from there", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    blizzardItem(db, 2589, 132889, "https://render.worldofwarcraft.com/us/icons/56/inv_fabric_linen_01.jpg");
    blizzardItem(db, 2590, 132890, "https://render.worldofwarcraft.com/us/icons/56/not_an_image.jpg");
  });
  await resolveIcon(132889, { now: NOW });
  await resolveIcon(132890, { now: NOW });
  const sent = [];
  const client = { send: async (command) => { sent.push(command.input); return {}; } };
  const fetchImpl = async (url) => (url.includes("linen")
    ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } })
    : new Response("<html>", { headers: { "content-type": "text/html" } }));
  const storage = { bucket: "icons-bucket", prefix: "icons/", publicUrl: "https://cdn.example/icons-bucket", clientOptions: {} };
  const result = await storeIcons({ storage, client, fetchImpl, now: () => NOW });
  assert.deepEqual([result.stored, result.failed], [1, 1]);
  assert.deepEqual(sent.map((input) => [input.Bucket, input.Key, input.ContentType]), [["icons-bucket", "icons/132889.jpg", "image/jpeg"]]);
  const stored = withGuildDatabase((db) => readIconInDatabase(db, 132889));
  assert.deepEqual([stored.status, stored.bytes, stored.sha256.length], ["stored", 6, 64]);
  assert.equal(withGuildDatabase((db) => readIconInDatabase(db, 132890)).last_error, "bad_response_200_text/html", "only images are kept");
  assert.deepEqual(await resolveIcon(132889, { storage, now: NOW }), { kind: "redirect", url: "https://cdn.example/icons-bucket/icons/132889.jpg", source: "stored" });
  assert.equal((await storeIcons({ storage: null })).skipped, true, "nothing happens without storage");
}));
