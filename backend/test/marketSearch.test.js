import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { upsertGameDataEntityInDatabase } from "../src/GameData/gameDataCatalog.js";
import {
  CATEGORY_TREE,
  categoryOf,
  categorySql,
  categoryTree,
  itemClassIds,
  resolveCategory,
  searchKey,
  searchTokens,
} from "../src/Market/marketCategories.js";
import {
  readItemMarket,
  readPrices,
  recordMarketSnapshotInDatabase,
  searchMarket,
  suggestItems,
  syncMarketCatalogInDatabase,
} from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// Auction House search: every known item can be found by name or id,
// listed or not; listings belong to the selected market and variant only;
// "none listed" and "not known" are told apart; categories come from the
// game's item classes.

const NOW = 1794300000;
const API = { marketKey: "api:us:house-113", kind: "api_house", region: "us", rulesetId: 2, houseId: 113, faction: "alliance", name: "US Alliance (113)" };
const GAME = { marketKey: "game:us:normal:alliance", kind: "client_house", region: "us", realm: "Normal", faction: "alliance", name: "Normal Alliance (in-game)" };
const HORDE = { ...API, marketKey: "api:us:house-116", houseId: 116, faction: "horde", name: "US Horde (116)" };

const CLASSES = {
  cloth: { itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 5, name: "Cloth" } },
  metal: { itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 7, name: "Metal & Stone" } },
  herb: { itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 9, name: "Herb" } },
  clothArmor: { itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 1, name: "Cloth" } },
  potion: { itemClass: { id: 0, name: "Consumable" }, itemSubclass: { id: 1, name: "Potion" } },
};

// The catalog: what players' games described (public_game_items).
function describe(db, entries) {
  const insert = db.prepare(`INSERT OR REPLACE INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (?, '70338', 'en_US', ?, ?, ?, ?, '2026-11-01')`);
  for (const [id, name, quality, classes = {}, extra = {}] of entries) {
    insert.run(id, name, quality, 130000 + id, JSON.stringify({ itemId: id, name, qualityId: quality, ...classes, ...extra }));
  }
}

function listing(itemKey, fields = {}) {
  return { itemKey, itemId: Number(/^i:(\d+)/.exec(itemKey)[1]), minUnitBuyout: 100, typicalUnitBuyout: 110, maxUnitBuyout: 150, minUnitBid: null,
    quantity: 10, listings: 2, bidOnlyListings: 0, ...fields };
}

let sequence = 0;
function scan(db, market, items, { coverage = "items", source = "addon_scan", observedAt = NOW - 600, scope = "" } = {}) {
  sequence += 1;
  return recordMarketSnapshotInDatabase(db, { market, sourceType: source, sourceId: `search-test-${sequence}`, coverage, scope, observedAt, now: NOW, items });
}

// A Blizzard house download: both endpoints, each a complete view.
function download(db, market, items, observedAt = NOW - 900) {
  scan(db, market, items, { coverage: "full", source: "official_api", observedAt, scope: "api:auctions" });
  scan(db, market, [listing("i:2589", { minUnitBuyout: 40 })], { coverage: "full", source: "official_api", observedAt, scope: "api:commodities" });
}

