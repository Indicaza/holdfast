import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureRuntimeDataFile,
  runtimeDataDirectory,
} from "../src/Data/runtimeData.js";

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

test("runtime files initialize from committed clean seeds", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-data-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const questPath = await ensureRuntimeDataFile("quests.json");
    const memberPath = await ensureRuntimeDataFile("members.json");
    const contributionPath = await ensureRuntimeDataFile("contributions.json");

    assert.equal(path.dirname(questPath), directory);
    assert.deepEqual(JSON.parse(await readFile(memberPath, "utf8")), []);
    assert.deepEqual(
      JSON.parse(await readFile(contributionPath, "utf8")),
      { version: 1, transactions: [] },
    );

    const quests = JSON.parse(await readFile(questPath, "utf8"));
    assert.equal(quests.version, 1);
    assert.equal(quests.focusedQuestId, "");
    assert.deepEqual(quests.quests, []);
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
