import assert from "node:assert/strict";
import test from "node:test";

import { mergeItemDefinition } from "../src/Character/Telemetry/itemDefinitionCatalog.js";

test("canonical item definitions enrich sparse equipment without losing instance fields", () => {
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
      itemClass: { id: 4, name: "Armor" },
      itemSubclass: { id: 4, name: "Plate" },
      stats: { ITEM_MOD_STRENGTH_SHORT: 13, ITEM_MOD_STAMINA_SHORT: 14 },
      tooltip: {
        source: "C_TooltipInfo",
        lines: [
          { left: "Golem Skull Helm" },
          { left: "Item Level 35" },
          { left: "+13 Strength" },
        ],
      },
    }],
  ]);

  const merged = mergeItemDefinition({
    slot: "HEAD",
    slotId: 1,
    itemId: 11746,
    itemLink: "|Hitem:11746:17|h[Golem Skull Helm]|h",
    name: "Golem Skull Helm",
    enchantId: 17,
    durability: { current: 91, max: 100 },
  }, catalog);

  assert.equal(merged.slot, "HEAD");
  assert.equal(merged.enchantId, 17);
  assert.deepEqual(merged.durability, { current: 91, max: 100 });
  assert.equal(merged.itemSubclass.name, "Plate");
  assert.equal(merged.stats.ITEM_MOD_STRENGTH_SHORT, 13);
  assert.equal(merged.tooltip.lines.length, 3);
  assert.equal(merged.tooltipLines[2].left, "+13 Strength");
});

test("a richer per-instance equipment tooltip beats an older canonical definition", () => {
  const catalog = new Map([
    ["item:6975", {
      itemId: 6975,
      name: "Whirlwind Axe",
      tooltip: { lines: [{ left: "Whirlwind Axe" }] },
      stats: { ITEM_MOD_STRENGTH_SHORT: 15 },
    }],
  ]);

  const merged = mergeItemDefinition({
    itemId: 6975,
    name: "Whirlwind Axe",
    stats: { ITEM_MOD_STAMINA_SHORT: 14 },
    tooltip: {
      source: "C_TooltipInfo",
      lines: [
        { left: "Whirlwind Axe" },
        { left: "+14 Stamina" },
      ],
    },
  }, catalog);

  assert.equal(merged.tooltip.lines.length, 2);
  assert.equal(merged.tooltip.lines[1].left, "+14 Stamina");
  assert.equal(merged.stats.ITEM_MOD_STRENGTH_SHORT, 15);
  assert.equal(merged.stats.ITEM_MOD_STAMINA_SHORT, 14);
});
