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
    assert.deepEqual(appliedMigrationVersions(), [1, 2, 3, 4, 5, 6, 7, 8]);
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
