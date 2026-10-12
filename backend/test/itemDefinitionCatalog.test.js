import assert from "node:assert/strict";
import test from "node:test";

import { isFullBlizzardTooltip, mergeItemDefinition } from "../src/Character/Telemetry/itemDefinitionCatalog.js";

function renderedTooltip(lines, method = "SetHyperlink") {
  return {
    source: "GameTooltip",
    method,
    rendered: true,
    complete: true,
    lines,
  };
}

test("canonical rendered item definitions enrich sparse equipment without losing instance fields", () => {
  const catalog = new Map([
    ["item:11746", {
      itemId: 11746,
      name: "Golem Skull Helm",
      qualityId: 3,
      itemLevel: 35,
      requiredLevel: 30,
      iconFileDataId: 132767,
      bindType: 2,
      equipLocation: "INVTYPE_HEAD",
      sellPrice: 12345,
      itemClass: { id: 4, name: "Armor" },
      itemSubclass: { id: 4, name: "Plate" },
      stats: { ITEM_MOD_STRENGTH_SHORT: 13, ITEM_MOD_STAMINA_SHORT: 14 },
      tooltip: renderedTooltip([
        { left: "Golem Skull Helm" },
        { left: "Head", right: "Plate" },
        { left: "120 Armor" },
        { left: "+13 Strength" },
        { left: "Durability 91 / 100" },
      ]),
    }],
  ]);

  const merged = mergeItemDefinition({
    slot: "HEAD",
    slotId: 1,
    itemId: 11746,
    itemLink: "|Hitem:11746:17|h[Golem Skull Helm]|h",
    name: "Golem Skull Helm",
    qualityId: null,
    iconFileDataId: null,
    requiredLevel: null,
    bindType: null,
    equipLocation: "",
    sellPrice: null,
    enchantId: 17,
    durability: { current: 91, max: 100 },
  }, catalog);

  assert.equal(merged.slot, "HEAD");
  assert.equal(merged.enchantId, 17);
  assert.deepEqual(merged.durability, { current: 91, max: 100 });
  assert.equal(merged.qualityId, 3);
  assert.equal(merged.iconFileDataId, 132767);
  assert.equal(merged.requiredLevel, 30);
  assert.equal(merged.bindType, 2);
  assert.equal(merged.equipLocation, "INVTYPE_HEAD");
  assert.equal(merged.sellPrice, 12345);
  assert.equal(merged.itemSubclass.name, "Plate");
  assert.equal(merged.stats.ITEM_MOD_STRENGTH_SHORT, 13);
  assert.equal(isFullBlizzardTooltip(merged), true);
  assert.equal(merged.tooltip.lines[2].left, "120 Armor");
  assert.equal(merged.tooltipLines[4].left, "Durability 91 / 100");
});

test("provisional C_TooltipInfo catalog data never replaces an equipment tooltip", () => {
  const catalog = new Map([
    ["item:3287", {
      itemId: 3287,
      name: "Tribal Pants",
      tooltip: {
        source: "C_TooltipInfo",
        complete: false,
        rendered: false,
        lines: [
          { left: "Tribal Pants" },
          { left: "Leather" },
          { left: "Requires Level 7" },
        ],
      },
    }],
  ]);

  const current = {
    itemId: 3287,
    name: "Tribal Pants",
    tooltip: renderedTooltip([
      { left: "Tribal Pants" },
      { left: "Legs", right: "Leather" },
      { left: "41 Armor" },
      { left: "+4 Agility" },
      { left: "Durability 45 / 45" },
      { left: "Requires Level 7" },
    ], "SetInventoryItem"),
  };

  const merged = mergeItemDefinition(current, catalog);
  assert.equal(merged.tooltip.method, "SetInventoryItem");
  assert.equal(merged.tooltip.lines[2].left, "41 Armor");
  assert.equal(merged.tooltip.lines.some((line) => line.left === "+4 Agility"), true);
});

test("slot-rendered equipment tooltip beats a generic rendered definition", () => {
  const catalog = new Map([
    ["item:6975", {
      itemId: 6975,
      name: "Whirlwind Axe",
      tooltip: renderedTooltip([
        { left: "Whirlwind Axe" },
        { left: "Two-Hand", right: "Axe" },
        { left: "102 - 154 Damage" },
        { left: "+15 Strength" },
        { left: "+14 Stamina" },
      ]),
      stats: { ITEM_MOD_STRENGTH_SHORT: 15 },
    }],
  ]);

  const merged = mergeItemDefinition({
    itemId: 6975,
    name: "Whirlwind Axe",
    stats: { ITEM_MOD_STAMINA_SHORT: 14 },
    tooltip: renderedTooltip([
      { left: "Whirlwind Axe" },
      { left: "Two-Hand", right: "Axe" },
      { left: "102 - 154 Damage" },
      { left: "Durability 65 / 65" },
    ], "SetInventoryItem"),
  }, catalog);

  assert.equal(merged.tooltip.method, "SetInventoryItem");
  assert.equal(merged.tooltip.lines[3].left, "Durability 65 / 65");
  assert.equal(merged.stats.ITEM_MOD_STRENGTH_SHORT, 15);
  assert.equal(merged.stats.ITEM_MOD_STAMINA_SHORT, 14);
});
