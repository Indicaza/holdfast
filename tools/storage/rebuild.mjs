#!/usr/bin/env node
// Rebuilds a compact production database on this PC from a verified backup.
//
//   node tools/storage/rebuild.mjs                      (latest backup)
//   node tools/storage/rebuild.mjs --from 20261117T043000Z --root D:\GuildweaverData
//   node tools/storage/rebuild.mjs --report-only        (step 1 alone)
//
// Never touches production and never modifies the backup. Steps:
//   1. Read-only report of the backup: every table's size and rows, and the
//      Auction House rows the cleanup policy makes eligible for deletion.
//   2. A working copy (SQLite's backup API) gets this release's migrations
//      (version 24 turns raw observations into current state) and the
//      website's own maintenance: watched set, weekly and monthly roll-ups,
//      then retention deletes that check the coarser rows exist and are
//      final. Run twice: the second run must remove nothing.
//   3. The compact database is written fresh from the working copy, table
//      by table with rowids kept (no VACUUM needed, nothing grows in place).
//   4. Validation: integrity_check; every table outside the Auction House
//      storage tables is identical to the backup, row for row; migration
//      history is kept; every summary (the price shown) is unchanged; every
//      current observation is the backup's latest; every day, week and
//      month of history still has its row at the resolution retention
//      calls for; the website's market queries run against the result.
//   5. manifest.json (SHA-256, size, schema version, every check) and
//      report.md in <root>/rebuilds/<id>/. upload.mjs sends that file.
//
// Cleanup policy (what may be dropped): superseded raw observations (only
// the latest per market, variant, source and full view is kept), snapshot
// bookkeeping no observation names, hourly history past 48 hours (7 days
// for watched items), daily past 30 days (90 watched) once its week and
// month are rolled up, weekly past 52 weeks once its month is rolled up,
// monthly past 24 months, snapshot checks past 14 days, provider runs
// past 30 days, price ladders and view counts past their windows. Nothing
// else: accounts, guild configuration, sign-in and pairing, wishlists,
// game data, recipes, dungeon loot, telemetry are copied unchanged.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { snapshotProcess } from "./backup.mjs";
import {
  backendModule,
  buildDatabaseFromSnapshot,
  contentDigests,
  copyDatabase,
  dataRoot,
  DATABASE_NAME,
  dump,
  fileBytes,
  findBackup,
  isMain,
  parseArgs,
  sha256File,
  snapshotFrames,
  timestampId,
  verifyDatabase,
  writeJson,
} from "./lib.mjs";

// Tables whose rows the cleanup may change. Everything else must come out
// identical.
export const AH_STORAGE_TABLES = Object.freeze([
  "market_observations", "market_snapshots", "market_snapshot_checks", "market_series_hourly", "market_series_daily", "market_series_weekly",
  "market_series_monthly", "market_summaries", "market_watched", "market_maintenance", "market_price_ladders", "market_provider_runs",
  "market_item_interest", "market_item_meta", "schema_migrations",
]);

const HOUR = 3600;
const DAY = 86400;
const MiB = 1024 ** 2;

