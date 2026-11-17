import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closeGuildDatabase, withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { createMarketRefresher, maintainMarketsIfDue } from "../src/Market/marketRefresh.js";
import {
  btreeBytesInDatabase,
  marketStorageObjectsInDatabase,
  pruneMarketDataInDatabase,
  readItemAnalysis,
  readItemMarket,
  readItemSeries,
  readMarketDiagnostics,
  readPrices,
  recordMarketSnapshotInDatabase,
  runMarketMaintenanceInDatabase,
  setMarketLink,
  STORAGE_BUDGET,
  storageStatus,
} from "../src/Market/marketRepository.js";
import { dayOf, monthOf, RETENTION, rollUpSeriesInDatabase } from "../src/Market/marketSeries.js";

// Storage regression tests: what the Auction House keeps, for how long, and
// how big it gets. Deterministic workloads only; production scale is
// projected from measured per-row costs, never materialized.

const HOUR = 3600;
const DAY = 86400;
// Monday 3 August 2026, 00:00 UTC.
const T0 = Date.UTC(2026, 7, 3) / 1000;
const API_A = { marketKey: "api:us:house-110", kind: "api_house", region: "us", rulesetId: 2, houseId: 110, faction: "alliance", name: "Alliance AH" };
const API_B = { marketKey: "api:us:house-111", kind: "api_house", region: "us", rulesetId: 2, houseId: 111, faction: "horde", name: "Horde AH" };
const GAME = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "Normal (in-game)" };

async function withData(run) {
  const previous = process.env.GUILD_DATA_DIR;
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-storage-"));
  process.env.GUILD_DATA_DIR = directory;
  try {
    return await run(directory);
  } finally {
    closeGuildDatabase();
    if (previous === undefined) delete process.env.GUILD_DATA_DIR;
    else process.env.GUILD_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

function item(itemKey, unit, quantity = 10, extra = {}) {
  return { itemKey, itemId: Number(/^i:(\d+)/.exec(itemKey)[1]), minUnitBuyout: unit, typicalUnitBuyout: unit + 5, maxUnitBuyout: unit + 50,
    minUnitBid: null, quantity, listings: Math.max(1, Math.ceil(quantity / 5)), bidOnlyListings: 0, ladder: quantity ? [[unit, quantity, 1]] : [], ...extra };
}

let sequence = 0;
function record(fields) {
  sequence += 1;
  return withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: API_A, sourceType: "official_api", sourceId: `s-${sequence}`,
    coverage: "full", scope: "api:auctions", ...fields }));
}

const count = (sql, ...params) => withGuildDatabase((db) => Number(db.prepare(sql).get(...params).n));
const quiet = { info() {}, warn() {}, error() {} };

test("repeated identical snapshots add no snapshots and no observations, only history points", () => withData(async () => {
  const items = [item("i:1", 100), item("i:2", 200)];
  for (let hour = 0; hour < 10; hour += 1) record({ observedAt: T0 + hour * HOUR, now: T0 + hour * HOUR, items });
  assert.equal(count("SELECT COUNT(*) AS n FROM market_snapshots"), 1, "the content hash recognises unchanged contents");
  assert.equal(count("SELECT COUNT(*) AS n FROM market_observations"), 2, "one current observation per item");
  assert.equal(count("SELECT COUNT(*) AS n FROM market_snapshot_checks WHERE outcome = 'unchanged'"), 9);
  assert.equal(count("SELECT COUNT(*) AS n FROM market_series_hourly WHERE item_key = 'i:1'"), 10, "each observed hour is a history point");
  // A retry of the same observation changes nothing at all.
  const retry = withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: API_A, sourceType: "official_api", sourceId: `s-${sequence}`,
    coverage: "full", scope: "api:auctions", observedAt: T0 + 9 * HOUR, now: T0 + 9 * HOUR, items }));
  assert.equal(retry.status, "duplicate");
  assert.equal(count("SELECT SUM(samples) AS n FROM market_series_hourly WHERE item_key = 'i:1'"), 10);
  const price = readPrices({ marketKey: API_A.marketKey, itemIds: [1], now: T0 + 9 * HOUR }).prices[0];
  assert.equal(price.observedAt, T0 + 9 * HOUR, "confirmed at the latest check");
  assert.equal(price.unchangedSince, T0);
}));

