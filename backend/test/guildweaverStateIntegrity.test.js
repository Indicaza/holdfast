import assert from "node:assert/strict";
import test from "node:test";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function snapshot({
  characterId = "rook-pc",
  capturedAt = 1791450000,
  level = 30,
  equipment = [{ slot: "MainHandSlot", itemId: 6975, name: "Whirlwind Axe" }],
  professions = [{ id: 164, name: "Blacksmithing", skillLevel: 225, maxSkillLevel: 225 }],
  talents = {
    configId: 901,
    treeIds: [1117],
    allocations: [{ nodeId: 101, rank: 2, ranksPurchased: 2 }],
  },
  stats = { strength: 91, stamina: 104 },
  capture = {
    integrityVersion: 1,
    reason: "INITIAL_DELAY",
    sections: {
      stats: "complete",
      equipment: "complete",
      talents: "complete",
      professions: "complete",
      recipes: "complete",
      guild: "complete",
      specialization: "complete",
    },
  },
} = {}) {
  return {
    schemaVersion: 3,
    capturedAt,
    installationId: characterId.startsWith("rook-mac") ? "install-mac" : "install-pc",
    characterId,
    characterKey: "classic beta pve 2:rook ravenstar",
    firstName: "Rook",
    lastName: "Ravenstar",
    fullName: "Rook Ravenstar",
    name: "Rook Ravenstar",
    realm: "Classic Beta PvE 2",
    region: "US",
    level,
    race: { name: "Night Elf", token: "NightElf", id: 4 },
    class: { name: "Warrior", token: "WARRIOR", id: 1 },
    guild: { name: "Holdfast" },
    specialization: { id: 73, name: "Protection" },
    equipment,
    professions,
    talents,
    stats,
    capture,
  };
}

async function armory(request, characterId) {
  const response = await request(`/api/intelligence/characters/${encodeURIComponent(characterId)}`, {
    persona: "member",
  });
  assert.equal(response.status, 200, response.text);
  return response.json;
}

async function pairDevice(request, name = "Integrity test") {
  const started = await request("/api/bridge/pairing/start", {
    method: "POST",
    body: { deviceName: name },
  });
  assert.equal(started.status, 201, started.text);

  const approved = await request("/api/bridge/pairing/approve", {
    persona: "member",
    method: "POST",
    body: { userCode: started.json.userCode },
  });
  assert.equal(approved.status, 200, approved.text);

  const exchanged = await request("/api/bridge/pairing/token", {
    method: "POST",
    body: { deviceCode: started.json.deviceCode },
  });
  assert.equal(exchanged.status, 200, exchanged.text);
  return exchanged.json;
}

function projectedPayload(characterId) {
  return withGuildDatabase((db) => {
    const row = db.prepare(`
      SELECT s.payload_json
      FROM telemetry_characters t
      JOIN character_snapshots s ON s.id = t.latest_snapshot_id
      WHERE t.character_id = ?
    `).get(characterId);
    return JSON.parse(row?.payload_json || "{}");
  });
}

test("partial teardown snapshots cannot erase known-good Armory sections", async () => {
  await withHttpApp(async ({ request }) => {
    const first = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-pc",
      bridgeRevision: 10,
      snapshot: snapshot(),
    });
    assert.equal(first.status, "created");

    const teardown = snapshot({
      capturedAt: 1791450060,
      level: 30,
      equipment: [],
      professions: [],
      talents: {},
      stats: {},
      capture: {
        integrityVersion: 1,
        reason: "PLAYER_LOGOUT",
        sections: {
          stats: "unavailable",
          equipment: "unavailable",
          talents: "unavailable",
          professions: "unavailable",
          recipes: "unavailable",
          guild: "unavailable",
          specialization: "unavailable",
        },
      },
    });

    const second = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-pc",
      bridgeRevision: 11,
      snapshot: teardown,
    });
    assert.equal(second.status, "updated");
    assert.ok(second.preservedSections.includes("equipment"));
    assert.ok(second.preservedSections.includes("professions"));
    assert.ok(second.preservedSections.includes("talents"));
    assert.ok(second.preservedSections.includes("stats"));

    const current = await armory(request, first.character.id);
    assert.equal(current.equipment.length, 1);
    assert.equal(current.equipment[0].name, "Whirlwind Axe");
    assert.equal(current.professions.length, 1);
    assert.equal(current.professions[0].name, "Blacksmithing");
    assert.equal(current.stats.strength, 91);
    assert.equal(projectedPayload(first.character.id).talents.allocations.length, 1);
  });
});

