// One place to ask about an item, for any part of Guildweaver (the Auction
// House, professions, loot, farming, and later rules and MCP tools): who the
// item is, its tooltip, what it costs on one market, how that changed, and
// where it comes from. Plain functions over the existing repositories: no
// React, no request objects, no tables of its own.
//
// Two identities are kept apart:
// - the item: a base item id, plus a random suffix or bonus lists for a
//   version ("i:15210:s-1081"). The same key everywhere.
// - the market: one auction house ("game:us:normal:alliance",
//   "api:us:house-113"). Prices always belong to one market; nothing here
//   picks a market for the caller or mixes two.
//
// Prices are asking prices people listed, never completed sales.

import { withGuildDatabase } from "../Data/database.js";
import { publicGameScopes, readPublicItem } from "../GameData/publicGameDataRepository.js";
import { costToBuy, itemVariantKey } from "../Market/marketModel.js";
import { itemsInDatabase, readItemAnalysis, readItemMarket, readItemSeries, readPricesInDatabase } from "../Market/marketRepository.js";

const MARKET_KEY = /^(game|api):[a-z0-9:._-]{1,150}$/;

// "i:15210:s-1081" → { itemKey, itemId, suffix, bonusLists }. Accepts an item
// id or a key; anything else is null.
export function parseItemKey(value) {
  const source = typeof value === "number" ? `i:${value}` : String(value ?? "").trim();
  const match = /^i:(\d+)((?::[sb][\d.-]+)*)$/.exec(/^\d+$/.test(source) ? `i:${source}` : source);
  if (!match) return null;
  const itemId = Number(match[1]);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return null;
  const suffix = Number(/:s(-?\d+)/.exec(match[2])?.[1] || 0);
  const bonusLists = (/:b([\d.]+)/.exec(match[2])?.[1] || "").split(".").filter(Boolean).map(Number);
  const itemKey = itemVariantKey({ itemId, suffix, bonusLists });
  return itemKey ? { itemKey, itemId, suffix, bonusLists, variant: itemKey !== `i:${itemId}` } : null;
}

function marketKeyOf(value) {
  const key = String(value ?? "").trim();
  return MARKET_KEY.test(key) ? key : null;
}

// The item itself: name, quality, icon, class, slot, levels, and its tooltip
// with where the tooltip came from ("game": a player's game rendered it, with
// its build; "blizzard": Blizzard's item text; null: only the facts). A
// version's tooltip is its base item's: its own bonuses are not known.
export function readItems(keys = []) {
  const parsed = keys.map(parseItemKey).filter(Boolean).slice(0, 200);
  if (!parsed.length) return [];
  return withGuildDatabase((db) => {
    const item = itemsInDatabase(db, [...new Set(parsed.map((entry) => entry.itemId))]);
    return parsed.map((key) => {
      const known = item(key.itemId);
      return {
        ...key,
        name: known.name,
        nameKnown: known.nameKnown,
        qualityId: known.qualityId,
        iconFileDataId: known.iconFileDataId ?? null,
        itemClass: known.itemClass ?? null,
        itemSubclass: known.itemSubclass ?? null,
        slotName: known.slotName || null,
        itemLevel: known.itemLevel ?? null,
        requiredLevel: known.requiredLevel ?? null,
        tooltip: { lines: known.tooltipLines || [], source: known.tooltipSource || null, gameBuild: known.tooltipBuild || null,
          versionBonusesIncluded: key.variant ? false : null },
      };
    });
  });
}

export function readItem(key) {
  return readItems([key])[0] || null;
}

// Current prices of many items on one market (the lowest buyout, typical
// buyout, quantity, auctions, freshness and source of each), keyed by item
// key. Items with nothing seen on that market are absent.
export function readMarketPrices({ marketKey, keys = [] }) {
  const market = marketKeyOf(marketKey);
  const parsed = keys.map(parseItemKey).filter(Boolean).slice(0, 500);
  if (!market || !parsed.length) return new Map();
  const itemKeys = parsed.filter((entry) => entry.variant).map((entry) => entry.itemKey);
  const itemIds = parsed.filter((entry) => !entry.variant).map((entry) => entry.itemId);
  return withGuildDatabase((db) => {
    const byKey = new Map();
    // Base items come back keyed by id, versions by key.
    for (const [key, price] of readPricesInDatabase(db, { marketKey: market, itemIds, itemKeys })) {
      byKey.set(typeof key === "number" ? `i:${key}` : key, price);
    }
    return byKey;
  });
}

