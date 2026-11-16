import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { BOE_FLOOR_COPPER, BOE_MAX_ITEMS, boeWatchlistInDatabase, credibleBoeValue, resetBoeWatchlistCache } from "../src/Loot/boeWatchlist.js";
import { lootSnapshotDigest } from "../src/Loot/lootBridge.js";
import { recordMarketSnapshotInDatabase } from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { ITEMS, connect, corpseLoot, seedItems, syncCharacter, syncInventory } from "../testSupport/lootHarness.js";

// What the bridge fetches for the add-on: wishlists by character, and a
// short list of Bind-on-Equip items whose value on the character's own
// auction house is credible.

const ASH = { id: "discord-bridge-ash", username: "ash" };
const BRAM = { id: "discord-bridge-bram", username: "bram" };
const NOW = Math.floor(Date.now() / 1000);
const ALLIANCE = { marketKey: "game:us:live-realm:alliance", kind: "client_house", region: "us", realm: "Live Realm", faction: "alliance", name: "Live Realm Alliance" };
const HORDE = { ...ALLIANCE, marketKey: "game:us:live-realm:horde", faction: "horde", name: "Live Realm Horde" };
const listing = (itemKey, minUnitBuyout, extra = {}) => ({ itemKey, itemId: Number(itemKey.split(":")[1]), minUnitBuyout, typicalUnitBuyout: minUnitBuyout + 5,
  maxUnitBuyout: minUnitBuyout * 2, minUnitBid: null, quantity: 40, listings: 3, bidOnlyListings: 0, ...extra });

test("a gold alert needs a confirmed BoE and a credible, fresh price", () => {
  const good = { minUnitBuyout: 250000, typicalUnitBuyout: 260000, quantity: 4, listings: 3, stale: false, confidence: "medium", conflict: false, referencePrice: null, referenceDays: 0 };
  assert.deepEqual(credibleBoeValue(good, { bindType: 2 }), { value: 250000, confidence: "medium" });
  assert.equal(credibleBoeValue(good, { bindType: 1 }), null, "Binds when picked up");
  assert.equal(credibleBoeValue(good, { bindType: null }), null, "binding unknown");
  assert.equal(credibleBoeValue(good, {}), null);
  assert.equal(credibleBoeValue({ ...good, stale: true }, { bindType: 2 }), null, "stale price");
  assert.equal(credibleBoeValue({ ...good, confidence: "low" }, { bindType: 2 }), null, "partial or thin reading");
  assert.equal(credibleBoeValue({ ...good, listings: 1 }, { bindType: 2 }), null, "one asking price is not a market");
  assert.equal(credibleBoeValue({ ...good, quantity: 0 }, { bindType: 2 }), null, "none listed");
  assert.equal(credibleBoeValue({ ...good, minUnitBuyout: null, typicalUnitBuyout: null }, { bindType: 2 }), null, "no price");
  assert.equal(credibleBoeValue({ ...good, minUnitBuyout: BOE_FLOOR_COPPER - 1, typicalUnitBuyout: null }, { bindType: 2 }), null, "below the floor");
  assert.equal(credibleBoeValue(null, { bindType: 2 }), null);
  // A 14-day reference price backs a single listing, and caps a high ask.
  assert.deepEqual(credibleBoeValue({ ...good, listings: 1, referencePrice: 180000, referenceDays: 5, confidence: "high" }, { bindType: 2 }), { value: 180000, confidence: "high" });
  assert.deepEqual(credibleBoeValue({ ...good, referencePrice: 180000, referenceDays: 5, confidence: "high", conflict: true }, { bindType: 2 }), { value: 180000, confidence: "medium" });
  assert.equal(credibleBoeValue({ ...good, listings: 1, referencePrice: 180000, referenceDays: 2 }, { bindType: 2 }), null, "two days are not a reference");
});

function seedMarkets() {
  resetBoeWatchlistCache();
  withGuildTransaction((db) => {
    recordMarketSnapshotInDatabase(db, { market: ALLIANCE, sourceType: "addon_scan", sourceId: "boe-a", coverage: "items", observedAt: NOW - 600, now: NOW, items: [
      listing("i:6694", 250000),                       // BoE, three listings
      listing("i:6468", 80000, { listings: 1, quantity: 1 }), // BoE, a single ask
      listing("i:6468:s-1081", 300000),                // its "of the Bear" variant, valued on its own
      listing("i:2168", 5000),                         // BoE, cheap
      listing("i:5191", 900000),                       // Binds when picked up
      listing("i:8888", 500000),                       // nobody's game has described it
    ] });
    // The other faction's house: the same shield, seen two days ago.
    recordMarketSnapshotInDatabase(db, { market: HORDE, sourceType: "addon_scan", sourceId: "boe-h", coverage: "items", observedAt: NOW - 2 * 86400, now: NOW,
      items: [listing("i:6694", 9999999)] });
  });
}

