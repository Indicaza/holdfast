import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { previewTooltipLines } from "../src/GameData/blizzardGameDataProvider.js";
import { scanItems } from "../src/Market/auctionScanTelemetry.js";
import { createBlizzardAuctionProvider } from "../src/Market/blizzardAuctionProvider.js";
import { aggregateListings } from "../src/Market/marketModel.js";
import { createMarketRefresher } from "../src/Market/marketRefresh.js";
import { readItemMarket, readPrices, recordMarketSnapshotInDatabase, searchMarket } from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// Market depth (every price level), empty houses, the slot level of the
// category tree, and tooltips that travel with search results.

const NOW = 1794300000;
const GAME = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "Normal Alliance (in-game)" };
const ENV = { BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret", MARKET_BLIZZARD_REGIONS: "us" };
const quiet = { info() {}, warn() {}, error() {} };

function blizzard() {
  const state = { lastModified: "Tue, 10 Nov 2026 10:00:00 GMT", body: { _links: { self: {} }, auctions: [{ id: 1, item: { id: 25 }, quantity: 1, buyout: 900 }] } };
  const fetchImpl = async (url) => {
    const path = String(url).replace(/^https:\/\/us\.api\.blizzard\.com/, "").replace(/\?.*$/, "");
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    if (String(url).includes("oauth")) return json({ access_token: "token", expires_in: 3600 });
    if (path === "/data/wow/ruleset/index") return json({ rulesets: [{ id: 2 }] });
    if (path === "/data/wow/ruleset/2/auctions/") return json({ auctions: [{ id: 113, name: "Alliance Auction House" }] });
    if (path.endsWith("/commodities")) return json({ error: "not_found" }, 404);
    return json(state.body, 200, { "last-modified": state.lastModified });
  };
  return { state, fetchImpl };
}

test("a house that sells out is recorded as empty; an odd answer is a failure, not an empty house", () => withHttpApp(async () => {
  let clock = Date.parse("Tue, 10 Nov 2026 10:05:00 GMT");
  const fake = blizzard();
  const refresher = createMarketRefresher({ provider: createBlizzardAuctionProvider({ env: ENV, fetchImpl: fake.fetchImpl, now: () => clock }), now: () => clock, log: quiet });
  await refresher.tick();
  const price = () => readPrices({ marketKey: "api:us:house-113", itemIds: [25], now: Math.floor(clock / 1000) }).prices[0];
  assert.equal(price().quantity, 1);
  // An answer without auctions and without Blizzard's _links: refused.
  clock += 5 * 3600 * 1000;
  fake.state.lastModified = "Tue, 10 Nov 2026 15:00:00 GMT";
  fake.state.body = {};
  let result = await refresher.tick();
  assert.equal(result.endpoints.find((entry) => entry.endpoint === "auctions").status, "failed");
  assert.equal(price().quantity, 1, "an odd answer never clears the house");
  // A real empty answer (Blizzard leaves `auctions` out): everything gone.
  clock += 5 * 3600 * 1000;
  fake.state.lastModified = "Tue, 10 Nov 2026 20:00:00 GMT";
  fake.state.body = { _links: { self: {} } };
  result = await refresher.tick();
  assert.equal(result.endpoints.find((entry) => entry.endpoint === "auctions").status, "recorded");
  assert.equal(price().quantity, 0, "none listed after the house emptied");
  assert.equal(price().minUnitBuyout, null);
  // The same empty answer later only confirms it.
  clock += 5 * 3600 * 1000;
  fake.state.lastModified = "Wed, 11 Nov 2026 01:00:00 GMT";
  result = await refresher.tick();
  assert.equal(result.endpoints.find((entry) => entry.endpoint === "auctions").status, "unchanged");
  // Empty is never accepted from a partial view.
  withGuildTransaction((db) => {
    assert.equal(recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "s0", coverage: "items", observedAt: NOW, now: NOW, items: [], allowEmpty: true }).status, "empty");
  });
}));

