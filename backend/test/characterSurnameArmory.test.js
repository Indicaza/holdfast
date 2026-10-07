import assert from "node:assert/strict";
import test from "node:test";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function snapshot({ characterId, lastName, className, level, capturedAt, equipment = [] }) {
  return {
    schemaVersion: 3,
    capturedAt,
    characterId,
    characterKey: `classic beta pve 2:rook:${lastName.toLowerCase()}`,
    name: "Rook",
    firstName: "Rook",
    lastName,
    displayName: `Rook ${lastName}`,
    realm: "Classic Beta PvE 2",
    region: "US",
    level,
    race: { id: 4, name: "Night Elf", token: "NightElf" },
    class: { name: className, token: className.toUpperCase() },
    guild: { name: "Holdfast", realm: "Classic Beta PvE 2" },
    professions: [],
    equipment,
  };
}

test("surname-aware collector identities keep same-first-name characters distinct", async () => {
  await withHttpApp(async ({ request }) => {
    const warrior = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: snapshot({
        characterId: "character-warrior-rook",
        lastName: "Ravenstar",
        className: "Warrior",
        level: 22,
        capturedAt: 1791342000,
        equipment: [
          {
            slot: "NeckSlot",
            slotId: 2,
            itemId: 273088,
            itemLink: "|cff0070dd|Hitem:273088::::::::22:::::::|h[Snake Eye Kaleidoscope]|h|r",
            name: "Snake Eye Kaleidoscope",
            quality: 3,
            itemLevel: 22,
            requiredLevel: 20,
            class: "Armor",
            subclass: "Miscellaneous",
            equipLocation: "INVTYPE_NECK",
            icon: "Interface\\Icons\\INV_Misc_Gem_Pearl_05",
            iconTexture: "Interface\\Icons\\INV_Misc_Gem_Pearl_05",
            iconFileDataId: 134123,
            tooltipLines: [
              { left: "Snake Eye Kaleidoscope" },
              { left: "Item Level 22" },
              { left: "+4 Agility", right: "+3 Stamina" },
            ],
          },
        ],
      }),
    });

    const rogue = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: snapshot({
        characterId: "character-rogue-rook",
        lastName: "Darkwing",
        className: "Rogue",
        level: 7,
        capturedAt: 1791342100,
      }),
    });

    assert.equal(warrior.status, "created");
    assert.equal(rogue.status, "created");
    assert.notEqual(warrior.character.id, rogue.character.id);
    assert.equal(warrior.character.name, "Rook Ravenstar");
    assert.equal(rogue.character.name, "Rook Darkwing");

    const summary = await request("/api/intelligence", { persona: "member" });
    assert.equal(summary.status, 200);
    assert.equal(summary.json.summary.characterCount, 2);
    assert.deepEqual(
      new Set(summary.json.characters.map((character) => character.name)),
      new Set(["Rook Ravenstar", "Rook Darkwing"]),
    );

    const armory = await request(
      `/api/intelligence/characters/${encodeURIComponent(warrior.character.id)}`,
      { persona: "member" },
    );
    assert.equal(armory.status, 200);
    assert.equal(armory.json.character.firstName, "Rook");
    assert.equal(armory.json.character.lastName, "Ravenstar");
    assert.equal(armory.json.character.displayName, "Rook Ravenstar");
    assert.equal(armory.json.character.name, "Rook Ravenstar");
    assert.equal(armory.json.equipment[0].iconFileId, 134123);
    assert.equal(
      armory.json.equipment[0].iconTexture,
      "Interface\\Icons\\INV_Misc_Gem_Pearl_05",
    );
    assert.equal(armory.json.equipment[0].requiredLevel, 20);
    assert.equal(armory.json.equipment[0].itemSubclassName, "Miscellaneous");
    assert.equal(armory.json.equipment[0].tooltipLines[2].left, "+4 Agility");
    assert.equal(armory.json.equipment[0].tooltipLines[2].right, "+3 Stamina");
  });
});