test("the watchlist is computed from the market's own summaries, bounded and exact per variant", () => withHttpApp(async () => {
  seedItems();
  seedMarkets();
  const alliance = withGuildDatabase((db) => boeWatchlistInDatabase(db, ALLIANCE.marketKey, { now: NOW }));
  assert.deepEqual(alliance.map((item) => [item.itemKey, item.value, item.confidence]), [["i:6468:s-1081", 300000, "medium"], ["i:6694", 250000, "medium"]]);
  assert.equal(alliance[1].observedAt, NOW - 600, "freshness travels with the value");
  assert.ok(alliance.length <= BOE_MAX_ITEMS);
  resetBoeWatchlistCache();
  assert.deepEqual(withGuildDatabase((db) => boeWatchlistInDatabase(db, HORDE.marketKey, { now: NOW })), [], "a stale price never alerts");
  // A reference price from the market's history raises the confidence and caps the value.
  withGuildDatabase((db) => db.prepare("UPDATE market_summaries SET reference_price = 200000, reference_days = 6 WHERE market_key = ? AND item_key = 'i:6694'").run(ALLIANCE.marketKey));
  resetBoeWatchlistCache();
  const referenced = withGuildDatabase((db) => boeWatchlistInDatabase(db, ALLIANCE.marketKey, { now: NOW }));
  assert.deepEqual(referenced.find((item) => item.itemKey === "i:6694"), { itemKey: "i:6694", itemId: 6694, value: 200000, observedAt: NOW - 600, confidence: "high" });
  // A day later the same reading is stale.
  resetBoeWatchlistCache();
  assert.deepEqual(withGuildDatabase((db) => boeWatchlistInDatabase(db, ALLIANCE.marketKey, { now: NOW + 86400 + 3600 })), []);
}));

const snapshot = (request, token, headers = {}) => request("/api/bridge/loot/snapshot", { headers: { Authorization: `Bearer ${token}`, ...headers } });

