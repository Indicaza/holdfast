import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { guildDatabaseFile, pendingGuildMigrations } from "./database.js";
import { runtimeDataDirectory } from "./runtimeData.js";

// Pre-migration safety snapshots on the application disk.
//
// A snapshot is taken only when this release has migrations to apply: an
// ordinary restart copies nothing. Each snapshot is verified before it is
// trusted and is described by a sidecar JSON file (schema versions, source
// file identity, size). A restart that finds the newest snapshot still
// matching the unchanged database reuses it instead of copying again, so a
// release that keeps failing its migration does not fill the disk.
//
// Retention applies only to snapshots this code created (those with a
// sidecar). Older snapshots, written before sidecars existed, are reported
// but never deleted automatically: removing them is an operator decision.

const BACKUP_DIRECTORY = "deploy-backups";
const BACKUP_PREFIX = "holdfast-before-startup-";
const PARTIAL_SUFFIX = ".partial";
export const DEFAULT_KEEP = 2;
// Space kept free beyond the copy itself, for the migration and WAL.
const MIN_HEADROOM_BYTES = 256 * 1024 * 1024;

function safeTimestamp(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function sidecarPath(file) {
  return file.replace(/\.sqlite$/, ".json");
}

async function fileBytes(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

// Size and modification time of the main database file after a full
// checkpoint. Writes after a checkpoint change it; reads and rolled-back
// transactions do not.
async function sourceIdentity(file) {
  const stats = await stat(file);
  return { bytes: stats.size, mtimeMs: Math.trunc(stats.mtimeMs) };
}

function quickCheck(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("PRAGMA quick_check").get()?.quick_check;
  } finally {
    db.close();
  }
}

export function startupBackupDirectory() {
  return path.join(runtimeDataDirectory(), BACKUP_DIRECTORY);
}

// Every file in the backup directory with its size, newest first. Managed
// snapshots carry their sidecar metadata; anything else is "legacy" or
// "partial" (an interrupted copy).
export async function listStartupBackups(directory = startupBackupDirectory()) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const backups = [];
  for (const name of names) {
    if (!name.startsWith(BACKUP_PREFIX)) continue;
    const file = path.join(directory, name);
    if (name.endsWith(PARTIAL_SUFFIX)) {
      backups.push({ name, kind: "partial", bytes: await fileBytes(file), meta: null });
      continue;
    }
    if (!name.endsWith(".sqlite")) continue;
    let meta = null;
    if (names.has(name.replace(/\.sqlite$/, ".json"))) {
      try {
        meta = JSON.parse(await readFile(sidecarPath(file), "utf8"));
      } catch {
        meta = null;
      }
    }
    backups.push({ name, kind: meta ? "managed" : "legacy", bytes: await fileBytes(file), meta });
  }
  return backups.sort((a, b) => b.name.localeCompare(a.name));
}

