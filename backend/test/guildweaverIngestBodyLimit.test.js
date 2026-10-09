import assert from "node:assert/strict";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { readLatestTelemetryState, telemetryRetention } from "../src/Character/Telemetry/telemetryStateRepository.js";
import { readTelemetryHistory } from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

async function pairBridge(request) {
  const started = await request("/api/bridge/pairing/start", {
    method: "POST",
    body: { deviceName: "Body limit test bridge" },
  });
  const approved = await request("/api/bridge/pairing/approve", {
    persona: "member",
    method: "POST",
    body: { userCode: started.json.userCode },
  });
  assert.equal(approved.status, 200);
  const exchanged = await request("/api/bridge/pairing/token", {
    method: "POST",
    body: { deviceCode: started.json.deviceCode },
  });
  return exchanged.json.deviceToken;
}

// A full crafting profession's recipe book, as Guildweaver captures it, is
// several hundred KB: every recipe carries item descriptions for its output
// and reagents.
function professionSnapshot(recipeCount, revision) {
  const filler = "Permanently enchants a weapon. ".repeat(60);
  const recipes = Array.from({ length: recipeCount }, (_, index) => ({
    recipeId: 3000 + index,
    name: `Recipe ${index}`,
    known: true,
    difficulty: "easy",
    description: filler,
    crafted: { itemId: 9000 + index, name: `Item ${index}`, qualityId: 2 },
    reagents: [{ itemId: 2840, name: "Copper Bar", quantity: 2 }],
  }));
  return {
    streamKey: "profession_snapshot:character-rook",
    kind: "state",
    revision,
    envelope: {
      schemaVersion: 1,
      eventType: "profession_snapshot",
      capturedAt: 1791322510 + revision,
      characterId: "character-rook",
      payload: {
        schemaVersion: 1,
        professions: [{ skillLineId: 197, name: "Tailoring", skillLevel: 300, maxSkillLevel: 300, recipes }],
      },
    },
  };
}

test("bridge ingest accepts recipe-book sized telemetry and reports oversized bodies as 413", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairBridge(request);
    const post = (body, key) => request("/api/bridge/telemetry", {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken}`, "Idempotency-Key": key },
      body,
    });

    const book = professionSnapshot(400, 1);
    assert.ok(JSON.stringify(book).length > 600 * 1024, "fixture is larger than the default body limit");
    const accepted = await post(book, "gw-body-limit-1");
    assert.equal(accepted.status, 201);

    const oversized = await post(professionSnapshot(2400, 2), "gw-body-limit-2");
    assert.equal(oversized.status, 413);
    assert.equal(oversized.json.error, "payload_too_large");

    // Everything else keeps the small default limit.
    const site = await request("/api/quests", {
      persona: "officer",
      method: "POST",
      body: { title: "x".repeat(300 * 1024) },
    });
    assert.equal(site.status, 413);
    assert.equal(site.json.error, "payload_too_large");
  });
});

test("raw history for large states is capped by size and keeps the newest record", () =>
  withHttpApp(async () => {
    const ingest = (recipeCount, revision) => ingestTelemetry({
      deviceId: "device-body-limit",
      memberId: memberIds.member,
      idempotencyKey: `gw-size-cap-${revision}`,
      body: professionSnapshot(recipeCount, revision),
      receivedAt: new Date(Date.UTC(2026, 9, 8, 12, 0, revision)).toISOString(),
    });
    // Each book is ~0.8 MB; a 2 MB budget keeps only the newest two.
    for (let revision = 1; revision <= 5; revision += 1) assert.equal(ingest(400, revision).status, "created");
    const revisions = () => readTelemetryHistory().records.map((record) => record.revision).sort((a, b) => a - b);
    assert.deepEqual(revisions(), [4, 5]);
    assert.ok(telemetryRetention.rawBytesPerStream >= 1024 * 1024);

    const [state] = readLatestTelemetryState({ memberId: memberIds.member, characterId: "character-rook", eventType: "profession_snapshot" });
    assert.equal(state.revision, 5);

    // A single record over the budget is still kept.
    assert.equal(ingest(2000, 6).status, "created");
    assert.deepEqual(revisions(), [6]);
  }));
