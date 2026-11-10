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
import { dailyVolatility, gapSeconds, marketMetrics, marketSignals } from "../src/Market/marketAnalysis.js";
import { backoffSeconds, createMarketRefresher } from "../src/Market/marketRefresh.js";
import {
  pruneMarketDataInDatabase,
  readItemAnalysis,
  readItemMarket,
  readItemSeries,
  readMarketDiagnostics,
  readPrices,
  recordMarketSnapshotInDatabase,
  runMarketMaintenanceInDatabase,
  searchMarket,
  setMarketLink,
} from "../src/Market/marketRepository.js";
import { rollUpWeeksInDatabase } from "../src/Market/marketSeries.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const NOW = 1794300000;
const API_MARKET = { marketKey: "api:us:house-113", kind: "api_house", region: "us", rulesetId: 2, houseId: 113, faction: "alliance", name: "US Alliance Auction House (113)" };

function item(itemKey, fields = {}) {
  return { itemKey, itemId: Number(/^i:(\d+)/.exec(itemKey)[1]), minUnitBuyout: 100, typicalUnitBuyout: 110, maxUnitBuyout: 150,
    minUnitBid: null, quantity: 40, listings: 8, bidOnlyListings: 0, ...fields };
}

let sequence = 0;
function snapshot(db, fields) {
  sequence += 1;
  return recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: `test-${sequence}`, coverage: "full",
    observedAt: NOW - 600, now: NOW, ...fields });
}

const GAME = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "US Normal Alliance (in-game)" };

function names(db, entries) {
  const insert = db.prepare(`INSERT OR REPLACE INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (?, '70338', 'enUS', ?, ?, NULL, ?, '2026-11-01')`);
  for (const [id, name, quality = 1, definition = {}] of entries) insert.run(id, name, quality, JSON.stringify(definition));
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


test("aggregates keep the quantity at the lowest price and the cheapest price points", () => {
  const [cloth] = aggregateListings([
    { itemId: 2589, quantity: 2, unitPrice: 10 }, { itemId: 2589, quantity: 3, unitPrice: 10 },
    { itemId: 2589, quantity: 50, unitPrice: 30 }, { itemId: 2589, quantity: 20, unitPrice: 31 },
  ]);
  assert.equal(cloth.minUnitBuyout, 10);
  assert.equal(cloth.minQuantity, 5, "both listings at the lowest price");
  assert.deepEqual(cloth.pricePoints, [[10, 5], [30, 50], [31, 20]]);
});

test("source rules: recency first, sources only outrank within 45 minutes, conflicts explained", () => {
  const scan = (fields) => ({ sourceType: "addon_scan", complete: true, observedAt: NOW - 600, minUnitBuyout: 100, typicalUnitBuyout: 100, ...fields });
  const api = (fields) => ({ sourceType: "official_api", complete: true, observedAt: NOW - 900, minUnitBuyout: 140, typicalUnitBuyout: 140, ...fields });
  let result = selectObservation([api(), scan()], { now: NOW });
  assert.equal(result.chosen.sourceType, "addon_scan", "same-period in-game scan wins");
  assert.equal(result.conflict, true);
  assert.equal(result.conflicts[0].source, "official_api");
  assert.equal(result.conflicts[0].differencePct, 40);
  assert.ok(result.notes.some((note) => note.code === "outranked"));
  result = selectObservation([api({ observedAt: NOW - 600 }), scan({ observedAt: NOW - 600 - 90 * 60 })], { now: NOW });
  assert.equal(result.chosen.sourceType, "official_api", "a scan 90 minutes older does not beat a newer API snapshot");
  result = selectObservation([api({ observedAt: NOW - 5000 }), scan({ observedAt: NOW - 60, complete: false, minUnitBuyout: 999, typicalUnitBuyout: 999 })], { now: NOW });
  assert.equal(result.chosen.sourceType, "official_api", "a complete view under 6 h old beats a newer partial one");
  assert.ok(result.notes.some((note) => note.code === "newer_partial"));
  result = selectObservation([api({ observedAt: NOW - 9 * 3600 }), scan({ observedAt: NOW - 60, complete: false })], { now: NOW });
  assert.equal(result.chosen.sourceType, "addon_scan", "past 6 h a fresh partial view wins");
  assert.match(result.reason, /partial view: .*last complete view is 9 h old/);
  assert.equal(result.conflict, false, "old evidence is not a conflict");
  assert.equal(selectObservation([], { now: NOW }), null);
});

test("retries, unchanged observations and new contents are told apart", () => withHttpApp(async () => {
  const T = NOW - 4 * 3600;
  withGuildTransaction((db) => {
    const first = recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-1", coverage: "full", scope: "api:auctions",
      observedAt: T, now: NOW, items: [item("i:2589")] });
    assert.equal(first.status, "recorded");
    assert.equal(recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-1", coverage: "full", scope: "api:auctions",
      observedAt: T, now: NOW, items: [item("i:2589")] }).status, "duplicate", "a retry changes nothing");
    const again = recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-2", coverage: "full", scope: "api:auctions",
      observedAt: T + 3600, now: NOW, items: [item("i:2589")] });
    assert.equal(again.status, "unchanged", "same contents seen again later");
    assert.equal(again.snapshotId, first.snapshotId);
    assert.equal(recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-replay", coverage: "full", scope: "api:auctions",
      observedAt: T + 1800, now: NOW, items: [item("i:2589")] }).status, "duplicate", "inside the confirmed period: nothing new");
    assert.equal(recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-old", coverage: "full", scope: "api:auctions",
      observedAt: NOW - 8 * 86400, now: NOW, items: [item("i:2589")] }).status, "too_old");
    assert.equal(snapshot(db, { items: [] }).status, "empty");
    assert.equal(snapshot(db, { items: [item("i:2589")], observedAt: NOW + 3600 }).status, "invalid", "future timestamps rejected");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM market_snapshots").get().n, 1, "no redundant full snapshot for an unchanged market");
    const market = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(API_MARKET.marketKey);
    assert.equal(market.last_checked_at, T + 3600, "checked when it was seen again");
    assert.equal(market.last_changed_at, T, "changed when the contents last changed");
    const hours = db.prepare("SELECT hour, samples FROM market_series_hourly ORDER BY hour").all();
    assert.deepEqual(hours.map((row) => row.hour), [Math.floor(T / 3600), Math.floor((T + 3600) / 3600)], "the confirmation is a real observation, at its own time");
    const changed = recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-3", coverage: "full", scope: "api:auctions",
      observedAt: T + 7200, now: NOW, items: [item("i:2589", { minUnitBuyout: 90 })] });
    assert.equal(changed.status, "recorded");
    assert.equal(db.prepare("SELECT last_changed_at FROM market_markets WHERE market_key = ?").get(API_MARKET.marketKey).last_changed_at, T + 7200);
  });
  const shown = readItemMarket({ itemId: 2589, marketKey: API_MARKET.marketKey, now: NOW });
  assert.equal(shown.variants[0].minUnitBuyout, 90);
  assert.equal(shown.variants[0].observedAt, T + 7200);
  // Unchanged prices keep looking current: confirmation moves "seen" forward.
  withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: API_MARKET, sourceType: "official_api", sourceId: "gen-4", coverage: "full", scope: "api:auctions",
    observedAt: NOW - 60, now: NOW, items: [item("i:2589", { minUnitBuyout: 90 })] }));
  const confirmed = readItemMarket({ itemId: 2589, marketKey: API_MARKET.marketKey, now: NOW }).variants[0];
  assert.equal(confirmed.observedAt, NOW - 60, "seen a minute ago");
  assert.equal(confirmed.unchangedSince, T + 7200, "unchanged since two hours ago");
  assert.equal(confirmed.stale, false);
}));