function seed() {
  withGuildTransaction((db) => {
    describe(db, [
      [4319, "Azure Silk Gloves", 2, CLASSES.clothArmor, { requiredLevel: 24, itemLevel: 29, bindType: 2,
        tooltipLines: [{ left: "Azure Silk Gloves" }, { left: "Binds when equipped" }, { left: "Hands", right: "Cloth" }] }],
      [2589, "Linen Cloth", 1, CLASSES.cloth],
      [4306, "Silk Cloth", 1, CLASSES.cloth],
      [2770, "Copper Ore", 1, CLASSES.metal],
      [12359, "Thorium Bar", 1, CLASSES.metal],
      [2447, "Peacebloom", 1, CLASSES.herb],
      [15210, "Raider's Chestpiece", 2, { itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 2, name: "Leather" } }],
      [13444, "Major Mana Potion", 1, CLASSES.potion],
      [18803, "Finkle's Lava Dredger", 4, { itemClass: { id: 2, name: "Weapon" }, itemSubclass: { id: 6, name: "Polearms" } }],
    ]);
    // In-game market: individual searches only.
    scan(db, GAME, [
      listing("i:4319", { minUnitBuyout: 25000, typicalUnitBuyout: 26000, quantity: 2 }),
      listing("i:2589", { minUnitBuyout: 90, quantity: 400 }),
      listing("i:4306", { minUnitBuyout: 350, quantity: 120 }),
      listing("i:2770", { minUnitBuyout: 60, quantity: 80 }),
      listing("i:15210:s-1081", { minUnitBuyout: 50000, quantity: 1, name: "Raider's Chestpiece of the Bear" }),
      listing("i:15210:s-1082", { minUnitBuyout: 9000, quantity: 1, name: "Raider's Chestpiece of the Eagle" }),
    ]);
    // API house: complete; Azure Silk Gloves at its own price there.
    download(db, API, [listing("i:4319", { minUnitBuyout: 31000, quantity: 1 }), listing("i:12359", { minUnitBuyout: 1500 })]);
    // Another faction's house: never seen from the others.
    download(db, HORDE, [listing("i:4319", { minUnitBuyout: 99999 })]);
  });
}

const names = (result) => result.results.map((row) => row.variantName || row.item.name);

test("search names are folded: case, accents, apostrophes and punctuation", () => {
  assert.equal(searchKey("Raider's Chestpiece"), "raiders chestpiece");
  assert.equal(searchKey("Finkle’s  Lava-Dredger!"), "finkles lava dredger");
  assert.equal(searchKey("Ébène"), "ebene");
  assert.deepEqual(searchTokens("  Silk   gloves silk "), ["silk", "gloves"]);
  assert.deepEqual(searchTokens("%_\\"), [], "wildcards are not searches");
});

test("the category tree comes from the game's item classes, one rule set for filters and counts", () => {
  assert.deepEqual(CATEGORY_TREE.map((entry) => entry.label), ["Weapons", "Armor", "Containers", "Gems", "Item Enhancements", "Consumables", "Glyphs",
    "Trade Goods", "Recipes", "Miscellaneous"]);
  const tradeGoods = CATEGORY_TREE.find((entry) => entry.key === "trade-goods").subcategories.map((entry) => entry.label);
  for (const label of ["Cloth", "Leather", "Metal & Stone", "Herbs", "Enchanting", "Jewelcrafting", "Parts", "Elemental"]) assert.ok(tradeGoods.includes(label), label);
  assert.deepEqual(categoryOf(7, 5), { category: "trade-goods", subcategory: "cloth" });
  assert.deepEqual(categoryOf(4, 1), { category: "armor", subcategory: "cloth" }, "cloth armor is not cloth");
  assert.deepEqual(categoryOf(0, 6), { category: "item-enhancements", subcategory: null });
  assert.deepEqual(categoryOf(7, null), { category: "trade-goods", subcategory: null }, "a class without a known subclass still has its category");
  assert.deepEqual(categoryOf(null, null), { category: null, subcategory: null });
  assert.deepEqual(itemClassIds({ className: "Trade Goods", subclassName: "Metal & Stone" }), { classId: 7, subclassId: 7 }, "names when ids are missing");
  assert.equal(resolveCategory("Trade Goods", "Cloth").subcategory.key, "cloth", "searches saved with names still resolve");
  assert.equal(resolveCategory("nonsense"), null);
  // Every class/subclass the tree places is selected by exactly that
  // category's SQL, and by no other top-level category's.
  withGuildDatabase((db) => {
    for (let classId = 0; classId <= 19; classId += 1) {
      for (const subclassId of [null, ...Array.from({ length: 21 }, (_, index) => index)]) {
        const { category, subcategory } = categoryOf(classId, subclassId);
        for (const entry of CATEGORY_TREE) {
          const { sql, params } = categorySql({ category: entry, subcategory: null }, "m");
          const hit = db.prepare(`SELECT ${sql} AS hit FROM (SELECT ? AS item_class_id, ? AS item_subclass_id) m`).get(...params, classId, subclassId);
          assert.equal(Boolean(hit.hit), entry.key === category, `class ${classId}/${subclassId} in ${entry.key}`);
        }
        if (subcategory) {
          const entry = CATEGORY_TREE.find((candidate) => candidate.key === category);
          const { sql, params } = categorySql({ category: entry, subcategory: entry.subcategories.find((sub) => sub.key === subcategory) }, "m");
          assert.equal(Boolean(db.prepare(`SELECT ${sql} AS hit FROM (SELECT ? AS item_class_id, ? AS item_subclass_id) m`).get(...params, classId, subclassId).hit), true);
        }
      }
    }
  });
  const tree = categoryTree([{ classId: 7, subclassId: 5, items: 3 }, { classId: 7, subclassId: 7, items: 2 }]);
  assert.equal(tree.length, 10, "every category, listed or not");
  assert.equal(tree.find((entry) => entry.key === "trade-goods").items, 5);
  assert.equal(tree.find((entry) => entry.key === "gems").items, 0);
});

