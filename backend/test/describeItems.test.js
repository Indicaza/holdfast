import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { upsertGameDataEntityInDatabase } from "../src/GameData/gameDataCatalog.js";
import { describeItems, describedItem, tooltipLineCount } from "../src/Items/describeItems.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// Every list of items a page shows (dungeon loot, your gathering, drop
// rates, craft results) is described the same way: the game's tooltip from
// the website's item index, never invented, never replacing what the
// caller already knew.

function seed(db) {
  db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (2589, '70888', 'en_US', 'Linen Cloth', 1, 132889, ?, '2026-11-01')`).run(JSON.stringify({ itemId: 2589, name: "Linen Cloth",
    itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 5, name: "Cloth" }, tooltipLines: [{ left: "Linen Cloth" }, { left: "Max Stack: 20" }] }));
  upsertGameDataEntityInDatabase(db, { type: "item", id: 15210, name: "Raider's Chestpiece", qualityId: 2, source: "blizzard",
    metadata: { itemClassId: 4, itemSubclassId: 2, tooltipLines: [{ left: "Raider's Chestpiece" }, { left: "Chest", right: "Leather" }], inventoryTypeName: "Chest" } });
  // Known only by name: a tooltip of one line says nothing.
  db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (6948, '70888', 'en_US', 'Hearthstone', 1, 134414, ?, '2026-11-01')`).run(JSON.stringify({ itemId: 6948, name: "Hearthstone", tooltipLines: [{ left: "Hearthstone" }] }));
}

test("items listed by id get their name, quality, icon and the game's tooltip", () => withHttpApp(async () => {
  withGuildTransaction(seed);
  const items = withGuildDatabase((db) => describeItems(db, [
    { itemId: 2589, quantity: 4 },
    { itemId: 15210, name: "" },
    { itemId: 6948 },
    { itemId: 777777, name: "Mystery" },
    { itemKey: "unknown", itemId: null },
  ]));
  assert.equal(items.length, 5, "one answer per item, in order");
  assert.equal(items[0].name, "Linen Cloth");
  assert.equal(items[0].qualityId, 1);
  assert.equal(items[0].iconFileDataId, 132889);
  assert.equal(items[0].quantity, 4, "the caller's own fields stay");
  assert.deepEqual(items[0].tooltip.lines.map((line) => line.left), ["Linen Cloth", "Max Stack: 20"]);
  assert.deepEqual([items[0].tooltip.source, items[0].tooltip.gameBuild], ["game", "70888"], "a player's game rendered it, on that build");
  assert.equal(items[1].name, "Raider's Chestpiece");
  assert.equal(items[1].tooltip.source, "blizzard", "Blizzard's item text when no game rendered one");
  assert.equal(items[1].tooltip.lines[1].right, "Leather");
  assert.equal(items[2].name, "Hearthstone");
  assert.equal(items[2].tooltip, undefined, "a one-line tooltip is not a tooltip");
  assert.equal(items[3].name, "Mystery", "an unknown item keeps the caller's name");
  assert.equal(items[3].tooltip, undefined, "and gets no invented tooltip");
  assert.deepEqual(items[4], { itemKey: "unknown", itemId: null }, "no id, untouched");
}));

test("what the caller already knows wins", () => withHttpApp(async () => {
  withGuildTransaction(seed);
  const own = { source: "C_TooltipInfo", lines: [{ left: "Linen Cloth" }, { left: "Crafting Reagent" }, { left: "Max Stack: 20" }] };
  const [item] = withGuildDatabase((db) => describeItems(db, [{ itemId: 2589, name: "Linen Cloth (mine)", qualityId: 2, iconFileDataId: 1, tooltip: own }]));
  assert.equal(item.name, "Linen Cloth (mine)");
  assert.equal(item.qualityId, 2);
  assert.equal(item.iconFileDataId, 1);
  assert.equal(item.tooltip, own, "the add-on's own capture is kept");
  assert.equal(tooltipLineCount(item), 3);
  assert.equal(tooltipLineCount({ tooltipLines: [{ left: "a" }] }), 1);
  assert.equal(tooltipLineCount({}), 0);
}));

test("describedItem by itself", () => {
  const facts = { name: "Item 5", nameKnown: false, qualityId: null, iconFileDataId: null, tooltipLines: [] };
  assert.deepEqual(describedItem({ itemId: 5 }, facts), { itemId: 5, name: "Item 5", qualityId: null, iconFileDataId: null });
  assert.equal(describedItem({ itemId: 5, name: "Known" }, facts).name, "Known");
  assert.equal(describedItem(null, facts), null);
  assert.deepEqual(describedItem({ itemId: 5 }, null), { itemId: 5 });
});
