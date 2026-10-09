import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

test("Armory reads the newest durable snapshot even when the projection points at an older sparse snapshot", async () => {
  await withHttpApp(async ({ request }) => {
    const first = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "durable-armory-device",
      snapshot: {
        schemaVersion: 3,
        capturedAt: 1791262800,
        characterId: "durable-armory-character",
        characterKey: "classic beta pve 2:rook ravenstar",
        name: "Rook Ravenstar",
        realm: "Classic Beta PvE 2",
      },
    });

    const second = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "durable-armory-device",
      snapshot: {
        schemaVersion: 3,
        capturedAt: 1791266400,
        characterId: "durable-armory-character",
        characterKey: "classic beta pve 2:rook ravenstar",
        firstName: "Rook",
        lastName: "Ravenstar",
        fullName: "Rook Ravenstar",
        name: "Rook Ravenstar",
        realm: "Classic Beta PvE 2",
        region: "US",
        level: 22,
        race: { id: 4, name: "Night Elf" },
        class: { id: 1, name: "Warrior" },
        guild: { name: "Holdfast" },
        stats: {
          resources: {
            health: { current: 984, max: 984 },
            power: { token: "RAGE", current: 100, max: 100 },
          },
        },
        equipment: [
          {
            slot: "head",
            slotId: 1,
            itemId: 11746,
            name: "Golem Skull Helm",
            qualityId: 3,
            itemLevel: 35,
            iconFileDataId: 132767,
          },
        ],
        professions: [
          {
            skillLineId: 164,
            name: "Blacksmithing",
            skillLevel: 94,
            maxSkillLevel: 150,
          },
        ],
      },
    });

    assert.equal(first.character.id, second.character.id);

    withGuildDatabase((db) => {
      db.prepare(`
        UPDATE telemetry_characters
        SET latest_snapshot_id = ?, level = 0, realm = '', guild_name = ''
        WHERE character_id = ?
      `).run(first.snapshot.id, second.character.id);
      db.prepare("DELETE FROM telemetry_professions WHERE character_id = ?").run(second.character.id);
      db.prepare("DELETE FROM telemetry_recipes WHERE character_id = ?").run(second.character.id);
    });

    const armory = await request(
      `/api/intelligence/characters/${encodeURIComponent(second.character.id)}`,
      { persona: "member" },
    );

    assert.equal(armory.status, 200);
    assert.equal(armory.json.character.name, "Rook Ravenstar");
    assert.equal(armory.json.character.level, 22);
    assert.equal(armory.json.character.className, "Warrior");
    assert.equal(armory.json.character.race, "Night Elf");
    assert.equal(armory.json.character.guildName, "Holdfast");
    assert.equal(armory.json.stats.resources.health.max, 984);
    assert.equal(armory.json.stats.resources.power.token, "RAGE");
    assert.equal(armory.json.equipment.length, 1);
    assert.equal(armory.json.equipment[0].itemId, 11746);
    assert.equal(armory.json.equipment[0].name, "Golem Skull Helm");
    assert.equal(armory.json.professions.length, 1);
    assert.equal(armory.json.professions[0].name, "Blacksmithing");
    assert.equal(armory.json.professions[0].current, 94);
  });
});
