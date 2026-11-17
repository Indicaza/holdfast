// Shared pieces of the local storage tools (backup, restore, rebuild,
// archive, upload). Everything here runs on the operator's PC.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const require = createRequire(import.meta.url);
export const dump = require("./remote/dumpDatabase.cjs");
export const TOOLS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY = path.resolve(TOOLS_DIRECTORY, "..", "..");
export const BACKEND = path.join(REPOSITORY, "backend");
export const DATABASE_NAME = "holdfast.sqlite";

// Backend modules, loaded on demand (the rebuild runs the website's own
// migrations and maintenance; backups only need the migration list).
export function backendModule(relative) {
  return import(pathToFileURL(path.join(BACKEND, "src", relative)).href);
}

// Where backups and archives live: --root, then GUILDWEAVER_DATA_ROOT, then
// D:\GuildweaverData when there is a D: drive, else GuildweaverData in the
// user's home directory. Never inside the repository.
export function dataRoot(explicit = "") {
  const chosen = explicit || process.env.GUILDWEAVER_DATA_ROOT || "";
  let root;
  if (chosen) root = path.resolve(chosen);
  else if (process.platform === "win32" && existsSync("D:\\")) root = "D:\\GuildweaverData";
  else root = path.join(os.homedir(), "GuildweaverData");
  const relative = path.relative(REPOSITORY, root);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error(`Refusing to keep data inside the repository: ${root}`);
  return root;
}

export function parseArgs(argv, { flags = [], values = [] } = {}) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) { options._.push(arg); continue; }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (flags.includes(name)) options[name] = true;
    else if (values.includes(name)) options[name] = inline ?? argv[(index += 1)];
    else throw new Error(`Unknown option --${name}`);
  }
  return options;
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function timestampId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export async function writeJson(file, value) {
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

// Frames of a snapshot stream (see remote/dumpDatabase.cjs), gunzipped.
export async function* snapshotFrames(input) {
  const gunzip = input.pipe(createGunzip());
  let pending = Buffer.alloc(0);
  for await (const chunk of gunzip) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 5) {
      const length = pending.readUInt32BE(1);
      if (pending.length < 5 + length) break;
      const type = String.fromCharCode(pending[0]);
      const payload = pending.subarray(5, 5 + length);
      pending = pending.subarray(5 + length);
      yield { type, payload: type === "R" ? Buffer.from(payload) : JSON.parse(payload.toString("utf8")) };
    }
  }
  if (pending.length) throw new Error("Snapshot stream ended inside a frame");
}

const columnList = (columns) => columns.map((column) => (column === "rowid" ? "rowid" : dump.quote(column))).join(", ");

// Builds a database from a snapshot stream. Tables whose content is
// unchanged since `basePath` (K frames) are copied from that file. Indexes,
// views and triggers are created after the rows. Returns the stream's own
// account of every table (rows, SHA-256) for verification.
export async function buildDatabaseFromSnapshot({ frames, target, basePath = null }) {
  const db = new DatabaseSync(target);
  let header = null;
  let schema = [];
  let trailer = null;
  let current = null;
  let insert = null;
  let hash = null;
  let rows = 0;
  const tables = [];
  let attached = false;
  try {
    for await (const { type, payload } of frames) {
      if (type === "H") {
        if (payload.format !== dump.FORMAT || payload.version !== dump.VERSION) throw new Error(`Unknown snapshot format ${payload.format} v${payload.version}`);
        header = payload;
        db.exec(`PRAGMA page_size = ${Number(payload.pageSize) || 4096}`);
        db.exec(`PRAGMA auto_vacuum = ${Number(payload.autoVacuum) || 0}`);
        db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF");
        if (basePath) { db.prepare("ATTACH DATABASE ? AS base").run(basePath); attached = true; }
        db.exec("BEGIN");
      } else if (type === "S") {
        schema = payload;
        for (const entry of schema) if (entry.type === "table" && !entry.name.startsWith("sqlite_")) db.exec(entry.sql);
      } else if (type === "T") {
        current = payload;
        if (current.name === "sqlite_sequence") db.exec("DELETE FROM main.sqlite_sequence");
        insert = db.prepare(`INSERT INTO main.${dump.quote(current.name)} (${columnList(current.columns)}) VALUES (${current.columns.map(() => "?").join(", ")})`);
        hash = createHash("sha256");
        rows = 0;
      } else if (type === "R") {
        hash.update(payload);
        for (const row of dump.decodeRows(payload)) insert.run(...row);
        rows += payload.readUInt32BE(0);
      } else if (type === "E") {
        const sha256 = hash.digest("hex");
        if (payload.name !== current?.name || payload.rows !== rows || payload.sha256 !== sha256) throw new Error(`Table ${payload.name} arrived damaged`);
        tables.push(payload);
        current = null;
      } else if (type === "K") {
        if (!attached) throw new Error(`Table ${payload.name} was not sent (unchanged) but there is no base backup`);
        if (payload.name === "sqlite_sequence") db.exec("DELETE FROM main.sqlite_sequence");
        db.exec(`INSERT INTO main.${dump.quote(payload.name)} (${columnList(payload.columns)}) SELECT ${columnList(payload.columns)} FROM base.${dump.quote(payload.name)}`);
        tables.push({ name: payload.name, rows: payload.rows, sha256: payload.sha256, kept: true });
      } else if (type === "Z") {
        trailer = payload;
      }
    }
    if (!header || !trailer) throw new Error("Snapshot stream ended early (no trailer): the transfer was interrupted");
    for (const entry of schema) {
      if (entry.type !== "table" && !entry.name.startsWith("sqlite_")) db.exec(entry.sql);
    }
    db.exec("COMMIT");
    db.exec(`PRAGMA user_version = ${Number(header.userVersion) || 0}`);
    db.exec(`PRAGMA application_id = ${Number(header.applicationId) || 0}`);
    if (attached) db.exec("DETACH DATABASE base");
    db.exec("PRAGMA journal_mode = WAL");
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
  if (dump.databaseDigest(tables) !== trailer.sha256) throw new Error("Snapshot digest does not match its trailer");
  return { header, trailer, tables };
}

// Every table's content digest, the same encoding the snapshot uses.
export function contentDigests(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return dump.tablePlans(db).map((plan) => ({ name: plan.name, ...dump.tableDigest(db, plan) }));
  } finally {
    db.close();
  }
}

