import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

test("GuildOS character cards read vitals from modular stats telemetry", async () => {
  await withHttpApp(async ({ request }) => {
    const rawCharacterId = "character-card-vitals";
    const synced = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-card-vitals",
      bridgeRevision: 1,
      snapshot: {
        schemaVersion: 3,
        capturedAt: 1791500000,
        characterId: rawCharacterId,
        characterKey: "classic beta pve 2:rook ravenstar",
        firstName: "Rook",
        lastName: "Ravenstar",
        fullName: "Rook Ravenstar",
        name: "Rook Ravenstar",
        realm: "Classic Beta PvE 2",
        region: "US",
        level: 22,
        race: { id: 4, name: "Night Elf", token: "NightElf" },
        class: { id: 1, name: "Warrior", token: "WARRIOR" },
        guild: { name: "Holdfast", realm: "Classic Beta PvE 2" },
        equipment: [],
        professions: [],
      },
    });

    assert.equal(synced.status, "created");

    const telemetry = ingestTelemetry({
      deviceId: "device-card-vitals",
      memberId: memberIds.member,
      idempotencyKey: "card-vitals-stats-1",
      receivedAt: "2026-10-09T01:15:00.000Z",
      body: {
        streamKey: `stats:${rawCharacterId}`,
        kind: "state",
        revision: 1,
        envelope: {
          schemaVersion: 1,
          eventType: "stats",
          payloadSchemaVersion: 1,
          capturedAt: 1791500001,
          characterId: rawCharacterId,
          payload: {
            stats: {
              resources: {
                health: { current: 738, max: 984 },
                power: { token: "RAGE", current: 64, max: 100 },
              },
            },
          },
        },
      },
    });

    assert.equal(telemetry.status, "created");
    assert.equal(telemetry.canonicalCharacterId, synced.character.id);

    const summary = await request("/api/intelligence", { persona: "member" });
    assert.equal(summary.status, 200);
    const character = summary.json.characters.find((entry) => entry.id === synced.character.id);
    assert.ok(character);
    assert.deepEqual(character.vitals, {
      healthCurrent: 738,
      healthMax: 984,
      powerCurrent: 64,
      powerMax: 100,
      powerToken: "RAGE",
    });
  });
});
