import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { readSyncedIntelligenceSummary } from "../src/Character/intelligenceSummaryRepository.js";
import { prepareCharacterArmory } from "../src/Character/intelligenceRouter.js";
import { readCharacterArmory } from "../src/Character/telemetryProjection.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const fixturePath = fileURLToPath(new URL("./fixtures/guildweaver-character-snapshot.v3.json", import.meta.url));

function fixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

test("current Guildweaver v3 snapshot feeds GuildOS cards and Armory without synthetic seed helpers", async () => {
  await withHttpApp(async () => {
    const snapshot = fixture();
    const synced = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot,
      deviceId: "device-live-contract",
      bridgeRevision: 1,
    });

    assert.equal(synced.status, "created");

    const summary = readSyncedIntelligenceSummary();
    const card = summary.characters.find((character) => character.id === synced.character.id);
    assert.ok(card);
    assert.equal(card.name, "Rook Ravenstar");
    assert.equal(card.level, 22);
    assert.equal(card.className, "Warrior");
    assert.equal(card.spec, "Protection");
    assert.equal(card.race, "Night Elf");
    assert.equal(card.guildName, "Holdfast");
    assert.deepEqual(card.vitals, {
      healthCurrent: 984,
      healthMax: 984,
      powerCurrent: 100,
      powerMax: 100,
      powerToken: "RAGE",
    });

    const stored = readCharacterArmory(synced.character.id);
    const armory = await prepareCharacterArmory(stored, {
      provider: null,
      icons: null,
      gameDataResolver: () => ({}),
    });

    assert.equal(armory.character.name, "Rook Ravenstar");
    assert.equal(armory.character.level, 22);
    assert.equal(armory.character.className, "Warrior");
    assert.equal(armory.character.spec, "Protection");
    assert.equal(armory.stats.resources.health.max, 984);
    assert.equal(armory.stats.resources.power.token, "RAGE");
    assert.equal(armory.stats.attributes.strength.effective, 83);
    assert.equal(armory.stats.offense.attackPower.effective, 221);
    assert.equal(armory.stats.defense.armor.effective, 1297);
    assert.equal(armory.stats.utility.itemLevel.equipped, 10.4);
    assert.equal(armory.equipment.length, 1);
    assert.equal(armory.equipment[0].itemId, 11746);
    assert.equal(armory.equipment[0].quality, 3);
    assert.equal(armory.equipment[0].iconFileId, 132767);
    assert.equal(armory.professions.length, 1);
    assert.equal(armory.professions[0].name, "Blacksmithing");
    assert.equal(armory.professions[0].current, 94);
    assert.equal(armory.recipes.length, 1);
    assert.equal(armory.recipes[0].name, "Mithril Spurs");
  });
});