export async function freeDiskBytes(directory, { statfsImpl = statfs } = {}) {
  const stats = await statfsImpl(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function requiredBackupBytes(databaseBytes, walBytes) {
  const copy = databaseBytes + walBytes;
  return copy + Math.max(MIN_HEADROOM_BYTES, Math.ceil(copy * 0.1));
}

function keepFrom(env, keep) {
  const value = keep ?? (env.STARTUP_BACKUP_KEEP === undefined ? DEFAULT_KEEP : Number(env.STARTUP_BACKUP_KEEP));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Startup backup retention must be a positive integer");
  }
  return value;
}

// Removes managed snapshots beyond `keep`, never the one just created and
// never legacy files. A failed removal is reported, not fatal: the new
// snapshot is already verified, and the next run retries the cleanup.
async function pruneManagedBackups(directory, keep, protectedName, remove = rm) {
  const managed = (await listStartupBackups(directory)).filter((entry) => entry.kind === "managed");
  const stale = managed.filter((entry) => entry.name !== protectedName).slice(Math.max(0, keep - 1));
  const removed = [];
  const failed = [];
  for (const entry of stale) {
    const file = path.join(directory, entry.name);
    try {
      await remove(file);
      await remove(sidecarPath(file), { force: true });
      removed.push(entry.name);
    } catch (error) {
      failed.push({ name: entry.name, error: error.code || error.message });
    }
  }
  return { removed, failed };
}

async function removePartials(directory) {
  for (const entry of await listStartupBackups(directory)) {
    if (entry.kind === "partial") await rm(path.join(directory, entry.name), { force: true });
  }
}

export async function backupGuildDatabaseBeforeMigrations({
  env = process.env,
  now = () => new Date(),
  keep,
  statfsImpl = statfs,
  removeImpl = rm,
} = {}) {
  if (env.NODE_ENV !== "production") {
    return { status: "disabled" };
  }

  const retain = keepFrom(env, keep);
  const source = guildDatabaseFile();
  if (!existsSync(source)) {
    return { status: "no-database" };
  }

  // Open the existing database directly. Do not call openGuildDatabase here:
  // that would run the new migrations before the safety snapshot exists.
  // Reading schema_migrations also fails closed on a file that is not SQLite.
  const sourceDb = new DatabaseSync(source);
  let pending;
  let fromVersion;
  try {
    pending = pendingGuildMigrations(sourceDb);
    if (!pending.length) {
      return { status: "not-needed", pending: [] };
    }
    fromVersion = Number(sourceDb.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version ?? 0);
  } catch (error) {
    sourceDb.close();
    throw new Error(`Refusing startup migration: the existing Holdfast database could not be read (${error.message})`, { cause: error });
  }

  const directory = startupBackupDirectory();
  let result;
  try {
    if (env.MIGRATION_BACKUP === "skip") {
      // Operator override, for when a verified off-site backup exists and the
      // disk cannot hold a local copy. Logged by the caller.
      result = { status: "skipped-by-operator", pending };
      return result;
    }

    await mkdir(directory, { recursive: true });
    await removePartials(directory);

    // Fold the WAL into the main file so the identity below reflects every
    // committed write and the copy needs no WAL replay.
    sourceDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const identity = await sourceIdentity(source);
    const toVersion = Math.max(...pending.map((migration) => migration.version));

    const newest = (await listStartupBackups(directory)).find((entry) => entry.kind === "managed");
    if (newest && newest.meta.source?.bytes === identity.bytes && newest.meta.source?.mtimeMs === identity.mtimeMs
      && newest.meta.fromVersion === fromVersion && newest.bytes === newest.meta.bytes) {
      result = { status: "reused", file: path.join(directory, newest.name), bytes: newest.bytes, pending };
      return result;
    }

    const walBytes = await fileBytes(`${source}-wal`);
    const needed = requiredBackupBytes(identity.bytes, walBytes);
    const free = await freeDiskBytes(directory, { statfsImpl });
    if (free < needed) {
      throw new Error(
        `Refusing startup migration: a pre-migration backup needs ${needed} bytes free in ${directory} but only ${free} are available. `
        + "Free space or enlarge the disk; set MIGRATION_BACKUP=skip only after confirming a verified off-site backup.",
      );
    }

    const name = `${BACKUP_PREFIX}${safeTimestamp(now())}.sqlite`;
    const destination = path.join(directory, name);
    const partial = `${destination}${PARTIAL_SUFFIX}`;
    const startedAt = Date.now();
    try {
      await backup(sourceDb, partial);
      const integrity = quickCheck(partial);
      if (integrity !== "ok") {
        throw new Error(
          `Refusing startup migration because the existing Holdfast database failed quick_check: ${integrity || "unknown"}`,
        );
      }
      await rename(partial, destination);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    const bytes = await fileBytes(destination);
    await writeFile(sidecarPath(destination), `${JSON.stringify({
      version: 1,
      createdAt: now().toISOString(),
      fromVersion,
      toVersion,
      pending: pending.map((migration) => migration.version),
      source: identity,
      bytes,
      copyMs: Date.now() - startedAt,
      integrity: "ok",
    }, null, 2)}\n`);

    const pruned = await pruneManagedBackups(directory, retain, name, removeImpl);
    result = { status: "created", file: destination, bytes, pending, pruned };
    return result;
  } finally {
    sourceDb.close();
  }
}