test("Azure Silk Gloves: found by name, part of a name, any case, any word order, and by id", () => withHttpApp(async () => {
  seed();
  for (const q of ["Azure Silk Gloves", "azure", "AZURE SILK", "gloves azure", "silk glov", "Azure-Silk  Gloves!", "4319", "#4319"]) {
    const result = searchMarket({ marketKey: GAME.marketKey, q, now: NOW });
    assert.equal(result.mode, "search");
    const row = result.results.find((entry) => entry.item.itemId === 4319);
    assert.ok(row, `${q} finds item 4319`);
    assert.equal(row.listing, "listed");
    assert.equal(row.minUnitBuyout, 25000, `${q}: this market's price`);
    assert.equal(row.item.name, "Azure Silk Gloves");
  }
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, q: "Azure Silk Gloves", now: NOW })), ["Azure Silk Gloves"]);
  assert.equal(searchMarket({ marketKey: GAME.marketKey, q: "silk", now: NOW }).results[0].item.name, "Silk Cloth", "names starting with the text first");
}));

test("items with no auctions are found; none listed and not known are different", () => withHttpApp(async () => {
  seed();
  // In-game market: never seen complete, so absence proves nothing.
  const game = searchMarket({ marketKey: GAME.marketKey, q: "thorium", now: NOW });
  assert.deepEqual(names(game), ["Thorium Bar"]);
  assert.equal(game.results[0].listing, "unknown");
  assert.equal(game.results[0].minUnitBuyout, null, "no price borrowed from the API house");
  assert.equal(game.coverage.complete, false);
  assert.match(game.results[0].listingNote, /never been seen complete/);
  // API house: a complete view without it means none listed.
  const api = searchMarket({ marketKey: API.marketKey, q: "peacebloom", now: NOW });
  assert.equal(api.results[0].listing, "none_listed");
  assert.equal(api.results[0].observedAt, NOW - 900);
  assert.equal(api.coverage.complete, true);
  // A complete view that is over a day old no longer confirms anything.
  assert.equal(searchMarket({ marketKey: API.marketKey, q: "peacebloom", now: NOW + 2 * 86400 }).results[0].listing, "unknown");
  // Seen and then gone in a later complete view: none listed, from that view.
  withGuildTransaction((db) => download(db, API, [listing("i:4319", { minUnitBuyout: 31000, quantity: 1 })], NOW - 300));
  const gone = searchMarket({ marketKey: API.marketKey, q: "thorium bar", now: NOW });
  assert.equal(gone.results[0].listing, "none_listed");
  assert.equal(gone.results[0].minUnitBuyout, null);
  // Listed only: catalog matches without listings are left out.
  const all = searchMarket({ marketKey: GAME.marketKey, q: "cloth", now: NOW });
  assert.deepEqual(names(all), ["Linen Cloth", "Silk Cloth"]);
  const listedOnly = searchMarket({ marketKey: API.marketKey, q: "cloth", listedOnly: true, now: NOW });
  assert.deepEqual(names(listedOnly), ["Linen Cloth"]);
  assert.equal(searchMarket({ marketKey: API.marketKey, q: "cloth", now: NOW }).total, 2, "Silk Cloth without listings is still found");
}));

