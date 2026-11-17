"use strict";
// Consistent logical snapshot of a live SQLite database, streamed to stdout.
//
// Runs where the database is (Render, over SSH: tools/storage/backup.mjs
// sends this file as the command) with nothing but Node's own node:sqlite.
// It writes nothing next to the database: no copy, no temporary file.
//
// Consistency: everything is read inside ONE read transaction. In WAL mode a
// reader sees a fixed snapshot (the database file plus the WAL up to the
// moment the transaction began) while the application keeps writing; the
// WAL is not checkpointed past an open reader, so nothing it needs is
// overwritten. Every table, index definition and row comes from that one
// snapshot. The application is never blocked: readers never take the write
// lock.
//
// Why logical and not pages: the official page-level tools (the sqlite3
// CLI's .backup, sqlite3_rsync, the sqlite_dbpage table) are not in the
// production image or in Node's SQLite build, and the backup API needs a
// destination file on the same disk, a second full copy production has no
// room for. Rows are re-inserted locally with their rowids, so the rebuilt
// database is logically identical; every table carries a SHA-256 of its
// exact encoded rows, checked again against the rebuilt file.
//
// Stream (gzip): frames of [type: 1 byte][length: u32 BE][payload].
//   H  header JSON          S  schema JSON (sqlite_schema rows)
//   T  table start JSON     R  rows (encoded, see encodeRows)
//   K  table kept JSON      (unchanged since the base backup: not sent)
//   E  table end JSON       Z  trailer JSON
// stdin: optional JSON { base: { [table]: sha256 } } from the last backup.
// A table whose digest matches is sent as K and copied from that backup.

const crypto = require("node:crypto");
const fs = require("node:fs");
const zlib = require("node:zlib");

const FORMAT = "guildweaver-logical-snapshot";
const VERSION = 1;
const ROWS_PER_FRAME = 2000;

function frame(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

// Values: null, INTEGER (BigInt, exact 64-bit), REAL (double), TEXT, BLOB.
function encodeValue(value, parts) {
  if (value === null || value === undefined) {
    parts.push(Buffer.from([0]));
  } else if (typeof value === "bigint") {
    const buffer = Buffer.alloc(9);
    buffer[0] = 1;
    buffer.writeBigInt64BE(value, 1);
    parts.push(buffer);
  } else if (typeof value === "number") {
    const buffer = Buffer.alloc(9);
    buffer[0] = 2;
    buffer.writeDoubleBE(value, 1);
    parts.push(buffer);
  } else if (typeof value === "string") {
    const text = Buffer.from(value, "utf8");
    const head = Buffer.alloc(5);
    head[0] = 3;
    head.writeUInt32BE(text.length, 1);
    parts.push(head, text);
  } else {
    const blob = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    const head = Buffer.alloc(5);
    head[0] = 4;
    head.writeUInt32BE(blob.length, 1);
    parts.push(head, blob);
  }
}

function encodeRows(rows, columns) {
  const head = Buffer.alloc(6);
  head.writeUInt32BE(rows.length, 0);
  head.writeUInt16BE(columns, 4);
  const parts = [head];
  for (const row of rows) for (const value of row) encodeValue(value, parts);
  return Buffer.concat(parts);
}

function decodeRows(buffer) {
  const count = buffer.readUInt32BE(0);
  const columns = buffer.readUInt16BE(4);
  let offset = 6;
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const row = new Array(columns);
    for (let column = 0; column < columns; column += 1) {
      const tag = buffer[offset];
      offset += 1;
      if (tag === 0) row[column] = null;
      else if (tag === 1) { row[column] = buffer.readBigInt64BE(offset); offset += 8; }
      else if (tag === 2) { row[column] = buffer.readDoubleBE(offset); offset += 8; }
      else {
        const length = buffer.readUInt32BE(offset);
        offset += 4;
        const slice = buffer.subarray(offset, offset + length);
        row[column] = tag === 3 ? slice.toString("utf8") : new Uint8Array(slice);
        offset += length;
      }
    }
    rows.push(row);
  }
  return rows;
}

const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;

// What to read from each table, in a fixed order, so the same data always
// encodes to the same bytes. Rowid tables carry their rowid unless a column
// is it (INTEGER PRIMARY KEY); WITHOUT ROWID tables are read in key order.
function tablePlans(db) {
  const tables = db.prepare(`SELECT s.name, s.sql, l.wr FROM sqlite_schema s JOIN pragma_table_list l ON l.name = s.name AND l.schema = 'main'
    WHERE s.type = 'table' AND s.name NOT LIKE 'sqlite_%' ORDER BY s.name`).all();
  const plans = tables.map((table) => {
    const info = db.prepare(`SELECT name, type, pk, hidden FROM pragma_table_xinfo(?)`).all(table.name);
    const columns = info.filter((column) => column.hidden === 0).map((column) => column.name);
    const keys = info.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
    const withoutRowid = table.wr === 1;
    const rowidAlias = !withoutRowid && keys.length === 1 && String(keys[0].type).toUpperCase() === "INTEGER";
    const selected = withoutRowid || rowidAlias ? columns : ["rowid", ...columns];
    const order = withoutRowid ? keys.map((column) => quote(column.name)).join(", ") : "rowid";
    return { name: table.name, columns: selected, withoutRowid, select: `SELECT ${selected.map((column) => (column === "rowid" ? "rowid" : quote(column))).join(", ")} FROM ${quote(table.name)} ORDER BY ${order}` };
  });
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_sequence'").get()) {
    plans.push({ name: "sqlite_sequence", columns: ["name", "seq"], withoutRowid: false, select: "SELECT name, seq FROM sqlite_sequence ORDER BY name" });
  }
  return plans;
}

