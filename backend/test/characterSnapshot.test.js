import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { importMembersIntoDatabase } from "../src/Guild/memberRepository.js";
import { withGuildTransaction } from "../src/Data/database.js";
import {
  readLatestCharacterSnapshot,
  recordCharacterSnapshot,
} from "../src/Character/characterSnapshotRepository.js";

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

test("character snapshots retain source, time, and payload", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-snapshot-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    withGuildTransaction((db) => {
      importMembersIntoDatabase(db, [
        {
          id: "member-one",
          username: "rook",
          displayName: "Rook",
          rank: "Commander",
          profile: {
            characters: [
              {
                id: "char-one",
                name: "Rook",
                race: "Night Elf",
                className: "Warrior",
                spec: "Arms",
                professions: ["Mining"],
                isMain: true,
              },
            ],
          },
        },
      ]);
    });

    await recordCharacterSnapshot({
      characterId: "char-one",
      source: "test-addon",
      capturedAt: "2026-09-27T12:00:00.000Z",
      payload: {
        level: 20,
        zone: "Westfall",
        gear: [{ slot: "MainHand", itemId: 123 }],
      },
    });

    const latest = await readLatestCharacterSnapshot("char-one");

    assert.equal(latest.characterId, "char-one");
    assert.equal(latest.source, "test-addon");
    assert.equal(latest.payload.level, 20);
    assert.equal(latest.payload.gear[0].itemId, 123);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