// Integrity, foreign keys, schema version and content of a database file.
// `expected`: per-table digests it must match exactly.
export function verifyDatabase(file, { expected = null, full = true } = {}) {
  const db = new DatabaseSync(file, { readOnly: true });
  let integrity;
  let foreignKeyViolations;
  let schema;
  try {
    const check = db.prepare(`PRAGMA ${full ? "integrity_check" : "quick_check"}`).all().map((row) => Object.values(row)[0]);
    integrity = check.length === 1 && check[0] === "ok" ? "ok" : check.slice(0, 10).join("; ");
    foreignKeyViolations = db.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check").get().n;
    const hasMigrations = db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'schema_migrations'").get();
    schema = hasMigrations ? db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all().map((row) => ({ version: Number(row.version), name: row.name })) : [];
  } finally {
    db.close();
  }
  const tables = contentDigests(file);
  const mismatches = [];
  if (expected) {
    const wanted = new Map(expected.map((table) => [table.name, table]));
    for (const table of tables) {
      const want = wanted.get(table.name);
      if (!want) mismatches.push(`${table.name}: not expected`);
      else if (want.rows !== table.rows || want.sha256 !== table.sha256) mismatches.push(`${table.name}: content differs`);
      wanted.delete(table.name);
    }
    for (const name of wanted.keys()) mismatches.push(`${name}: missing`);
  }
  return { integrity, foreignKeyViolations, schemaVersion: schema.at(-1)?.version ?? null, migrations: schema, tables, digest: dump.databaseDigest(tables), mismatches,
    ok: integrity === "ok" && mismatches.length === 0 };
}

// A consistent copy with SQLite's online backup API.
export async function copyDatabase(source, target) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, target);
  } finally {
    db.close();
  }
}

export function backupsDirectory(root) {
  return path.join(root, "backups");
}

// Complete, verified backups, oldest first.
export async function listBackups(root) {
  const directory = backupsDirectory(root);
  if (!existsSync(directory)) return [];
  const backups = [];
  for (const name of (await readdir(directory)).sort()) {
    if (name.startsWith(".")) continue;
    const manifest = path.join(directory, name, "manifest.json");
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(await readFile(manifest, "utf8"));
    if (parsed.verified === true) backups.push({ id: name, directory: path.join(directory, name), file: path.join(directory, name, DATABASE_NAME), manifest: parsed });
  }
  return backups;
}

export async function findBackup(root, which = "latest") {
  const backups = await listBackups(root);
  if (!backups.length) throw new Error(`No verified backup in ${backupsDirectory(root)}`);
  if (!which || which === "latest") return backups.at(-1);
  const byId = backups.find((entry) => entry.id === which || entry.directory === path.resolve(which));
  if (byId) return byId;
  throw new Error(`No verified backup ${which}`);
}

export async function removeStalePartials(root) {
  const directory = backupsDirectory(root);
  if (!existsSync(directory)) return [];
  const removed = [];
  for (const name of await readdir(directory)) {
    if (!name.startsWith(".partial-")) continue;
    await rm(path.join(directory, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export async function fileBytes(file) {
  try { return (await stat(file)).size; } catch { return 0; }
}

export function dumpScriptSource() {
  return readFileSync(path.join(TOOLS_DIRECTORY, "remote", "dumpDatabase.cjs"), "utf8");
}

// A command for the remote shell that runs `source` with the remote node,
// passing `args`. The code travels base64-encoded: no quoting surprises.
export function remoteNodeCommand(source, args = []) {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  const safe = args.map((arg) => {
    if (!/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) throw new Error(`Unsafe remote argument: ${arg}`);
    return arg;
  });
  return `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))" ${safe.join(" ")}`.trim();
}

export function isMain(url) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === url;
}

export function sshArgs(target, command, extra = []) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(target)) throw new Error(`Unexpected SSH target: ${target}`);
  return ["-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=6", ...extra, target, command];
}