test("the bridge snapshot: wishlists by character, the right market, its own revision and digest", () => withHttpApp(async ({ request }) => {
  seedItems();
  seedMarkets();
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  const rook = await syncCharacter(request, ash.token, "character-rook", "Rook Shepard");
  const fern = await syncCharacter(request, ash.token, "character-fern", "Fern", { race: { id: 2, name: "Orc", token: "Orc" } });
  const moss = await syncCharacter(request, ash.token, "character-moss", "Moss", { race: { id: 99, name: "Unknown", token: "Unknown" } });
  await syncCharacter(request, bram.token, "character-thorn", "Thorn");
  await corpseLoot(request, ash.token, { npcId: 639, npcName: "Edwin VanCleef", serial: 1, items: [ITEMS.barb, ITEMS.cape] });
  const put = (cookie, character, key, body = {}) => request(`/api/player/wishlists/${character}/items/${key}`, { method: "PUT", rawCookie: cookie, body });

  assert.equal((await request("/api/bridge/loot/snapshot")).status, 401);
  assert.equal((await snapshot(request, "gwd_not_a_token")).status, 401);

  const empty = await snapshot(request, ash.token);
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.json.schemaVersion, 1);
  assert.equal(empty.json.revision, 0, "no wishlist yet");
  assert.equal(empty.json.characters.length, 3);
  assert.ok(empty.json.characters.every((character) => character.wishlist.items.length === 0));
  assert.match(empty.json.digest, /^[0-9a-f]{16}$/);

  await put(ash.cookie, rook, "i:5193", { priority: "low" });
  await put(ash.cookie, rook, "i:5191", { priority: "high", note: "Main hand\nuntil 30" });
  await put(ash.cookie, fern, "i:6468:s-1081");
  await put(bram.cookie, (await request("/api/player/characters", { rawCookie: bram.cookie })).json.characters[0].id, "i:6694");

  const first = (await snapshot(request, ash.token)).json;
  assert.equal(first.revision, 3, "the account's counter moved once per change");
  assert.notEqual(first.digest, empty.json.digest);
  const byName = Object.fromEntries(first.characters.map((character) => [character.name, character]));
  assert.deepEqual(Object.keys(byName).sort(), ["Fern", "Moss", "Rook Shepard"], "only this account's characters");
  assert.deepEqual(byName["Rook Shepard"].aliases, ["character-rook"], "the add-on's own id for the character");
  assert.equal(byName["Rook Shepard"].realm, "Live Realm");
  assert.equal(byName["Rook Shepard"].marketKey, ALLIANCE.marketKey, "a Night Elf sells on the Alliance house of its realm");
  assert.deepEqual(byName["Rook Shepard"].wishlist.items.map((item) => [item.itemId, item.itemKey, item.priority, item.name]),
    [[5191, "i:5191", "high", "Cruel Barb"], [5193, "i:5193", "low", "Cape of the Brotherhood"]], "most wanted first");
  assert.equal(byName["Rook Shepard"].wishlist.items[0].note, "Main hand\nuntil 30");
  assert.equal(byName["Rook Shepard"].wishlist.revision, 2);
  assert.equal(byName.Fern.marketKey, HORDE.marketKey, "an Orc sells on the Horde house: never the other faction's prices");
  assert.deepEqual(first.boe.markets[HORDE.marketKey].items, [], "whose only price is stale: nothing to alert on");
  assert.deepEqual(byName.Fern.wishlist.items.map((item) => item.itemKey), ["i:6468:s-1081"]);
  assert.equal(byName.Moss.marketKey, null, "unknown faction: no market is guessed");
  assert.deepEqual(Object.keys(first.boe.markets).sort(), [ALLIANCE.marketKey, HORDE.marketKey]);
  assert.deepEqual(first.boe.markets[ALLIANCE.marketKey].items.map((item) => item.itemKey), ["i:6468:s-1081", "i:6694"]);
  assert.equal(first.boe.floorCopper, BOE_FLOOR_COPPER);
  assert.ok(first.boe.maxAgeSeconds > 0);
  assert.ok(!JSON.stringify(first).includes(BRAM.id) && !JSON.stringify(first).includes("Thorn"));
  const { schemaVersion, generatedAt, digest, ...body } = first;
  assert.equal(digest, lootSnapshotDigest(body), "the digest covers everything but the time");
  assert.ok(schemaVersion && generatedAt);

  // Nothing changed: the same digest, and a conditional request costs no body.
  const again = await snapshot(request, ash.token);
  assert.equal(again.json.digest, first.digest);
  assert.equal(again.headers.get("etag"), `"${first.digest}"`);
  const conditional = await snapshot(request, ash.token, { "If-None-Match": `"${first.digest}"` });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.text, "");

  // The cape arrives in Rook's bags: it stops being sent, and the revision moves.
  assert.equal((await syncInventory(request, ash.token, "character-rook", [5193])).status, 201);
  const acquired = await snapshot(request, ash.token, { "If-None-Match": `"${first.digest}"` });
  assert.equal(acquired.status, 200);
  assert.deepEqual(acquired.json.characters.find((character) => character.id === rook).wishlist.items.map((item) => item.itemId), [5191]);
  assert.ok(acquired.json.revision > first.revision);
  const listed = (await request(`/api/player/wishlists/${rook}`, { rawCookie: ash.cookie })).json;
  assert.equal(listed.items.find((item) => item.itemId === 5193).state, "acquired", "still on the website's list");

  const bramSnapshot = (await snapshot(request, bram.token)).json;
  assert.deepEqual(bramSnapshot.characters.map((character) => character.name), ["Thorn"]);
  assert.equal(bramSnapshot.revision, 1);
  void moss;
}));

test("the snapshot stays bounded however long the wishlist notes are", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, ASH);
  const rook = await syncCharacter(request, ash.token, "character-rook", "Rook");
  await request(`/api/player/wishlists/${rook}/items/i:5191`, { method: "PUT", rawCookie: ash.cookie, body: { note: "n".repeat(140), sourceDungeon: "d".repeat(80) } });
  const body = (await snapshot(request, ash.token)).json;
  assert.equal(body.characters[0].wishlist.items[0].note.length, 140);
  assert.ok(JSON.stringify(body).length < 2000);
  assert.deepEqual(body.boe.markets, {}, "no market data, no watchlist");
  assert.equal(body.characters[0].marketKey, null);
}));
