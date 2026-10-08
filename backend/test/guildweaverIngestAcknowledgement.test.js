import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acknowledgeGuildweaverIngest,
  readGuildweaverIngestReconciliation,
} from "../src/Character/guildweaverIngestAcknowledgementRepository.js";

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

test("server reconciliation replays data missing from the durable DB ledger", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-gw-ack-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const scope = { deviceId: "device-one", memberId: "member-one" };
    const manifest = {
      ...scope,
      characters: [{ streamKey: "realm:rook", revision: 3 }],
      telemetry: [{ streamKey: "talents:warrior", revision: 7 }],
    };

    const emptyServer = readGuildweaverIngestReconciliation(manifest);
    assert.deepEqual(emptyServer.characters[0], {
      streamKey: "realm:rook",
      revision: 3,
      serverRevision: 0,
      needsUpload: true,
    });
    assert.equal(emptyServer.telemetry[0].needsUpload, true);

    acknowledgeGuildweaverIngest({
      ...scope,
      kind: "character",
      streamKey: "realm:rook",
      revision: 3,
    });
    acknowledgeGuildweaverIngest({
      ...scope,
      kind: "telemetry",
      streamKey: "talents:warrior",
      revision: 7,
    });

    const inSync = readGuildweaverIngestReconciliation(manifest);
    assert.equal(inSync.characters[0].serverRevision, 3);
    assert.equal(inSync.characters[0].needsUpload, false);
    assert.equal(inSync.telemetry[0].serverRevision, 7);
    assert.equal(inSync.telemetry[0].needsUpload, false);

    // A stale acknowledgement can never move the server backwards.
    acknowledgeGuildweaverIngest({
      ...scope,
      kind: "character",
      streamKey: "realm:rook",
      revision: 2,
    });
    const newerClient = readGuildweaverIngestReconciliation({
      ...scope,
      characters: [{ streamKey: "realm:rook", revision: 4 }],
    });
    assert.equal(newerClient.characters[0].serverRevision, 3);
    assert.equal(newerClient.characters[0].needsUpload, true);

    // A different device has its own receipt ledger and therefore self-heals.
    const otherDevice = readGuildweaverIngestReconciliation({
      deviceId: "device-two",
      memberId: "member-one",
      characters: [{ streamKey: "realm:rook", revision: 3 }],
    });
    assert.equal(otherDevice.characters[0].serverRevision, 0);
    assert.equal(otherDevice.characters[0].needsUpload, true);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
