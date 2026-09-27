import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  awardObjective,
  readContributionTotals,
} from "../src/Contribution/contributionRepository.js";

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

test("objective reward transactions are idempotent per member", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-contrib-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const quest = { id: "quest-one", title: "Launch Day" };
    const objective = {
      id: "objective-one",
      title: "Stock the bank",
      reward: {
        rep: 250,
        marks: 75,
        items: [],
      },
    };
    const member = {
      id: "member-one",
      displayName: "Rook",
    };
    const awardedBy = {
      id: "officer-one",
      username: "officer",
      guildNickname: "Officer",
    };

    const first = await awardObjective({
      quest,
      objective,
      members: [member],
      awardedBy,
    });
    const second = await awardObjective({
      quest,
      objective,
      members: [member],
      awardedBy,
    });

    assert.equal(first.length, 1);
    assert.deepEqual(second, []);

    const totals = await readContributionTotals();
    assert.deepEqual(totals.get("member-one"), {
      rep: 250,
      marks: 75,
      completedObjectives: 1,
    });
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
