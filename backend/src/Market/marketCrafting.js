import { withGuildDatabase } from "../Data/database.js";
import { positiveInteger } from "./marketModel.js";
import { readPricesInDatabase } from "./marketRepository.js";

// Auction house cut on a sale: 5% on faction houses, 15% on the neutral
// (Blackwater) houses, as in Classic. The deposit depends on the item's
// vendor price and the listing duration and is lost only when an auction
// expires, so it is not part of the margin.
export const AH_CUT = Object.freeze({ faction: 0.05, neutral: 0.15 });

function recipeFromRow(row) {
  let raw = {};
  try { raw = JSON.parse(row.definition_json); } catch { raw = {}; }
  return {
    recipeId: row.recipe_id, name: raw.name || `Recipe ${row.recipe_id}`, professionName: raw.professionName || null,
    craftedItemId: row.crafted_item_id, minQuantity: positiveInteger(raw.minQuantity) || 1, maxQuantity: positiveInteger(raw.maxQuantity) || positiveInteger(raw.minQuantity) || 1,
    reagents: (Array.isArray(raw.reagents) ? raw.reagents : []).map((entry) => ({ itemId: positiveInteger(entry?.itemId), quantity: positiveInteger(entry?.quantity), optional: entry?.optional === true }))
      .filter((entry) => entry.itemId && entry.quantity),
  };
}

function unitCost(price) {
  return price ? (price.minUnitBuyout ?? price.typicalUnitBuyout ?? null) : null;
}

// One recipe's material cost and estimated margin in one market. A margin is
// only given when every required reagent and the crafted item have prices;
// otherwise the missing items are listed instead.
export function craftCost(recipe, prices, { neutral = false } = {}) {
  const reagents = recipe.reagents.map((reagent) => {
    const price = prices.get(reagent.itemId) || null;
    const unit = unitCost(price);
    return { ...reagent, unitPrice: unit, cost: unit === null ? null : unit * reagent.quantity, stale: price?.stale ?? null, source: price?.source ?? null };
  });
  const required = reagents.filter((entry) => !entry.optional);
  const missing = required.filter((entry) => entry.cost === null).map((entry) => entry.itemId);
  const stale = required.filter((entry) => entry.stale).map((entry) => entry.itemId);
  const materialCost = missing.length ? null : required.reduce((sum, entry) => sum + entry.cost, 0);
  const crafted = prices.get(recipe.craftedItemId) || null;
  const salePrice = crafted ? (crafted.typicalUnitBuyout ?? crafted.minUnitBuyout) : null;
  const averageQuantity = (recipe.minQuantity + recipe.maxQuantity) / 2;
  const cut = neutral ? AH_CUT.neutral : AH_CUT.faction;
  const revenue = salePrice === null ? null : Math.floor(salePrice * averageQuantity * (1 - cut));
  const margin = materialCost === null || revenue === null ? null : revenue - materialCost;
  return {
    recipeId: recipe.recipeId, name: recipe.name, professionName: recipe.professionName, craftedItemId: recipe.craftedItemId,
    craftedQuantity: { min: recipe.minQuantity, max: recipe.maxQuantity }, reagents, materialCost, salePrice, revenueAfterCut: revenue,
    auctionCut: cut, margin, marginPct: margin === null || !materialCost ? null : Math.round((margin / materialCost) * 1000) / 10,
    missingPrices: [...missing, ...(salePrice === null ? [recipe.craftedItemId] : [])], stalePrices: [...stale, ...(crafted?.stale ? [recipe.craftedItemId] : [])],
    note: margin === null ? "Not enough prices to estimate a margin." : "Estimate: lowest reagent asks, typical asking price for the result, after the auction cut. Deposit and failed sales not included.",
  };
}

// Craft costs for the recipes that make an item, or a list of recipe ids.
export function readCraftCosts({ marketKey, itemId = null, recipeIds = [] }) {
  return withGuildDatabase((db) => {
    const market = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(String(marketKey || ""));
    let rows = [];
    if (positiveInteger(itemId)) {
      rows = db.prepare(`SELECT *, MAX(captured_at) AS newest FROM public_game_recipes WHERE crafted_item_id = ? GROUP BY recipe_id LIMIT 20`).all(positiveInteger(itemId));
    } else {
      const ids = recipeIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 50);
      if (ids.length) rows = db.prepare(`SELECT *, MAX(captured_at) AS newest FROM public_game_recipes WHERE recipe_id IN (${ids.map(() => "?").join(",")}) GROUP BY recipe_id`).all(...ids);
    }
    const recipes = rows.map(recipeFromRow);
    const ids = recipes.flatMap((recipe) => [recipe.craftedItemId, ...recipe.reagents.map((entry) => entry.itemId)]);
    const prices = market ? readPricesInDatabase(db, { marketKey: market.market_key, itemIds: ids }) : new Map();
    const names = new Map(ids.length ? db.prepare(`SELECT item_id, name, quality_id, icon_file_id FROM public_game_items WHERE item_id IN (${[...new Set(ids)].map(() => "?").join(",")})`)
      .all(...new Set(ids)).map((row) => [row.item_id, { itemId: row.item_id, name: row.name, qualityId: row.quality_id, iconFileDataId: row.icon_file_id }]) : []);
    return {
      marketKey: market?.market_key || null,
      items: Object.fromEntries([...new Set(ids)].map((id) => [id, names.get(id) || { itemId: id, name: `Item ${id}` }])),
      recipes: recipes.map((recipe) => craftCost(recipe, prices, { neutral: market?.faction === "neutral" })),
    };
  });
}