test("a full snapshot records items that disappeared as none listed; searches and scans of other scopes do not", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    snapshot(db, { scope: "api:auctions", observedAt: NOW - 7200, items: [item("i:25"), item("i:26")] });
    const second = snapshot(db, { scope: "api:auctions", observedAt: NOW - 3600, items: [item("i:25")] });
    assert.equal(second.absent, 1);
    // Commodities are their own scope: they never zero auctions.
    snapshot(db, { scope: "api:commodities", observedAt: NOW - 1800, items: [item("i:2589")] });
    // An in-game item search never implies anything about other items.
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "scan:a", coverage: "items", observedAt: NOW - 3000, now: NOW, items: [item("i:25")] });
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "scan:b", coverage: "items", observedAt: NOW - 2000, now: NOW, items: [item("i:26")] });
  });
  const rows = withGuildDatabase((db) => db.prepare("SELECT market_key, item_key, quantity, min_unit_buyout FROM market_summaries ORDER BY market_key, item_key").all());
  assert.deepEqual(rows.map((row) => [row.market_key, row.item_key, row.quantity]), [
    ["api:us:house-113", "i:25", 40], ["api:us:house-113", "i:2589", 40], ["api:us:house-113", "i:26", 0],
    ["game:us:normal:alliance", "i:25", 40], ["game:us:normal:alliance", "i:26", 40],
  ]);
  assert.equal(rows.find((row) => row.item_key === "i:26" && row.market_key === API_MARKET.marketKey).min_unit_buyout, null, "no price when none listed");
  assert.deepEqual(searchMarket({ marketKey: API_MARKET.marketKey, now: NOW }).results.map((row) => row.itemKey).sort(), ["i:25", "i:2589"], "none listed is hidden");
  assert.equal(searchMarket({ marketKey: API_MARKET.marketKey, includeEmpty: true, now: NOW }).total, 3);
  const gone = readItemSeries({ itemId: 26, marketKey: API_MARKET.marketKey, range: "24h", now: NOW }).series[0].points;
  assert.deepEqual(gone.map((point) => point.quantity), [40, 0], "supply fell to zero, observed");
}));

test("a multi-part in-game full scan is judged once all parts are in", () => withHttpApp(async () => {
  const part = (db, scan, index, parts, items, at) => recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: `scan:${scan}-${index}`,
    coverage: "full", observedAt: at, now: NOW, group: scan, part: index, parts, items });
  withGuildTransaction((db) => {
    part(db, "s1", 1, 1, [item("i:1"), item("i:2"), item("i:3")], NOW - 7200);
    assert.equal(part(db, "s2", 1, 2, [item("i:1")], NOW - 600).absent, 0, "waits for part 2");
    assert.equal(part(db, "s2", 2, 2, [item("i:2")], NOW - 600).absent, 1, "only item 3 is gone");
    assert.ok(db.prepare("SELECT last_full_at FROM market_markets WHERE market_key = ?").get(GAME.marketKey).last_full_at >= NOW - 600);
  });
  const quantities = withGuildDatabase((db) => db.prepare("SELECT item_key, quantity FROM market_summaries ORDER BY item_key").all());
  assert.deepEqual(quantities.map((row) => [row.item_key, row.quantity]), [["i:1", 40], ["i:2", 40], ["i:3", 0]]);
}));

