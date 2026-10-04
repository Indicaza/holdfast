import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { guildDatabaseFile } from "./database.js";
import { runtimeDataDirectory } from "./runtimeData.js";

const BACKUP_DIRECTORY = "deploy-backups";
const BACKUP_PREFIX = "holdfast-before-startup-";
const DEFAULT_KEEP = 5;

function safeTimestamp(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function verifySqlite(file) {
  const db = new DatabaseSync(file);

  try {
    const integrity = db.prepare("PRAGMA quick_check").get()?.quick_check;
    if (integrity !== "ok") {
      throw new Error(`SQLite quick_check failed for ${file}: ${integrity || "unknown"}`);
    }
  } finally {
    db.close();
  }
}

async function pruneBackups(directory, keep) {
  const entries = await readdir(directory, { withFileTypes: true });
  const backups = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(BACKUP_PREFIX) &&
        entry.name.endsWith(".sqlite"),
    )
    .map((entry) => entry.name)
    .sort();

  const stale = backups.slice(0, Math.max(0, backups.length - keep));
  await Promise.all(stale.map((name) => rm(path.join(directory, name))));
}

export async function backupGuildDatabaseBeforeMigrations({
  env = process.env,
  now = () => new Date(),
  keep = DEFAULT_KEEP,
} = {}) {
  if (env.NODE_ENV !== "production") {
    return { status: "disabled" };
  }

  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error("Startup backup retention must be a positive integer");
  }

  const source = guildDatabaseFile();
  if (!existsSync(source)) {
    return { status: "no-database" };
  }

  const directory = path.join(runtimeDataDirectory(), BACKUP_DIRECTORY);
  await mkdir(directory, { recursive: true });

  // Open the existing database directly. Do not call openGuildDatabase here:
  // that would run the new migration before the safety snapshot exists.
  const sourceDb = new DatabaseSync(source);
  let destination;

  try {
    const integrity = sourceDb.prepare("PRAGMA quick_check").get()?.quick_check;
    if (integrity !== "ok") {
      throw new Error(
        `Refusing startup migration because the existing Holdfast database failed quick_check: ${integrity || "unknown"}`,
      );
    }

    destination = path.join(
      directory,
      `${BACKUP_PREFIX}${safeTimestamp(now())}.sqlite`,
    );
    await backup(sourceDb, destination);
  } finally {
    sourceDb.close();
  }

  verifySqlite(destination);
  await pruneBackups(directory, keep);

  return {
    status: "created",
    file: destination,
  };
}

export function startupBackupDirectory() {
  return path.join(runtimeDataDirectory(), BACKUP_DIRECTORY);
}
