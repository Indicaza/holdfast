import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { readCharacterCards } from "../src/Character/ReadModel/readModelReader.js";
import {
  readTelemetryHistory,
  recordTelemetry,
} from "../src/Character/telemetryRecordRepository.js";
import { withGuildTransaction } from "../src/Data/database.js";
import { importMembersIntoDatabase } from "../src/Guild/memberRepository.js";

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

test("Guildweaver character and generic telemetry ingest are durable before GuildOS reads them", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-db-first-"));

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
          profile: { characters: [] },
        },
      ]);
    });

    const capturedAt = "2026-10-08T19:30:00.000Z";
    const characterResult = await syncGuildweaverCharacter({
      memberId: "member-one",
      deviceId: "device-one",
      bridgeRevision: 7,
      receivedAt: "2026-10-08T19:30:01.000Z",
      snapshot: {
        schemaVersion: 3,
        characterId: "character-local-one",
        installationId: "install-one",
        capturedAt,
        name: "Rook",
        realm: "Classic Beta PvE 2",
        region: "US",
        level: 30,
        race: { name: "Human" },
        class: { name: "Warrior" },
        specialization: { id: 1491, name: "Warrior" },
        professions: [],
        equipment: [],
        talents: { treeIds: [1117], allocations: [] },
        stats: { health: 984, power: 100 },
      },
    });

    assert.equal(characterResult.status, "created");
    assert.equal(characterResult.character.name, "Rook");

    const telemetryResult = recordTelemetry({
      deviceId: "device-one",
      memberId: "member-one",
      idempotencyKey: "gw-test-talent-tree-v1",
      streamKey: "talent_tree_definition:warrior:1491:1117:test:enus",
      kind: "state",
      revision: 1,
      receivedAt: "2026-10-08T19:30:02.000Z",
      envelope: {
        schemaVersion: 1,
        eventType: "talent_tree_definition",
        capturedAt,
        installationId: "install-one",
        realm: "Classic Beta PvE 2",
        region: "US",
        payload: {
          schemaVersion: 4,
          treeId: 1117,
          treeHash: "test",
          class: { id: 1, name: "Warrior", token: "WARRIOR" },
          nodes: [],
          edges: [],
        },
      },
    });

    assert.equal(telemetryResult.status, "created");

    const counts = withGuildTransaction((db) => ({
      characters: Number(db.prepare("SELECT COUNT(*) AS count FROM characters").get().count),
      snapshots: Number(db.prepare("SELECT COUNT(*) AS count FROM character_snapshots").get().count),
      telemetry: Number(
        db.prepare("SELECT COUNT(*) AS count FROM guildweaver_telemetry_records").get().count,
      ),
    }));

    assert.deepEqual(counts, {
      characters: 1,
      snapshots: 1,
      telemetry: 1,
    });

    const intelligence = readCharacterCards();
    assert.equal(intelligence.summary.characterCount, 1);
    assert.equal(intelligence.characters[0].name, "Rook");
    assert.equal(intelligence.characters[0].level, 30);

    const telemetry = readTelemetryHistory({ limit: 10 });
    assert.equal(telemetry.records.length, 1);
    assert.equal(telemetry.records[0].eventType, "talent_tree_definition");
    assert.equal(telemetry.records[0].streamKey, "talent_tree_definition:warrior:1491:1117:test:enus");
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
