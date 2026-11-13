import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { maintainMarketsIfDue } from "../src/Market/marketRefresh.js";
import { marketPruneSteps, pruneMarketDataInDatabase, recordMarketSnapshotInDatabase, runMarketPruneStepInDatabase } from "../src/Market/marketRepository.js";
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
const NOW = T + 40 * 3600;

for (const [label, prune] of [
  ["bounded steps", async () => {
    for (const step of marketPruneSteps(NOW)) {
      while (withGuildTransaction((db) => runMarketPruneStepInDatabase(db, step, 5)) === 5);
    }
  }],
  ["single transaction", async () => withGuildTransaction((db) => pruneMarketDataInDatabase(db, NOW))],
]) {
  test(`API observations are kept 26 hours and in-game scans three days (${label})`, () => withHttpApp(async () => {
    seed();
    assert.equal(count("official_api"), 80);
    await prune();
    // Kept: the last 27 hourly snapshots (26 h window inclusive), plus none
    // older because the summaries point at the newest.
    const kept = withGuildDatabase((db) => db.prepare("SELECT MIN(observed_at) AS oldest FROM market_observations WHERE source_type = 'official_api'").get().oldest);
    assert.ok(kept >= NOW - 26 * 3600, "nothing older than 26 hours");
    assert.ok(count("official_api") >= 2 * 26, "a day of API evidence kept");
    assert.equal(count("addon_scan"), 1, "the in-game scan, 40 hours old, is kept");
    const hourly = withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_series_hourly WHERE market_key = ?").get(API.marketKey).n);
    assert.equal(hourly, 80, "the hourly series still holds every hour");
  }));
}

test("scheduled maintenance applies the same rules", () => withHttpApp(async () => {
  seed();
  const result = await maintainMarketsIfDue({ now: NOW + 20 * 3600 });
  assert.ok(result.pruned.observations > 0);
  assert.equal(count("addon_scan"), 1);
  assert.ok(count("official_api") <= 2 * 27);
}));
