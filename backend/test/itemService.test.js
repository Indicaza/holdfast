import assert from "node:assert/strict";
import test from "node:test";

import { withGuildTransaction } from "../src/Data/database.js";
import { createBlizzardGameDataProvider } from "../src/GameData/blizzardGameDataProvider.js";
import { upsertGameDataEntityInDatabase } from "../src/GameData/gameDataCatalog.js";
import { parseItemKey, readCostToBuy, readItem, readItemHistory, readItemIntelligence, readItemOnMarket, readItemSources, readMarketPrices } from "../src/Items/itemService.js";
import { marketItemDataEnv, resolveMarketItemNames } from "../src/Market/marketRefresh.js";
import { itemsMissingTooltipsInDatabase, recordMarketSnapshotInDatabase, searchMarket } from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// The shared item service (what the Auction House, professions, loot and
// later rules read) and the tooltip data behind it.

const NOW = Math.floor(Date.now() / 1000);
const GAME = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "Normal Alliance (in-game)" };
const API = { marketKey: "api:us:house-113", kind: "api_house", region: "us", rulesetId: 2, houseId: 113, faction: "alliance", name: "US Alliance (113)" };

let sequence = 0;
function snapshot(db, market, items, { coverage = "items", source = "addon_scan", observedAt = NOW - 600, scope = "" } = {}) {
  sequence += 1;
  return recordMarketSnapshotInDatabase(db, { market, sourceType: source, sourceId: `item-service-${sequence}`, coverage, scope, observedAt, now: NOW, items });
}

function listing(itemKey, fields = {}) {
  return { itemKey, itemId: Number(/^i:(\d+)/.exec(itemKey)[1]), minUnitBuyout: 100, typicalUnitBuyout: 110, maxUnitBuyout: 150, minUnitBid: null,
    quantity: 10, listings: 2, bidOnlyListings: 0, ...fields };
}

test("item keys: a base item, a random-suffix version and bonus lists, nothing else", () => {
  assert.deepEqual(parseItemKey(2589), { itemKey: "i:2589", itemId: 2589, suffix: 0, bonusLists: [], variant: false });
  assert.deepEqual(parseItemKey("2589")?.itemKey, "i:2589");
  assert.deepEqual(parseItemKey("i:15210:s-1081"), { itemKey: "i:15210:s-1081", itemId: 15210, suffix: -1081, bonusLists: [], variant: true });
  assert.equal(parseItemKey("i:19019:b3.1")?.itemKey, "i:19019:b1.3", "bonus lists are sorted, so one version has one key");
  for (const bad of ["", "item:2589", "i:0", "i:-4", "DROP TABLE", null]) assert.equal(parseItemKey(bad), null, String(bad));
});

