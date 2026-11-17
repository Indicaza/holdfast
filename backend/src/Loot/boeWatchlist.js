// Which Bind-on-Equip items are worth an alert when they drop: a short,
// bounded list per auction house, computed here from the Auction House's
// own summaries so the add-on never needs market data of its own.
//
// An item is on the list only when all of this holds:
// - a player's game reported it as Binds when equipped (bind type 2). Item
//   quality, a vendor price or a guess never stands in for that.
// - its price on this one market is fresh and not a low-confidence reading
//   (see marketModel.confidence).
// - the estimate is backed by more than one asking price: at least two
//   listings, or a 14-day reference price from three or more days.
// The estimate is the lowest of the lowest ask, the typical ask and the
// reference price: asking prices are not sales, so the cautious figure is
// the one to alert on. Variants ("of the Bear") are valued by their exact
// key and never lend their price to the base item.

import { withGuildDatabase } from "../Data/database.js";
import { factionForRace } from "../Dungeon/dungeonRunRepository.js";
import { clientMarketKey } from "../Market/marketModel.js";
import { summaryFromRow } from "../Market/marketRepository.js";

export const BIND_ON_EQUIP = 2;
// Nothing cheaper is sent; the add-on's own threshold starts above this.
export const BOE_FLOOR_COPPER = 10_000;
export const BOE_MAX_ITEMS = 300;
export const BOE_MAX_MARKETS = 4;
// How long the add-on may keep using a value after it was observed.
export const BOE_MAX_AGE_SECONDS = 3 * 86_400;
const CACHE_SECONDS = 300;

const cache = new Map();

export function resetBoeWatchlistCache() {
  cache.clear();
}

// The value to alert on and how far to trust it, or null when the item
// must not alert. `summary` is marketRepository.summaryFromRow's shape.
export function credibleBoeValue(summary, { bindType } = {}) {
  if (bindType !== BIND_ON_EQUIP || !summary) return null;
  if (summary.stale || summary.confidence === "low" || !(summary.quantity > 0)) return null;
  const asks = [summary.minUnitBuyout, summary.typicalUnitBuyout].filter((value) => Number.isSafeInteger(value) && value > 0);
  if (!asks.length) return null;
  const referenced = Number.isSafeInteger(summary.referencePrice) && summary.referencePrice > 0 && (summary.referenceDays ?? 0) >= 3;
  if (!referenced && !((summary.listings ?? 0) >= 2)) return null;
  const value = Math.min(...asks, ...(referenced ? [summary.referencePrice] : []));
  if (value < BOE_FLOOR_COPPER) return null;
  return { value, confidence: referenced && summary.confidence === "high" && !summary.conflict ? "high" : "medium" };
}

// The auction house a character sells on: its own faction's house on its
// own realm. Unknown faction or realm means no market, so no gold alerts,
// rather than another market's prices.
export function marketForCharacterInDatabase(db, { realm, region, race }) {
  const faction = factionForRace(race);
  const key = faction ? clientMarketKey({ region, realm, faction }) : null;
  if (!key) return null;
  const row = db.prepare("SELECT market_key, name FROM market_markets WHERE market_key = ?").get(key);
  return row ? { marketKey: row.market_key, name: row.name } : null;
}

export function boeWatchlistInDatabase(db, marketKey, { now = Math.floor(Date.now() / 1000) } = {}) {
  const cached = cache.get(marketKey);
  if (cached && now - cached.at < CACHE_SECONDS && now >= cached.at) return cached.items;
  const candidates = [];
  for (const row of db.prepare(`SELECT s.*, m.bind_type FROM market_summaries s JOIN market_item_meta m ON m.item_id = s.item_id
    WHERE s.market_key = ? AND m.bind_type = ? AND s.quantity > 0 AND COALESCE(s.min_unit_buyout, s.typical_unit_buyout, 0) >= ?
    ORDER BY COALESCE(s.min_unit_buyout, s.typical_unit_buyout) DESC LIMIT 3000`).all(marketKey, BIND_ON_EQUIP, BOE_FLOOR_COPPER)) {
    const summary = summaryFromRow(row, now);
    const estimate = credibleBoeValue(summary, { bindType: row.bind_type });
    if (estimate) candidates.push({ itemKey: row.item_key, itemId: row.item_id, value: estimate.value, observedAt: summary.observedAt, confidence: estimate.confidence });
  }
  const items = candidates.sort((a, b) => b.value - a.value || a.itemKey.localeCompare(b.itemKey)).slice(0, BOE_MAX_ITEMS);
  cache.set(marketKey, { at: now, items });
  return items;
}

export function readBoeWatchlist(marketKey, options) {
  return withGuildDatabase((db) => boeWatchlistInDatabase(db, marketKey, options));
}