test("a house where something sells out every hour keeps no old snapshots (the 6 GB leak)", () => withData(async () => {
  // 60 items; at hour h item h disappears for good. Before bounded storage
  // every snapshot that marked an item "none listed" was kept forever, with
  // every observation it held.
  // The last snapshot is at hour 59; maintenance a day and more later.
  const now = T0 + 90 * HOUR;
  for (let hour = 0; hour < 72; hour += 1) {
    const items = Array.from({ length: 60 }, (_, index) => item(`i:${index + 1}`, 100 + index + hour)).filter((_, index) => index >= hour);
    if (!items.length) break;
    record({ observedAt: T0 + hour * HOUR, now: T0 + hour * HOUR, items });
  }
  withGuildTransaction((db) => runMarketMaintenanceInDatabase(db, now));
  assert.ok(count("SELECT COUNT(*) AS n FROM market_snapshots") <= 2, `only the latest snapshot and those observations name (${count("SELECT COUNT(*) AS n FROM market_snapshots")})`);
  assert.equal(count("SELECT COUNT(*) AS n FROM market_observations"), 60, "current state: one row per item, sold out or not");
  assert.equal(count("SELECT COUNT(*) AS n FROM market_summaries WHERE quantity = 0"), 59, "sold-out items show none listed");
  const ladder = withGuildDatabase((db) => db.prepare("SELECT levels FROM market_price_ladders WHERE item_key = 'i:1'").get().levels);
  assert.equal(ladder, "[]", "a sold-out item's price list is empty, not stale");
}));

test("changed snapshots replace current state at once; their snapshots go after a day", () => withData(async () => {
  for (let hour = 0; hour < 5; hour += 1) record({ observedAt: T0 + hour * HOUR, now: T0 + hour * HOUR, items: [item("i:1", 100 + hour), item("i:2", 300 - hour)] });
  assert.equal(count("SELECT COUNT(*) AS n FROM market_observations"), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM market_snapshots"), 5);
  await maintainMarketsIfDue({ now: T0 + 31 * HOUR, yieldFn: async () => {} });
  assert.equal(count("SELECT COUNT(*) AS n FROM market_snapshots"), 1);
  assert.deepEqual(readPrices({ marketKey: API_A.marketKey, itemIds: [1, 2], now: T0 + 31 * HOUR }).prices.map((price) => price.minUnitBuyout).sort(), [104, 296]);
}));

test("a failed refresh changes nothing stored", () => withData(async () => {
  record({ observedAt: T0, now: T0, items: [item("i:1", 100)] });
  withGuildTransaction((db) => db.prepare("INSERT INTO market_provider_state (provider, market_key, next_due_at) VALUES ('fake', ?, 0)").run(API_A.marketKey));
  const before = withGuildDatabase((db) => JSON.stringify([db.prepare("SELECT * FROM market_observations").all(), db.prepare("SELECT * FROM market_summaries").all()]));
  const provider = {
    name: "fake", sourceType: "official_api", config: { regions: [], refreshSeconds: 3600 }, configured: () => true, discoverMarkets: async () => [],
    fetchMarket: async () => ({ endpoints: { auctions: { endpoint: "auctions", status: "failed", error: "http_503", transient: true } } }),
  };
  const result = await createMarketRefresher({ provider, now: () => (T0 + HOUR) * 1000, log: quiet }).refreshOne();
  assert.equal(result.status, "failed");
  assert.equal(withGuildDatabase((db) => JSON.stringify([db.prepare("SELECT * FROM market_observations").all(), db.prepare("SELECT * FROM market_summaries").all()])), before);
}));

test("a multi-part scan is judged once all parts are in; earlier scans are released", () => withData(async () => {
  const scan = (group, part, items, at) => withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan",
    sourceId: `${group}-${part}`, coverage: "full", group, part, parts: 2, observedAt: at, now: at, items }));
  scan("g1", 1, [item("i:1", 10), item("i:2", 20)], T0);
  scan("g1", 2, [item("i:3", 30)], T0 + 60);
  const first = scan("g2", 1, [item("i:1", 11)], T0 + DAY);
  assert.equal(first.absent, 0, "nothing is judged missing from half a scan");
  const second = scan("g2", 2, [item("i:3", 31)], T0 + DAY + 60);
  assert.equal(second.absent, 1, "i:2 is gone once both parts are in");
  assert.equal(readPrices({ marketKey: GAME.marketKey, itemIds: [2], now: T0 + DAY + 60 }).prices[0].quantity, 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM market_observations"), 3);
  withGuildTransaction((db) => pruneMarketDataInDatabase(db, T0 + 3 * DAY));
  assert.deepEqual(withGuildDatabase((db) => db.prepare("SELECT DISTINCT scan_group FROM market_snapshots ORDER BY scan_group").all().map((row) => row.scan_group)), ["g2"],
    "the first scan's snapshots are no longer referenced");
}));

