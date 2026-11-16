import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrateGuildDatabase, withGuildDatabase } from "../src/Data/database.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { ITEMS, WAILING, connect, corpseLoot, lootRoll, seedItems, syncCharacter, syncInventory } from "../testSupport/lootHarness.js";

// Character wishlists: personal, per character, across dungeons; an item is
// acquired only on proof (owned, or a roll the game said was won), and an
// acquired item stays on the list.

const ASH = { id: "discord-wish-ash", username: "ash" };
const BRAM = { id: "discord-wish-bram", username: "bram" };

async function setup(request) {
  seedItems();
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  const rook = await syncCharacter(request, ash.token, "character-rook", "Rook");
  const fern = await syncCharacter(request, ash.token, "character-fern", "Fern");
  const other = await syncCharacter(request, bram.token, "character-thorn", "Thorn");
  await corpseLoot(request, ash.token, { npcId: 639, npcName: "Edwin VanCleef", serial: 1, items: [ITEMS.barb, ITEMS.cape] });
  await corpseLoot(request, ash.token, { npcId: 3653, npcName: "Kresh", serial: 1, items: [ITEMS.belt], instance: WAILING });
  return { ash, bram, rook, fern, other };
}

const wishlist = async (request, cookie, characterId) => (await request(`/api/player/wishlists/${encodeURIComponent(characterId)}`, { rawCookie: cookie }));
const put = (request, cookie, characterId, itemKey, body = {}) => request(`/api/player/wishlists/${encodeURIComponent(characterId)}/items/${itemKey}`, { method: "PUT", rawCookie: cookie, body });
const patch = (request, cookie, characterId, itemKey, body) => request(`/api/player/wishlists/${encodeURIComponent(characterId)}/items/${itemKey}`, { method: "PATCH", rawCookie: cookie, body });
const entry = (list, itemId) => list.items.find((item) => item.itemId === itemId);

test("a wishlist belongs to one character of one account", () => withHttpApp(async ({ request }) => {
  const { ash, bram, rook, fern, other } = await setup(request);
  assert.equal((await put(request, ash.cookie, rook, "i:5191", { priority: "high", note: "Main hand until 30" })).status, 200);
  assert.equal((await put(request, ash.cookie, fern, "i:6468")).status, 200);

  const rookList = (await wishlist(request, ash.cookie, rook)).json;
  const fernList = (await wishlist(request, ash.cookie, fern)).json;
  assert.deepEqual(rookList.items.map((item) => item.itemId), [5191], "each character has its own list");
  assert.deepEqual(fernList.items.map((item) => item.itemId), [6468]);
  assert.equal(rookList.character.name, "Rook");

  // Another account's character: read, add, change, remove and import all answer 404.
  assert.equal((await wishlist(request, bram.cookie, rook)).status, 404);
  assert.equal((await put(request, bram.cookie, rook, "i:5193")).status, 404);
  assert.equal((await patch(request, bram.cookie, rook, "i:5191", { priority: "low" })).status, 404);
  assert.equal((await request(`/api/player/wishlists/${rook}/items/i:5191`, { method: "DELETE", rawCookie: bram.cookie })).status, 404);
  assert.equal((await request(`/api/player/wishlists/${rook}/import`, { method: "POST", rawCookie: bram.cookie, body: { text: "{}" } })).status, 404);
  assert.equal((await request(`/api/player/wishlists/${rook}/ai-prompt`, { rawCookie: bram.cookie })).status, 404);
  assert.equal((await wishlist(request, ash.cookie, other)).status, 404);
  assert.equal((await wishlist(request, ash.cookie, "no-such-character")).status, 404);
  assert.equal((await request(`/api/player/wishlists/${rook}`)).status, 401);
  assert.deepEqual((await wishlist(request, ash.cookie, rook)).json.items.map((item) => item.priority), ["high"], "nothing changed");

  // The catalog marks what is on the chosen character's list, and only theirs.
  const marked = (await request(`/api/player/loot/dungeons/36?character=${rook}`, { rawCookie: ash.cookie })).json;
  assert.equal(marked.sources[0].items.find((item) => item.itemId === 5191).wishlisted, true);
  const unmarked = (await request(`/api/player/loot/dungeons/36?character=${rook}`, { rawCookie: bram.cookie })).json;
  assert.equal(unmarked.sources[0].items.find((item) => item.itemId === 5191).wishlisted, false);
}));