// One item on one market: the listing state, its figures, every price level
// (unit price, quantity, auctions; sellers are never reported), where the
// figures came from and how old they are.
export function readItemOnMarket({ key, marketKey }) {
  const parsed = parseItemKey(key);
  const market = marketKeyOf(marketKey);
  if (!parsed || !market) return null;
  const detail = readItemMarket({ itemId: parsed.itemId, itemKey: parsed.itemKey, marketKey: market });
  if (!detail) return null;
  const here = detail.variants.find((entry) => entry.itemKey === detail.itemKey) || null;
  return {
    itemKey: detail.itemKey,
    marketKey: detail.marketKey,
    listing: detail.listing,
    listingObservedAt: detail.listingObservedAt,
    coverage: detail.coverage,
    price: here,
    ladder: detail.ladder,
    basis: detail.basis,
  };
}

// What buying a quantity of an item on one market would cost now, from its
// price levels (see costToBuy). Null when no price levels are known.
export function readCostToBuy({ key, marketKey, quantity }) {
  const depth = readItemOnMarket({ key, marketKey });
  if (!depth?.ladder?.levels?.length) return null;
  return { ...costToBuy(depth.ladder.levels, quantity), itemKey: depth.itemKey, marketKey: depth.marketKey, observedAt: depth.ladder.observedAt,
    source: depth.ladder.source, truncated: depth.ladder.truncated };
}

// Price and supply over time on one market ("24h", "7d", "30d", "90d", "1y",
// "all"), plus the derived metrics (medians, ranges, volatility, supply
// change). Missing hours stay missing.
export function readItemHistory({ key, marketKey, range = "7d" }) {
  const parsed = parseItemKey(key);
  const market = marketKeyOf(marketKey);
  if (!parsed || !market) return null;
  const series = readItemSeries({ itemId: parsed.itemId, itemKey: parsed.itemKey, marketKey: market, range });
  const analysis = readItemAnalysis({ itemId: parsed.itemId, itemKey: parsed.itemKey, marketKey: market });
  return series ? { ...series, metrics: analysis?.metrics || null, signals: analysis?.signals || [] } : null;
}

// Where an item comes from and what it makes, from what players' games
// reported publicly: recipes that create it or use it, and creatures or
// nodes it was seen to drop from. The newest game build that knows it.
export function readItemSources(key) {
  const parsed = parseItemKey(key);
  if (!parsed) return null;
  for (const scope of publicGameScopes().scopes.slice(0, 5)) {
    const found = readPublicItem(parsed.itemId, { gameBuild: scope.gameBuild, locale: scope.locale });
    if (found) {
      return { gameBuild: scope.gameBuild, locale: scope.locale, createdBy: found.createdBy, usedBy: found.usedBy, sources: found.sources,
        locations: found.locations, evidence: found.evidence };
    }
  }
  return { gameBuild: null, locale: null, createdBy: [], usedBy: [], sources: [], locations: [], evidence: null };
}

// Everything above for one item, for callers that want one answer.
export function readItemIntelligence({ key, marketKey = "", range = "7d", include = ["item", "market", "history", "sources"] }) {
  const parsed = parseItemKey(key);
  if (!parsed) return null;
  const want = new Set(include);
  const market = marketKeyOf(marketKey);
  return {
    itemKey: parsed.itemKey,
    item: want.has("item") ? readItem(parsed.itemKey) : undefined,
    market: want.has("market") && market ? readItemOnMarket({ key: parsed.itemKey, marketKey: market }) : undefined,
    history: want.has("history") && market ? readItemHistory({ key: parsed.itemKey, marketKey: market, range }) : undefined,
    sources: want.has("sources") ? readItemSources(parsed.itemKey) : undefined,
  };
}

