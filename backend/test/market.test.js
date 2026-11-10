import assert from "node:assert/strict";
import test from "node:test";

import { setSession } from "../src/Auth/session.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { createBlizzardAuctionProvider, listingsFromBlizzard } from "../src/Market/blizzardAuctionProvider.js";
import { craftCost } from "../src/Market/marketCrafting.js";
import {
  aggregateListings,
  apiMarketKey,
  clientMarketKey,
  factionFromHouseName,
  itemVariantKey,
  selectObservation,
} from "../src/Market/marketModel.js";
import { backoffSeconds, createMarketRefresher } from "../src/Market/marketRefresh.js";
import {
  pruneMarketDataInDatabase,
  readItemHistory,
  readItemMarket,
  readPrices,
  recordMarketSnapshotInDatabase,
  searchMarket,
} from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const NOW = 1794300000;
const API_MARKET = { marketKey: "api:us:house-113", kind: "api_house", region: "us", rulesetId: 2, houseId: 113, faction: "alliance", name: "US Alliance Auction House (113)" };

function item(itemKey, fields = {}) {
  return { itemKey, itemId: Number(/^i:(\d+)/.exec(itemKey)[1]), minUnitBuyout: 100, typicalUnitBuyout: 110, maxUnitBuyout: 150,
    minUnitBid: null, quantity: 40, listings: 8, bidOnlyListings: 0, ...fields };
}

function snapshot(db, fields) {
  return recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "test", coverage: "full",
    observedAt: NOW - 600, now: NOW, ...fields });
}

test("markets are told apart by region, house and faction, never merged", () => {
  assert.equal(apiMarketKey({ region: "US", houseId: 113, rulesetId: 2 }), "api:us:house-113");
  assert.equal(apiMarketKey({ region: "eu", houseId: 113, rulesetId: 2 }), "api:eu:house-113", "regions stay apart");
  assert.equal(apiMarketKey({ region: "us", houseId: 113, rulesetId: 2, rulesetScoped: true }), "api:us:ruleset-2:house-113");
  assert.notEqual(apiMarketKey({ region: "us", houseId: 113, rulesetId: 1, rulesetScoped: true }), apiMarketKey({ region: "us", houseId: 113, rulesetId: 2, rulesetScoped: true }));
  assert.equal(apiMarketKey({ region: "cn", houseId: 1 }), null);
  assert.equal(clientMarketKey({ region: "US", realm: "Normal", faction: "Alliance" }), "game:us:normal:alliance");
  assert.notEqual(clientMarketKey({ region: "us", realm: "Normal", faction: "horde" }), clientMarketKey({ region: "us", realm: "Normal", faction: "neutral" }));
  assert.equal(clientMarketKey({ region: "us", realm: "Normal", faction: "" }), null, "unknown faction is not a market");
  assert.equal(factionFromHouseName("Blackwater Auction House"), "neutral");
  assert.equal(factionFromHouseName("Horde Auction House"), "horde");
});

test("item variants and unit prices are normalized, never mixed", () => {
  assert.equal(itemVariantKey({ itemId: 2589 }), "i:2589");
  assert.equal(itemVariantKey({ itemId: 15210, suffix: -1081 }), "i:15210:s-1081", "random suffix is its own variant");
  assert.equal(itemVariantKey({ itemId: 1, bonusLists: [9, 3, 3] }), "i:1:b3.9");
  const [cloth, sword] = aggregateListings([
    { itemId: 2589, quantity: 20, buyout: 2000 }, // stack buyout → 100 each
    { itemId: 2589, quantity: 5, unitPrice: 120 },
    { itemId: 2589, quantity: 1, buyout: 999999 }, // outlier
    { itemId: 2589, quantity: 10, bid: 500 }, // bid only
    { itemId: 15210, suffix: -1081, quantity: 1, buyout: 50000, bid: 40000 },
  ]).sort((a, b) => a.itemId - b.itemId);
  assert.equal(cloth.minUnitBuyout, 100);
  assert.equal(cloth.typicalUnitBuyout, 100, "outliers do not move the typical price");
  assert.equal(cloth.quantity, 36);
  assert.equal(cloth.listings, 4);
  assert.equal(cloth.bidOnlyListings, 1);
  assert.equal(cloth.minUnitBid, 50);
  assert.equal(sword.itemKey, "i:15210:s-1081");
  assert.equal(sword.minUnitBuyout, 50000);
  const listings = listingsFromBlizzard([{ id: 1, item: { id: 7, bonus_lists: [2] }, quantity: 2, buyout: 300 }, { id: 2, item: {}, quantity: 1 }]);
  assert.deepEqual(listings, [{ itemId: 7, bonusLists: [2], quantity: 2, buyout: 300, bid: undefined }]);
  assert.equal(listingsFromBlizzard([{ item: { id: 8 }, quantity: 3, unit_price: 40 }], { commodity: true })[0].unitPrice, 40);
});