test("history keeps every hour of a day, rolls up to days and weeks, leaves gaps open and is pruned", () => withHttpApp(async () => {
  const day = Math.floor(NOW / 86400) * 86400;
  withGuildTransaction((db) => {
    for (const [hour, price, quantity] of [[1, 100, 40], [2, 150, 30], [3, 120, 35], [12, 90, 80]]) {
      snapshot(db, { scope: "api:auctions", observedAt: day + hour * 3600 + 60, now: day + 13 * 3600, items: [item("i:2589", { minUnitBuyout: price, typicalUnitBuyout: price + 10, quantity })] });
    }
  });
  const now = day + 13 * 3600;
  const hourly = readItemSeries({ itemId: 2589, marketKey: API_MARKET.marketKey, range: "24h", now });
  assert.equal(hourly.resolution, "hour");
  assert.deepEqual(hourly.series[0].points.map((point) => point.min), [100, 150, 120, 90], "every observation within the day kept");
  assert.ok(hourly.series[0].gapSeconds < 9 * 3600, "the hours between 3:00 and 12:00 are a gap, not a line");
  const daily = readItemSeries({ itemId: 2589, marketKey: API_MARKET.marketKey, range: "30d", now });
  assert.equal(daily.series[0].points.length, 1);
  const point = daily.series[0].points[0];
  assert.deepEqual([point.minLow, point.minHigh, point.min, point.quantityLow, point.quantityHigh, point.quantity, point.samples], [90, 150, 90, 30, 80, 80, 4]);
  // Weeks from days, and a gap stays a gap.
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT INTO market_series_daily (market_key, item_key, source_type, day, samples, min_low, min_high, min_close, typical_low, typical_high,
      typical_close, quantity_low, quantity_high, quantity_close, listings_close) VALUES (?, 'i:2589', 'official_api', ?, 1, ?, ?, ?, ?, ?, ?, 10, 10, 10, 2)`);
    for (const [offset, price] of [[-14, 100], [-13, 200], [-12, 300], [-3, 50]]) {
      const label = new Date((day + offset * 86400) * 1000).toISOString().slice(0, 10);
      insert.run(API_MARKET.marketKey, label, price, price, price, price, price, price);
    }
    assert.ok(rollUpWeeksInDatabase(db, now, { sinceDays: 20 }) >= 2);
  });
  const weekly = readItemSeries({ itemId: 2589, marketKey: API_MARKET.marketKey, range: "all", now });
  assert.equal(weekly.resolution, "week");
  assert.ok(weekly.series[0].points.some((entry) => entry.typicalMedian === 200 || entry.days >= 2), "a week summarises its days");
  withGuildTransaction((db) => {
    const removed = pruneMarketDataInDatabase(db, now + 12 * 86400);
    assert.ok(removed.hourly > 0, "hourly kept 10 days");
    assert.equal(removed.daily, 0, "daily kept 400 days");
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM market_summaries").get().n > 0, "summaries kept");
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM market_observations").get().n > 0, "the observation a summary shows is kept");
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM market_maintenance WHERE name = 'prune'").get().n === 1, "pruning is recorded for diagnostics");
  });
}));

test("metrics: medians, change, volatility and supply, with their windows; sparse data says so", () => {
  const now = NOW;
  const hourly = [];
  for (let hour = 7 * 24; hour >= 1; hour -= 1) {
    const t = Math.floor((now - hour * 3600) / 3600) * 3600;
    hourly.push({ t, lastAt: t + 60, min: 100, typical: 110, quantity: 100, listings: 10 });
  }
  const daily = [];
  for (let offset = 30; offset >= 1; offset -= 1) {
    const t = Math.floor((now - offset * 86400) / 86400) * 86400;
    daily.push({ t, min: 100, minLow: 95, typical: offset % 2 ? 110 : 140, typicalHigh: 150, quantity: 100 });
  }
  const current = { min: 70, typical: 110, quantity: 300, listings: 30, minQuantity: 1, observedAt: now - 60 };
  const metrics = marketMetrics({ current, hourly, daily, now });
  assert.equal(metrics.median7d.value, 110);
  assert.ok(metrics.median7d.samples >= 167, "every observed hour in the window");
  assert.equal(metrics.change24h.pct, 0);
  assert.equal(metrics.median30d.value, 110, "29 days inside the window: 15 at 110, 14 at 140");
  assert.equal(metrics.supply.changePct, 200);
  assert.equal(metrics.volatility30d.level, "high", "alternating days are volatile");
  assert.equal(metrics.vsTypicalMin.pct, -30);
  const types = marketSignals(metrics, { now }).map((entry) => entry.type);
  assert.deepEqual(types.sort(), ["below_recent_market", "isolated_low_listing", "supply_increasing", "volatile_market"]);
  for (const entry of marketSignals(metrics, { now })) {
    assert.ok(entry.explanation && entry.confidence && Number.isFinite(entry.samples) && entry.window, entry.type);
  }
  const sparse = marketMetrics({ current, hourly: hourly.slice(-3), daily: daily.slice(-2), now });
  assert.equal(sparse.median7d.value, null);
  assert.match(sparse.median7d.reason, /at least 6/);
  assert.equal(sparse.median30d.value, null);
  assert.equal(sparse.volatility30d.value, null);
  assert.deepEqual(marketSignals(sparse, { now }).map((entry) => entry.type), ["isolated_low_listing"], "nothing claimed from sparse history");
  assert.equal(dailyVolatility([{ t: 0, typical: 100 }, { t: 3 * 86400, typical: 200 }]).returns, 0, "a gap breaks the chain");
  assert.equal(gapSeconds([{ t: 0 }, { t: 3600 }, { t: 7200 }], 3600), 9000);
});

test("variants are priced on their own and never borrow another's price", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    names(db, [[15210, "Raider's Chestpiece", 2, { itemClass: { id: 4, name: "Armor" } }]]);
    snapshot(db, { items: [item("i:15210:s-1081", { minUnitBuyout: 50000, quantity: 3 }), item("i:15210:s-1082", { minUnitBuyout: 9000, quantity: 1 })] });
    db.prepare("INSERT INTO market_variant_names (item_key, name, updated_at) VALUES ('i:15210:s-1081', 'Raider''s Chestpiece of the Bear', 0)").run();
  });
  const byId = readPrices({ marketKey: API_MARKET.marketKey, itemIds: [15210], now: NOW }).prices[0];
  assert.equal(byId.variantsOnly, true);
  assert.equal(byId.minUnitBuyout, null, "no price borrowed from a variant");
  assert.equal(byId.variants.length, 2);
  const byKey = readPrices({ marketKey: API_MARKET.marketKey, itemKeys: ["i:15210:s-1082"], now: NOW }).prices[0];
  assert.equal(byKey.minUnitBuyout, 9000, "a tooltip can ask for the exact variant");
  const detail = readItemMarket({ itemId: 15210, marketKey: API_MARKET.marketKey, itemKey: "i:15210:s-1082", now: NOW });
  assert.equal(detail.itemKey, "i:15210:s-1082");
  assert.deepEqual(detail.variants.map((entry) => entry.label).sort(), ["Raider's Chestpiece of the Bear", "suffix -1082"]);
  assert.ok(detail.evidence.every((entry) => entry.itemKey === "i:15210:s-1082"), "evidence of the selected variant only");
  const series = readItemSeries({ itemId: 15210, marketKey: API_MARKET.marketKey, range: "24h", now: NOW });
  assert.equal(series.itemKey, "i:15210:s-1081", "without a key: the most listed variant, alone");
  assert.equal(series.series[0].points[0].min, 50000);
  const search = searchMarket({ marketKey: API_MARKET.marketKey, q: "of the bear", now: NOW });
  assert.deepEqual(search.results.map((row) => row.variantName), ["Raider's Chestpiece of the Bear"], "variants are searchable by their own name");
}));

test("markets are only combined when an administrator links matching houses", () => withHttpApp(async () => {
  const horde = { ...API_MARKET, marketKey: "api:us:house-116", houseId: 116, faction: "horde", name: "US Horde" };
  const otherRealm = { ...GAME, marketKey: "game:us:hardcore:alliance", realm: "Hardcore" };
  withGuildTransaction((db) => {
    snapshot(db, { observedAt: NOW - 1200, items: [item("i:2589", { minUnitBuyout: 100, typicalUnitBuyout: 100 })] });
    snapshot(db, { market: horde, observedAt: NOW - 1200, items: [item("i:2589", { minUnitBuyout: 300 })] });
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "scan:1", coverage: "items", observedAt: NOW - 600, now: NOW,
      items: [item("i:2589", { minUnitBuyout: 100, typicalUnitBuyout: 100 })] });
    recordMarketSnapshotInDatabase(db, { market: otherRealm, sourceType: "addon_scan", sourceId: "scan:2", coverage: "items", observedAt: NOW - 600, now: NOW,
      items: [item("i:2589", { minUnitBuyout: 500 })] });
  });
  const evidence = readMarketDiagnostics({ now: NOW }).identity.find((entry) => entry.marketKey === GAME.marketKey).evidence;
  assert.equal(evidence[0].marketKey, API_MARKET.marketKey, "only same-faction houses are candidates");
  assert.equal(evidence[0].exactShare, 100);
  assert.equal(evidence.length, 1);
  assert.equal(setMarketLink({ marketKey: GAME.marketKey, linkedMarketKey: horde.marketKey, now: NOW }).reason, "faction_mismatch");
  assert.equal(setMarketLink({ marketKey: GAME.marketKey, linkedMarketKey: API_MARKET.marketKey, now: NOW }).status, "linked");
  const linked = readItemMarket({ itemId: 2589, marketKey: API_MARKET.marketKey, now: NOW }).variants[0];
  assert.equal(linked.source, "addon_scan", "the linked in-game scan now counts for the house");
  assert.ok(linked.notes.some((note) => note.code === "linked"));
  assert.equal(readItemMarket({ itemId: 2589, marketKey: GAME.marketKey, now: NOW }).variants[0].source, "addon_scan");
  const second = setMarketLink({ marketKey: otherRealm.marketKey, linkedMarketKey: API_MARKET.marketKey, now: NOW });
  assert.equal(second.status, "conflict", "another realm on the same house needs confirmation");
  assert.deepEqual(second.realms, ["Normal"]);
  assert.equal(readItemMarket({ itemId: 2589, marketKey: horde.marketKey, now: NOW }).variants[0].minUnitBuyout, 300, "Horde untouched");
  assert.equal(setMarketLink({ marketKey: GAME.marketKey, linkedMarketKey: null, now: NOW }).status, "unlinked");
  assert.equal(readItemMarket({ itemId: 2589, marketKey: API_MARKET.marketKey, now: NOW }).variants[0].source, "official_api", "unlinking separates them again");
}));

test("search: names, categories, quality, levels, below market and the Pct column", () => withHttpApp(async () => {
  const day = Math.floor(NOW / 86400) * 86400;
  withGuildTransaction((db) => {
    names(db, [[2589, "Linen Cloth", 1, { itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { name: "Cloth" } }],
      [2592, "Wool Cloth", 1, { itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { name: "Cloth" } }],
      [2770, "Copper Ore", 1, { itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { name: "Metal & Stone" } }],
      [25, "Worn Shortsword", 2, { itemClass: { id: 2, name: "Weapon" }, requiredLevel: 5, itemLevel: 8 }]]);
    const items = [item("i:2589", { minUnitBuyout: 10 }), item("i:2592", { minUnitBuyout: 30 }), item("i:2770", { minUnitBuyout: 20 }), item("i:25", { minUnitBuyout: 500 })];
    for (let id = 100000; id < 100060; id += 1) items.push(item(`i:${id}`));
    // Ten days at 100c for wool, then today at 30c: well below its market.
    for (let offset = 7; offset >= 1; offset -= 1) snapshot(db, { items: [item("i:2592", { minUnitBuyout: 100, typicalUnitBuyout: 100 })], observedAt: day - offset * 86400 + 3600, now: NOW });
    snapshot(db, { items, now: NOW });
    runMarketMaintenanceInDatabase(db, NOW);
  });
  let result = searchMarket({ marketKey: API_MARKET.marketKey, q: "cloth", now: NOW });
  assert.deepEqual(result.results.map((row) => row.item.name), ["Linen Cloth", "Wool Cloth"]);
  result = searchMarket({ marketKey: API_MARKET.marketKey, category: "Trade Goods", sort: "price", direction: "desc", now: NOW });
  assert.deepEqual(result.results.map((row) => row.item.itemId), [2592, 2770, 2589]);
  assert.deepEqual(searchMarket({ marketKey: API_MARKET.marketKey, category: "Trade Goods", subcategory: "Cloth", now: NOW }).results.map((row) => row.item.itemId), [2589, 2592]);
  assert.deepEqual(result.categories.find((entry) => entry.name === "Trade Goods").subcategories.map((entry) => entry.name), ["Cloth", "Metal & Stone"]);
  assert.deepEqual(searchMarket({ marketKey: API_MARKET.marketKey, quality: 2, now: NOW }).results.map((row) => row.item.itemId), [25]);
  assert.deepEqual(searchMarket({ marketKey: API_MARKET.marketKey, minLevel: 5, maxLevel: 10, now: NOW }).results.map((row) => row.item.itemId), [25]);
  const below = searchMarket({ marketKey: API_MARKET.marketKey, belowMarket: true, now: NOW });
  assert.deepEqual(below.results.map((row) => row.item.itemId), [2592]);
  assert.equal(below.results[0].pct, 30, "30% of its 14-day median");
  assert.ok(below.results[0].referenceDays >= 5, "enough observed days behind the median");
  assert.equal(searchMarket({ marketKey: API_MARKET.marketKey, sort: "pct", now: NOW }).results[0].item.itemId, 2592);
  assert.equal(searchMarket({ marketKey: API_MARKET.marketKey, q: "2770", now: NOW }).results[0].item.name, "Copper Ore", "item id search");
  const page2 = searchMarket({ marketKey: API_MARKET.marketKey, sort: "name", page: 2, pageSize: 50, now: NOW });
  assert.equal(page2.total, 64);
  assert.equal(page2.results.length, 14);
  assert.equal(page2.results.at(-1).item.nameKnown, false, "unnamed items still listed, last");
  assert.equal(searchMarket({ marketKey: "api:us:house-999" }), null);
  const prices = readPrices({ marketKey: API_MARKET.marketKey, itemIds: [2589, 25, 424242], now: NOW });
  assert.deepEqual(prices.prices.map((entry) => entry.item.itemId).sort((a, b) => a - b), [25, 2589]);
  const analysis = readItemAnalysis({ itemId: 2592, marketKey: API_MARKET.marketKey, now: NOW });
  assert.equal(analysis.metrics.median30d.value, 100);
  assert.ok(analysis.signals.some((entry) => entry.type === "below_recent_market"));
  assert.match(analysis.disclaimer, /not completed sales/);
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
  const variantOnly = craftCost(recipe, new Map([[2589, { variantsOnly: true, minUnitBuyout: null, typicalUnitBuyout: null }], [2996, { minUnitBuyout: 400 }]]));
  assert.equal(variantOnly.margin, null, "a variant-only reagent has no price");
});

// A fake Blizzard API. Each endpoint has its own Last-Modified and contents,
// and can be made to fail or not exist.
function fakeBlizzard({ houses = [{ id: 113, name: "Alliance Auction House" }, { id: 116, name: "Horde Auction House" }] } = {}) {
  const calls = [];
  const state = {
    auctions: { lastModified: "Tue, 10 Nov 2026 10:00:00 GMT", rows: [{ id: 1, item: { id: 25 }, quantity: 1, buyout: 900, time_left: "LONG" }], fail: new Set(), status: 503 },
    commodities: { lastModified: "Tue, 10 Nov 2026 10:00:00 GMT", rows: [{ id: 9, item: { id: 2589 }, quantity: 200, unit_price: 12, time_left: "LONG" }], fail: new Set(), status: 503 },
  };
  const fetchImpl = async (url, options = {}) => {
    const path = String(url).replace(/^https:\/\/us\.api\.blizzard\.com/, "").replace(/\?.*$/, "");
    calls.push({ path, headers: options.headers || {} });
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    if (String(url).includes("oauth")) return json({ access_token: "token", expires_in: 3600 });
    if (path === "/data/wow/ruleset/index") return json({ rulesets: [{ id: 3 }, { id: 2 }] });
    if (path === "/data/wow/ruleset/2/auctions/") return json({ auctions: houses });
    const match = /\/auctions\/(\d+)(\/commodities)?$/.exec(path);
    if (!match) return json({}, 404);
    const endpoint = state[match[2] ? "commodities" : "auctions"];
    if (endpoint.fail.has(Number(match[1]))) return json({}, endpoint.status);
    if (options.headers?.["If-Modified-Since"] === endpoint.lastModified) return new Response(null, { status: 304 });
    return json({ auctions: endpoint.rows }, 200, { "last-modified": endpoint.lastModified });
  };
  return { fetchImpl, calls, state };
}

const ENV = { BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret", MARKET_BLIZZARD_REGIONS: "us" };
const quiet = { info() {}, warn() {}, error() {} };

test("provider: each endpoint refreshes on its own; 304s, failures and missing endpoints never block the other", () => withHttpApp(async () => {
  let clock = Date.parse("Tue, 10 Nov 2026 10:05:00 GMT");
  const now = () => clock;
  const blizzard = fakeBlizzard({ houses: [{ id: 113, name: "Alliance Auction House" }] });
  const provider = createBlizzardAuctionProvider({ env: ENV, fetchImpl: blizzard.fetchImpl, now });
  const refresher = createMarketRefresher({ provider, now, log: quiet });
  const first = await refresher.tick();
  assert.equal(first.status, "recorded");
  assert.deepEqual(first.endpoints.map((entry) => [entry.endpoint, entry.status]), [["auctions", "recorded"], ["commodities", "recorded"]]);
  assert.ok(blizzard.calls.some((call) => call.path === "/data/wow/ruleset/2/auctions/"), "trailing slash kept");
  const advance = () => { clock += 5 * 3600 * 1000; };

  // Auctions not modified, commodities regenerated with new prices: the
  // commodities are still read and stored.
  advance();
  blizzard.state.commodities.lastModified = "Tue, 10 Nov 2026 15:00:00 GMT";
  blizzard.state.commodities.rows = [{ id: 10, item: { id: 2589 }, quantity: 150, unit_price: 9 }];
  let result = await refresher.tick();
  assert.deepEqual(result.endpoints.map((entry) => [entry.endpoint, entry.status]), [["auctions", "not_modified"], ["commodities", "recorded"]]);
  assert.equal(readPrices({ marketKey: "api:us:house-113", itemIds: [2589], now: Math.floor(clock / 1000) }).prices[0].minUnitBuyout, 9);
  let calls = blizzard.calls.slice(-2);
  assert.ok(calls.every((call) => call.headers["If-Modified-Since"]), "each endpoint sends its own Last-Modified");

  // Regenerated with identical contents: confirmed, not stored again.
  advance();
  blizzard.state.commodities.lastModified = "Tue, 10 Nov 2026 20:00:00 GMT";
  result = await refresher.tick();
  assert.deepEqual(result.endpoints.map((entry) => entry.status), ["not_modified", "unchanged"]);
  assert.equal(result.status, "unchanged");
  const shown = readPrices({ marketKey: "api:us:house-113", itemIds: [2589], now: Math.floor(clock / 1000) }).prices[0];
  assert.equal(shown.observedAt, Date.parse("Tue, 10 Nov 2026 20:00:00 GMT") / 1000, "seen at the new generation");

  // Commodities failing while auctions change: auctions stored, the
  // failure is the commodities endpoint's alone.
  advance();
  blizzard.state.commodities.fail.add(113);
  blizzard.state.auctions.lastModified = "Wed, 11 Nov 2026 01:00:00 GMT";
  blizzard.state.auctions.rows = [{ id: 2, item: { id: 25 }, quantity: 1, buyout: 700 }];
  result = await refresher.tick();
  assert.deepEqual(result.endpoints.map((entry) => [entry.endpoint, entry.status]), [["auctions", "recorded"], ["commodities", "failed"]]);
  const endpoints = withGuildDatabase((db) => db.prepare("SELECT endpoint, consecutive_failures, last_error FROM market_provider_endpoints ORDER BY endpoint").all());
  assert.deepEqual(endpoints.map((row) => [row.endpoint, row.consecutive_failures]), [["auctions", 0], ["commodities", 1]]);
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT status FROM market_provider_runs ORDER BY id DESC LIMIT 1").get().status), "recorded_partial");
  assert.equal(readPrices({ marketKey: "api:us:house-113", itemIds: [2589], now: Math.floor(clock / 1000) }).prices[0].minUnitBuyout, 9, "commodity prices untouched");

  // A house without a commodities endpoint: "missing", nothing zeroed.
  advance();
  blizzard.state.commodities.fail = new Set([113]);
  blizzard.state.commodities.status = 404;
  result = await refresher.tick();
  assert.equal(result.endpoints[1].status, "missing");
  assert.ok(readPrices({ marketKey: "api:us:house-113", itemIds: [2589], now: Math.floor(clock / 1000) }).prices[0].quantity > 0, "missing is not empty");

  // Both down: backs off, last good data stays.
  advance();
  blizzard.state.auctions.fail.add(113);
  blizzard.state.commodities.status = 503;
  result = await refresher.tick();
  assert.equal(result.status, "failed");
  const state = withGuildDatabase((db) => db.prepare("SELECT * FROM market_provider_state").get());
  assert.equal(state.consecutive_failures, 1);
  assert.equal(state.next_due_at - Math.floor(clock / 1000), backoffSeconds(1));
  assert.equal(backoffSeconds(10), 6 * 3600, "backoff is capped");
  const diagnostics = readMarketDiagnostics({ now: Math.floor(clock / 1000) });
  const market = diagnostics.markets.find((entry) => entry.marketKey === "api:us:house-113");
  assert.ok(market.warnings.some((warning) => /auctions failing/.test(warning)));
  assert.ok(diagnostics.runs.length >= 5);
  assert.ok(diagnostics.storage.rows.market_series_hourly > 0);
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

test("favorites, alerts and shopping lists are private to their owner", () => withHttpApp(async ({ request }) => {
  const ash = cookie({ id: "market-ash", username: "ash" });
  const bram = cookie({ id: "market-bram", username: "bram" });
  withGuildTransaction((db) => snapshot(db, { items: [item("i:2589", { minUnitBuyout: 80 })], now: Math.floor(Date.now() / 1000), observedAt: Math.floor(Date.now() / 1000) - 60 }));
  assert.equal((await request("/api/market/favorites")).status, 401);
  assert.equal((await request("/api/market/favorites/2589", { method: "PUT", rawCookie: ash })).status, 200);
  assert.equal((await request("/api/market/favorites/2589", { method: "PATCH", rawCookie: ash, body: { alertBelow: 100 } })).status, 200);
  assert.equal((await request("/api/market/favorites/2589", { method: "PATCH", rawCookie: bram, body: { alertBelow: 1 } })).status, 404, "not someone else's favorite");
  const favorites = (await request(`/api/market/favorites?market=${API_MARKET.marketKey}`, { rawCookie: ash })).json.favorites;
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].alert.below, 100);
  assert.equal(favorites[0].alertState, "below", "the target is met; nothing is sent");
  assert.ok(favorites[0].metrics.coverage, "favorites carry their metrics");
  assert.equal((await request("/api/market/favorites", { rawCookie: bram })).json.favorites.length, 0);
  const created = await request("/api/market/lists", { method: "POST", rawCookie: ash, body: { name: "Bandages", purpose: "crafting" } });
  assert.equal(created.status, 200, created.text);
  const listId = created.json.list.id;
  assert.equal((await request(`/api/market/lists/${listId}/items/2589`, { method: "PUT", rawCookie: ash, body: { quantity: 40 } })).status, 200);
  assert.equal((await request(`/api/market/lists/${listId}/items/2592`, { method: "PUT", rawCookie: ash, body: { quantity: 2 } })).status, 200);
  assert.equal((await request(`/api/market/lists/${listId}/items/2589`, { method: "PUT", rawCookie: bram, body: { quantity: 1 } })).status, 404, "not someone else's list");
  assert.equal((await request(`/api/market/lists/${listId}`, { method: "DELETE", rawCookie: bram })).status, 404);
  assert.equal((await request(`/api/market/lists/${listId}/items/2589`, { method: "PUT", rawCookie: ash, body: { quantity: 0 } })).status, 400);
  const lists = (await request(`/api/market/lists?market=${API_MARKET.marketKey}`, { rawCookie: ash })).json.lists;
  assert.equal(lists[0].items[0].quantity, 40);
  assert.equal(lists[0].estimate.copper, 3200);
  assert.equal(lists[0].estimate.missingPrices, 1, "unpriced items counted, not guessed");
  assert.equal((await request("/api/market/lists", { rawCookie: bram })).json.lists.length, 0);
  assert.equal((await request("/api/market/searches", { method: "POST", rawCookie: ash, body: { name: "Cloth", query: { q: "cloth", evil: "x" } } })).json.search.query.evil, undefined);
  assert.equal((await request("/api/market/searches", { rawCookie: bram })).json.searches.length, 0);
  assert.equal((await request("/api/market/admin/status", { rawCookie: ash })).status, 403);
  assert.equal((await request("/api/market/admin/diagnostics", { rawCookie: ash })).status, 403);
  const diagnostics = await request("/api/market/admin/diagnostics", { persona: "owner" });
  assert.equal(diagnostics.status, 200, diagnostics.text);
  assert.equal(JSON.stringify(diagnostics.json).includes("market-ash"), false, "diagnostics name no player");
  const series = await request(`/api/market/items/2589/history?market=${API_MARKET.marketKey}&range=24h`, { rawCookie: bram });
  assert.equal(series.json.resolution, "hour");
  const analysis = await request(`/api/market/items/2589/analysis?market=${API_MARKET.marketKey}`, { rawCookie: bram });
  assert.equal(analysis.status, 200, analysis.text);
}));

test("in-game scans are validated, deduplicated, grouped and anonymous", () => withHttpApp(async () => {
  const now = Math.floor(Date.now() / 1000);
  const envelope = (fields = {}) => ({
    schemaVersion: 1, eventType: "auction_scan", capturedAt: now, characterId: "character-rook", installationId: "install-1",
    realm: "Normal", region: "US", gameBuild: { build: "70338" }, payloadSchemaVersion: 1,
    payload: { schemaVersion: 1, scanId: "scan-1-1", observedAt: now - 30, market: { faction: "alliance" }, query: { kind: "commodity" },
      coverage: "items", items: [{ itemId: 2589, quantity: 220, listings: 6, complete: true, prices: [[12, 200, 5], [15, 20, 1]] }], ...fields },
  });
  let nonce = 0;
  const send = (env) => ingestTelemetry({ memberId: "market-ash", deviceId: "device-1", idempotencyKey: `scan-${nonce += 1}`,
    body: { kind: "event", revision: 1, streamKey: `auction_scan:character-rook:${env.payload.scanId}`, envelope: env } });
  assert.equal(send(envelope()).recordedEvent.status, "recorded");
  assert.equal(send({ ...envelope(), payload: { ...envelope().payload, scanId: "scan-1-2" } }).recordedEvent.status, "duplicate", "same results at the same time store once");
  assert.equal(send({ ...envelope(), payload: { ...envelope().payload, scanId: "scan-1-3", observedAt: now - 10 } }).recordedEvent.status, "unchanged", "the same results later confirm them");
  for (const bad of [{ market: { faction: "pirates" } }, { coverage: "most" }, { items: [] }, { items: [{ itemId: 1, quantity: 1, name: "x".repeat(200) }] },
    { items: [{ itemId: 1, quantity: 1, prices: Array.from({ length: 21 }, () => [1, 1]) }] }, { query: { kind: "buyout_everything" } }]) {
    assert.equal(send(envelope({ ...bad, scanId: `bad-${nonce}` })).status, "invalid", JSON.stringify(bad));
  }
  // The classic browse frame's pages and "get all" scans.
  const page = send(envelope({ scanId: "page-1", query: { kind: "page" }, coverage: "partial", items: [{ itemId: 4306, quantity: 20, listings: 2, complete: false,
    minUnitBuyout: 50, name: "Silk Cloth", qualityId: 1, requiredLevel: 0, prices: [[50, 20, 2]] }] }));
  assert.equal(page.recordedEvent.status, "recorded");
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT name, name_source FROM market_item_meta WHERE item_id = 4306").get()).name_source, "addon", "a scan's name is a last resort");
  readPrices({ marketKey: "game:us:normal:alliance", itemIds: [4306] });
  withGuildTransaction((db) => runMarketMaintenanceInDatabase(db));
  assert.equal(readItemMarket({ itemId: 4306, marketKey: "game:us:normal:alliance" }).item.name, "Silk Cloth", "looking the item up again never blanks its name");
  for (const chunk of [1, 2]) {
    const result = send(envelope({ scanId: `ah-full-${chunk}`, query: { kind: "getall", chunk, chunks: 2 }, coverage: "full",
      items: [{ itemId: 3000 + chunk, quantity: 5, listings: 1, complete: true, prices: [[100, 5, 1]] }] }));
    assert.equal(result.recordedEvent.status, "recorded");
  }
  assert.deepEqual(withGuildDatabase((db) => db.prepare("SELECT DISTINCT scan_group, parts FROM market_snapshots WHERE scan_group <> ''").all())
    .map((row) => [row.scan_group, row.parts]), [["ah-full", 2]]);
  const row = withGuildDatabase((db) => db.prepare("SELECT * FROM market_snapshots ORDER BY id LIMIT 1").get());
  assert.equal(row.market_key, "game:us:normal:alliance");
  assert.notEqual(row.contributor_key, "market-ash");
  assert.equal(row.contributor_key.length, 16, "contributor is a hash");
  const summary = withGuildDatabase((db) => db.prepare("SELECT * FROM market_summaries WHERE item_key = 'i:2589'").get());
  assert.equal(summary.min_unit_buyout, 12);
  assert.equal(summary.quantity, 220, "the item's total, not just the cheapest listings");
  assert.equal(summary.listings, 6);
  const columns = withGuildDatabase((db) => ["market_snapshots", "market_observations", "market_summaries", "market_series_hourly", "market_series_daily",
    "market_snapshot_checks", "market_item_meta", "market_variant_names"].flatMap((table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)));
  assert.equal(columns.some((name) => /member|character|device|owner|seller/.test(name)), false, "shared market tables name no player");
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

test("the shared classic-frame page fixture ingests with names as a last resort and partial items as partial", () => withHttpApp(async () => {
  const { readFileSync } = await import("node:fs");
  const envelope = JSON.parse(readFileSync(new URL("./fixtures/guildweaver-auction-scan.page.v1.json", import.meta.url), "utf8"));
  envelope.payload.observedAt = Math.floor(Date.now() / 1000) - 30;
  const result = ingestTelemetry({ memberId: "market-fixture", deviceId: "device-fixture", idempotencyKey: "fixture-page",
    body: { kind: "event", revision: 1, streamKey: `auction_scan:character-rook:${envelope.payload.scanId}`, envelope } });
  assert.equal(result.recordedEvent.status, "recorded");
  const rows = withGuildDatabase((db) => db.prepare("SELECT item_key, complete, market_key FROM market_summaries ORDER BY item_key").all());
  assert.deepEqual(rows.map((row) => [row.item_key, row.complete]), [["i:15210:s-1081", 0], ["i:2589", 1]]);
  assert.ok(rows.every((row) => row.market_key === "game:us:normal:horde"));
  const names = withGuildDatabase((db) => db.prepare("SELECT item_key, name FROM market_variant_names").all());
  assert.deepEqual(names.map((row) => [row.item_key, row.name]), [["i:15210:s-1081", "Raider's Chestpiece of the Bear"]]);
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_series_hourly WHERE item_key = 'i:15210:s-1081'").get().n), 0,
    "a partial view is not history");
}));

test("a large house ingests in bounded time and searches stay fast", () => withHttpApp(async () => {
  const items = [];
  for (let id = 1; id <= 20000; id += 1) items.push(item(`i:${id}`, { minUnitBuyout: 100 + (id % 997), typicalUnitBuyout: 120 + (id % 997), quantity: 1 + (id % 50) }));
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
      VALUES (?, '70338', 'enUS', ?, ?, NULL, '{}', '2026-11-01')`);
    for (let id = 1; id <= 20000; id += 1) insert.run(id, `Item number ${id}`, id % 5);
  });
  let started = performance.now();
  withGuildTransaction((db) => snapshot(db, { items }));
  const ingest = performance.now() - started;
  assert.ok(ingest < 15000, `20,000 items in ${Math.round(ingest)} ms`);
  started = performance.now();
  withGuildTransaction((db) => snapshot(db, { items: items.slice(0, 19000), observedAt: NOW - 300 }));
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_summaries WHERE quantity = 0").get().n), 1000, "1,000 gone, recorded once each");
  started = performance.now();
  for (const query of [{ q: "number 19" }, { sort: "price", direction: "desc", page: 100 }, { quality: 3, sort: "quantity" }]) {
    searchMarket({ marketKey: API_MARKET.marketKey, now: NOW, ...query });
  }
  const searches = (performance.now() - started) / 3;
  assert.ok(searches < 400, `a search takes ${Math.round(searches)} ms`);
}));