test("item variants stay apart in current state, history and prices", () => withData(async () => {
  record({ observedAt: T0, now: T0, items: [item("i:15210", 5000), item("i:15210:s-1081", 9000), item("i:15210:s-1082", 7000)] });
  assert.equal(count("SELECT COUNT(*) AS n FROM market_observations WHERE item_id = 15210"), 3);
  assert.equal(count("SELECT COUNT(DISTINCT item_key) AS n FROM market_series_hourly WHERE item_key LIKE 'i:15210%'"), 3);
  const prices = readPrices({ marketKey: API_A.marketKey, itemKeys: ["i:15210:s-1081"], itemIds: [15210], now: T0 }).prices;
  assert.deepEqual(prices.map((price) => [price.itemKey, price.minUnitBuyout]).sort(), [["i:15210", 5000], ["i:15210:s-1081", 9000]]);
}));

test("linked markets and multiple sources: the shown price's origin survives snapshot pruning", () => withData(async () => {
  record({ observedAt: T0, now: T0, items: [item("i:1", 100)] });
  withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "scan-1", coverage: "items",
    observedAt: T0 - HOUR, now: T0, items: [item("i:1", 90)] }));
  assert.equal(setMarketLink({ marketKey: GAME.marketKey, linkedMarketKey: API_A.marketKey, now: T0 }).status, "linked");
  const shown = withGuildDatabase((db) => db.prepare("SELECT origin_market_key, source_type FROM market_summaries WHERE market_key = ? AND item_key = 'i:1'").get(GAME.marketKey));
  assert.deepEqual([shown.origin_market_key, shown.source_type], [API_A.marketKey, "official_api"], "the newer API observation is shown in the linked in-game market");
  // Two days of new API snapshots: every old snapshot can go.
  for (let hour = 1; hour <= 48; hour += 6) record({ observedAt: T0 + hour * HOUR, now: T0 + hour * HOUR, items: [item("i:1", 100 + hour)] });
  withGuildTransaction((db) => pruneMarketDataInDatabase(db, T0 + 50 * HOUR));
  const detail = readItemMarket({ itemId: 1, marketKey: GAME.marketKey, now: T0 + 50 * HOUR });
  assert.deepEqual(detail.evidence.map((entry) => entry.source).sort(), ["addon_scan", "official_api"], "both sources' current observations are kept for comparison");
  assert.ok(detail.ladder && detail.ladder.levels.length === 1, "the price list is found without the snapshot");
  const analysis = readItemAnalysis({ itemId: 1, marketKey: GAME.marketKey, now: T0 + 50 * HOUR });
  assert.equal(analysis.basis.marketKey, API_A.marketKey, "metrics come from the market the price came from");
}));

