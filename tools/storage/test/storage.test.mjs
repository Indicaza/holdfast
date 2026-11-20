// Tests for the local storage tools. Run from the repository root:
//   node --test tools/storage/test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import test from "node:test";

import { decodeArchive, exportArchive, restoreArchive, verifyArchive } from "../archive.mjs";
import { runBackup } from "../backup.mjs";
import { backendModule, contentDigests, dataRoot, listBackups, verifyDatabase } from "../lib.mjs";
import { rebuild } from "../rebuild.mjs";
import { restoreBackup } from "../restore.mjs";

const { migrateGuildDatabase } = await backendModule("Data/database.js");
const quiet = { info() {}, warn() {}, error() {} };
const HOUR = 3600;
const DAY = 86400;

async function withRoot(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gw-storage-tools-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

function source(directory, throughVersion = Infinity) {
  const file = path.join(directory, "source.sqlite");
  const db = new DatabaseSync(file);
  if (Number.isFinite(throughVersion)) {
    // The release before bounded storage, as production has it today.
    db.exec("PRAGMA journal_mode = WAL");
    migrateOldRelease(db, throughVersion);
  } else {
    migrateGuildDatabase(db);
  }
  return { file, db };
}

let migrateOldRelease;
{
  const database = await backendModule("Data/database.js");
  migrateOldRelease = (db, throughVersion) => database.migrateGuildDatabase(db, { throughVersion });
}

test("a backup is consistent while the database is written, holds what only the WAL had, and restores", () => withRoot(async (root) => {
  const { file, db } = source(root);
  db.exec("PRAGMA wal_autocheckpoint = 0");
  db.exec(`CREATE TABLE typed (a, b BLOB, c REAL, d INTEGER PRIMARY KEY AUTOINCREMENT);
    INSERT INTO typed (a, b, c) VALUES (9007199254740993, x'00ff10', 3.0), ('text', NULL, 1.5), (NULL, x'', -0.25);
    DELETE FROM typed WHERE a = 'text';
    CREATE TABLE gaps (v TEXT); INSERT INTO gaps (rowid, v) VALUES (5, 'five'), (900, 'nine hundred');
    CREATE VIEW typed_view AS SELECT a FROM typed;
    CREATE INDEX typed_c_idx ON typed(c);`);
  db.prepare("INSERT INTO market_favorites (member_id, item_id, created_at) VALUES ('member-1', 2770, '2026-11-01')").run();
  assert.ok((await readFile(`${file}-wal`)).length > 0, "rows are only in the WAL");
  const backupRoot = path.join(root, "data");
  const first = await runBackup({ local: file, root: backupRoot, log: quiet });
  assert.equal(first.manifest.integrity, "ok");
  assert.equal(first.manifest.restoreTest.ok, true);
  assert.deepEqual(first.manifest.restoreTest.pendingMigrations, []);
  assert.equal(first.manifest.tables.find((table) => table.name === "market_favorites").rows, 1);
  const copy = new DatabaseSync(first.file, { readOnly: true });
  const typed = copy.prepare("SELECT a, hex(b) AS b, typeof(c) AS tc, c, d FROM typed ORDER BY d");
  typed.setReadBigInts(true);
  assert.deepEqual(typed.all().map((row) => ({ ...row })), [
    { a: 9007199254740993n, b: "00FF10", tc: "real", c: 3, d: 1n },
    { a: null, b: "", tc: "real", c: -0.25, d: 3n },
  ], "exact integers, blobs, reals and rowids");
  assert.deepEqual(copy.prepare("SELECT rowid, v FROM gaps ORDER BY rowid").all().map((row) => [row.rowid, row.v]), [[5, "five"], [900, "nine hundred"]]);
  assert.equal(copy.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'typed'").get().seq, 3, "AUTOINCREMENT counters kept");
  assert.ok(copy.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'typed_view'").get() && copy.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'typed_c_idx'").get());
  copy.close();

  // Written during and after: the next backup sends only what changed.
  db.prepare("INSERT INTO market_favorites (member_id, item_id, created_at) VALUES ('member-1', 2771, '2026-11-02')").run();
  const second = await runBackup({ local: file, root: backupRoot, now: new Date(Date.now() + 60_000), log: quiet });
  assert.equal(second.manifest.transfer.sentTables, 1, "only the changed table travels");
  assert.ok(second.manifest.transfer.keptTables > 50);
  assert.deepEqual(contentDigests(second.file), contentDigests(file), "the backup is the database, table for table");
  db.close();

  const target = path.join(root, "restored", "holdfast.sqlite");
  const restored = await restoreBackup({ from: "latest", target, root: backupRoot, log: quiet });
  assert.equal(restored.ok, true);
  assert.equal(verifyDatabase(target).digest, second.manifest.digest);
  await assert.rejects(() => restoreBackup({ from: "latest", target, root: backupRoot, log: quiet }), /Refusing to overwrite/);
}));

// A snapshot process whose stream stops after `bytes`.
function cutAfter(bytes, { exitCode = 0 } = {}) {
  return (command, args, options) => {
    const real = spawn(command, args, options);
    const child = new EventEmitter();
    child.stdin = real.stdin;
    child.stderr = real.stderr;
    child.stdout = new PassThrough();
    child.kill = () => real.kill();
    let sent = 0;
    real.stdout.on("data", (chunk) => {
      if (sent >= bytes) return;
      child.stdout.write(chunk.subarray(0, bytes - sent));
      sent += chunk.length;
      if (sent >= bytes) { child.stdout.end(); real.kill(); }
    });
    real.stdout.on("end", () => child.stdout.end());
    real.once("close", () => child.emit("close", exitCode, null));
    real.once("error", (error) => child.emit("error", error));
    return child;
  };
}

test("an interrupted backup keeps nothing and leaves earlier backups alone", () => withRoot(async (root) => {
  const { file, db } = source(root);
  for (let index = 0; index < 3000; index += 1) db.prepare("INSERT INTO market_favorites (member_id, item_id, created_at) VALUES (?, ?, '2026-11-01')").run(`m-${index}`, index);
  db.close();
  const backupRoot = path.join(root, "data");
  const good = await runBackup({ local: file, root: backupRoot, log: quiet });
  for (const [label, spawnImpl] of [["stream cut, clean exit", cutAfter(4000)], ["stream cut, failed exit", cutAfter(4000, { exitCode: 255 })]]) {
    await assert.rejects(() => runBackup({ local: file, root: backupRoot, full: true, now: new Date(Date.now() + 120_000), spawnImpl, log: quiet }), /nothing kept/, label);
    assert.deepEqual((await listBackups(backupRoot)).map((entry) => entry.id), [good.id], `${label}: only the earlier backup`);
    assert.deepEqual((await readdir(path.join(backupRoot, "backups"))).filter((name) => name.startsWith(".")), [], `${label}: no partial files left`);
  }
  assert.equal(verifyDatabase(good.file).digest, good.manifest.digest, "the earlier backup is intact");
}));

// The release before bounded storage, bloated the way production is.
function bloat(db, now) {
  const market = "api:us:house-110";
  db.prepare("INSERT INTO market_markets (market_key, kind, region, house_id, faction, name, created_at, last_snapshot_at) VALUES (?, 'api_house', 'us', 110, 'alliance', 'AH', '2026-08-01', ?)").run(market, now);
  const snapshot = db.prepare(`INSERT INTO market_snapshots (market_key, source_type, source_id, scope_key, coverage, content_hash, observed_at, confirmed_at, ingested_at, item_count, listing_count)
    VALUES (?, 'official_api', ?, 'api:auctions', 'full', ?, ?, ?, '2026-11-01', 20, 20)`);
  const observation = db.prepare(`INSERT INTO market_observations (snapshot_id, market_key, item_key, item_id, source_type, complete, observed_at, min_unit_buyout, typical_unit_buyout, quantity, listings)
    VALUES (?, ?, ?, ?, 'official_api', 1, ?, ?, ?, ?, 1)`);
  const hourly = db.prepare(`INSERT OR REPLACE INTO market_series_hourly (market_key, item_key, source_type, hour, first_at, last_at, samples, min_low, min_close, typical_close, quantity_low, quantity_high, quantity_close, listings_close)
    VALUES (?, ?, 'official_api', ?, ?, ?, 1, ?, ?, ?, 5, 5, 5, 1)`);
  const daily = db.prepare(`INSERT OR REPLACE INTO market_series_daily (market_key, item_key, source_type, day, first_at, last_at, samples, min_low, min_high, min_close, typical_low, typical_high, typical_close, quantity_low, quantity_high, quantity_close, listings_close)
    VALUES (?, ?, 'official_api', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 5, 5, 5, 1)`);
  const ids = [];
  // 60 hourly snapshots, each with 20 items; i:99 sold out 59 hours ago and
  // its summary still names that snapshot (the leak).
  for (let hour = 60; hour >= 1; hour -= 1) {
    const at = now - hour * HOUR;
    const id = Number(snapshot.run(market, `s-${hour}`, `h-${hour}`, at, at).lastInsertRowid);
    ids.push(id);
    for (let item = 1; item <= 20; item += 1) observation.run(id, market, `i:${item}`, item, at, 100 + item + hour, 110 + item + hour, 5);
    if (hour === 59) observation.run(id, market, "i:99", 99, at, null, null, 0);
  }
  const latest = ids.at(-1);
  const summary = db.prepare(`INSERT INTO market_summaries (market_key, item_key, item_id, source_type, snapshot_id, complete, observed_at, confirmed_at, min_unit_buyout, typical_unit_buyout, quantity, listings, selection_reason, updated_at)
    VALUES (?, ?, ?, 'official_api', ?, 1, ?, ?, ?, ?, ?, 1, 'latest', '2026-11-01')`);
  for (let item = 1; item <= 20; item += 1) summary.run(market, `i:${item}`, item, latest, now - HOUR, now - HOUR, 101 + item, 111 + item, 5);
  summary.run(market, "i:99", 99, ids[1], now - 59 * HOUR, now - 59 * HOUR, null, null, 0);
  // Ten days of hourly history and 70 of daily history.
  for (let item = 1; item <= 20; item += 1) {
    for (let hour = 1; hour <= 240; hour += 1) {
      const at = now - hour * HOUR;
      hourly.run(market, `i:${item}`, Math.floor(at / HOUR), at, at, 100 + item, 100 + item, 110 + item);
    }
    for (let back = 1; back <= 70; back += 1) {
      const at = now - back * DAY;
      const price = 100 + item + (back % 7);
      daily.run(market, `i:${item}`, new Date(at * 1000).toISOString().slice(0, 10), at, at, price, price + 3, price, price + 10, price + 13, price + 10);
    }
  }
  // Everything that is not Auction House storage: must come out identical.
  db.prepare("INSERT INTO market_favorites (member_id, item_id, created_at) VALUES ('member-1', 7, '2026-10-01')").run();
  db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (7, '70338', 'enUS', 'Thing', 2, NULL, '{}', '2026-10-01')`).run();
}

test("the rebuild cleans a bloated database, keeps everything else identical, and verifies itself", { timeout: 300_000 }, () => withRoot(async (root) => {
  const now = Math.floor(Date.now() / 1000);
  const { file, db } = source(root, 23);
  bloat(db, now);
  db.close();
  const backupRoot = path.join(root, "data");
  const backup = await runBackup({ local: file, root: backupRoot, log: quiet });
  assert.equal(backup.manifest.schemaVersion, 23);
  const result = await rebuild({ root: backupRoot, now, log: quiet });
  const { manifest } = result;
  assert.equal(manifest.ok, true, JSON.stringify(manifest.validation));
  assert.equal(manifest.schemaVersion, 25);
  assert.equal(manifest.validation.integrity, "ok");
  assert.equal(manifest.validation.preservedTablesIdentical, true);
  assert.ok(manifest.validation.preservedTables > 50);
  assert.equal(manifest.validation.secondCleanupRemoved, 0, "cleaning again removes nothing");
  assert.equal(manifest.validation.website.problems.length, 0);
  assert.equal(manifest.eligible.market_observations.rows, 60 * 20 + 1);
  assert.equal(manifest.eligible.market_observations.kept, 21);
  const compact = new DatabaseSync(result.file, { readOnly: true });
  const rows = (table) => compact.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.equal(rows("market_observations"), 21, "current state only");
  assert.ok(rows("market_snapshots") <= 27, "the sold-out item no longer pins its snapshot");
  assert.ok(rows("market_series_hourly") <= 19 * 49 + 169, "48 hours of hourly history; 7 days for the favorite (i:7)");
  assert.ok(compact.prepare("SELECT COUNT(*) AS n FROM market_series_hourly WHERE item_key = 'i:7'").get().n > 100, "the watched item keeps its week");
  assert.ok(rows("market_series_monthly") >= 20 * 3, "months rolled up before days were dropped");
  assert.ok(compact.prepare("SELECT MIN(day) AS d FROM market_series_daily WHERE item_key <> 'i:7'").get().d >= new Date((now - 40 * DAY) * 1000).toISOString().slice(0, 10));
  assert.equal(compact.prepare("SELECT quantity FROM market_summaries WHERE item_key = 'i:99'").get().quantity, 0, "current state of a sold-out item kept");
  compact.close();
  assert.ok(manifest.sizes.auctionHouseBytes.after < manifest.sizes.auctionHouseBytes.before);
  assert.ok(existsSync(path.join(result.directory, "report.md")));
  assert.ok(!existsSync(path.join(result.directory, "work.sqlite")), "the working copy is removed");
  // The backup it came from is untouched.
  assert.equal(verifyDatabase(backup.file).digest, backup.manifest.digest);
}));

test("archives: per market and month, merged across backups, checksummed, restorable", () => withRoot(async (root) => {
  const now = Math.floor(Date.now() / 1000);
  const { file, db } = source(root);
  const hourly = db.prepare(`INSERT INTO market_series_hourly (market_key, item_key, source_type, hour, first_at, last_at, samples, min_low, min_close, typical_close, quantity_low, quantity_high, quantity_close, listings_close)
    VALUES ('api:us:house-110', ?, 'official_api', ?, ?, ?, ?, 100, 100, 110, 5, 5, 5, 1)`);
  for (let hour = 1; hour <= 30; hour += 1) hourly.run("i:1", Math.floor((now - hour * HOUR) / HOUR), now, now, 1);
  db.close();
  const backupRoot = path.join(root, "data");
  await runBackup({ local: file, root: backupRoot, log: quiet });
  const first = await exportArchive({ root: backupRoot, log: quiet });
  assert.ok(first.written >= 1 && first.rows === 30);
  const again = await exportArchive({ root: backupRoot, log: quiet });
  assert.equal(again.written, 0, "the same rows are not rewritten");
  // A later backup with more hours and a fuller hour: merged.
  const writer = new DatabaseSync(file);
  writer.prepare(`UPDATE market_series_hourly SET samples = 3 WHERE hour = ?`).run(Math.floor((now - HOUR) / HOUR));
  writer.prepare(`DELETE FROM market_series_hourly WHERE hour < ?`).run(Math.floor((now - 10 * HOUR) / HOUR));
  writer.close();
  await runBackup({ local: file, root: backupRoot, now: new Date(Date.now() + 60_000), log: quiet });
  await exportArchive({ root: backupRoot, log: quiet });
  const manifest = JSON.parse(await readFile(path.join(backupRoot, "archive", "manifest.json"), "utf8"));
  const hourlyFiles = Object.entries(manifest.files).filter(([, entry]) => entry.table === "market_series_hourly");
  assert.equal(hourlyFiles.reduce((sum, [, entry]) => sum + entry.rows, 0), 30, "hours the live database dropped stay archived");
  const [relative] = hourlyFiles.find(([, entry]) => entry.sources.length === 2) || hourlyFiles[0];
  const { header, rows } = decodeArchive(await readFile(path.join(backupRoot, "archive", relative)));
  assert.equal(header.format, "guildweaver-ah-archive");
  assert.equal(header.version, 1);
  assert.equal(header.compression, "gzip");
  assert.ok(header.market && header.month && header.from <= header.to && header.rows === rows.length);
  assert.equal((await verifyArchive({ root: backupRoot })).ok, true);
  // Restorable into a scratch database.
  const scratch = path.join(root, "scratch.sqlite");
  const target = new DatabaseSync(scratch);
  migrateGuildDatabase(target);
  target.close();
  const restored = await restoreArchive({ file: path.join(backupRoot, "archive", relative), into: scratch });
  assert.equal(restored.rows, rows.length);
  // Tampering is found.
  await writeFile(path.join(backupRoot, "archive", relative), Buffer.from("not gzip"));
  const verified = await verifyArchive({ root: backupRoot });
  assert.equal(verified.ok, false);
  assert.match(verified.problems[0], /checksum/);
}));

test("data stays outside the repository", () => {
  assert.throws(() => dataRoot(path.resolve("tools/storage/data")), /inside the repository/);
});
