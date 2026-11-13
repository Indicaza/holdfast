import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
  listStartupBackups,
  requiredBackupBytes,
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
      migration: 22,
      members: 1,
      sentinel: "pre-migration-copy",
      integrity: "ok",
    });

    // The snapshot remains the pre-migration image even after current code upgrades live SQLite.
    assert.equal(inspectDatabase(result.file).migration, 5);
  });
});

function touchDatabase(label) {
  const db = new DatabaseSync(guildDatabaseFile());
  try {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('backup_touch', ?, ?)").run(label, new Date().toISOString());
  } finally {
    db.close();
  }
}

async function backupFiles() {
  return (await readdir(startupBackupDirectory())).sort();
}

test("startup snapshots keep the newest managed copies and never delete legacy files", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();
    await mkdir(startupBackupDirectory(), { recursive: true });
    const legacy = path.join(startupBackupDirectory(), "holdfast-before-startup-2026-01-01T00-00-00-000Z.sqlite");
    await copyFile(guildDatabaseFile(), legacy);

    for (let index = 0; index < 4; index += 1) {
      touchDatabase(`run-${index}`);
      // Different modification times, so each run sees a changed database.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await backupGuildDatabaseBeforeMigrations({ now: () => new Date(Date.UTC(2026, 9, 3, 23, 0, index)) });
      assert.equal(result.status, "created");
    }

    const backups = await listStartupBackups();
    const managed = backups.filter((entry) => entry.kind === "managed");
    assert.equal(managed.length, 2);
    assert.ok(managed[0].name.includes("23-00-03"));
    assert.ok(managed[1].name.includes("23-00-02"));
    assert.equal(backups.filter((entry) => entry.kind === "legacy").length, 1, "legacy snapshot kept");
    for (const entry of managed) {
      assert.equal(inspectDatabase(path.join(startupBackupDirectory(), entry.name)).integrity, "ok");
      assert.equal(entry.meta.fromVersion, 5);
      assert.equal(entry.meta.bytes, entry.bytes);
    }
  });
});

test("an ordinary restart with no pending migration copies nothing", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    openGuildDatabase().close();

    const result = await backupGuildDatabaseBeforeMigrations();
    assert.deepEqual(result, { status: "not-needed", pending: [] });
    assert.deepEqual(await listStartupBackups(), []);
  });
});

test("a restart after a failed migration reuses the unchanged snapshot", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();

    const first = await backupGuildDatabaseBeforeMigrations({ now: () => new Date("2026-10-03T22:01:00.000Z") });
    assert.equal(first.status, "created");
    const second = await backupGuildDatabaseBeforeMigrations({ now: () => new Date("2026-10-03T22:02:00.000Z") });
    assert.equal(second.status, "reused");
    assert.equal(second.file, first.file);
    assert.equal((await backupFiles()).filter((name) => name.endsWith(".sqlite")).length, 1);

    touchDatabase("changed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const third = await backupGuildDatabaseBeforeMigrations({ now: () => new Date("2026-10-03T22:03:00.000Z") });
    assert.equal(third.status, "created", "a changed database is copied again");
  });
});

test("a pre-migration snapshot is refused, not attempted, when the disk lacks room", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();
    const tinyDisk = async () => ({ bavail: 10, bsize: 4096 });

    await assert.rejects(
      () => backupGuildDatabaseBeforeMigrations({ statfsImpl: tinyDisk }),
      /needs \d+ bytes free .* only 40960 are available/,
    );
    assert.deepEqual(await listStartupBackups(), [], "nothing written");
    assert.equal(inspectDatabase(guildDatabaseFile()).migration, 5, "database untouched");
    assert.ok(requiredBackupBytes(1000, 0) > 1000);
  });
});

test("interrupted copies are removed and an operator can skip the local snapshot", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();
    await mkdir(startupBackupDirectory(), { recursive: true });
    const partial = path.join(startupBackupDirectory(), "holdfast-before-startup-2026-10-03T21-00-00-000Z.sqlite.partial");
    await writeFile(partial, "half a copy");
    assert.equal((await listStartupBackups())[0].kind, "partial");

    const skipped = await backupGuildDatabaseBeforeMigrations({ env: { ...process.env, MIGRATION_BACKUP: "skip" } });
    assert.equal(skipped.status, "skipped-by-operator");
    assert.ok(skipped.pending.length > 0);

    const created = await backupGuildDatabaseBeforeMigrations();
    assert.equal(created.status, "created");
    assert.ok(!(await backupFiles()).some((name) => name.endsWith(".partial")), "partial removed");
  });
});

test("a failed cleanup of old snapshots does not fail startup", async () => {
  await withTemporaryData(async () => {
    process.env.NODE_ENV = "production";
    seedVersionFiveDatabase();
    const first = await backupGuildDatabaseBeforeMigrations({ keep: 1, now: () => new Date("2026-10-03T22:01:00.000Z") });
    touchDatabase("changed");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const refuse = async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); };
    const second = await backupGuildDatabaseBeforeMigrations({ keep: 1, removeImpl: refuse, now: () => new Date("2026-10-03T22:02:00.000Z") });
    assert.equal(second.status, "created");
    assert.deepEqual(second.pruned.failed, [{ name: path.basename(first.file), error: "EBUSY" }]);
    assert.equal((await listStartupBackups()).filter((entry) => entry.kind === "managed").length, 2, "old copy kept for the next cleanup");
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