test("nothing is deleted before the coarser resolution holding it exists and is final", () => withData(async () => {
  const now = T0 + 120 * DAY;
  record({ observedAt: now - HOUR, now, items: [item("i:1", 100)] });
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT INTO market_series_daily (market_key, item_key, source_type, day, first_at, last_at, samples, min_low, min_high, min_close,
      typical_low, typical_high, typical_close, quantity_low, quantity_high, quantity_close, listings_close) VALUES (?, 'i:1', 'official_api', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 5, 5, 5, 1)`);
    // 60 to 41 days ago, every other day: old enough to be deleted.
    for (let ago = 60; ago > 40; ago -= 2) {
      const at = now - ago * DAY;
      insert.run(API_A.marketKey, dayOf(at), at, at, 1000 + ago, 1000 + ago, 1000 + ago, 1100 + ago, 1100 + ago, 1100 + ago);
    }
  });
  const before = count("SELECT COUNT(*) AS n FROM market_series_daily");
  const held = withGuildTransaction((db) => pruneMarketDataInDatabase(db, now));
  assert.equal(count("SELECT COUNT(*) AS n FROM market_series_daily"), before, "no weekly or monthly rows yet: every day is kept");
  assert.equal(held.held.daily, 10, "and reported as held back");
  withGuildTransaction((db) => rollUpSeriesInDatabase(db, now, { sinceDays: Infinity }));
  const months = withGuildDatabase((db) => db.prepare("SELECT month, days, min_low, min_high, final FROM market_series_monthly WHERE item_key = 'i:1' AND final = 1 ORDER BY month").all());
  assert.equal(months.length, 1, "October is final; the current month is not");
  assert.equal(months.reduce((sum, row) => sum + row.days, 0), 10, "a month counts the days observed: missing days stay missing");
  const removed = withGuildTransaction((db) => pruneMarketDataInDatabase(db, now));
  assert.equal(removed.daily, 10);
  assert.equal(removed.held.daily, 0);
  // Final rows are never recomputed from what is left.
  const again = withGuildTransaction((db) => rollUpSeriesInDatabase(db, now, { sinceDays: Infinity }));
  assert.equal(again.months, 1, "only the current, unfinished month is rolled up again");
  assert.deepEqual(withGuildDatabase((db) => db.prepare("SELECT month, days, min_low, min_high, final FROM market_series_monthly WHERE item_key = 'i:1' AND final = 1 ORDER BY month").all()), months);
}));

test("an interrupted maintenance run at any point loses nothing and the next run finishes the same", async () => {
  const seed = () => {
    for (let at = T0; at < T0 + 50 * DAY; at += 6 * HOUR) {
      const day = Math.floor((at - T0) / DAY);
      record({ observedAt: at, now: at, items: Array.from({ length: 8 }, (_, index) => item(`i:${index + 1}`, 100 + ((day * 7 + index * 3 + at / HOUR) % 40))) });
    }
  };
  const now = T0 + 50 * DAY;
  const state = () => withGuildDatabase((db) => ["market_observations", "market_series_hourly", "market_series_daily", "market_series_weekly", "market_series_monthly", "market_summaries"]
    .map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())).join("\n"));
  let total = 0;
  const expected = await withData(async () => {
    seed();
    total = (await maintainMarketsIfDue({ now, yieldFn: async () => {} })).transactions;
    return state();
  });
  assert.ok(total > 10);
  // Early (after the watched set), in the middle (roll-ups) and at the end
  // (retention done, success not yet recorded).
  for (const stopAt of [2, Math.floor(total / 2), total - 1]) {
    await withData(async () => {
      seed();
      let calls = 0;
      await assert.rejects(() => maintainMarketsIfDue({ now, yieldFn: async () => { calls += 1; if (calls === stopAt) throw new Error("SIGTERM"); } }), /SIGTERM/);
      await maintainMarketsIfDue({ now, yieldFn: async () => {} });
      assert.equal(state(), expected, `interrupted after ${stopAt} transactions`);
    });
  }
});

// The 90-day simulation --------------------------------------------------------------

// Deterministic prices: a slow trend, a daily cycle and an item offset.
function priceOf(index, at) {
  const hours = Math.floor(at / HOUR);
  return 1000 + index * 37 + ((hours * 11 + index * 5) % 90) + Math.floor((at - T0) / DAY) * 2;
}
// Item 7 is sold out on days 20-29 and 60-64; item 8 lists only every
// third day: missing data must stay missing.
function listed(index, at) {
  const day = Math.floor((at - T0) / DAY);
  if (index === 7 && ((day >= 20 && day < 30) || (day >= 60 && day < 65))) return false;
  if (index === 8 && day % 3 !== 0) return false;
  return true;
}
const SIM_ITEMS = 40;
const STEP = 3 * HOUR;
const SIM_DAYS = 90;
const keyOf = (index) => (index === 39 ? "i:15210:s-1081" : `i:${1000 + index}`);

function simulate({ until, from = T0, maintain = true, onDay = null }) {
  for (let at = from; at < until; at += STEP) {
    for (const market of [API_A, API_B]) {
      const items = [];
      for (let index = 0; index < SIM_ITEMS; index += 1) {
        if (!listed(index, at)) continue;
        items.push(item(keyOf(index), priceOf(index, at) + (market === API_B ? 3 : 0), 5 + ((index + Math.floor(at / HOUR)) % 20)));
      }
      sequence += 1;
      withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market, sourceType: "official_api", sourceId: `sim-${sequence}`, coverage: "full",
        scope: "api:auctions", observedAt: at, now: at, items }));
    }
    if ((at - T0) % DAY === 12 * HOUR) {
      // A player's search of a few items once a day.
      withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: `scan-${at}`, coverage: "items",
        observedAt: at, now: at, items: [item(keyOf(0), priceOf(0, at) - 10), item(keyOf(1), priceOf(1, at) - 10)] }));
    }
    if (maintain && (at - T0) % (6 * HOUR) === 0) runMarketMaintenanceInDatabaseQuietly(at + 60);
    if (onDay && (at - T0) % DAY === 0) onDay(at);
  }
}

function runMarketMaintenanceInDatabaseQuietly(now) {
  const last = withGuildDatabase((db) => db.prepare("SELECT ran_at FROM market_maintenance WHERE name = 'rollup'").get()?.ran_at ?? 0);
  if (now - last < 6 * HOUR) return null;
  return withGuildTransaction((db) => runMarketMaintenanceInDatabase(db, now, { measure: false }));
}

function storageByTable() {
  return withGuildDatabase((db) => {
    const tables = {};
    for (const object of marketStorageObjectsInDatabase(db)) tables[object.tableName] = (tables[object.tableName] || 0) + btreeBytesInDatabase(db, object.name);
    const rows = Object.fromEntries(Object.keys(tables).map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)]));
    return { tables, rows };
  });
}

test("90 days of activity: bounded storage, correct charts, current prices, budget projection", { timeout: 600_000 }, (t) => withData(async () => {
  const END = T0 + SIM_DAYS * DAY;
  withGuildTransaction((db) => {
    db.prepare("INSERT INTO market_favorites (member_id, item_id, created_at) VALUES ('member-1', 1000, '2026-08-01')").run();
  });
  const rowsAt = {};
  simulate({ until: END, onDay: (at) => {
    const day = Math.round((at - T0) / DAY);
    if (day === 45 || day === 89) rowsAt[day] = storageByTable().rows;
  } });
  const now = END;
  const result = await maintainMarketsIfDue({ now, yieldFn: async () => {}, force: true });
  assert.equal(withGuildDatabase((db) => db.prepare("PRAGMA integrity_check").get().integrity_check), "ok");

  // Current state and bookkeeping are bounded by items, not by time.
  assert.ok(count("SELECT COUNT(*) AS n FROM market_observations") <= SIM_ITEMS * 2 + 2, "current observations: one per market, variant and source");
  assert.ok(count("SELECT COUNT(*) AS n FROM market_snapshots") <= 2 * Math.ceil(26 * HOUR / STEP) + 4, "snapshots: a day of bookkeeping");
  assert.ok(count("SELECT COUNT(*) AS n FROM market_snapshot_checks") <= (2 * DAY / STEP + 1) * 14 + 16, "checks: 14 days");

  // Retention per resolution, watched (favorite 1000) and normal.
  const oldest = (table, column, key) => withGuildDatabase((db) => db.prepare(`SELECT MIN(${column}) AS v FROM ${table} WHERE market_key = ? AND item_key = ?`).get(API_A.marketKey, key).v);
  assert.equal(count("SELECT COUNT(*) AS n FROM market_watched WHERE item_key = 'i:1000'"), 3, "the favorite is watched in every market that has it");
  assert.ok(oldest("market_series_hourly", "hour", "i:1001") * HOUR >= now - (RETENTION.hourlyHours + 6) * HOUR, "normal: 48 hours of hourly rows");
  assert.ok(oldest("market_series_hourly", "hour", "i:1000") * HOUR <= now - 6 * DAY, "watched: 7 days of hourly rows");
  assert.ok(oldest("market_series_hourly", "hour", "i:1000") * HOUR >= now - (RETENTION.watchedHourlyHours + 6) * HOUR);
  assert.ok(oldest("market_series_daily", "day", "i:1001") >= dayOf(now - 40 * DAY), "normal: about 30 days of daily rows (until their month is final)");
  assert.equal(oldest("market_series_daily", "day", "i:1000"), dayOf(T0), "watched: 90 days of daily rows");
  assert.equal(oldest("market_series_weekly", "week", "i:1001"), dayOf(T0), "weekly rows reach back to the start");
  assert.equal(oldest("market_series_monthly", "month", "i:1001"), monthOf(dayOf(T0)), "monthly rows too");

  // Steady state: the finer resolutions stop growing.
  for (const table of ["market_observations", "market_series_hourly"]) {
    assert.ok(Math.abs(rowsAt[89][table] - rowsAt[45][table]) <= rowsAt[45][table] * 0.1, `${table} is flat from day 45 to 89 (${rowsAt[45][table]} → ${rowsAt[89][table]})`);
  }

  // Charts at the resolutions each range calls for.
  const series = (itemId, itemKey, range) => readItemSeries({ itemId, itemKey, marketKey: API_A.marketKey, range, now });
  const resolutions = (itemId, itemKey) => ["24h", "7d", "30d", "90d", "1y", "all"].map((range) => series(itemId, itemKey, range).resolution);
  assert.deepEqual(resolutions(1000, "i:1000"), ["hour", "hour", "day", "day", "week", "month"], "watched");
  assert.deepEqual(resolutions(1001, "i:1001"), ["hour", "day", "day", "week", "week", "month"], "normal");
  for (const range of ["24h", "7d", "30d", "90d", "1y", "all"]) assert.ok(series(1001, "i:1001", range).series[0].points.length > 0, `${range} has points`);

  // Monthly values are what was observed: lowest and highest lowest-ask of
  // the month across observations, days with an observation, none invented.
  const monthly = series(1007, "i:1007", "all").series.find((entry) => entry.source === "official_api" && entry.marketKey === API_A.marketKey).points;
  const august = monthly.find((point) => point.label === "2026-08-01");
  let low = Infinity;
  let high = -Infinity;
  const days = new Set();
  for (let at = T0; at < Date.UTC(2026, 8, 1) / 1000; at += STEP) {
    if (!listed(7, at)) continue;
    low = Math.min(low, priceOf(7, at));
    high = Math.max(high, priceOf(7, at));
    days.add(dayOf(at));
  }
  assert.deepEqual([august.minLow, august.minHigh], [low, high], "August's lowest and highest asks");
  assert.equal(august.days, days.size + 1, "observed days only, plus the day it sold out (none listed is an observation)");
  const sparse = series(1008, "i:1008", "all").series[0].points;
  // Listed every third day: the day it is listed and the next (seen gone,
  // "none listed") are observed; the third day has no row at all.
  assert.ok(sparse.length >= 3 && sparse.every((point) => point.days <= 21), `an item listed every third day has two days in three, never filled in (${sparse.map((point) => point.days)})`);

  // Current prices are the last observation, exactly.
  const last = END - STEP;
  const prices = readPrices({ marketKey: API_A.marketKey, itemIds: [1000, 1001, 1002], itemKeys: ["i:15210:s-1081"], now }).prices;
  for (const price of prices) {
    const index = price.itemKey === "i:15210:s-1081" ? 39 : price.itemKey ? Number(price.itemKey.slice(2)) - 1000 : null;
    assert.equal(price.minUnitBuyout, priceOf(index, last), `${price.itemKey} current price`);
  }

  // Metrics: watched items from hourly points, others from daily points,
  // labelled as such.
  const watched = readItemAnalysis({ itemId: 1000, marketKey: API_A.marketKey, now });
  const normal = readItemAnalysis({ itemId: 1001, marketKey: API_A.marketKey, now });
  assert.equal(watched.metrics.median7d.resolution, "hour");
  assert.equal(normal.metrics.median7d.resolution, "day");
  assert.equal(normal.metrics.median7d.approximate, true);
  assert.ok(Number.isFinite(normal.metrics.median7d.value) && Number.isFinite(normal.metrics.median30d.value));
  assert.ok(normal.metrics.volatility30d.returns >= 7);

  // The budget measurement and its alerts.
  assert.equal(result.storage.status, "ok");
  assert.ok(result.storage.bytes > 0 && result.storage.tables.market_series_hourly > 0);
  assert.deepEqual([storageStatus(STORAGE_BUDGET.warningBytes - 1), storageStatus(STORAGE_BUDGET.warningBytes), storageStatus(STORAGE_BUDGET.criticalBytes)], ["ok", "warning", "critical"]);
  assert.equal(readMarketDiagnostics({ now }).storage.budget.status, "ok");

  // Production projection from measured per-row costs. Production: about
  // 124,000 item/market rows over 16 US houses; at most every one of them
  // listed and observed hourly (listed share 1.0, the worst case), plus
  // 3,000 watched variants at the finer retention. Summaries are taken at
  // their measured production size (82.9 MiB), which holds price points.
  const measured = storageByTable();
  const perRow = (table) => measured.tables[table] / Math.max(1, measured.rows[table]);
  const N = 124_000;
  const projection = (share) => {
    const listed = N * share;
    const rows = {
      market_series_hourly: listed * (RETENTION.hourlyHours + 6) + RETENTION.watchedLimit * (RETENTION.watchedHourlyHours - RETENTION.hourlyHours),
      market_series_daily: listed * 39 + RETENTION.watchedLimit * (RETENTION.watchedDailyDays - 39),
      market_series_weekly: listed * (RETENTION.weeklyWeeks + 5),
      market_series_monthly: listed * (RETENTION.monthlyMonths + 1),
      market_observations: N * 1.15,
      market_price_ladders: listed,
      market_snapshots: 16 * 2 * 27,
      market_snapshot_checks: 16 * 2 * 24 * 14,
    };
    const bytes = Object.fromEntries(Object.entries(rows).map(([table, n]) => [table, Math.round(n * perRow(table))]));
    bytes.market_summaries = 82.9 * 1024 ** 2;
    const total = Object.values(bytes).reduce((sum, value) => sum + value, 0);
    return { share, totalGiB: Math.round((total / 1024 ** 3) * 100) / 100, tablesMiB: Object.fromEntries(Object.entries(bytes).map(([table, value]) => [table, Math.round(value / 1024 ** 2)])) };
  };
  const report = { perRowBytes: Object.fromEntries(Object.keys(measured.tables).filter((table) => measured.rows[table]).map((table) => [table, Math.round(perRow(table))])),
    worstCase: projection(1), likely: projection(0.85), measuredBefore: { liveAhGiB: 5.62 } };
  t.diagnostic(`storage projection ${JSON.stringify(report)}`);
  assert.ok(report.worstCase.totalGiB * 1024 ** 3 < STORAGE_BUDGET.criticalBytes, `worst case under the critical budget (${report.worstCase.totalGiB} GiB)`);
  assert.ok(report.likely.totalGiB < 5.62 / 2, "less than half of today's live Auction House storage");
}));
