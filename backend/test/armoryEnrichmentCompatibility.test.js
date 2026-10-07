import assert from "node:assert/strict";
import test from "node:test";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function baseSnapshot(overrides = {}) {
  return {
    schemaVersion: 3,
    capturedAt: 1791343000,
    characterId: "character-compat",
    characterKey: "classic beta pve 2:finch",
    name: "Finch",
    realm: "Classic Beta PvE 2",
    level: 12,
    race: "Human",
    class: "Mage",
    professions: [],
    ...overrides,
  };
}

test("Armory enrichment tolerates legacy icon and tooltip shapes without losing metadata", async () => {
  await withHttpApp(async ({ request }) => {
    const result = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: baseSnapshot({
        equipment: [
          {
            slot: "Finger0Slot",
            itemID: 111,
            itemName: "Numeric Icon Ring",
            icon: "132760",
            required_level: 9,
            itemClass: "Armor",
            itemSubclass: "Miscellaneous",
            tooltip: [
              "Plain tooltip line",
              { leftText: "Left stat", rightText: "Right stat", type: "2" },
              null,
              {},
            ],
          },
          {
            slotName: "SecondaryHandSlot",
            id: 222,
            name: "Texture Path Dagger",
            icon: "Interface\\Icons\\INV_Weapon_ShortBlade_05",
            classId: "2",
            subclassId: "15",
            setId: "7",
            expansionId: "1",
          },
        ],
      }),
    });

    assert.equal(result.status, "created");
    const response = await request(
      `/api/intelligence/characters/${encodeURIComponent(result.character.id)}`,
      { persona: "member" },
    );
    assert.equal(response.status, 200);
    assert.equal(response.json.character.firstName, "Finch");
    assert.equal(response.json.character.lastName, "");
    assert.equal(response.json.character.displayName, "Finch");

    const ring = response.json.equipment.find((item) => item.itemId === 111);
    assert.equal(ring.iconFileId, 132760);
    assert.equal(ring.requiredLevel, 9);
    assert.equal(ring.itemClassName, "Armor");
    assert.equal(ring.itemSubclassName, "Miscellaneous");
    assert.deepEqual(ring.tooltipLines[0], {
      left: "Plain tooltip line",
      right: "",
      type: null,
    });
    assert.deepEqual(ring.tooltipLines[1], {
      left: "Left stat",
      right: "Right stat",
      type: 2,
    });

    const dagger = response.json.equipment.find((item) => item.itemId === 222);
    assert.equal(dagger.iconTexture, "Interface\\Icons\\INV_Weapon_ShortBlade_05");
    assert.equal(dagger.classId, 2);
    assert.equal(dagger.subclassId, 15);
    assert.equal(dagger.setId, 7);
    assert.equal(dagger.expansionId, 1);
  });
});

test("legacy snapshots without anonymous ids still use the name fallback safely", async () => {
  await withHttpApp(async () => {
    const first = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: {
        schemaVersion: 1,
        capturedAt: 1791343100,
        guid: "",
        characterKey: "",
        name: "Legacy",
        class: "Priest",
      },
    });
    assert.equal(first.status, "invalid");
  });
});
