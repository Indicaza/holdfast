import assert from "node:assert/strict";
import test from "node:test";

import { readCharacterArmoryFromReadModel } from "../src/Character/ReadModel/readModelReader.js";
import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const RAW_ID = "character-full-tooltip";
const CHARACTER_ID = `guildweaver-id:${RAW_ID}`;

function fullTooltip() {
  return {
    source: "GameTooltip",
    method: "SetInventoryItem",
    rendered: true,
    complete: true,
    lines: [
      { left: "Tribal Pants", leftColor: { r: 0.12, g: 1, b: 0 } },
      { left: "Binds when equipped", leftColor: { r: 1, g: 1, b: 1 } },
      { left: "Legs", right: "Leather", leftColor: { r: 1, g: 1, b: 1 }, rightColor: { r: 1, g: 1, b: 1 } },
      { left: "41 Armor", leftColor: { r: 1, g: 1, b: 1 } },
      { left: "+4 Agility", leftColor: { r: 1, g: 1, b: 1 } },
      { blank: true },
      { left: "Durability 45 / 45", leftColor: { r: 1, g: 1, b: 1 } },
      { left: "Requires Level 7", leftColor: { r: 1, g: 1, b: 1 } },
    ],
  };
}

test("schema 2 character snapshots preserve the full rendered Blizzard equipment tooltip", () =>
  withHttpApp(async () => {
    const tooltip = fullTooltip();
    const result = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-full-tooltip",
      bridgeRevision: 1,
      receivedAt: "2026-10-12T17:00:00.000Z",
      snapshot: {
        schemaVersion: 2,
        capturedAt: 1791824400,
        characterId: RAW_ID,
        characterKey: "darkwing:tooltiptest",
        name: "Tooltiptest",
        realm: "Darkwing",
        region: "US",
        level: 12,
        class: { id: 4, name: "Rogue", file: "ROGUE" },
        race: { id: 1, name: "Human", file: "Human" },
        equipment: [
          {
            slot: "LegsSlot",
            slotId: 7,
            itemId: 3287,
            itemLink: "|cff1eff00|Hitem:3287::::::::12:::::::|h[Tribal Pants]|h|r",
            itemString: "item:3287::::::::12:::::::",
            name: "Tribal Pants",
            qualityId: 2,
            itemLevel: 12,
            requiredLevel: 7,
            iconFileDataId: 134586,
            bindType: 2,
            equipLocation: "INVTYPE_LEGS",
            sellPrice: 199,
            itemClass: { id: 4, name: "Armor" },
            itemSubclass: { id: 2, name: "Leather" },
            stats: { ITEM_MOD_AGILITY_SHORT: 4 },
            durability: { current: 45, max: 45 },
            tooltip,
          },
        ],
        professions: [],
      },
    });

    assert.equal(result.status, "created");
    const armory = readCharacterArmoryFromReadModel(CHARACTER_ID);
    assert.ok(armory);
    assert.equal(armory.equipment.length, 1);

    const pants = armory.equipment[0];
    assert.equal(pants.name, "Tribal Pants");
    assert.equal(pants.requiredLevel, 7);
    assert.equal(pants.sellPrice, 199);
    assert.equal(pants.itemSubclass.name, "Leather");
    assert.equal(pants.stats.ITEM_MOD_AGILITY_SHORT, 4);
    assert.deepEqual(pants.durability, { current: 45, max: 45 });
    assert.equal(pants.tooltip.source, "GameTooltip");
    assert.equal(pants.tooltip.method, "SetInventoryItem");
    assert.equal(pants.tooltip.rendered, true);
    assert.equal(pants.tooltip.complete, true);
    assert.equal(pants.tooltip.lines.length, tooltip.lines.length);
    assert.equal(pants.tooltip.lines[2].right, "Leather");
    assert.equal(pants.tooltip.lines[3].left, "41 Armor");
    assert.equal(pants.tooltip.lines[4].left, "+4 Agility");
    assert.equal(pants.tooltip.lines[5].blank, true);
    assert.equal(pants.tooltip.lines[6].left, "Durability 45 / 45");
  }));