test("an item's tooltip: the game's with its build, else Blizzard's, never another version's bonuses", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
      VALUES (2589, '70888', 'en_US', 'Linen Cloth', 1, 132889, ?, '2026-11-01')`).run(JSON.stringify({ itemId: 2589, name: "Linen Cloth",
      itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 5, name: "Cloth" }, tooltipLines: [{ left: "Linen Cloth" }, { left: "Max Stack: 20" }] }));
    upsertGameDataEntityInDatabase(db, { type: "item", id: 15210, name: "Raider's Chestpiece", qualityId: 2, source: "blizzard",
      metadata: { itemClassId: 4, itemSubclassId: 2, tooltipLines: [{ left: "Raider's Chestpiece" }, { left: "Chest", right: "Leather" }, { left: "<Random enchantment>" }],
        inventoryTypeName: "Chest" } });
    snapshot(db, GAME, [listing("i:2589"), listing("i:15210:s-1081", { name: "Raider's Chestpiece of the Bear" })]);
  });
  const linen = readItem("i:2589");
  assert.equal(linen.name, "Linen Cloth");
  assert.deepEqual(linen.tooltip.lines.map((line) => line.left), ["Linen Cloth", "Max Stack: 20"]);
  assert.deepEqual([linen.tooltip.source, linen.tooltip.gameBuild, linen.tooltip.versionBonusesIncluded], ["game", "70888", null]);
  const bear = readItem("i:15210:s-1081");
  assert.equal(bear.variant, true);
  assert.equal(bear.tooltip.source, "blizzard");
  assert.equal(bear.tooltip.versionBonusesIncluded, false, "the base item's lines, said to lack this version's bonuses");
  assert.equal(bear.slotName, "Chest");
  assert.equal(readItem("i:777777").tooltip.source, null, "unknown: no tooltip, not an invented one");
}));

test("prices belong to one market and one version; nothing is picked or merged for the caller", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    snapshot(db, GAME, [listing("i:2589", { minUnitBuyout: 90, typicalUnitBuyout: 92, quantity: 150, listings: 7, ladder: [[90, 100, 5], [95, 50, 2]] }),
      listing("i:15210:s-1081", { minUnitBuyout: 50000, quantity: 1, listings: 1 })]);
    snapshot(db, API, [listing("i:2589", { minUnitBuyout: 120, quantity: 900, listings: 40 })], { coverage: "full", source: "official_api", scope: "api:commodities" });
  });
  const here = readMarketPrices({ marketKey: GAME.marketKey, keys: ["i:2589", "i:15210:s-1081", "i:15210"] });
  assert.equal(here.get("i:2589").minUnitBuyout, 90);
  assert.equal(here.get("i:15210:s-1081").minUnitBuyout, 50000);
  assert.equal(here.get("i:15210").variantsOnly, true, "the base item is not listed: its versions are counted, not priced as it");
  assert.equal(here.get("i:15210").minUnitBuyout, null);
  assert.equal(readMarketPrices({ marketKey: API.marketKey, keys: ["i:2589"] }).get("i:2589").minUnitBuyout, 120, "the other house's own price");
  assert.equal(readMarketPrices({ marketKey: "nowhere", keys: ["i:2589"] }).size, 0);

  const depth = readItemOnMarket({ key: "2589", marketKey: GAME.marketKey });
  assert.equal(depth.listing, "listed");
  assert.deepEqual(depth.ladder.levels, [{ unitPrice: 90, quantity: 100, auctions: 5 }, { unitPrice: 95, quantity: 50, auctions: 2 }]);
  assert.equal(depth.ladder.totalQuantity, 150);
  assert.equal(depth.ladder.sellers, null, "no source reports sellers");
  assert.equal(depth.price.source, "addon_scan");
  assert.equal(readItemOnMarket({ key: "2589", marketKey: "" }), null, "no market: no answer, never one chosen for the caller");
  assert.deepEqual(readCostToBuy({ key: "i:2589", marketKey: GAME.marketKey, quantity: 120 }).cost, 100 * 90 + 20 * 95, "level by level, not the lowest price × 120");
  const tooMany = readCostToBuy({ key: "i:2589", marketKey: GAME.marketKey, quantity: 500 });
  assert.deepEqual([tooMany.quantity, tooMany.short, tooMany.highest], [150, 350, 95]);

  const history = readItemHistory({ key: "i:2589", marketKey: GAME.marketKey, range: "24h" });
  assert.equal(history.itemKey, "i:2589");
  assert.match(history.basis, /not sales/);
  const all = readItemIntelligence({ key: "i:2589", marketKey: GAME.marketKey, include: ["item", "market"] });
  assert.equal(all.item.itemId, 2589);
  assert.equal(all.market.price.minUnitBuyout, 90);
  assert.equal(all.history, undefined, "only what was asked for");
  const sources = readItemSources("i:2589");
  assert.deepEqual([sources.createdBy, sources.usedBy, sources.sources].map((list) => Array.isArray(list)), [true, true, true]);
}));

test("Blizzard items saved before tooltips were kept are asked again once, then show Blizzard's tooltip", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    // As production has them: named and classed by Blizzard's item API,
    // but with no tooltip text kept.
    upsertGameDataEntityInDatabase(db, { type: "item", id: 2000, name: "Black Duskwood Staff", qualityId: 3, source: "blizzard",
      metadata: { itemClassId: 2, itemSubclassId: 10, itemLevel: 38, requiredLevel: 33, inventoryType: "TWOHWEAPON", itemClassName: "Weapon", itemSubclassName: "Staff" } });
    snapshot(db, API, [listing("i:2000", { minUnitBuyout: 29900, quantity: 22, listings: 22 })], { coverage: "full", source: "official_api", scope: "api:auctions" });
  });
  const before = searchMarket({ marketKey: API.marketKey, q: "black duskwood", now: NOW }).results[0].item;
  assert.equal(before.name, "Black Duskwood Staff");
  assert.equal(before.tooltipLines?.length || 0, 0, "only the facts so far");
  assert.deepEqual(withGuildTransaction((db) => itemsMissingTooltipsInDatabase(db, { now: NOW })), [2000]);

  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (url.href === "https://oauth.battle.net/token") return json({ access_token: "t", expires_in: 3600 });
    if (url.pathname === "/data/wow/item/2000") {
      return json({ id: 2000, name: "Black Duskwood Staff", quality: { type: "RARE" }, level: 38, required_level: 33, item_class: { id: 2, name: "Weapon" },
        item_subclass: { id: 10, name: "Staff" }, inventory_type: { type: "TWOHWEAPON", name: "Two-Hand" }, sell_price: 14577,
        preview_item: { name: "Black Duskwood Staff", level: { display_string: "Item Level 38" }, binding: { name: "Binds when equipped" },
          inventory_type: { name: "Two-Hand" }, item_subclass: { name: "Staff" },
          weapon: { damage: { display_string: "86 - 130 Damage" }, attack_speed: { display_string: "Speed 3.30" }, dps: { display_string: "(32.7 damage per second)" } },
          stats: [{ display: { display_string: "+10 Strength" } }], durability: { display_string: "Durability 85 / 85" },
          requirements: { level: { display_string: "Requires Level 33" } } } });
    }
    return json({ error: "not_found" }, 404);
  };
  const itemProvider = createBlizzardGameDataProvider({ env: marketItemDataEnv({ BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret", BLIZZARD_REGION: "us" }), fetchImpl });
  const result = await resolveMarketItemNames({ itemProvider, now: () => NOW });
  assert.equal(result.looked, 1);
  assert.ok(calls.includes("/data/wow/item/2000"), "asked although its catalog entry is recent");
  const after = readItem("i:2000");
  assert.equal(after.tooltip.source, "blizzard");
  assert.deepEqual(after.tooltip.lines.map((line) => [line.left, line.right ?? ""]), [["Black Duskwood Staff", ""], ["Item Level 38", ""], ["Binds when equipped", ""],
    ["Two-Hand", "Staff"], ["86 - 130 Damage", "Speed 3.30"], ["(32.7 damage per second)", ""], ["+10 Strength", ""], ["Durability 85 / 85", ""], ["Requires Level 33", ""]]);
  assert.equal(after.slotName, "Two-Hand");
  assert.equal(searchMarket({ marketKey: API.marketKey, q: "black duskwood", now: NOW }).results[0].item.tooltipSource, "blizzard", "search results carry it: no request per hover");
  assert.deepEqual(withGuildTransaction((db) => itemsMissingTooltipsInDatabase(db, { now: NOW + 2 * 86400 })), [], "asked once");
}));
