import test from "node:test";
import assert from "node:assert/strict";

import { readLatestCharacterSnapshot } from "../src/Character/characterSnapshotRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const bridgeToken = "guildweaver-http-test-token-at-least-32-bytes";

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

test("Guildweaver bridge requires its bearer token", async () => {
  await withHttpApp(
    async ({ request }) => {
      const response = await request("/api/bridge/characters/snapshot", {
        method: "POST",
        body: {
          memberId: memberIds.member,
          revision: 1,
          snapshot: snapshot(),
        },
      });

      assert.equal(response.status, 401);
      assert.equal(response.json.error, "invalid_bridge_token");
    },
    { env: { GUILDWEAVER_BRIDGE_TOKEN: bridgeToken } },
  );
});

test("Guildweaver bridge seeds a member character and retains the raw snapshot", async () => {
  await withHttpApp(
    async ({ request }) => {
      const response = await request("/api/bridge/characters/snapshot", {
        method: "POST",
        headers: { Authorization: `Bearer ${bridgeToken}` },
        body: {
          memberId: memberIds.member,
          revision: 7,
          snapshot: snapshot(),
        },
      });

      assert.equal(response.status, 201);
      assert.equal(response.json.status, "created");
      assert.equal(response.json.revision, 7);
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
    },
    { env: { GUILDWEAVER_BRIDGE_TOKEN: bridgeToken } },
  );
});

test("Guildweaver bridge rejects unsupported snapshot schemas", async () => {
  await withHttpApp(
    async ({ request }) => {
      const response = await request("/api/bridge/characters/snapshot", {
        method: "POST",
        headers: { Authorization: `Bearer ${bridgeToken}` },
        body: {
          memberId: memberIds.member,
          revision: 1,
          snapshot: snapshot({ schemaVersion: 99 }),
        },
      });

      assert.equal(response.status, 400);
      assert.equal(response.json.error, "unsupported_snapshot_schema");
    },
    { env: { GUILDWEAVER_BRIDGE_TOKEN: bridgeToken } },
  );
});