function* readTable(db, plan) {
  const statement = db.prepare(plan.select);
  statement.setReadBigInts(true);
  if (statement.setReturnArrays) statement.setReturnArrays(true);
  let batch = [];
  for (const row of statement.iterate()) {
    batch.push(Array.isArray(row) ? row : plan.columns.map((column) => row[column]));
    if (batch.length === ROWS_PER_FRAME) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

// Digest of a table: SHA-256 over its encoded row frames, plus the count.
function tableDigest(db, plan) {
  const hash = crypto.createHash("sha256");
  let rows = 0;
  for (const batch of readTable(db, plan)) {
    hash.update(encodeRows(batch, plan.columns.length));
    rows += batch.length;
  }
  return { sha256: hash.digest("hex"), rows };
}

function databaseDigest(tables) {
  const hash = crypto.createHash("sha256");
  for (const table of tables) hash.update(`${table.name}\0${table.rows}\0${table.sha256}\n`);
  return hash.digest("hex");
}

function schemaRows(db) {
  return db.prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid").all();
}

function pragmas(db) {
  const one = (name) => Object.values(db.prepare(`PRAGMA ${name}`).get())[0];
  return { pageSize: one("page_size"), userVersion: one("user_version"), applicationId: one("application_id"), autoVacuum: one("auto_vacuum"), encoding: one("encoding") };
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function main(argv = process.argv.slice(1).filter((value) => value !== "--" && !value.endsWith("dumpDatabase.cjs"))) {
  const file = argv[0];
  if (!file) throw new Error("usage: dumpDatabase.cjs /path/to/holdfast.sqlite");
  const request = await readStdin();
  const base = request.base || {};
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 10000");
  const out = zlib.createGzip({ level: Number(request.level ?? 1) });
  out.pipe(process.stdout);
  const write = (buffer) => (out.write(buffer) ? null : new Promise((resolve) => out.once("drain", resolve)));
  const started = Date.now();
  db.exec("BEGIN");
  try {
    // The first read fixes the snapshot every later read sees.
    db.prepare("SELECT COUNT(*) FROM sqlite_schema").get();
    const sizeOf = (target) => { try { return fs.statSync(target).size; } catch { return 0; } };
    let free = null;
    try { const stats = fs.statfsSync(require("node:path").dirname(file)); free = stats.bavail * stats.bsize; } catch { /* not reported */ }
    await write(frame("H", { format: FORMAT, version: VERSION, sqliteVersion: db.prepare("SELECT sqlite_version() AS v").get().v, node: process.version,
      file, fileBytes: sizeOf(file), walBytes: sizeOf(`${file}-wal`), freeBytes: free, startedAt: new Date(started).toISOString(), ...pragmas(db),
      schemaVersion: db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'schema_migrations'").get() ? Number(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v) : null }));
    await write(frame("S", schemaRows(db)));
    const tables = [];
    let sent = 0;
    let kept = 0;
    for (const plan of tablePlans(db)) {
      if (base[plan.name]) {
        const digest = tableDigest(db, plan);
        if (digest.sha256 === base[plan.name]) {
          await write(frame("K", { name: plan.name, columns: plan.columns, ...digest }));
          tables.push({ name: plan.name, ...digest });
          kept += 1;
          continue;
        }
      }
      await write(frame("T", { name: plan.name, columns: plan.columns, withoutRowid: plan.withoutRowid }));
      const hash = crypto.createHash("sha256");
      let rows = 0;
      for (const batch of readTable(db, plan)) {
        const payload = encodeRows(batch, plan.columns.length);
        hash.update(payload);
        rows += batch.length;
        const waiting = write(frame("R", payload));
        if (waiting) await waiting;
      }
      const digest = { name: plan.name, rows, sha256: hash.digest("hex") };
      await write(frame("E", digest));
      tables.push(digest);
      sent += 1;
    }
    await write(frame("Z", { tables: tables.length, sent, kept, rows: tables.reduce((sum, table) => sum + table.rows, 0), sha256: databaseDigest(tables),
      finishedAt: new Date().toISOString(), ms: Date.now() - started }));
  } finally {
    db.exec("COMMIT");
    db.close();
  }
  await new Promise((resolve) => out.end(resolve));
}

module.exports = { FORMAT, VERSION, decodeRows, encodeRows, frame, tablePlans, tableDigest, databaseDigest, readTable, quote, main };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`dump failed: ${error && error.message ? error.message : error}\n`);
    process.exit(1);
  });
}
