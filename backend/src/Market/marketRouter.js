import { Router } from "express";

import { requireAuthenticated, requirePermission } from "../Auth/permissions.js";
import { readCraftCosts } from "./marketCrafting.js";
import {
  createShoppingList,
  deleteSavedSearch,
  deleteShoppingList,
  favoriteIds,
  readFavorites,
  readSavedSearches,
  readShoppingLists,
  removeShoppingListItem,
  saveSearch,
  setFavorite,
  setFavoriteAlert,
  updateShoppingList,
  upsertShoppingListItem,
} from "./marketPersonalRepository.js";
import {
  noteItemInterest,

  readItemMarket,
  readItemAnalysis,
  readItemSeries,
  readMarketDiagnostics,
  readMarkets,
  readPrices,
  searchMarket,
  setMarketLink,
  suggestItems,
} from "./marketRepository.js";

const STATUS_CODES = { invalid: 400, limit: 409, "not-found": 404, conflict: 409 };

// Mounted at /api/market. Market data (prices, history) is shared by every
// signed-in player and names no one. Favorites, shopping lists and saved
// searches belong to the signed-in account: the account always comes from
// the session, so there is no way to read or change another player's.
export function createMarketRouter({ refresher = null, providerConfig = null } = {}) {
  const router = Router();
  router.use(requireAuthenticated, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const owner = (req) => req.auth.user.id;
  const market = (req) => String(req.query?.market || "").slice(0, 160);

  function read(name, fn) {
    return (req, res) => {
      try {
        const result = fn(req);
        if (result === null) {
          res.status(404).json({ error: `market_${name}_not_found` });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error(`Unable to read market ${name}`, error);
        res.status(500).json({ error: `market_${name}_unavailable` });
      }
    };
  }

  function write(name, fn) {
    return (req, res) => {
      try {
        const result = fn(req);
        const code = STATUS_CODES[result.status];
        if (code) {
          res.status(code).json({ error: `market_${name}_${result.status.replace("-", "_")}`, ...(result.reason ? { reason: result.reason } : {}),
            ...(result.realms ? { realms: result.realms } : {}) });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error(`Unable to change market ${name}`, error);
        res.status(500).json({ error: `market_${name}_failed` });
      }
    };
  }

  router.get("/markets", read("markets", () => readMarkets()));
  // Browse (no q: this market's listings) or search (q: every known item
  // that matches, with this market's listings where there are any; listed=1
  // leaves out items with none). Categories are keys of marketCategories.js.
  const param = (req, name, max = 100) => String(req.query?.[name] ?? "").slice(0, max);
  router.get("/search", read("search", (req) => searchMarket({
    marketKey: market(req), q: param(req, "q"), category: param(req, "category", 80), subcategory: param(req, "sub", 80), quality: param(req, "quality", 2),
    minLevel: param(req, "minLevel", 4), maxLevel: param(req, "maxLevel", 4), minItemLevel: param(req, "minIlvl", 4), maxItemLevel: param(req, "maxIlvl", 4),
    belowMarket: req.query?.below === "1", includeEmpty: req.query?.empty === "1", listedOnly: req.query?.listed === "1", sort: param(req, "sort", 20),
    direction: param(req, "dir", 4), page: param(req, "page", 6), pageSize: param(req, "pageSize", 4),
  })));
  router.get("/suggest", read("suggest", (req) => suggestItems({ q: String(req.query?.q ?? "").slice(0, 60), marketKey: market(req) })));
  router.get("/items/:itemId", read("item", (req) => {
    const result = readItemMarket({ itemId: req.params.itemId, itemKey: String(req.query?.key || ""), marketKey: market(req) });
    if (result) {
      noteItemInterest(result.item.itemId);
      result.favorite = favoriteIds(owner(req), [result.item.itemId]).length > 0;
    }
    return result;
  }));
  // History at the resolution the range needs (24h, 7d: hourly; 30d, 90d,
  // 1y: daily; all: weekly), per market and source, with gaps left open.
  router.get("/items/:itemId/history", read("history", (req) => readItemSeries({ itemId: req.params.itemId, itemKey: String(req.query?.key || ""),
    marketKey: market(req), range: String(req.query?.range || "7d") })));
  // Metrics (medians, ranges, volatility, supply) and observations, each
  // with its window, sample count and confidence.
  router.get("/items/:itemId/analysis", read("analysis", (req) => readItemAnalysis({ itemId: req.params.itemId, itemKey: String(req.query?.key || ""), marketKey: market(req) })));
  router.get("/items/:itemId/crafting", read("crafting", (req) => readCraftCosts({ marketKey: market(req), itemId: req.params.itemId })));
  // Prices for many items at once: recipes, dungeon loot, wishlists.
  // By item id (base item; variant-only items list their variants) or by
  // exact variant key ("i:15210:s-1081"), for tooltips that know the variant.
  router.get("/prices", read("prices", (req) => readPrices({ marketKey: market(req), itemIds: String(req.query?.items || "").split(",").slice(0, 500),
    itemKeys: String(req.query?.keys || "").split(",").filter(Boolean).slice(0, 500) })));
  router.get("/crafting", read("crafting", (req) => readCraftCosts({ marketKey: market(req), recipeIds: String(req.query?.recipes || "").split(",") })));

  router.get("/favorites", read("favorites", (req) => readFavorites({ memberId: owner(req), marketKey: market(req) })));
  router.put("/favorites/:itemId", write("favorite", (req) => setFavorite({ memberId: owner(req), itemId: req.params.itemId, favorite: true })));
  router.delete("/favorites/:itemId", write("favorite", (req) => setFavorite({ memberId: owner(req), itemId: req.params.itemId, favorite: false })));
  // Target prices kept with a favorite, for alerts later. Nothing is sent yet.
  router.patch("/favorites/:itemId", write("favorite", (req) => setFavoriteAlert({ memberId: owner(req), itemId: req.params.itemId,
    below: req.body?.alertBelow, above: req.body?.alertAbove })));

  router.get("/lists", read("lists", (req) => readShoppingLists({ memberId: owner(req), marketKey: market(req) })));
  router.post("/lists", write("list", (req) => createShoppingList({ memberId: owner(req), name: req.body?.name, purpose: req.body?.purpose })));
  router.patch("/lists/:listId", write("list", (req) => updateShoppingList({ memberId: owner(req), listId: req.params.listId,
    name: req.body?.name, purpose: req.body?.purpose, position: req.body?.position })));
  router.delete("/lists/:listId", write("list", (req) => deleteShoppingList({ memberId: owner(req), listId: req.params.listId })));
  router.put("/lists/:listId/items/:itemId", write("list_item", (req) => upsertShoppingListItem({ memberId: owner(req), listId: req.params.listId,
    itemId: req.params.itemId, quantity: req.body?.quantity, purchased: req.body?.purchased, note: req.body?.note })));
  router.delete("/lists/:listId/items/:itemId", write("list_item", (req) => removeShoppingListItem({ memberId: owner(req), listId: req.params.listId, itemId: req.params.itemId })));

  router.get("/searches", read("searches", (req) => readSavedSearches({ memberId: owner(req) })));
  router.post("/searches", write("search", (req) => saveSearch({ memberId: owner(req), name: req.body?.name, query: req.body?.query })));
  router.delete("/searches/:searchId", write("search", (req) => deleteSavedSearch({ memberId: owner(req), searchId: req.params.searchId })));

  // Administrators: provider status, and linking an in-game market to the
  // API house it is (only someone who checked can say so).
  router.get("/admin/status", requirePermission("site.admin"), read("status", () => ({
    provider: refresher ? refresher.stats() : null, ...readMarkets(),
  })));
  router.get("/admin/diagnostics", requirePermission("site.admin"), read("diagnostics", () => readMarketDiagnostics({
    refresherStats: refresher ? refresher.stats() : null, providerConfig,
  })));
  router.post("/admin/links", requirePermission("site.admin"), write("link", (req) => setMarketLink({ marketKey: req.body?.marketKey,
    linkedMarketKey: req.body?.linkedMarketKey, shared: req.body?.shared === true })));

  return router;
}