test("every price level is kept: quantity and auctions at each price, cheapest first", () => withHttpApp(async () => {
  // 30 price levels of copper ore, two auctions at the cheapest.
  const listings = [{ itemId: 2770, quantity: 20, buyout: 1200 }, { itemId: 2770, quantity: 5, buyout: 300 }];
  for (let level = 1; level <= 29; level += 1) listings.push({ itemId: 2770, quantity: 10 + level, buyout: (60 + level) * (10 + level) });
  const [ore] = aggregateListings(listings);
  assert.equal(ore.ladder.length, 30);
  assert.deepEqual(ore.ladder[0], [60, 25, 2], "two auctions at 60c, 25 ore");
  assert.equal(ore.pricePoints.length, 10, "observations keep ten levels");
  withGuildTransaction((db) => {
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "full-1", coverage: "full", observedAt: NOW - 60, now: NOW, items: [ore] });
  });
  const detail = readItemMarket({ itemId: 2770, marketKey: GAME.marketKey, now: NOW });
  assert.equal(detail.ladder.levels.length, 30);
  assert.deepEqual(detail.ladder.levels[0], { unitPrice: 60, quantity: 25, auctions: 2 });
  assert.ok(detail.ladder.levels.every((level, index, all) => index === 0 || level.unitPrice > all[index - 1].unitPrice), "ascending");
  assert.equal(detail.ladder.totalQuantity, ore.quantity);
  assert.equal(detail.ladder.sellers, null, "no source reports sellers");
  assert.equal(detail.ladder.complete, true);
  // An in-game search shows a few levels of a larger supply: said so.
  const [partial] = scanItems({ items: [{ itemId: 2770, quantity: 500, listings: 40, prices: [[61, 20, 2], [62, 30, 3]] }] });
  assert.equal(partial.ladderTruncated, true);
  withGuildTransaction((db) => {
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "page-1", coverage: "items", observedAt: NOW - 30, now: NOW, items: [partial] });
  });
  const later = readItemMarket({ itemId: 2770, marketKey: GAME.marketKey, now: NOW });
  assert.equal(later.ladder.truncated || later.ladder.levels.length === 30, true, "the shown price's own levels");
  // Gone from a later complete view: the price list is empty, not stale.
  withGuildTransaction((db) => {
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "full-2", coverage: "full", observedAt: NOW - 10, now: NOW,
      items: [{ itemKey: "i:25", itemId: 25, minUnitBuyout: 900, typicalUnitBuyout: 900, quantity: 1, listings: 1, ladder: [[900, 1, 1]] }] });
  });
  const ladder = withGuildDatabase((db) => db.prepare("SELECT levels FROM market_price_ladders WHERE item_key = 'i:2770' AND source_type = 'addon_scan' AND market_key = ?").get(GAME.marketKey));
  assert.equal(ladder.levels, "[]");
}));

test("armor by slot: Mail › Chest takes chest pieces and robes, not gloves", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
      VALUES (?, '70790', 'en_US', ?, 2, NULL, ?, '2026-11-01')`);
    const mail = (id, name, equipLocation) => insert.run(id, name, JSON.stringify({ itemId: id, name, itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 3, name: "Mail" }, equipLocation,
      tooltipLines: [{ left: name }, { left: "Binds when equipped" }] }));
    mail(1001, "Chain Vest", "INVTYPE_CHEST");
    mail(1002, "Chain Robe", "INVTYPE_ROBE");
    mail(1003, "Chain Gloves", "INVTYPE_HAND");
    recordMarketSnapshotInDatabase(db, { market: GAME, sourceType: "addon_scan", sourceId: "mail", coverage: "items", observedAt: NOW - 60, now: NOW,
      items: [1001, 1002, 1003].map((itemId) => ({ itemKey: `i:${itemId}`, itemId, minUnitBuyout: 500, typicalUnitBuyout: 500, quantity: 1, listings: 1 })) });
  });
  const chest = searchMarket({ marketKey: GAME.marketKey, category: "armor", subcategory: "mail", slot: "chest", now: NOW });
  assert.deepEqual(chest.results.map((row) => row.item.name).sort(), ["Chain Robe", "Chain Vest"]);
  assert.deepEqual(chest.filters.category.keys, ["armor", "mail", "chest"]);
  assert.equal(chest.detailColumn, "level", "Armor shows the required level column, as in the game");
  assert.equal(searchMarket({ marketKey: GAME.marketKey, category: "armor", subcategory: "mail", now: NOW }).total, 3);
  const mailNode = chest.categories.find((entry) => entry.key === "armor").subcategories.find((entry) => entry.key === "mail");
  assert.equal(mailNode.subcategories.find((entry) => entry.key === "chest").items, 2);
  // Tooltips come with the page of results: no request per hover.
  assert.deepEqual(chest.results[0].item.tooltipLines.map((line) => line.left)[1], "Binds when equipped");
  assert.equal(chest.results[0].item.tooltipSource, "game");
}));

test("Blizzard's item preview becomes tooltip lines, from its own display strings only", () => {
  const lines = previewTooltipLines({ name: "Azure Silk Gloves", preview_item: {
    name: "Azure Silk Gloves", level: { display_string: "Item Level 29" }, binding: { name: "Binds when equipped" },
    inventory_type: { name: "Hands" }, item_subclass: { name: "Cloth" }, armor: { display: { display_string: "30 Armor" } },
    stats: [{ display: { display_string: "+5 Intellect" } }], durability: { display_string: "Durability 25 / 25" },
    requirements: { level: { display_string: "Requires Level 24" } }, spells: [{ description: "Equip: Increases your skill in Fishing by 5." }],
  } });
  assert.deepEqual(lines.map((line) => [line.left, line.right ?? ""]), [["Azure Silk Gloves", ""], ["Item Level 29", ""], ["Binds when equipped", ""], ["Hands", "Cloth"],
    ["30 Armor", ""], ["+5 Intellect", ""], ["Durability 25 / 25", ""], ["Requires Level 24", ""], ["Equip: Increases your skill in Fishing by 5.", ""]]);
  assert.deepEqual(previewTooltipLines({ name: "Linen Cloth" }), [], "no preview, no lines: nothing made up");
});