test("Mac and PC observations converge on one character and stale devices cannot time-travel Armory", async () => {
  await withHttpApp(async ({ request }) => {
    const pc = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-pc",
      bridgeRevision: 20,
      snapshot: snapshot({ characterId: "rook-pc", capturedAt: 1791450200, level: 30 }),
    });
    assert.equal(pc.status, "created");

    const staleMac = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-mac",
      bridgeRevision: 1,
      snapshot: snapshot({
        characterId: "rook-mac",
        capturedAt: 1791450100,
        level: 12,
        equipment: [{ slot: "MainHandSlot", itemId: 25, name: "Worn Shortsword" }],
      }),
    });

    assert.equal(staleMac.status, "stale");
    assert.equal(staleMac.character.id, pc.character.id);

    let current = await armory(request, pc.character.id);
    assert.equal(current.character.level, 30);
    assert.equal(current.equipment[0].name, "Whirlwind Axe");

    const freshMac = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-mac",
      bridgeRevision: 2,
      snapshot: snapshot({
        characterId: "rook-mac",
        capturedAt: 1791450300,
        level: 31,
        equipment: [{ slot: "MainHandSlot", itemId: 999, name: "Mac Test Axe" }],
      }),
    });

    assert.equal(freshMac.status, "updated");
    assert.equal(freshMac.character.id, pc.character.id);

    current = await armory(request, pc.character.id);
    assert.equal(current.character.level, 31);
    assert.equal(current.equipment[0].name, "Mac Test Axe");

    const integrity = withGuildDatabase((db) => ({
      characters: Number(
        db.prepare("SELECT COUNT(*) AS count FROM characters WHERE member_id = ? AND name = ? COLLATE NOCASE")
          .get(memberIds.member, "Rook Ravenstar").count,
      ),
      aliases: Number(
        db.prepare("SELECT COUNT(*) AS count FROM guildweaver_character_aliases WHERE character_id = ?")
          .get(pc.character.id).count,
      ),
    }));
    assert.equal(integrity.characters, 1);
    assert.equal(integrity.aliases, 2);
  });
});

test("a device that has not opened its trade skill UI cannot erase recipes learned on another device", async () => {
  await withHttpApp(async ({ request }) => {
    const pcProfession = {
      id: 164,
      name: "Blacksmithing",
      skillLevel: 225,
      maxSkillLevel: 225,
      recipes: [
        {
          recipeId: 9789,
          name: "Mithril Spurs",
          known: true,
          professionId: 164,
          professionName: "Blacksmithing",
          craftedItemId: 7969,
        },
      ],
      recipeSnapshotAt: 1791450400,
      recipeSource: "C_TradeSkillUI",
    };
    const pc = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-pc",
      bridgeRevision: 30,
      snapshot: snapshot({
        characterId: "rook-pc-recipes",
        capturedAt: 1791450400,
        professions: [pcProfession],
      }),
    });
    assert.equal(pc.status, "created");

    let current = await armory(request, pc.character.id);
    assert.equal(current.recipes.length, 1);
    assert.equal(current.recipes[0].name, "Mithril Spurs");

    const macProfession = {
      id: 164,
      name: "Blacksmithing",
      skillLevel: 226,
      maxSkillLevel: 225,
    };
    const mac = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-mac",
      bridgeRevision: 1,
      snapshot: snapshot({
        characterId: "rook-mac-recipes",
        capturedAt: 1791450500,
        professions: [macProfession],
        capture: {
          integrityVersion: 1,
          reason: "SKILL_LINES_CHANGED",
          sections: {
            stats: "complete",
            equipment: "complete",
            talents: "complete",
            professions: "complete",
            recipes: "partial",
            guild: "complete",
            specialization: "complete",
          },
        },
      }),
    });
    assert.equal(mac.status, "updated");
    assert.equal(mac.character.id, pc.character.id);
    assert.ok(mac.preservedSections.includes("recipes"));

    current = await armory(request, pc.character.id);
    assert.equal(current.professions[0].current, 226);
    assert.equal(current.recipes.length, 1);
    assert.equal(current.recipes[0].name, "Mithril Spurs");
  });
});

test("generic telemetry and logout checkpoints are append-only evidence, never an Armory mutation path", async () => {
  await withHttpApp(async ({ request }) => {
    const device = await pairDevice(request);
    const baseline = snapshot({ characterId: "rook-route", capturedAt: 1791450600, level: 30 });
    const ingest = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: { Authorization: `Bearer ${device.deviceToken}` },
      body: { revision: 1, snapshot: baseline },
    });
    assert.equal(ingest.status, 201, ingest.text);
    const characterId = ingest.json.character.id;

    const checkpointPayload = snapshot({
      characterId: "rook-route",
      capturedAt: 1791450660,
      level: 1,
      equipment: [],
      professions: [],
      talents: {},
      stats: {},
      capture: {
        integrityVersion: 1,
        reason: "PLAYER_LOGOUT",
        sections: {
          stats: "unavailable",
          equipment: "unavailable",
          talents: "unavailable",
          professions: "unavailable",
          recipes: "unavailable",
        },
      },
    });

    const telemetry = await request("/api/bridge/telemetry", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${device.deviceToken}`,
        "Idempotency-Key": "gw-integrity-checkpoint-1",
      },
      body: {
        streamKey: "character_session:rook-route:test:end",
        kind: "event",
        revision: 1,
        envelope: {
          schemaVersion: 1,
          eventType: "character_session_checkpoint",
          capturedAt: 1791450660,
          characterId: "rook-route",
          installationId: "install-pc",
          realm: "Classic Beta PvE 2",
          region: "US",
          payload: checkpointPayload,
        },
      },
    });
    assert.equal(telemetry.status, 201, telemetry.text);
    assert.equal(telemetry.json.characterStatus, "associated");
    assert.equal(telemetry.json.characterId, characterId);

    const current = await armory(request, characterId);
    assert.equal(current.character.level, 30);
    assert.equal(current.equipment.length, 1);
    assert.equal(current.professions.length, 1);

    const stored = withGuildDatabase((db) =>
      db.prepare("SELECT character_id, event_type FROM guildweaver_telemetry_records WHERE id = ?")
        .get(telemetry.json.recordId),
    );
    assert.equal(stored.character_id, characterId);
    assert.equal(stored.event_type, "character_session_checkpoint");
  });
});
