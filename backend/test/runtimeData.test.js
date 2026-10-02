import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appliedMigrationVersions,
  guildDatabaseFile,
  openGuildDatabase,
} from "../src/Data/database.js";
import { runtimeDataDirectory } from "../src/Data/runtimeData.js";

function preserveEnvironment() {
  return {
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
  };
}

function restoreEnvironment(previous) {
  if (previous.dataDir === undefined) {
    delete process.env.GUILD_DATA_DIR;
  } else {
    process.env.GUILD_DATA_DIR = previous.dataDir;
  }

  if (previous.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previous.nodeEnv;
  }
}

test("SQLite initializes inside the configured runtime directory", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-data-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const db = openGuildDatabase();
    const settings = db
      .prepare("SELECT * FROM quest_settings WHERE id = 1")
      .get();
    db.close();

    assert.equal(path.dirname(guildDatabaseFile()), directory);
    await access(guildDatabaseFile());
    assert.equal(settings.rep_max, 1000);
    assert.equal(settings.marks_quest_max, 1000);
    assert.deepEqual(appliedMigrationVersions(), [1, 2, 3, 4, 5, 6]);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration 6 raises reward caps to cover existing quest data", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-data-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const db = openGuildDatabase();

    db.prepare(
      `
        INSERT INTO quests (
          id,
          publication,
          mode,
          title,
          summary,
          created_by_member_id,
          created_at,
          completed,
          sort_order
        ) VALUES (?, 'draft', 'rotating', ?, '', NULL, '', 0, 0)
      `,
    ).run("legacy-quest", "Legacy Quest");

    const insertObjective = db.prepare(
      `
        INSERT INTO objectives (
          id,
          quest_id,
          title,
          description,
          priority,
          completed,
          need,
          reward_rep,
          reward_marks,
          reward_approved_by_member_id,
          reward_approved_by_name,
          reward_approved_at,
          reward_approved_fingerprint,
          sort_order
        ) VALUES (?, ?, ?, '', 'Medium', 0, '', ?, ?, NULL, '', '', '', ?)
      `,
    );

    insertObjective.run(
      "legacy-objective-1",
      "legacy-quest",
      "One",
      1200,
      700,
      0,
    );
    insertObjective.run(
      "legacy-objective-2",
      "legacy-quest",
      "Two",
      0,
      650,
      1,
    );

    db.prepare(
      `
        UPDATE quest_settings
        SET rep_max = 1000, marks_max = 1000, marks_quest_max = 1000
        WHERE id = 1
      `,
    ).run();

    db.prepare("DELETE FROM schema_migrations WHERE version = 6").run();
    db.close();

    const repaired = openGuildDatabase();
    const settings = repaired
      .prepare("SELECT * FROM quest_settings WHERE id = 1")
      .get();
    repaired.close();

    assert.equal(settings.rep_max, 1200);
    assert.equal(settings.marks_max, 1000);
    assert.equal(settings.marks_quest_max, 1350);
    assert.deepEqual(appliedMigrationVersions(), [1, 2, 3, 4, 5, 6]);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("production requires an explicit persistent data directory", () => {
  const previous = preserveEnvironment();

  try {
    process.env.NODE_ENV = "production";
    delete process.env.GUILD_DATA_DIR;

    assert.throws(
      () => runtimeDataDirectory(),
      /GUILD_DATA_DIR is required in production/,
    );
  } finally {
    restoreEnvironment(previous);
  }
});