test("add, edit, reorder and remove, across dungeons, with stable identity", () => withHttpApp(async ({ request }) => {
  const { ash, rook } = await setup(request);
  const added = await put(request, ash.cookie, rook, "i:5191", { priority: "high", note: "Main hand", sourceDungeon: "The Deadmines", sourceInstanceId: 36 });
  assert.equal(added.json.status, "created");
  assert.equal(added.json.revision, 1);
  await put(request, ash.cookie, rook, "i:6468", { sourceDungeon: "Wailing Caverns" });
  await put(request, ash.cookie, rook, "i:5193");

  let list = (await wishlist(request, ash.cookie, rook)).json;
  assert.deepEqual(list.items.map((item) => item.itemId), [5191, 6468, 5193], "items of two dungeons on one list");
  const barb = entry(list, 5191);
  assert.equal(barb.item.name, "Cruel Barb");
  assert.equal(barb.item.slot, "One-Hand");
  assert.equal(barb.origin, "manual");
  assert.equal(barb.state, "wanted");
  assert.ok(barb.addedAt > 0);
  assert.deepEqual(barb.sources.map((source) => [source.dungeon, source.source, source.confidence]), [["The Deadmines", "Edwin VanCleef", "confirmed"]]);
  assert.equal(entry(list, 6468).sources[0].dungeon, "Wailing Caverns");

  // The same item again is the same entry, not a second one.
  const again = await put(request, ash.cookie, rook, "i:5191", { note: "Tank set" });
  assert.equal(again.json.status, "updated");
  assert.equal(again.json.items.length, 3);
  assert.equal(entry(again.json, 5191).note, "Tank set");
  assert.equal(entry(again.json, 5191).priority, "high", "fields not sent are kept");

  // A variant is its own identity beside the base item.
  assert.equal((await put(request, ash.cookie, rook, "i:6468:s-1081")).json.status, "created");
  assert.equal((await put(request, ash.cookie, rook, "i:6468:s-1081")).json.status, "updated");
  list = (await wishlist(request, ash.cookie, rook)).json;
  assert.deepEqual(list.items.filter((item) => item.itemId === 6468).map((item) => item.itemKey), ["i:6468", "i:6468:s-1081"]);

  const moved = await patch(request, ash.cookie, rook, "i:5193", { move: "up", priority: "low" });
  assert.deepEqual(moved.json.items.map((item) => item.itemKey), ["i:5191", "i:5193", "i:6468", "i:6468:s-1081"]);
  assert.equal(entry(moved.json, 5193).priority, "low");

  for (const [key, body] of [["i:5191", { priority: "urgent" }], ["i:5191", { note: "x".repeat(141) }], ["i:5191", { state: "lost" }], ["i:5191", { move: "sideways" }]]) {
    assert.equal((await patch(request, ash.cookie, rook, key, body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await put(request, ash.cookie, rook, "not-an-item")).status, 400);
  assert.equal((await put(request, ash.cookie, rook, "i:424242")).status, 422, "an item the website has never seen cannot be wished for");
  assert.equal((await patch(request, ash.cookie, rook, "i:2168", { priority: "low" })).status, 404, "not on the list");

  const before = (await wishlist(request, ash.cookie, rook)).json.revision;
  const removed = await request(`/api/player/wishlists/${rook}/items/i:5193`, { method: "DELETE", rawCookie: ash.cookie });
  assert.equal(removed.json.status, "deleted");
  assert.equal(removed.json.items.length, 3);
  assert.equal(removed.json.revision, before + 1, "every change moves the revision");
  const summary = (await request("/api/player/wishlists", { rawCookie: ash.cookie })).json;
  assert.deepEqual(summary.characters, [{ characterId: rook, items: 3, wanted: 3 }]);
}));

test("offered is not acquired: only owning it or winning the roll is, and acquired items stay", () => withHttpApp(async ({ request }) => {
  const { ash, rook, fern } = await setup(request);
  await put(request, ash.cookie, rook, "i:5191");
  await put(request, ash.cookie, rook, "i:5193");
  await put(request, ash.cookie, rook, "i:6468");

  // Seen in a loot window (setup) and offered in a roll: still wanted.
  const rolledAt = Math.floor(Date.now() / 1000) + 5;
  await lootRoll(request, ash.token, { rollKey: "character-rook:1:1", itemId: 5191, startedAt: rolledAt });
  let list = (await wishlist(request, ash.cookie, rook)).json;
  const barb = entry(list, 5191);
  assert.equal(barb.state, "wanted", "a roll is an offer to the group");
  assert.ok(barb.evidence.seenInLootWindowAt, "the player's own loot window sighting");
  assert.ok(barb.evidence.offeredInRollAt);
  assert.equal(barb.evidence.wonAt, null);
  assert.equal(barb.evidence.ownedCount, null, "no bags synced yet: ownership unknown, not zero");
  assert.equal(list.ownershipKnown, false);

  // The game reported the roll as won.
  await lootRoll(request, ash.token, { rollKey: "character-rook:1:1", itemId: 5191, outcome: "won", startedAt: rolledAt, revision: 2 });
  list = (await wishlist(request, ash.cookie, rook)).json;
  assert.equal(entry(list, 5191).state, "acquired");
  assert.equal(entry(list, 5191).acquiredBasis, "roll_won");
  assert.equal(list.items.length, 3, "acquired items are not removed");

  // The bags arrive with the cape in them.
  assert.equal((await syncInventory(request, ash.token, "character-rook", [5193])).status, 201);
  list = (await wishlist(request, ash.cookie, rook)).json;
  assert.equal(entry(list, 5193).state, "acquired");
  assert.equal(entry(list, 5193).acquiredBasis, "owned");
  assert.equal(entry(list, 5193).evidence.ownedCount, 1);
  assert.equal(entry(list, 6468).state, "wanted");
  assert.equal(entry(list, 6468).evidence.ownedCount, 0);
  const acquiredRevision = list.revision;

  // Wanted again for another copy: the copy already owned does not count.
  const again = await patch(request, ash.cookie, rook, "i:5193", { state: "wanted" });
  assert.equal(entry(again.json, 5193).state, "wanted");
  assert.ok(again.json.revision > acquiredRevision);
  list = (await wishlist(request, ash.cookie, rook)).json;
  assert.equal(entry(list, 5193).state, "wanted", "still wanted on the next read");
  // The old win does not re-acquire the barb either once it is wanted again.
  await patch(request, ash.cookie, rook, "i:5191", { state: "wanted" });
  assert.equal(entry((await wishlist(request, ash.cookie, rook)).json, 5191).state, "wanted");

  // A manual mark, for loot Guildweaver was not running for.
  const manual = await patch(request, ash.cookie, rook, "i:6468", { state: "acquired" });
  assert.equal(entry(manual.json, 6468).acquiredBasis, "manual");
  // Another character of the same account owning the item says nothing here.
  await put(request, ash.cookie, fern, "i:5193");
  assert.equal(entry((await wishlist(request, ash.cookie, fern)).json, 5193).state, "wanted");
}));

test("an existing database starts with the loot it already recorded inside dungeons", () => {
  const db = new DatabaseSync(":memory:");
  migrateGuildDatabase(db, { throughVersion: 22 });
  db.prepare(`INSERT INTO dungeon_runs (run_key, run_id, member_id, installation_id, raw_character_id, sequence, status, end_reason, started_at, duration_seconds,
    instance_name, instance_id, instance_type, difficulty_id, difficulty_name, class_token, xp_available, xp_at_level_cap, wallet_available, deaths, bosses_defeated,
    encounter_events, timeline_json, realm, region, game_build, captured_at, received_at)
    VALUES ('k', 'r', 'm', 'i', 'c', 1, 'completed', '', 1, 1, 'The Deadmines', 36, 'party', 1, 'Normal', 'DRUID', 1, 0, 1, 0, 0, 0, '[]', 'Live Realm', 'US', '70338', 1, 'now')`).run();
  const observe = db.prepare(`INSERT INTO game_loot_observations (observation_key, contributor_key, game_build, locale, activity, discipline, source_kind, source_id,
    source_name, instance_id, instance_name, difficulty_id, zone, position_kind, captured_at) VALUES (?, 'c', '70338', 'en_US', 'corpse_loot', 'loot', 'creature', ?, ?, ?, ?, 1, '', 'player_at_loot', ?)`);
  const output = db.prepare("INSERT INTO game_loot_outputs (observation_id, item_id, quantity) VALUES (?, ?, 1)");
  output.run(observe.run("a", 639, "Edwin VanCleef", 36, "The Deadmines", "2026-11-01T00:00:00.000Z").lastInsertRowid, 5191);
  output.run(observe.run("b", 639, "Edwin VanCleef", 36, "The Deadmines", "2026-11-03T00:00:00.000Z").lastInsertRowid, 5191);
  // Open-world loot names a continent as its instance: never a dungeon.
  output.run(observe.run("c", 30, "Forest Spider", 1, "Kalimdor", "2026-11-02T00:00:00.000Z").lastInsertRowid, 2589);

  migrateGuildDatabase(db);
  assert.deepEqual(db.prepare("SELECT instance_id, name, instance_type FROM dungeon_loot_instances").all().map((row) => ({ ...row })),
    [{ instance_id: 36, name: "The Deadmines", instance_type: "party" }]);
  const entries = db.prepare("SELECT * FROM dungeon_loot_entries").all();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].item_id, 5191);
  assert.equal(entries[0].evidence_count, 2);
  assert.equal(entries[0].provenance, "loot_window");
  assert.equal(entries[0].first_seen_at, "2026-11-01T00:00:00.000Z");
  assert.equal(entries[0].last_seen_at, "2026-11-03T00:00:00.000Z");
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'dungeon_loot_revision'").get().value, "1");
  db.close();
});

test("wishlist tables keep what the model promises", () => withHttpApp(async () => {
  withGuildDatabase((db) => {
    const insert = (overrides) => db.prepare(`INSERT INTO character_wishlist_items (member_id, character_id, item_id, item_key, priority, note, origin, state, wanted_since, position, added_at, updated_at)
      VALUES ('m', 'c', 1, ?, ?, ?, ?, ?, 1, 1, 1, 1)`).run(overrides.key || "i:1", overrides.priority || "normal", overrides.note || "", overrides.origin || "manual", overrides.state || "wanted");
    insert({});
    assert.throws(() => insert({}), /UNIQUE/, "one entry per item identity");
    assert.throws(() => insert({ key: "i:1:s2", priority: "urgent" }), /CHECK/);
    assert.throws(() => insert({ key: "i:1:s3", origin: "scraper" }), /CHECK/);
    assert.throws(() => insert({ key: "i:1:s4", state: "deleted" }), /CHECK/);
    assert.throws(() => insert({ key: "i:1:s5", note: "x".repeat(141) }), /CHECK/);
    db.prepare("DELETE FROM character_wishlist_items WHERE member_id = 'm'").run();
  });
}));
