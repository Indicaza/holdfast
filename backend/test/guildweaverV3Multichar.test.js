import assert from "node:assert/strict";
import test from "node:test";

import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

async function pairBridge(request) {
  const started = await request("/api/bridge/pairing/start", {
    method: "POST",
    body: { deviceName: "Schema v3 test bridge" },
  });
  assert.equal(started.status, 201);

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
  assert.equal(exchanged.status, 200);
  assert.equal(exchanged.json.memberId, memberIds.member);
  return exchanged.json.deviceToken;
}

function snapshot({ characterId, name, className, level, capturedAt }) {
  const classId = className === "Mage" ? 8 : className === "Druid" ? 11 : 4;
  return {
    schemaVersion: 3,
    capturedAt,
    characterId,
    characterKey: `classic beta pve 2:${name.toLowerCase()}`,
    name,
    realm: "Classic Beta PvE 2",
    region: "US",
    level,
    race: { id: 1, name: "Human", token: "Human" },
    class: { id: classId, name: className, token: className.toUpperCase() },
    guild: { name: "Holdfast", realm: "Classic Beta PvE 2" },
    professions: [],
    equipment: [],
  };
}

test("schema v3 keeps multiple characters and generic telemetry can populate the Armory", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairBridge(request);
    const headers = { Authorization: `Bearer ${deviceToken}` };

    const rogue = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers,
      body: {
        revision: 15,
        snapshot: snapshot({
          characterId: "character-rook",
          name: "Rook",
          className: "Rogue",
          level: 7,
          capturedAt: 1791320496,
        }),
      },
    });
    assert.equal(rogue.status, 201);
    assert.equal(rogue.json.character.name, "Rook");

    const mage = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers,
      body: {
        revision: 4,
        snapshot: snapshot({
          characterId: "character-quill",
          name: "Quill",
          className: "Mage",
          level: 16,
          capturedAt: 1791320596,
        }),
      },
    });
    assert.equal(mage.status, 201);
    assert.equal(mage.json.character.name, "Quill");

    const druidSnapshot = snapshot({
      characterId: "character-kumo",
      name: "Kumo",
      className: "Druid",
      level: 12,
      capturedAt: 1791320646,
    });
    const telemetry = await request("/api/bridge/telemetry", {
      method: "POST",
      headers: {
        ...headers,
        "Idempotency-Key": "gw-schema-v3-character-kumo-rev-2",
      },
      body: {
        streamKey: "character_snapshot:character-kumo",
        kind: "state",
        revision: 2,
        envelope: {
          schemaVersion: 1,
          eventType: "character_snapshot",
          capturedAt: druidSnapshot.capturedAt,
          characterId: druidSnapshot.characterId,
          realm: druidSnapshot.realm,
          region: druidSnapshot.region,
          payload: druidSnapshot,
        },
      },
    });
    assert.equal(telemetry.status, 201);
    assert.equal(telemetry.json.characterStatus, "created");

    const summary = await request("/api/intelligence", { persona: "member" });
    assert.equal(summary.status, 200);
    assert.equal(summary.json.summary.characterCount, 3);
    assert.deepEqual(
      new Set(summary.json.characters.map((character) => character.name)),
      new Set(["Rook", "Quill", "Kumo"]),
    );
    assert.deepEqual(
      new Set(summary.json.characters.map((character) => character.id)),
      new Set([
        "guildweaver-id:character-rook",
        "guildweaver-id:character-quill",
        "guildweaver-id:character-kumo",
      ]),
    );

    const future = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers,
      body: {
        revision: 1,
        snapshot: {
          ...snapshot({
            characterId: "character-future",
            name: "Future",
            className: "Mage",
            level: 1,
            capturedAt: 1791320696,
          }),
          schemaVersion: 4,
        },
      },
    });
    assert.equal(future.status, 400);
    assert.equal(future.json.error, "unsupported_snapshot_schema");
  });
});