test("listings in search results belong to the selected market and the exact variant", () => withHttpApp(async () => {
  seed();
  const prices = Object.fromEntries([GAME, API, HORDE].map((market) => [market.marketKey, searchMarket({ marketKey: market.marketKey, q: "azure silk gloves", now: NOW }).results[0].minUnitBuyout]));
  assert.deepEqual(prices, { [GAME.marketKey]: 25000, [API.marketKey]: 31000, [HORDE.marketKey]: 99999 }, "each market its own price; changing market changes them");
  const chest = searchMarket({ marketKey: GAME.marketKey, q: "raiders chestpiece", now: NOW });
  assert.deepEqual(chest.results.map((row) => [row.itemKey, row.minUnitBuyout]), [["i:15210:s-1081", 50000], ["i:15210:s-1082", 9000]], "one row per variant at its own price");
  assert.ok(chest.results.every((row) => row.listing === "listed"));
  const bear = searchMarket({ marketKey: GAME.marketKey, q: "of the bear", now: NOW });
  assert.deepEqual(bear.results.map((row) => row.itemKey), ["i:15210:s-1081"], "a variant by its own name, without its sibling");
  const elsewhere = searchMarket({ marketKey: API.marketKey, q: "raiders chestpiece", now: NOW });
  assert.deepEqual(elsewhere.results.map((row) => [row.itemKey, row.minUnitBuyout, row.listing]), [[null, null, "none_listed"]], "no variant price leaks into another market");
  assert.equal(readPrices({ marketKey: GAME.marketKey, itemIds: [15210], now: NOW }).prices[0].minUnitBuyout, null, "the base item never borrows a variant's price");
}));

test("no match, filters, sorting and paging in a search", () => withHttpApp(async () => {
  seed();
  const none = searchMarket({ marketKey: GAME.marketKey, q: "xyzzy plugh", now: NOW });
  assert.equal(none.total, 0);
  assert.deepEqual(none.results, []);
  assert.equal(searchMarket({ marketKey: GAME.marketKey, q: "999999", now: NOW }).total, 0, "an unknown id is not invented");
  // Category filters apply to catalog matches too.
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, q: "cloth", category: "armor", now: NOW })), []);
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, q: "silk", category: "armor", subcategory: "cloth", now: NOW })), ["Azure Silk Gloves"]);
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, q: "silk", quality: 2, now: NOW })), ["Azure Silk Gloves"]);
  // Sorting by price keeps listed rows first in both directions.
  const byPrice = searchMarket({ marketKey: API.marketKey, q: "o", sort: "price", direction: "desc", now: NOW });
  assert.equal(byPrice.results[0].listing, "listed");
  assert.ok(byPrice.results.findIndex((row) => row.listing !== "listed") > byPrice.results.findLastIndex((row) => row.listing === "listed"));
  const page = searchMarket({ marketKey: GAME.marketKey, q: "e", pageSize: 10, page: 1, now: NOW });
  assert.ok(page.total > page.results.length || page.total <= 10);
  assert.equal(searchMarket({ marketKey: "api:us:house-999", q: "silk" }), null, "an unknown market is not swapped for another");
}));