test("source rules: fresh complete scans win, old scans do not, partial views never replace complete ones", () => {
  const scan = (fields) => ({ sourceType: "addon_scan", complete: true, observedAt: NOW - 600, minUnitBuyout: 100, typicalUnitBuyout: 100, ...fields });
  const api = (fields) => ({ sourceType: "official_api", complete: true, observedAt: NOW - 900, minUnitBuyout: 140, typicalUnitBuyout: 140, ...fields });
  let result = selectObservation([api(), scan()], { now: NOW });
  assert.equal(result.chosen.sourceType, "addon_scan", "same-period in-game scan wins");
  assert.equal(result.conflict, true, "disagreement is flagged");
  assert.match(result.reason, /preferred over Blizzard API snapshot/);
  result = selectObservation([api({ observedAt: NOW - 600 }), scan({ observedAt: NOW - 3 * 86400 })], { now: NOW });
  assert.equal(result.chosen.sourceType, "official_api", "an old scan does not beat a newer API snapshot");
  assert.match(result.reason, /older in-game scan not used/);
  result = selectObservation([api({ observedAt: NOW - 5000 }), scan({ observedAt: NOW - 60, complete: false, minUnitBuyout: 999 })], { now: NOW });
  assert.equal(result.chosen.sourceType, "official_api", "a newer partial view does not replace a complete one");
  assert.match(result.reason, /newer in-game scan is partial/);
  result = selectObservation([scan({ complete: false })], { now: NOW });
  assert.equal(result.chosen.complete, false, "partial only when nothing else");
  assert.equal(selectObservation([], { now: NOW }), null);
});

