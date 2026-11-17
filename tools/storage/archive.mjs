#!/usr/bin/env node
// Detailed Auction House history, kept on this PC by market and month.
//
//   node tools/storage/archive.mjs export [--from latest|<backup id>] [--root DIR]
//   node tools/storage/archive.mjs verify [--root DIR]
//   node tools/storage/archive.mjs inspect <archive file>
//   node tools/storage/archive.mjs restore <archive file> --into <database file>
//
// The website keeps compact history (48 hours hourly, 30 days daily, ...);
// each local backup still holds the finer rows of its day. `export` copies
// every history row of a backup into one file per market, month and
// resolution:
//
//   <root>/archive/<market>/<YYYY-MM>/<table>.v1.ndjson.gz
//
// Line 1 is a header (format, version, table, columns, market, month, date
// range, row count, source backups, compression); every further line is
// one row as a JSON array. Files are merged across backups: a row already
// archived is kept unless the newer backup has more observations behind it
// (samples), so exporting every day's backup builds up every hour ever
// seen. <root>/archive/manifest.json lists every file with the SHA-256 of
// its compressed bytes and of its rows; a file is written to a temporary
// name, read back and checked before it replaces the previous version.
//
// Archiving never deletes anything anywhere. The live website never reads
// these files and does not depend on this PC.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";

import { dataRoot, findBackup, isMain, parseArgs, sha256File, writeJson } from "./lib.mjs";

export const ARCHIVE_FORMAT = "guildweaver-ah-archive";
export const ARCHIVE_VERSION = 1;
// Table, its period column, the month of a row, and its key columns.
export const ARCHIVED = Object.freeze({
  market_series_hourly: { period: "hour", month: (value) => new Date(Number(value) * 3600 * 1000).toISOString().slice(0, 7), key: ["market_key", "item_key", "source_type", "hour"] },
  market_series_daily: { period: "day", month: (value) => String(value).slice(0, 7), key: ["market_key", "item_key", "source_type", "day"] },
  market_series_weekly: { period: "week", month: (value) => String(value).slice(0, 7), key: ["market_key", "item_key", "source_type", "week"] },
  market_series_monthly: { period: "month", month: (value) => String(value).slice(0, 7), key: ["market_key", "item_key", "source_type", "month"] },
});

const safe = (name) => name.replace(/[^A-Za-z0-9_.-]/g, "_");

export function archiveDirectory(root) {
  return path.join(root, "archive");
}

function encode(header, rows) {
  const content = `${[JSON.stringify(header), ...rows.map((row) => JSON.stringify(row))].join("\n")}\n`;
  return { content, contentSha256: createHash("sha256").update(content).digest("hex"), compressed: gzipSync(content, { level: 9 }) };
}

export function decodeArchive(buffer) {
  const lines = gunzipSync(buffer).toString("utf8").split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]);
  if (header.format !== ARCHIVE_FORMAT || header.version !== ARCHIVE_VERSION) throw new Error(`Unknown archive format ${header.format} v${header.version}`);
  return { header, rows: lines.slice(1).map((line) => JSON.parse(line)) };
}

async function readManifest(root) {
  const file = path.join(archiveDirectory(root), "manifest.json");
  return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : { format: `${ARCHIVE_FORMAT}-manifest`, version: 1, files: {} };
}

