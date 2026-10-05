import test from "node:test";
import assert from "node:assert/strict";

import { withGuildDatabase } from "../src/Data/database.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function snapshot(name = "Rook") {
  return {
    schemaVersion: 1,
    capturedAt: 1791162000,
    characterKey: `classic-beta:${name.toLowerCase()}`,
    guid: `Player-1-${name}`,
    name,
    realm: "Classic Beta PvE 2",
    level: 20,
    race: { name: "Night Elf" },
    class: { name: "Warrior" },
    specialization: { name: "Protection" },
    professions: [
      { name: "Blacksmithing", skillLevel: 120 },
      { name: "Mining", skillLevel: 150 },
    ],
    equipment: [],
  };
}

test("Guildweaver device pairing binds snapshots to the approving Discord member", async () => {
  await withHttpApp(async ({ request }) => {
    const started = await request("/api/bridge/pairing/start", {
      method: "POST",
      body: { deviceName: "Zach's PC" },
    });

    assert.equal(started.status, 201);
    assert.equal(started.json.status, "pending");
    assert.ok(started.json.deviceCode);
    assert.match(started.json.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.match(started.json.verificationUri, /\/guildweaver\/connect\?code=/);

    const pending = await request("/api/bridge/pairing/token", {
      method: "POST",
      body: { deviceCode: started.json.deviceCode },
    });

    assert.equal(pending.status, 202);
    assert.equal(pending.json.status, "pending");

    const unauthenticated = await request("/api/bridge/pairing/approve", {
      method: "POST",
      body: { userCode: started.json.userCode },
    });

    assert.equal(unauthenticated.status, 401);

    const approved = await request("/api/bridge/pairing/approve", {
      persona: "member",
      method: "POST",
      body: { userCode: started.json.userCode },
    });

    assert.equal(approved.status, 200);
    assert.equal(approved.json.status, "approved");

    const exchanged = await request("/api/bridge/pairing/token", {
      method: "POST",
      body: { deviceCode: started.json.deviceCode },
    });

    assert.equal(exchanged.status, 200);
    assert.equal(exchanged.json.status, "connected");
    assert.equal(exchanged.json.memberId, memberIds.member);
    assert.match(exchanged.json.deviceToken, /^gwd_/);

    const synced = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exchanged.json.deviceToken}`,
      },
      body: {
        memberId: memberIds.officer,
        revision: 1,
        snapshot: snapshot(),
      },
    });

    assert.equal(synced.status, 201);
    assert.equal(synced.json.memberId, memberIds.member);
    assert.ok(synced.json.deviceId);

    const owners = withGuildDatabase((db) =>
      db
        .prepare("SELECT member_id FROM characters WHERE name = 'Rook'")
        .all()
        .map((row) => row.member_id),
    );

    assert.deepEqual(owners, [memberIds.member]);

    const reusedPairing = await request("/api/bridge/pairing/token", {
      method: "POST",
      body: { deviceCode: started.json.deviceCode },
    });

    assert.equal(reusedPairing.status, 409);
    assert.equal(reusedPairing.json.error, "pairing_already_consumed");
  });
});

test("Guildweaver snapshots reject unknown device credentials", async () => {
  await withHttpApp(async ({ request }) => {
    const response = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-device-token" },
      body: { revision: 1, snapshot: snapshot("Quill") },
    });

    assert.equal(response.status, 401);
    assert.equal(response.json.error, "invalid_device_token");
  });
});