function tableSizes(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tableOf = new Map(db.prepare("SELECT name, tbl_name AS tableName FROM sqlite_schema WHERE type IN ('table', 'index')").all().map((row) => [row.name, row.tableName]));
    const sizes = {};
    for (const row of db.prepare("SELECT name, pgsize AS bytes FROM dbstat WHERE aggregate = TRUE").all()) {
      const table = tableOf.get(row.name) ?? row.name.replace(/^sqlite_autoindex_(.*)_\d+$/, "$1");
      sizes[table] ??= { bytes: 0, rows: 0 };
      sizes[table].bytes += row.bytes;
    }
    for (const name of Object.keys(sizes)) {
      if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name)) sizes[name].rows = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${dump.quote(name)}`).get().n);
    }
    const pragma = (name) => Number(Object.values(db.prepare(`PRAGMA ${name}`).get())[0]);
    return { tables: sizes, pageSize: pragma("page_size"), pages: pragma("page_count"), freePages: pragma("freelist_count") };
  } finally {
    db.close();
  }
}

const has = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table));
const n = (db, sql, ...params) => Number(db.prepare(sql).get(...params).n);

// Step 1: what the cleanup policy makes eligible, read only.
export function eligibilityReport(file, now) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const day = (days) => new Date((now - days * DAY) * 1000).toISOString().slice(0, 10);
    const report = {};
    if (has(db, "market_observations")) {
      const total = n(db, "SELECT COUNT(*) AS n FROM market_observations");
      const current = n(db, `SELECT COUNT(*) AS n FROM (SELECT 1 FROM market_observations o LEFT JOIN market_snapshots s ON s.id = o.snapshot_id
        GROUP BY o.market_key, o.item_key, o.source_type, o.complete, CASE WHEN s.coverage = 'full' THEN s.scope_key ELSE '' END)`);
      report.market_observations = { rows: total, kept: current, eligible: total - current, rule: "only the latest per market, variant, source and full view" };
    }
    if (has(db, "market_snapshots")) report.market_snapshots = { rows: n(db, "SELECT COUNT(*) AS n FROM market_snapshots"), rule: "kept while an observation names it, the latest of its scope, or under 26 hours" };
    if (has(db, "market_series_hourly")) report.market_series_hourly = { rows: n(db, "SELECT COUNT(*) AS n FROM market_series_hourly"), olderThan48h: n(db, "SELECT COUNT(*) AS n FROM market_series_hourly WHERE hour < ?", Math.floor((now - 48 * HOUR) / HOUR)), olderThan7d: n(db, "SELECT COUNT(*) AS n FROM market_series_hourly WHERE hour < ?", Math.floor((now - 7 * DAY) / HOUR)) };
    if (has(db, "market_series_daily")) report.market_series_daily = { rows: n(db, "SELECT COUNT(*) AS n FROM market_series_daily"), olderThan30d: n(db, "SELECT COUNT(*) AS n FROM market_series_daily WHERE day < ?", day(30)), olderThan90d: n(db, "SELECT COUNT(*) AS n FROM market_series_daily WHERE day < ?", day(90)), rule: "deleted only after their week and month are rolled up and final" };
    if (has(db, "market_series_weekly")) report.market_series_weekly = { rows: n(db, "SELECT COUNT(*) AS n FROM market_series_weekly"), olderThan52w: n(db, "SELECT COUNT(*) AS n FROM market_series_weekly WHERE week < ?", day(364)) };
    if (has(db, "market_snapshot_checks")) report.market_snapshot_checks = { rows: n(db, "SELECT COUNT(*) AS n FROM market_snapshot_checks"), olderThan14d: n(db, "SELECT COUNT(*) AS n FROM market_snapshot_checks WHERE checked_at < ?", now - 14 * DAY) };
    if (has(db, "market_provider_runs")) report.market_provider_runs = { rows: n(db, "SELECT COUNT(*) AS n FROM market_provider_runs"), olderThan30d: n(db, "SELECT COUNT(*) AS n FROM market_provider_runs WHERE started_at < ?", now - 30 * DAY) };
    return report;
  } finally {
    db.close();
  }
}

// Step 4c-f: what must survive, compared across the backup and the result.
function crossChecks(original, compact, now) {
  const db = new DatabaseSync(compact, { readOnly: true });
  db.prepare("ATTACH DATABASE ? AS o").run(`file:${original.replaceAll("\\", "/")}?mode=ro`);
  const day = (days) => new Date((now - days * DAY) * 1000).toISOString().slice(0, 10);
  try {
    const checks = {};
    const has0 = (schema, table) => Boolean(db.prepare(`SELECT 1 FROM ${schema}.sqlite_schema WHERE type = 'table' AND name = ?`).get(table));
    checks.migrationHistoryKept = n(db, `SELECT COUNT(*) AS n FROM o.schema_migrations a WHERE NOT EXISTS (SELECT 1 FROM main.schema_migrations b WHERE b.version = a.version AND b.name = a.name)`) === 0;
    if (has0("o", "market_summaries")) {
      checks.summariesMissing = n(db, `SELECT COUNT(*) AS n FROM o.market_summaries a WHERE NOT EXISTS (SELECT 1 FROM main.market_summaries b WHERE b.market_key = a.market_key AND b.item_key = a.item_key)`);
      checks.summariesChanged = n(db, `SELECT COUNT(*) AS n FROM o.market_summaries a JOIN main.market_summaries b ON b.market_key = a.market_key AND b.item_key = a.item_key
        WHERE b.min_unit_buyout IS NOT a.min_unit_buyout OR b.typical_unit_buyout IS NOT a.typical_unit_buyout OR b.quantity IS NOT a.quantity
          OR b.listings IS NOT a.listings OR b.source_type IS NOT a.source_type OR b.observed_at IS NOT a.observed_at OR b.item_id IS NOT a.item_id`);
    }
    if (has0("o", "market_observations")) {
      checks.currentObservationsMissing = n(db, `SELECT COUNT(*) AS n FROM (SELECT market_key, item_key, source_type, complete, MAX(observed_at) AS at FROM o.market_observations
          GROUP BY market_key, item_key, source_type, complete) a
        WHERE NOT EXISTS (SELECT 1 FROM main.market_observations b WHERE b.market_key = a.market_key AND b.item_key = a.item_key AND b.source_type = a.source_type
          AND b.complete = a.complete AND b.observed_at = a.at)`);
    }
    if (has0("o", "market_series_daily")) {
      const monthFloor = (() => { const date = new Date(now * 1000); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 24); return date.toISOString().slice(0, 10); })();
      checks.monthsMissing = n(db, `SELECT COUNT(*) AS n FROM (SELECT DISTINCT market_key, item_key, source_type, substr(day, 1, 7) || '-01' AS month FROM o.market_series_daily WHERE day >= ?) a
        WHERE NOT EXISTS (SELECT 1 FROM main.market_series_monthly b WHERE b.market_key = a.market_key AND b.item_key = a.item_key AND b.source_type = a.source_type AND b.month = a.month)`, monthFloor);
      checks.weeksMissing = n(db, `SELECT COUNT(*) AS n FROM (SELECT DISTINCT market_key, item_key, source_type,
            date(day, '-' || ((CAST(strftime('%w', day) AS INTEGER) + 6) % 7) || ' days') AS week FROM o.market_series_daily WHERE day >= ?) a
        WHERE NOT EXISTS (SELECT 1 FROM main.market_series_weekly b WHERE b.market_key = a.market_key AND b.item_key = a.item_key AND b.source_type = a.source_type AND b.week = a.week)`, day(364));
      checks.daysMissing = n(db, `SELECT COUNT(*) AS n FROM o.market_series_daily a WHERE a.day >= ?
        AND NOT EXISTS (SELECT 1 FROM main.market_series_daily b WHERE b.market_key = a.market_key AND b.item_key = a.item_key AND b.source_type = a.source_type AND b.day = a.day)`, day(30));
    }
    if (has0("o", "market_series_hourly")) {
      checks.hoursMissing = n(db, `SELECT COUNT(*) AS n FROM o.market_series_hourly a WHERE a.hour >= ?
        AND NOT EXISTS (SELECT 1 FROM main.market_series_hourly b WHERE b.market_key = a.market_key AND b.item_key = a.item_key AND b.source_type = a.source_type AND b.hour = a.hour)`,
      Math.floor((now - 48 * HOUR) / HOUR));
    }
    return checks;
  } finally {
    db.close();
  }
}

// Step 4g: the website's market queries against a copy of the result.
async function websiteChecks(compact, directory, now) {
  const verify = path.join(directory, "verify");
  await rm(verify, { recursive: true, force: true });
  await mkdir(verify, { recursive: true });
  await copyDatabase(compact, path.join(verify, DATABASE_NAME));
  const previous = process.env.GUILD_DATA_DIR;
  process.env.GUILD_DATA_DIR = verify;
  const database = await backendModule("Data/database.js");
  const market = await backendModule("Market/marketRepository.js");
  const results = { items: 0, problems: [] };
  try {
    const samples = database.withGuildDatabase((db) => db.prepare(`SELECT market_key AS marketKey, item_id AS itemId, item_key AS itemKey, min_unit_buyout AS min, quantity
      FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY market_key ORDER BY quantity DESC, item_key) AS rank FROM market_summaries) WHERE rank <= 3 ORDER BY market_key LIMIT 48`).all());
    for (const sample of samples) {
      results.items += 1;
      try {
        market.searchMarket({ marketKey: sample.marketKey, q: "", now });
        const detail = market.readItemMarket({ itemId: sample.itemId, itemKey: sample.itemKey, marketKey: sample.marketKey, now });
        if (!detail?.variants?.length) results.problems.push(`${sample.marketKey} ${sample.itemKey}: item page has no variants`);
        for (const range of ["24h", "7d", "30d", "90d", "1y", "all"]) market.readItemSeries({ itemId: sample.itemId, itemKey: sample.itemKey, marketKey: sample.marketKey, range, now });
        const analysis = market.readItemAnalysis({ itemId: sample.itemId, itemKey: sample.itemKey, marketKey: sample.marketKey, now });
        if (!analysis?.summary) results.problems.push(`${sample.marketKey} ${sample.itemKey}: no analysis summary`);
        const price = market.readPrices({ marketKey: sample.marketKey, itemKeys: [sample.itemKey], now }).prices[0];
        if (!price || price.minUnitBuyout !== sample.min || price.quantity !== sample.quantity) results.problems.push(`${sample.marketKey} ${sample.itemKey}: price differs from its summary`);
      } catch (error) {
        results.problems.push(`${sample.marketKey} ${sample.itemKey}: ${error.message}`);
      }
    }
    market.readMarketDiagnostics({ now });
  } finally {
    database.closeGuildDatabase();
    if (previous === undefined) delete process.env.GUILD_DATA_DIR;
    else process.env.GUILD_DATA_DIR = previous;
    await rm(verify, { recursive: true, force: true, maxRetries: 5 });
  }
  return results;
}

// The steady-state size of the live Auction House tables, projected from
// this database: measured bytes per row, and how many item variants each
// market actually observes per hour (the last day of hourly rows).
function steadyState(file, now) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const sizes = tableSizes(file).tables;
    const perRow = (table) => (sizes[table]?.rows ? sizes[table].bytes / sizes[table].rows : 0);
    const perHour = n(db, "SELECT COUNT(*) AS n FROM market_series_hourly WHERE hour >= ?", Math.floor((now - DAY) / HOUR)) / 24;
    const variants = n(db, "SELECT COUNT(*) AS n FROM market_summaries");
    const watched = n(db, "SELECT COUNT(*) AS n FROM market_watched");
    const rows = {
      market_series_hourly: perHour * 54 + watched * 120,
      market_series_daily: perHour * 39 + watched * 51,
      market_series_weekly: perHour * 57,
      market_series_monthly: perHour * 25,
    };
    const projected = Object.fromEntries(Object.entries(rows).map(([table, count]) => [table, Math.round(count * perRow(table))]));
    for (const table of Object.keys(sizes).filter((name) => name.startsWith("market_") && !(name in projected))) projected[table] = sizes[table].bytes;
    const total = Object.values(projected).reduce((sum, value) => sum + value, 0);
    return { observedVariantsPerHour: Math.round(perHour), variants, watched, projectedBytes: total, projectedMiB: Math.round(total / MiB),
      tablesMiB: Object.fromEntries(Object.entries(projected).map(([table, value]) => [table, Math.round((value / MiB) * 10) / 10])) };
  } finally {
    db.close();
  }
}

async function compactCopy(source, target) {
  const { child, input } = snapshotProcess({ local: source, spawnImpl: spawn });
  child.stdin.end(input({}));
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("close", resolve));
  const built = await buildDatabaseFromSnapshot({ frames: snapshotFrames(child.stdout), target });
  if ((await exited) !== 0) throw new Error(`copy failed: ${stderr}`);
  return built;
}

export async function rebuild({ from = "latest", root = dataRoot(), now = Math.floor(Date.now() / 1000), reportOnly = false, log = console } = {}) {
  const source = await findBackup(root, from);
  const id = timestampId(new Date(now * 1000));
  const directory = path.join(root, "rebuilds", id);
  if (existsSync(directory)) throw new Error(`${directory} already exists`);
  await mkdir(directory, { recursive: true });
  const step = (text) => log.info?.(`[rebuild] ${text}`);

  step(`1/5 report on backup ${source.id} (read only)`);
  if ((await sha256File(source.file)) !== source.manifest.sha256) throw new Error("The backup does not match its manifest checksum");
  const before = tableSizes(source.file);
  const eligible = eligibilityReport(source.file, now);
  await writeJson(path.join(directory, "report-before.json"), { backup: source.id, now, sizes: before, eligible });
  if (reportOnly) return { directory, before, eligible };

  step("2/5 working copy, migrations and maintenance");
  const work = path.join(directory, "work.sqlite");
  await copyDatabase(source.file, work);
  const { migrateGuildDatabase } = await backendModule("Data/database.js");
  const { runMarketMaintenanceInDatabase } = await backendModule("Market/marketRepository.js");
  const db = new DatabaseSync(work);
  let first;
  let second;
  try {
    migrateGuildDatabase(db);
    db.exec("BEGIN IMMEDIATE");
    first = runMarketMaintenanceInDatabase(db, now, { measure: false, batchRows: 1_000_000 });
    db.exec("COMMIT");
    db.exec("BEGIN IMMEDIATE");
    // The same policy at the same time again: must find nothing left to do.
    second = runMarketMaintenanceInDatabase(db, now, { measure: false, batchRows: 1_000_000 });
    db.exec("COMMIT");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
  const removedAgain = Object.values(second.pruned).reduce((sum, value) => sum + value, 0);

  step("3/5 compact copy");
  const compact = path.join(directory, DATABASE_NAME);
  await compactCopy(work, compact);

  step("4/5 validation");
  const verified = verifyDatabase(compact, { expected: contentDigests(work) });
  const originalTables = new Map(source.manifest.tables.map((table) => [table.name, table]));
  const compactTables = new Map(verified.tables.map((table) => [table.name, table]));
  const preservedDiffer = [];
  for (const [name, table] of originalTables) {
    if (AH_STORAGE_TABLES.includes(name) || name === "sqlite_sequence") continue;
    const after = compactTables.get(name);
    if (!after || after.sha256 !== table.sha256 || after.rows !== table.rows) preservedDiffer.push(name);
  }
  // A table a pending migration added rows to (production may be behind
  // this release) is still preserved when every original row is there,
  // unchanged.
  const preservedExtended = [];
  if (preservedDiffer.length) {
    const check = new DatabaseSync(compact, { readOnly: true });
    check.prepare("ATTACH DATABASE ? AS o").run(`file:${source.file.replaceAll("\\", "/")}?mode=ro`);
    try {
      for (const name of [...preservedDiffer]) {
        const columns = check.prepare("SELECT name FROM pragma_table_info(?, 'o')").all(name).map((row) => dump.quote(row.name)).join(", ");
        const lost = Number(check.prepare(`SELECT COUNT(*) AS n FROM (SELECT ${columns} FROM o.${dump.quote(name)} EXCEPT SELECT ${columns} FROM main.${dump.quote(name)})`).get().n);
        if (lost === 0) {
          preservedDiffer.splice(preservedDiffer.indexOf(name), 1);
          preservedExtended.push(name);
        }
      }
    } finally {
      check.close();
    }
  }
  const cross = crossChecks(source.file, compact, now);
  const website = await websiteChecks(compact, directory, now);
  const validation = {
    integrity: verified.integrity,
    foreignKeyViolations: { before: source.manifest.foreignKeyViolations ?? null, after: verified.foreignKeyViolations },
    compactMatchesWorkingCopy: verified.mismatches.length === 0,
    preservedTablesIdentical: preservedDiffer.length === 0, preservedTablesDiffering: preservedDiffer, preservedTablesExtendedByMigrations: preservedExtended, preservedTables: [...originalTables.keys()].filter((name) => !AH_STORAGE_TABLES.includes(name)).length,
    ...cross,
    secondCleanupRemoved: removedAgain,
    website,
  };
  const ok = validation.integrity === "ok" && validation.compactMatchesWorkingCopy && validation.preservedTablesIdentical && validation.migrationHistoryKept
    && !validation.summariesMissing && !validation.summariesChanged && !validation.currentObservationsMissing && !validation.monthsMissing && !validation.weeksMissing
    && !validation.daysMissing && !validation.hoursMissing && removedAgain === 0 && website.problems.length === 0
    && (validation.foreignKeyViolations.before === null || validation.foreignKeyViolations.after <= validation.foreignKeyViolations.before);

  step("5/5 manifest and report");
  const after = tableSizes(compact);
  const sha256 = await sha256File(compact);
  const bytes = await fileBytes(compact);
  const sum = (sizes, filter) => Object.entries(sizes.tables).filter(([name]) => filter(name)).reduce((total, [, entry]) => total + entry.bytes, 0);
  const sizes = {
    databaseBytes: { before: source.manifest.bytes, after: bytes },
    auctionHouseBytes: { before: sum(before, (name) => name.startsWith("market_")), after: sum(after, (name) => name.startsWith("market_")) },
    otherBytes: { before: sum(before, (name) => !name.startsWith("market_")), after: sum(after, (name) => !name.startsWith("market_")) },
    tables: Object.fromEntries([...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort().map((name) => [name, {
      before: before.tables[name] ?? null, after: after.tables[name] ?? null }])),
  };
  const projection = steadyState(compact, now);
  const manifest = { format: "guildweaver-rebuild", version: 1, id, ok, createdAt: new Date().toISOString(), now, backup: { id: source.id, sha256: source.manifest.sha256 },
    file: DATABASE_NAME, sha256, bytes, schemaVersion: verified.schemaVersion, digest: verified.digest, validation, cleanup: { first: first.pruned, held: first.held, rolled: { weeks: first.weeks, months: first.months } },
    eligible, sizes, steadyState: projection };
  await writeJson(path.join(directory, "manifest.json"), manifest);
  await writeFile(path.join(directory, "report.md"), report(manifest));
  await rm(work, { force: true });
  for (const suffix of ["-wal", "-shm"]) await rm(`${work}${suffix}`, { force: true });
  return { directory, file: compact, manifest };
}

function report(manifest) {
  const mib = (value) => (value === null || value === undefined ? "–" : `${(value / MiB).toFixed(1)} MiB`);
  const lines = [
    `# Guildweaver database rebuild ${manifest.id}`, "",
    `Result: **${manifest.ok ? "verified" : "NOT VERIFIED – do not deploy"}**`, "",
    `From backup ${manifest.backup.id}. Output ${manifest.file}, ${mib(manifest.bytes)}, sha256 \`${manifest.sha256}\`, schema version ${manifest.schemaVersion}.`, "",
    "| | before | after |", "|---|---:|---:|",
    `| database file | ${mib(manifest.sizes.databaseBytes.before)} | ${mib(manifest.sizes.databaseBytes.after)} |`,
    `| Auction House tables and indexes | ${mib(manifest.sizes.auctionHouseBytes.before)} | ${mib(manifest.sizes.auctionHouseBytes.after)} |`,
    `| everything else | ${mib(manifest.sizes.otherBytes.before)} | ${mib(manifest.sizes.otherBytes.after)} |`, "",
    `Projected steady state of the live Auction House tables: ${manifest.steadyState.projectedMiB} MiB (${manifest.steadyState.observedVariantsPerHour} variants observed per hour; budget warning 2048 MiB, critical 3072 MiB).`, "",
    "## Validation", "", "```json", JSON.stringify(manifest.validation, null, 2), "```", "",
    "## Tables", "", "| table | rows before | rows after | size before | size after |", "|---|---:|---:|---:|---:|",
    ...Object.entries(manifest.sizes.tables).map(([name, entry]) => `| ${name} | ${entry.before?.rows ?? "–"} | ${entry.after?.rows ?? "–"} | ${mib(entry.before?.bytes)} | ${mib(entry.after?.bytes)} |`),
    "", "## Eligible for cleanup (before)", "", "```json", JSON.stringify(manifest.eligible, null, 2), "```", "",
  ];
  return `${lines.join("\n")}\n`;
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), { flags: ["report-only"], values: ["from", "root", "now"] });
    const now = options.now ? Math.floor(Date.parse(options.now) / 1000) : Math.floor(Date.now() / 1000);
    const result = await rebuild({ from: options.from || "latest", root: dataRoot(options.root), now, reportOnly: options["report-only"] === true, log: { info: (text) => console.error(text) } });
    if (result.manifest) {
      const { manifest } = result;
      console.log(JSON.stringify({ ok: manifest.ok, file: result.file, sha256: manifest.sha256, bytes: manifest.bytes, sizes: { databaseBytes: manifest.sizes.databaseBytes, auctionHouseBytes: manifest.sizes.auctionHouseBytes },
        steadyStateMiB: manifest.steadyState.projectedMiB, report: path.join(result.directory, "report.md") }, null, 2));
      if (!manifest.ok) process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ directory: result.directory, eligible: result.eligible }, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