test("browse shows this market's listings only, by category; never catalog entries", () => withHttpApp(async () => {
  seed();
  const browse = searchMarket({ marketKey: GAME.marketKey, now: NOW });
  assert.equal(browse.mode, "browse");
  assert.ok(browse.results.every((row) => row.listing === "listed" && row.minUnitBuyout !== null));
  assert.ok(!names(browse).includes("Thorium Bar"));
  const cloth = searchMarket({ marketKey: GAME.marketKey, category: "trade-goods", subcategory: "cloth", now: NOW });
  assert.deepEqual(names(cloth), ["Linen Cloth", "Silk Cloth"]);
  const metal = searchMarket({ marketKey: GAME.marketKey, category: "trade-goods", subcategory: "metal-stone", now: NOW });
  assert.deepEqual(names(metal), ["Copper Ore"]);
  const armor = searchMarket({ marketKey: GAME.marketKey, category: "Armor", now: NOW });
  assert.deepEqual(names(armor).sort(), ["Azure Silk Gloves", "Raider's Chestpiece of the Bear", "Raider's Chestpiece of the Eagle"]);
  const tree = browse.categories;
  assert.equal(tree.length, 10);
  assert.equal(tree.find((entry) => entry.key === "trade-goods").subcategories.find((entry) => entry.key === "cloth").items, 2);
  assert.equal(tree.find((entry) => entry.key === "weapons").items, 0, "listed nowhere, still shown");
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, category: "trade-goods", subcategory: "nonsense", now: NOW })), []);
}));

test("suggestions: names starting with the text first, any known item, prices from the selected market only", () => withHttpApp(async () => {
  seed();
  const silk = suggestItems({ q: "silk", marketKey: GAME.marketKey, now: NOW }).suggestions;
  assert.equal(silk[0].name, "Silk Cloth");
  assert.ok(silk.some((entry) => entry.name === "Azure Silk Gloves"));
  const thorium = suggestItems({ q: "thor", marketKey: GAME.marketKey, now: NOW }).suggestions[0];
  assert.deepEqual([thorium.name, thorium.listed, thorium.minUnitBuyout], ["Thorium Bar", false, null], "listed in the API house, not here");
  assert.equal(suggestItems({ q: "thor", marketKey: API.marketKey, now: NOW }).suggestions[0].minUnitBuyout, 1500);
  assert.equal(suggestItems({ q: "thor", now: NOW }).suggestions[0].minUnitBuyout, null, "no market, no price: never one market's price for another");
  const chest = suggestItems({ q: "raider", marketKey: GAME.marketKey, now: NOW }).suggestions[0];
  assert.deepEqual([chest.listed, chest.priced, chest.variants], [true, false, 2], "variants counted, never priced as the item");
  assert.equal(suggestItems({ q: "4319", marketKey: GAME.marketKey, now: NOW }).suggestions[0].name, "Azure Silk Gloves");
  assert.deepEqual(suggestItems({ q: "a", marketKey: GAME.marketKey, now: NOW }).suggestions, []);
}));

test("the item index follows the catalog: Blizzard item data becomes searchable with its class", () => withHttpApp(async () => {
  seed();
  withGuildTransaction((db) => {
    upsertGameDataEntityInDatabase(db, { type: "item", id: 7078, name: "Essence of Fire", qualityId: 2, source: "blizzard", locale: "en_US",
      metadata: { itemClassId: 7, itemClassName: "Trade Goods", itemSubclassId: 10, itemSubclassName: "Elemental", requiredLevel: 0 } });
  });
  const found = searchMarket({ marketKey: GAME.marketKey, q: "essence of fire", now: NOW });
  assert.deepEqual(names(found), ["Essence of Fire"], "indexed on first search, not a day later");
  assert.equal(found.results[0].listing, "unknown");
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, q: "essence", category: "trade-goods", subcategory: "elemental", now: NOW })), ["Essence of Fire"]);
  withGuildTransaction((db) => {
    // A player's scan never renames an item the game data named.
    scan(db, GAME, [listing("i:7078", { name: "Essence of Fyre" })]);
    const sync = syncMarketCatalogInDatabase(db, { now: NOW });
    assert.equal(sync.caughtUp, true);
  });
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT name, name_source, search_name FROM market_item_meta WHERE item_id = 7078").get()).name, "Essence of Fire");
  // A scan-only name (no game data yet) is searchable too, until game data names it.
  withGuildTransaction((db) => scan(db, GAME, [listing("i:99001", { name: "Mystery Box" })]));
  assert.deepEqual(names(searchMarket({ marketKey: GAME.marketKey, q: "mystery", now: NOW })), ["Mystery Box"]);
}));