test("snapshots: duplicates, summaries, history, linked markets and retention", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    assert.equal(snapshot(db, { items: [item("i:2589")] }).status, "recorded");
    assert.equal(snapshot(db, { items: [item("i:2589")] }).status, "duplicate", "a retried snapshot is stored once");
    assert.equal(snapshot(db, { items: [] }).status, "empty");
    assert.equal(snapshot(db, { items: [item("i:2589")], observedAt: NOW + 3600 }).status, "invalid", "future timestamps rejected");
    // A day later, a cheaper complete snapshot.
    assert.equal(snapshot(db, { items: [item("i:2589", { minUnitBuyout: 80, typicalUnitBuyout: 88 })], observedAt: NOW + 86400 - 600, now: NOW + 86400 }).status, "recorded");
  });
  const market = readItemMarket({ itemId: 2589, marketKey: API_MARKET.marketKey, now: NOW + 86400 });
  assert.equal(market.markets.length, 1);
  assert.equal(market.markets[0].minUnitBuyout, 80);
  assert.equal(market.markets[0].change24hPct, -20, "change against the previous day");
  assert.equal(market.markets[0].source, "official_api");
  assert.equal(market.evidence.length, 2);
  const history = readItemHistory({ itemId: 2589, marketKey: API_MARKET.marketKey, range: "7d", now: NOW + 86400 });
  assert.equal(history.points.length, 2);
  assert.match(history.basis, /not counted as sales/);

  // An in-game market stays separate until an administrator links it.
  withGuildTransaction((db) => {
    const game = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "US Normal Alliance (in-game)" };
    recordMarketSnapshotInDatabase(db, { market: game, sourceType: "addon_scan", sourceId: "scan:1", coverage: "items",
      observedAt: NOW + 86400 - 60, now: NOW + 86400, items: [item("i:2589", { minUnitBuyout: 70, typicalUnitBuyout: 75 })] });
    assert.equal(db.prepare("SELECT source_type FROM market_summaries WHERE market_key = ? AND item_key = 'i:2589'").get(API_MARKET.marketKey).source_type, "official_api", "not merged silently");
    db.prepare("UPDATE market_markets SET linked_market_key = ? WHERE market_key = ?").run(API_MARKET.marketKey, game.marketKey);
    recordMarketSnapshotInDatabase(db, { market: game, sourceType: "addon_scan", sourceId: "scan:2", coverage: "items",
      observedAt: NOW + 86400 - 30, now: NOW + 86400, items: [item("i:2589", { minUnitBuyout: 71, typicalUnitBuyout: 75 })] });
    const summary = db.prepare("SELECT * FROM market_summaries WHERE market_key = ? AND item_key = 'i:2589'").get(API_MARKET.marketKey);
    assert.equal(summary.source_type, "addon_scan", "a linked same-period in-game scan is preferred");
    assert.match(summary.selection_reason, /preferred over Blizzard API snapshot/);
  });

  withGuildTransaction((db) => {
    const removed = pruneMarketDataInDatabase(db, NOW + 20 * 86400);
    assert.ok(removed.observations > 0, "old observations pruned");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM market_observations").get().n, 0);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM market_history").get().n > 0, "history kept");
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM market_summaries").get().n > 0, "summaries kept");
  });
}));

