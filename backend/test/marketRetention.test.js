import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { maintainMarketsIfDue } from "../src/Market/marketRefresh.js";
import { marketPruneSteps, pruneMarketDataInDatabase, recordMarketSnapshotInDatabase, runMarketPruneStepInDatabase, SNAPSHOT_RETENTION_SECONDS } from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const T = 1794300000;
const API = { marketKey: "api:us:house-113", kind: "api_house", region: "us", houseId: 113, faction: "alliance", name: "API" };
const GAME = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "Game" };
const item = (itemId, price) => ({ itemKey: `i:${itemId}`, itemId, minUnitBuyout: price, typicalUnitBuyout: price, maxUnitBuyout: price, quantity: 2, listings: 1 });

function seed() {
  // Hourly API snapshots for 40 hours, prices changing so each is new; one
  // in-game scan 40 hours ago.
  for (let hour = 0; hour < 40; hour += 1) {
    withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: API, sourceType: "official_api", sourceId: `api-${hour}`, coverage: "full",
      scope: "api:auctions", observedAt: T + hour * 3600, now: T + hour * 3600, items: [item(1, 100 + hour), item(2, 200 + hour)] }));
  }
  withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "scan-1", coverage: "items",
    observedAt: T, now: T, items: [item(1, 100)] }));
}

const count = (source) => withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_observations WHERE source_type = ?").get(source).n);
const snapshots = () => withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_snapshots").get().n);
const NOW = T + 40 * 3600;

test("observations are current state: each new snapshot replaces what it supersedes, at once", () => withHttpApp(async () => {
  seed();
  assert.equal(count("official_api"), 2, "one current observation per item, not one per snapshot");
  assert.equal(count("addon_scan"), 1, "the in-game scan is the current state of its own source");
  const current = withGuildDatabase((db) => db.prepare("SELECT item_key, min_unit_buyout, observed_at FROM market_observations WHERE source_type = 'official_api' ORDER BY item_key").all());
  assert.deepEqual(current.map((row) => [row.item_key, row.min_unit_buyout, row.observed_at]), [["i:1", 139, T + 39 * 3600], ["i:2", 239, T + 39 * 3600]]);
  const hourly = withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_series_hourly WHERE market_key = ?").get(API.marketKey).n);
  assert.equal(hourly, 80, "the hourly series holds every hour");
}));

for (const [label, prune] of [
  ["bounded steps", async () => {
    for (const step of marketPruneSteps(NOW)) {
      while (withGuildTransaction((db) => runMarketPruneStepInDatabase(db, step, 5)) === 5);
    }
  }],
  ["single transaction", async () => withGuildTransaction((db) => pruneMarketDataInDatabase(db, NOW))],
]) {
  test(`snapshots no observation names are dropped after a day; the latest of each scope stays (${label})`, () => withHttpApp(async () => {
    seed();
    assert.equal(snapshots(), 41);
    await prune();
    const kept = withGuildDatabase((db) => db.prepare("SELECT MIN(confirmed_at) AS oldest FROM market_snapshots WHERE source_type = 'official_api'").get().oldest);
    assert.ok(kept >= NOW - SNAPSHOT_RETENTION_SECONDS, "no unreferenced API snapshot older than the bookkeeping window");
    assert.ok(snapshots() <= 28, `bounded (${snapshots()})`);
    assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_snapshots WHERE source_type = 'addon_scan'").get().n), 1,
      "the in-game scan, 40 hours old, is kept: its observation names it");
    assert.equal(count("official_api"), 2, "current state is never pruned");
  }));
}

test("scheduled maintenance applies the same rules", () => withHttpApp(async () => {
  seed();
  const result = await maintainMarketsIfDue({ now: NOW + 20 * 3600 });
  assert.ok(result.pruned.snapshots > 0);
  assert.equal(count("addon_scan"), 1);
  assert.equal(count("official_api"), 2);
  // 60 hours after the first: the in-game scan (named by its observation)
  // and the API snapshots of the last 26 hours (hours 34-39).
  assert.equal(snapshots(), 7, "only named snapshots and a day of bookkeeping");
}));
