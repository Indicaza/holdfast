import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  guildDatabaseFile,
  migrateGuildDatabase,
  openGuildDatabase,
} from "../src/Data/database.js";
import {
  backupGuildDatabaseBeforeMigrations,
  startupBackupDirectory,
} from "../src/Data/startupBackup.js";

function preserveEnvironment() {
  return {
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
  };
}

function restoreEnvironment(previous) {
  if (previous.dataDir === undefined) delete process.env.GUILD_DATA_DIR;
  else process.env.GUILD_DATA_DIR = previous.dataDir;

  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
}

async function withTemporaryData(callback) {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-startup-backup-"));

  try {
    process.env.GUILD_DATA_DIR = directory;
    return await callback(directory);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
}

function seedVersionFiveDatabase() {
  const db = new DatabaseSync(guildDatabaseFile());

  try {
    migrateGuildDatabase(db, { throughVersion: 5 });
    db.prepare(
      `
        INSERT INTO members (
          id,
          username,
          display_name,
          initials,
          rank,
          status,
          first_seen_at,
          updated_at
        ) VALUES ('backup-member', 'backup', 'Backup Member', 'BM', 'Commander', 'active', ?, ?)
      `,
    ).run("2026-10-03T22:00:00.000Z", "2026-10-03T22:00:00.000Z");
    db.prepare(
      `
        INSERT INTO app_meta (key, value, updated_at)
        VALUES ('backup_sentinel', 'pre-migration-copy', ?)
      `,
    ).run("2026-10-03T22:00:00.000Z");
  } finally {
    db.close();
  }
}

function inspectDatabase(file) {
  const db = new DatabaseSync(file);

  try {
    return {
      migration: Number(
        db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
      ),
      members: Number(db.prepare("SELECT COUNT(*) AS count FROM members").get().count),
      sentinel: db
        .prepare("SELECT value FROM app_meta WHERE key = 'backup_sentinel'")
        .get()?.value,
      integrity: db.prepare("PRAGMA quick_check").get().quick_check,
    };
  } finally {
    db.close();
  }
}

test("production startup snapshot captures the old database before migrations run", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();

    const result = await backupGuildDatabaseBeforeMigrations({
      now: () => new Date("2026-10-03T22:01:00.000Z"),
    });

    assert.equal(result.status, "created");
    assert.equal(path.dirname(result.file), startupBackupDirectory());
    assert.deepEqual(inspectDatabase(result.file), {
      migration: 5,
      members: 1,
      sentinel: "pre-migration-copy",
      integrity: "ok",
    });

    const live = openGuildDatabase();
    live.close();

    assert.deepEqual(inspectDatabase(guildDatabaseFile()), {
      migration: 6,
      members: 1,
      sentinel: "pre-migration-copy",
      integrity: "ok",
    });

    // The snapshot remains the pre-migration image even after current code upgrades live SQLite.
    assert.equal(inspectDatabase(result.file).migration, 5);
  });
});

test("startup snapshots retain only the newest five recoverable copies", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();

    for (let index = 0; index < 7; index += 1) {
      await backupGuildDatabaseBeforeMigrations({
        now: () => new Date(Date.UTC(2026, 9, 3, 23, 0, index)),
      });
    }

    const files = (await readdir(startupBackupDirectory()))
      .filter((name) => name.endsWith(".sqlite"))
      .sort();

    assert.equal(files.length, 5);
    assert.ok(files[0].includes("23-00-02"));
    assert.ok(files[4].includes("23-00-06"));

    for (const file of files) {
      assert.equal(
        inspectDatabase(path.join(startupBackupDirectory(), file)).integrity,
        "ok",
      );
    }
  });
});

test("production startup fails closed when the existing SQLite file is corrupt", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    await writeFile(guildDatabaseFile(), "this is not sqlite", "utf8");

    await assert.rejects(
      () => backupGuildDatabaseBeforeMigrations(),
      /database|quick_check|malformed/i,
    );
  });
});

test("development does not create automatic startup snapshots", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "development";
    seedVersionFiveDatabase();

    const result = await backupGuildDatabaseBeforeMigrations();
    assert.deepEqual(result, { status: "disabled" });
  });
});