test("search filters, sorts and pages; prices batch", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
      VALUES (?, '70338', 'enUS', ?, 1, NULL, ?, '2026-11-01')`);
    insert.run(2589, "Linen Cloth", JSON.stringify({ itemClass: { id: 7, name: "Trade Goods" } }));
    insert.run(2592, "Wool Cloth", JSON.stringify({ itemClass: { id: 7, name: "Trade Goods" } }));
    insert.run(2770, "Copper Ore", JSON.stringify({ itemClass: { id: 7, name: "Trade Goods" } }));
    insert.run(25, "Worn Shortsword", JSON.stringify({ itemClass: { id: 2, name: "Weapon" } }));
    const items = [item("i:2589", { minUnitBuyout: 10 }), item("i:2592", { minUnitBuyout: 30 }), item("i:2770", { minUnitBuyout: 20 }), item("i:25", { minUnitBuyout: 500 })];
    for (let id = 100000; id < 100060; id += 1) items.push(item(`i:${id}`));
    snapshot(db, { items });
  });
  let result = searchMarket({ marketKey: API_MARKET.marketKey, q: "cloth", now: NOW });
  assert.deepEqual(result.results.map((row) => row.item.name), ["Linen Cloth", "Wool Cloth"]);
  result = searchMarket({ marketKey: API_MARKET.marketKey, category: "Trade Goods", sort: "price", direction: "desc", now: NOW });
  assert.deepEqual(result.results.map((row) => row.item.itemId), [2592, 2770, 2589]);
  assert.ok(result.categories.some((entry) => entry.name === "Weapon"));
  result = searchMarket({ marketKey: API_MARKET.marketKey, q: "2770", now: NOW });
  assert.equal(result.results[0].item.name, "Copper Ore", "item id search");
  const page2 = searchMarket({ marketKey: API_MARKET.marketKey, sort: "name", page: 2, pageSize: 50, now: NOW });
  assert.equal(page2.total, 64);
  assert.equal(page2.results.length, 14);
  assert.equal(page2.results[0].item.nameKnown, false, "unnamed items still listed");
  assert.equal(searchMarket({ marketKey: "api:us:house-999" }), null);
  const prices = readPrices({ marketKey: API_MARKET.marketKey, itemIds: [2589, 25, 424242], now: NOW });
  assert.deepEqual(prices.prices.map((entry) => entry.item.itemId).sort((a, b) => a - b), [25, 2589]);
}));

test("crafting cost never claims a margin without prices", () => {
  const recipe = { recipeId: 1, name: "Bolt", craftedItemId: 2996, minQuantity: 1, maxQuantity: 1,
    reagents: [{ itemId: 2589, quantity: 2, optional: false }, { itemId: 9999, quantity: 1, optional: true }] };
  const priced = new Map([[2589, { minUnitBuyout: 100, typicalUnitBuyout: 110, stale: false }], [2996, { minUnitBuyout: 400, typicalUnitBuyout: 500, stale: false }]]);
  const cost = craftCost(recipe, priced);
  assert.equal(cost.materialCost, 200, "optional reagents not required");
  assert.equal(cost.revenueAfterCut, 475, "5% cut");
  assert.equal(cost.margin, 275);
  assert.equal(craftCost(recipe, priced, { neutral: true }).revenueAfterCut, 425, "15% at the neutral house");
  const missing = craftCost(recipe, new Map([[2996, { minUnitBuyout: 400 }]]));
  assert.equal(missing.margin, null);
  assert.deepEqual(missing.missingPrices, [2589]);
});

function fakeBlizzard({ houses = [{ id: 113, name: "Alliance Auction House" }, { id: 116, name: "Horde Auction House" }], fail = new Set(), lastModified = "Tue, 10 Nov 2026 10:00:00 GMT" } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = String(url).replace(/^https:\/\/us\.api\.blizzard\.com/, "").replace(/\?.*$/, "");
    calls.push({ path, headers: options.headers || {} });
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    if (String(url).includes("oauth")) return json({ access_token: "token", expires_in: 3600 });
    if (path === "/data/wow/ruleset/index") return json({ rulesets: [{ id: 3 }, { id: 2 }] });
    if (path === "/data/wow/ruleset/2/auctions/") return json({ auctions: houses });
    const match = /\/auctions\/(\d+)(\/commodities)?$/.exec(path);
    if (match && fail.has(Number(match[1]))) return json({}, 503);
    if (match && options.headers?.["If-Modified-Since"] === lastModified) return new Response(null, { status: 304 });
    if (match && match[2]) return json({ auctions: [{ id: 9, item: { id: 2589 }, quantity: 200, unit_price: 12, time_left: "LONG" }] });
    if (match) return json({ id: Number(match[1]), auctions: [{ id: 1, item: { id: 25 }, quantity: 1, buyout: 900, time_left: "LONG" }] }, 200, { "last-modified": lastModified });
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

const ENV = { BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret", MARKET_BLIZZARD_REGIONS: "us" };
const quiet = { info() {}, warn() {}, error() {} };

test("provider: discovers houses, stores snapshots, skips unchanged data, backs off and keeps the last good data", () => withHttpApp(async () => {
  let clock = NOW * 1000;
  const now = () => clock;
  const blizzard = fakeBlizzard({ fail: new Set() });
  const provider = createBlizzardAuctionProvider({ env: ENV, fetchImpl: blizzard.fetchImpl, now });
  const refresher = createMarketRefresher({ provider, now, log: quiet });
  assert.equal((await refresher.tick()).status, "recorded");
  assert.equal((await refresher.tick()).status, "recorded", "second house");
  assert.equal((await refresher.tick()).status, "idle", "nothing due");
  const markets = withGuildDatabase((db) => db.prepare("SELECT * FROM market_markets ORDER BY market_key").all());
  assert.deepEqual(markets.map((row) => [row.market_key, row.faction, row.ruleset_id]), [["api:us:house-113", "alliance", 2], ["api:us:house-116", "horde", 2]]);
  const prices = readPrices({ marketKey: "api:us:house-113", itemIds: [25, 2589], now: NOW });
  assert.equal(prices.prices.length, 2, "auctions and commodities");
  assert.ok(blizzard.calls.some((call) => call.path === "/data/wow/ruleset/2/auctions/"), "trailing slash kept");

  // Due again (no one uses these houses: 4× the interval) → 304 unchanged.
  clock += 5 * 3600 * 1000;
  assert.equal((await refresher.tick()).status, "unchanged");

  // Outage: failures back off and the stored prices stay.
  const failing = fakeBlizzard({ fail: new Set([113, 116]), lastModified: "x" });
  const down = createMarketRefresher({ provider: createBlizzardAuctionProvider({ env: ENV, fetchImpl: failing.fetchImpl, now }), now, log: quiet });
  clock += 5 * 3600 * 1000;
  assert.equal((await down.tick()).status, "failed");
  const state = withGuildDatabase((db) => db.prepare("SELECT * FROM market_provider_state WHERE consecutive_failures > 0").get());
  assert.equal(state.consecutive_failures, 1);
  assert.equal(state.next_due_at - Math.floor(clock / 1000), backoffSeconds(1));
  assert.equal(readPrices({ marketKey: "api:us:house-113", itemIds: [25], now: Math.floor(clock / 1000) }).prices[0].stale, false, "last good data still served");
  assert.equal(backoffSeconds(10), 6 * 3600, "backoff is capped");
}));

test("provider: rate limit and missing credentials", async () => {
  const blizzard = fakeBlizzard();
  const limited = createBlizzardAuctionProvider({ env: { ...ENV, MARKET_BLIZZARD_MAX_REQUESTS_PER_HOUR: "10" }, fetchImpl: blizzard.fetchImpl });
  let refused = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try { await limited.discoverMarkets("us"); } catch (error) { if (error.code === "rate_limited") refused += 1; }
  }
  assert.ok(refused > 0, "requests past the hourly limit are refused");
  assert.ok(blizzard.calls.length <= 10, "never more than the limit sent");
  assert.equal(createBlizzardAuctionProvider({ env: {} }).configured(), false);
});

function cookie(user) {
  let header;
  setSession({ append(_name, value) { header = value; } }, { user, permissions: [], homeServer: false, verifiedAt: Date.now() });
  return header.split(";", 1)[0];
}

test("favorites and shopping lists are private to their owner", () => withHttpApp(async ({ request }) => {
  const ash = cookie({ id: "market-ash", username: "ash" });
  const bram = cookie({ id: "market-bram", username: "bram" });
  assert.equal((await request("/api/market/favorites")).status, 401);
  assert.equal((await request("/api/market/favorites/2589", { method: "PUT", rawCookie: ash })).status, 200);
  assert.equal((await request("/api/market/favorites", { rawCookie: ash })).json.favorites.length, 1);
  assert.equal((await request("/api/market/favorites", { rawCookie: bram })).json.favorites.length, 0);
  const created = await request("/api/market/lists", { method: "POST", rawCookie: ash, body: { name: "Bandages", purpose: "crafting" } });
  assert.equal(created.status, 200, created.text);
  const listId = created.json.list.id;
  assert.equal((await request(`/api/market/lists/${listId}/items/2589`, { method: "PUT", rawCookie: ash, body: { quantity: 40 } })).status, 200);
  assert.equal((await request(`/api/market/lists/${listId}/items/2589`, { method: "PUT", rawCookie: bram, body: { quantity: 1 } })).status, 404, "not someone else's list");
  assert.equal((await request(`/api/market/lists/${listId}`, { method: "DELETE", rawCookie: bram })).status, 404);
  assert.equal((await request(`/api/market/lists/${listId}/items/2589`, { method: "PUT", rawCookie: ash, body: { quantity: 0 } })).status, 400);
  const lists = (await request("/api/market/lists", { rawCookie: ash })).json.lists;
  assert.equal(lists[0].items[0].quantity, 40);
  assert.equal(lists[0].estimate.missingPrices, 1, "unpriced items counted, not guessed");
  assert.equal((await request("/api/market/lists", { rawCookie: bram })).json.lists.length, 0);
  assert.equal((await request("/api/market/searches", { method: "POST", rawCookie: ash, body: { name: "Cloth", query: { q: "cloth", evil: "x" } } })).json.search.query.evil, undefined);
  assert.equal((await request("/api/market/searches", { rawCookie: bram })).json.searches.length, 0);
  assert.equal((await request("/api/market/admin/status", { rawCookie: ash })).status, 403);
}));

test("in-game scans are validated, deduplicated and anonymous", () => withHttpApp(async () => {
  const envelope = (fields = {}) => ({
    schemaVersion: 1, eventType: "auction_scan", capturedAt: NOW, characterId: "character-rook", installationId: "install-1",
    realm: "Normal", region: "US", gameBuild: { build: "70338" }, payloadSchemaVersion: 1,
    payload: { schemaVersion: 1, scanId: "scan-1-1", observedAt: NOW - 30, market: { faction: "alliance" }, query: { kind: "commodity" },
      coverage: "items", items: [{ itemId: 2589, quantity: 220, listings: 6, complete: true, prices: [[12, 200, 5], [15, 20, 1]] }], ...fields },
  });
  let nonce = 0;
  const send = (env) => ingestTelemetry({ memberId: "market-ash", deviceId: "device-1", idempotencyKey: `scan-${nonce += 1}`,
    body: { kind: "event", revision: 1, streamKey: `auction_scan:character-rook:${env.payload.scanId}`, envelope: env } });
  assert.equal(send(envelope()).recordedEvent.status, "recorded");
  assert.equal(send({ ...envelope(), payload: { ...envelope().payload, scanId: "scan-1-2" } }).recordedEvent.status, "duplicate", "same results twice store once");
  for (const bad of [{ market: { faction: "pirates" } }, { coverage: "most" }, { items: [] },
    { items: [{ itemId: 1, quantity: 1, prices: Array.from({ length: 21 }, () => [1, 1]) }] }, { query: { kind: "buyout_everything" } }]) {
    assert.equal(send(envelope({ ...bad, scanId: `bad-${nonce}` })).status, "invalid", JSON.stringify(bad));
  }
  const row = withGuildDatabase((db) => db.prepare("SELECT * FROM market_snapshots").get());
  assert.equal(row.market_key, "game:us:normal:alliance");
  assert.notEqual(row.contributor_key, "market-ash");
  assert.equal(row.contributor_key.length, 16, "contributor is a hash");
  const summary = withGuildDatabase((db) => db.prepare("SELECT * FROM market_summaries").get());
  assert.equal(summary.min_unit_buyout, 12);
  assert.equal(summary.quantity, 220, "the item's total, not just the cheapest listings");
  assert.equal(summary.listings, 6);
  const columns = withGuildDatabase((db) => ["market_snapshots", "market_observations", "market_summaries", "market_history"]
    .flatMap((table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)));
  assert.equal(columns.some((name) => /member|character|device/.test(name)), false, "shared market tables name no player");
}));

test("the shared add-on fixture ingests into its in-game market", () => withHttpApp(async () => {
  const { readFileSync } = await import("node:fs");
  const envelope = JSON.parse(readFileSync(new URL("./fixtures/guildweaver-auction-scan.v1.json", import.meta.url), "utf8"));
  envelope.payload.observedAt = Math.floor(Date.now() / 1000) - 30;
  const result = ingestTelemetry({ memberId: "market-fixture", deviceId: "device-fixture", idempotencyKey: "fixture-1",
    body: { kind: "event", revision: 1, streamKey: `auction_scan:character-rook:${envelope.payload.scanId}`, envelope } });
  assert.equal(result.recordedEvent.status, "recorded");
  const rows = withGuildDatabase((db) => db.prepare("SELECT item_key, min_unit_buyout, quantity, source_type FROM market_summaries ORDER BY item_key").all());
  assert.deepEqual(rows.map((row) => row.item_key), ["i:15210:s-1081", "i:2589"]);
  assert.equal(rows.find((row) => row.item_key === "i:2589").min_unit_buyout, 12);
  assert.ok(rows.every((row) => row.source_type === "addon_scan"));
}));