export async function exportArchive({ from = "latest", root = dataRoot(), log = console } = {}) {
  const backup = await findBackup(root, from);
  const manifest = await readManifest(root);
  const db = new DatabaseSync(backup.file, { readOnly: true });
  const result = { backup: backup.id, written: 0, unchanged: 0, rows: 0 };
  try {
    for (const [table, spec] of Object.entries(ARCHIVED)) {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table)) continue;
      const columns = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).map((row) => row.name);
      const keyIndexes = spec.key.map((key) => columns.indexOf(key));
      const samplesIndex = columns.indexOf("samples");
      const periodIndex = columns.indexOf(spec.period);
      // One market at a time, so a month's rows are grouped without holding
      // the whole table in memory.
      for (const { market_key: market } of db.prepare(`SELECT DISTINCT market_key FROM ${table}`).all()) {
        const months = new Map();
        const statement = db.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM ${table} WHERE market_key = ?`);
        if (statement.setReturnArrays) statement.setReturnArrays(true);
        for (const raw of statement.iterate(market)) {
          const row = Array.isArray(raw) ? raw : columns.map((column) => raw[column]);
          const month = spec.month(row[periodIndex]);
          if (!months.has(month)) months.set(month, []);
          months.get(month).push(row);
        }
        for (const [month, rows] of months) {
          const relative = path.join(safe(market), month, `${table}.v${ARCHIVE_VERSION}.ndjson.gz`);
          const file = path.join(archiveDirectory(root), relative);
          const entry = manifest.files[relative.replaceAll("\\", "/")];
          const merged = new Map();
          let sources = [backup.id];
          if (entry && existsSync(file)) {
            const previous = decodeArchive(await readFile(file));
            if (previous.header.columns.join() !== columns.join()) throw new Error(`${relative}: columns changed; archive under a new version`);
            for (const row of previous.rows) merged.set(JSON.stringify(keyIndexes.map((index) => row[index])), row);
            sources = [...new Set([...(previous.header.sources || []), backup.id])];
          }
          for (const row of rows) {
            const key = JSON.stringify(keyIndexes.map((index) => row[index]));
            const known = merged.get(key);
            if (!known || (samplesIndex >= 0 && Number(row[samplesIndex]) > Number(known[samplesIndex]))) merged.set(key, row);
          }
          const sorted = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
          const periods = sorted.map((row) => row[periodIndex]);
          const header = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, table, columns, market, month, from: periods.reduce((a, b) => (a < b ? a : b)),
            to: periods.reduce((a, b) => (a > b ? a : b)), rows: sorted.length, sources, compression: "gzip", prices: "copper per unit" };
          // Which backups contributed is not content: compare rows only.
          const { contentSha256 } = encode({ ...header, sources: [] }, sorted);
          if (entry && entry.contentSha256 === contentSha256 && existsSync(file)) { result.unchanged += 1; continue; }
          const written = encode(header, sorted);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(`${file}.tmp`, written.compressed);
          const check = decodeArchive(await readFile(`${file}.tmp`));
          if (check.rows.length !== sorted.length) throw new Error(`${relative}: read back ${check.rows.length} of ${sorted.length} rows`);
          await rename(`${file}.tmp`, file);
          manifest.files[relative.replaceAll("\\", "/")] = { table, market, month, rows: sorted.length, from: header.from, to: header.to, sources,
            sha256: await sha256File(file), contentSha256, bytes: written.compressed.length, updatedAt: new Date().toISOString() };
          result.written += 1;
          result.rows += sorted.length;
        }
      }
    }
  } finally {
    db.close();
  }
  manifest.updatedAt = new Date().toISOString();
  await mkdir(archiveDirectory(root), { recursive: true });
  await writeJson(path.join(archiveDirectory(root), "manifest.json"), manifest);
  log.info?.(`[archive] ${result.written} files written, ${result.unchanged} unchanged, from backup ${backup.id}`);
  return result;
}

export async function verifyArchive({ root = dataRoot() } = {}) {
  const manifest = await readManifest(root);
  const problems = [];
  let files = 0;
  for (const [relative, entry] of Object.entries(manifest.files)) {
    files += 1;
    const file = path.join(archiveDirectory(root), relative);
    if (!existsSync(file)) { problems.push(`${relative}: missing`); continue; }
    if ((await sha256File(file)) !== entry.sha256) { problems.push(`${relative}: checksum differs`); continue; }
    const { header, rows } = decodeArchive(await readFile(file));
    if (rows.length !== entry.rows || header.rows !== entry.rows) problems.push(`${relative}: row count differs`);
    if (encode({ ...header, sources: [] }, rows).contentSha256 !== entry.contentSha256) problems.push(`${relative}: content checksum differs`);
  }
  return { ok: problems.length === 0, files, problems };
}

// Puts archived rows back into a database (a restored backup or a scratch
// copy for analysis), never the live one. Existing rows are replaced.
export async function restoreArchive({ file, into }) {
  const { header, rows } = decodeArchive(await readFile(file));
  const db = new DatabaseSync(into);
  try {
    const columns = header.columns.map((column) => `"${column}"`).join(", ");
    const insert = db.prepare(`INSERT OR REPLACE INTO ${header.table} (${columns}) VALUES (${header.columns.map(() => "?").join(", ")})`);
    db.exec("BEGIN");
    for (const row of rows) insert.run(...row);
    db.exec("COMMIT");
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
  return { table: header.table, market: header.market, month: header.month, rows: rows.length };
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const options = parseArgs(rest, { values: ["from", "root", "into"] });
    const root = dataRoot(options.root);
    let result;
    if (command === "export") result = await exportArchive({ from: options.from || "latest", root });
    else if (command === "verify") result = await verifyArchive({ root });
    else if (command === "inspect") {
      const { header, rows } = decodeArchive(await readFile(options._[0]));
      result = { header, sample: rows.slice(0, 5) };
    } else if (command === "restore") {
      if (!options.into) throw new Error("restore needs --into <database file>");
      result = await restoreArchive({ file: options._[0], into: options.into });
    } else throw new Error("Usage: node tools/storage/archive.mjs export|verify|inspect|restore ...");
    console.log(JSON.stringify(result, null, 2));
    if (result.ok === false) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
