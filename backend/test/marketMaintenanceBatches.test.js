import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closeGuildDatabase, guildDatabaseFile, withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { maintainMarketsIfDue } from "../src/Market/marketRefresh.js";
import { recordMarketSnapshotInDatabase, runMarketMaintenanceInDatabase } from "../src/Market/marketRepository.js";

// Market maintenance runs as many short transactions; the result must be
// exactly what the single-transaction version produces.

const START = 1794000000;
const MARKETS = [
  { marketKey: "api:us:house-110", kind: "api_house", region: "us", houseId: 110, faction: "alliance", name: "Alliance Auction House" },
  { marketKey: "api:us:house-111", kind: "api_house", region: "us", houseId: 111, faction: "horde", name: "Horde Auction House" },
];
const ITEMS = 120;

function item(itemId, hour) {
  const unit = 1000 + itemId * 7 + ((hour * 13 + itemId) % 50);
  return { itemKey: `i:${itemId}`, itemId, minUnitBuyout: unit, typicalUnitBuyout: unit + 5, maxUnitBuyout: unit + 40, quantity: 1 + ((itemId + hour) % 9), listings: 1 + (itemId % 3) };
}

// Eight days of snapshots every six hours: enough for observations to age
// out, hourly series to exceed nothing, and daily history for references.
function seed() {
  for (let hour = 0; hour < 8 * 24; hour += 6) {
    for (const market of MARKETS) {
      withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, {
        market, sourceType: "official_api", sourceId: `seed-${market.houseId}-${hour}`, coverage: "full", scope: "api:auctions",
        observedAt: START + hour * 3600, now: START + hour * 3600,
        items: Array.from({ length: ITEMS }, (_, index) => item(index + 1, hour)),
      }));
    }
  }
}

const TABLES = ["market_observations", "market_snapshots", "market_snapshot_checks", "market_series_hourly", "market_series_daily",
  "market_series_weekly", "market_summaries", "market_price_ladders", "market_item_meta"];

function state() {
  return withGuildDatabase((db) => Object.fromEntries(TABLES.map((table) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name).filter((name) => !["updated_at", "ran_at"].includes(name));
    return [table, db.prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY ${columns.join(", ")}`).all()];
  })));
}

async function withDirectory(run) {
  const previous = process.env.GUILD_DATA_DIR;
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-maintenance-"));
  process.env.GUILD_DATA_DIR = directory;
  try {
    return await run(directory);
  } finally {
    closeGuildDatabase();
    if (previous === undefined) delete process.env.GUILD_DATA_DIR;
    else process.env.GUILD_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function seededCopies() {
  const source = await mkdtemp(path.join(os.tmpdir(), "holdfast-maintenance-seed-"));
  process.env.GUILD_DATA_DIR = source;
  seed();
  withGuildDatabase((db) => db.exec("PRAGMA wal_checkpoint(TRUNCATE)"));
  closeGuildDatabase();
  return { file: path.join(source, "holdfast.sqlite"), cleanup: () => rm(source, { recursive: true, force: true }) };
}

const NOW = START + 9 * 86400;

test("batched maintenance leaves exactly the state one big transaction leaves, in small transactions", async () => {
  const previous = process.env.GUILD_DATA_DIR;
  const seeded = await seededCopies();
  try {
    const expected = await withDirectory(async () => {
      await copyFile(seeded.file, guildDatabaseFile());
      withGuildTransaction((db) => runMarketMaintenanceInDatabase(db, NOW));
      return state();
    });
    assert.ok(expected.market_observations.length > 0 && expected.market_series_weekly.length > 0, "the seed exercises pruning and roll-ups");

    await withDirectory(async () => {
      await copyFile(seeded.file, guildDatabaseFile());
      const before = withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS count FROM market_observations").get().count);
      let yields = 0;
      const result = await maintainMarketsIfDue({ now: NOW, batchRows: 100, yieldFn: async () => { yields += 1; } });
      assert.ok(result.pruned.observations > 0 && result.pruned.observations < before);
      assert.ok(result.transactions > 10, `split into many transactions (${result.transactions})`);
      assert.equal(yields, result.transactions, "requests are served between every transaction");
      assert.deepEqual(state(), expected);
      assert.equal(await maintainMarketsIfDue({ now: NOW + 60 }), null, "not due again until the interval passes");
    });
  } finally {
    await seeded.cleanup();
    if (previous === undefined) delete process.env.GUILD_DATA_DIR;
    else process.env.GUILD_DATA_DIR = previous;
  }
});

test("an interrupted run is not marked done and the next run finishes with the same result", async () => {
  const previous = process.env.GUILD_DATA_DIR;
  const seeded = await seededCopies();
  try {
    const expected = await withDirectory(async () => {
      await copyFile(seeded.file, guildDatabaseFile());
      await maintainMarketsIfDue({ now: NOW });
      return state();
    });

    await withDirectory(async () => {
      await copyFile(seeded.file, guildDatabaseFile());
      let calls = 0;
      const stopAfter = async () => {
        calls += 1;
        if (calls === 7) throw new Error("SIGTERM");
      };
      await assert.rejects(() => maintainMarketsIfDue({ now: NOW, batchRows: 100, yieldFn: stopAfter }), /SIGTERM/);
      const ran = withGuildDatabase((db) => db.prepare("SELECT ran_at FROM market_maintenance WHERE name = 'rollup'").get());
      assert.equal(ran, undefined, "an interrupted run is not recorded as done");

      const finished = await maintainMarketsIfDue({ now: NOW, batchRows: 100 });
      assert.ok(finished, "the next check runs it again");
      assert.deepEqual(state(), expected);
    });
  } finally {
    await seeded.cleanup();
    if (previous === undefined) delete process.env.GUILD_DATA_DIR;
    else process.env.GUILD_DATA_DIR = previous;
  }
});
