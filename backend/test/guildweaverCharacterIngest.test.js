import test from "node:test";
import assert from "node:assert/strict";

import { readLatestCharacterSnapshot } from "../src/Character/characterSnapshotRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    capturedAt: 1791169200,
    addonVersion: "0.2.0-alpha.1",
    characterKey: "classic beta pve 2:rook ravenstar",
    guid: "Player-9999-00000001",
    name: "Rook Ravenstar",
    realm: "Classic Beta PvE 2",
    level: 20,
    race: { name: "Night Elf", file: "NightElf", id: 4 },
    class: { name: "Warrior", file: "WARRIOR", id: 1 },
    guild: { name: "Holdfast", rankName: "Commander", rankIndex: 0 },
    specialization: { id: 71, name: "Arms", role: "DAMAGER" },
    professions: [
      { name: "Mining", kind: "primary", skillLevel: 150, maxSkillLevel: 150 },
      { name: "Blacksmithing", kind: "primary", skillLevel: 112, maxSkillLevel: 150 },
    ],
    equipment: [
      { slot: "MainHandSlot", slotId: 16, itemLink: "|cff0070dd|Hitem:12345|h[Test Sword]|h|r" },
    ],
    ...overrides,
  };
}

async function pairDevice(request, persona = "member") {
  const started = await request("/api/bridge/pairing/start", {
    method: "POST",
    body: { deviceName: "Character ingest test" },
  });

  assert.equal(started.status, 201);

  const approved = await request("/api/bridge/pairing/approve", {
    persona,
    method: "POST",
    body: { userCode: started.json.userCode },
  });

  assert.equal(approved.status, 200);

  const exchanged = await request("/api/bridge/pairing/token", {
    method: "POST",
    body: { deviceCode: started.json.deviceCode },
  });

  assert.equal(exchanged.status, 200);
  assert.match(exchanged.json.deviceToken, /^gwd_/);

  return exchanged.json.deviceToken;
}

test("Guildweaver character ingest requires a paired device credential", async () => {
  await withHttpApp(async ({ request }) => {
    const response = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      body: {
        revision: 1,
        snapshot: snapshot(),
      },
    });

    assert.equal(response.status, 401);
    assert.equal(response.json.error, "invalid_device_token");
  });
});

test("Guildweaver paired device seeds a member character and retains the raw snapshot", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairDevice(request);
    const response = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: {
        memberId: memberIds.officer,
        revision: 7,
        snapshot: snapshot(),
      },
    });

    assert.equal(response.status, 201);
    assert.equal(response.json.status, "created");
    assert.equal(response.json.revision, 7);
    assert.equal(response.json.memberId, memberIds.member);
    assert.equal(response.json.character.name, "Rook Ravenstar");
    assert.deepEqual(response.json.character.professions, ["Mining", "Blacksmithing"]);

    const memberResponse = await request(`/api/guild/members/${memberIds.member}`, {
      persona: "member",
    });

    assert.equal(memberResponse.status, 200);
    const character = memberResponse.json.member.profile.characters.find(
      (item) => item.name === "Rook Ravenstar",
    );
    assert.ok(character);
    assert.equal(character.className, "Warrior");
    assert.equal(character.spec, "Arms");
    assert.deepEqual(character.professions, ["Mining", "Blacksmithing"]);

    const stored = await readLatestCharacterSnapshot(character.id);
    assert.equal(stored.source, "guildweaver");
    assert.equal(stored.payload.level, 20);
    assert.equal(stored.payload.realm, "Classic Beta PvE 2");
    assert.equal(stored.payload.equipment[0].slot, "MainHandSlot");
  });
});

test("Guildweaver paired device accepts current schema 2 snapshots", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairDevice(request);
    const response = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: {
        revision: 8,
        snapshot: snapshot({
          schemaVersion: 2,
          characterId: "character-schema2-ingest",
          guid: undefined,
          addonVersion: "0.5.0-alpha.1",
        }),
      },
    });

    assert.equal(response.status, 201);
    assert.equal(response.json.status, "created");
    assert.equal(response.json.revision, 8);
    assert.equal(response.json.character.id, "guildweaver-id:character-schema2-ingest");
  });
});

test("Guildweaver paired device rejects unsupported snapshot schemas", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairDevice(request);
    const response = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: {
        revision: 1,
        snapshot: snapshot({ schemaVersion: 99 }),
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.json.error, "unsupported_snapshot_schema");
  });
});