test("an item opened from search: its tooltip, its listing state, and the market it is from", () => withHttpApp(async () => {
  seed();
  const listed = readItemMarket({ itemId: 4319, marketKey: GAME.marketKey, now: NOW });
  assert.equal(listed.listing, "listed");
  assert.equal(listed.market.name, GAME.name);
  assert.equal(listed.market.chosen, "requested");
  assert.deepEqual(listed.item.tooltipLines.map((line) => line.left), ["Azure Silk Gloves", "Binds when equipped", "Hands"]);
  assert.equal(listed.variants[0].minUnitBuyout, 25000);
  const unknown = readItemMarket({ itemId: 12359, marketKey: GAME.marketKey, now: NOW });
  assert.deepEqual([unknown.listing, unknown.variants.length], ["unknown", 0], "never the API house's price");
  assert.equal(readItemMarket({ itemId: 2447, marketKey: API.marketKey, now: NOW }).listing, "none_listed");
  assert.equal(readItemMarket({ itemId: 12359, now: NOW }).market.chosen, "server", "a market the server picked is said so");
  assert.deepEqual(readItemMarket({ itemId: 2770, marketKey: GAME.marketKey, now: NOW }).item.tooltipLines, [], "no description is ever made up");
}));

test("the search API: signed in only, parameters passed through, bounded", () => withHttpApp(async ({ request }) => {
  seed();
  assert.equal((await request("/api/market/search?market=game:us:normal:alliance&q=azure")).status, 401);
  const response = await request(`/api/market/search?market=${encodeURIComponent(GAME.marketKey)}&q=${encodeURIComponent("Azure Silk")}&listed=1&sort=price&dir=desc`, { persona: "member" });
  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "search");
  assert.equal(response.json.filters.listedOnly, true);
  assert.equal(response.json.results[0].item.itemId, 4319);
  const category = await request(`/api/market/search?market=${encodeURIComponent(GAME.marketKey)}&category=trade-goods&sub=cloth`, { persona: "member" });
  assert.deepEqual(category.json.results.map((row) => row.item.name), ["Linen Cloth", "Silk Cloth"]);
  const suggest = await request(`/api/market/suggest?market=${encodeURIComponent(GAME.marketKey)}&q=azu`, { persona: "member" });
  assert.equal(suggest.json.suggestions[0].itemId, 4319);
  const long = await request(`/api/market/search?market=${encodeURIComponent(GAME.marketKey)}&q=${"a".repeat(5000)}`, { persona: "member" });
  assert.equal(long.status, 200);
}));

test("searching tens of thousands of catalog items stays fast", () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
      VALUES (?, '70338', 'en_US', ?, 1, NULL, ?, '2026-11-01')`);
    for (let id = 1; id <= 40000; id += 1) insert.run(id, `Catalog Item ${id}`, JSON.stringify({ itemClass: { id: id % 16, name: "" }, itemSubclass: { id: id % 7, name: "" } }));
    const items = [];
    for (let id = 1; id <= 20000; id += 2) items.push(listing(`i:${id}`, { minUnitBuyout: 100 + (id % 997) }));
    scan(db, GAME, items);
    let caughtUp = false;
    while (!caughtUp) caughtUp = syncMarketCatalogInDatabase(db, { now: NOW }).caughtUp;
  });
  const started = performance.now();
  const queries = [{ q: "catalog item 1234" }, { q: "item", sort: "price" }, { q: "37" }, { q: "catalog", listedOnly: true, page: 50 }, { category: "trade-goods" }];
  for (const query of queries) searchMarket({ marketKey: GAME.marketKey, now: NOW, ...query });
  const average = (performance.now() - started) / queries.length;
  assert.ok(average < 400, `a search takes ${Math.round(average)} ms`);
  const suggestStart = performance.now();
  for (const q of ["cat", "catalog item 3", "item 39"]) suggestItems({ q, marketKey: GAME.marketKey, now: NOW });
  assert.ok((performance.now() - suggestStart) / 3 < 100, "suggestions stay quick");
}));
