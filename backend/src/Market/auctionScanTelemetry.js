import { createHash } from "node:crypto";

import { aggregateListings, aggregateSummaryRow, clientMarketKey, copper, itemVariantKey, normalizeFaction, normalizeRegion, positiveInteger } from "./marketModel.js";
import { recordMarketSnapshotInDatabase } from "./marketRepository.js";

// auction_scan (payload schema 1): what a player's client showed of the
// auction house. Sent by the addon in chunks of at most MAX_ITEMS items.
export const MAX_ITEMS = 1000;
export const MAX_PRICE_POINTS = 20;
const QUERY_KINDS = new Set(["full", "commodity", "item", "browse"]);
const COVERAGES = new Set(["full", "items", "partial"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function luaList(value) {
  if (Array.isArray(value)) return value;
  if (isObject(value) && Object.keys(value).length === 0) return [];
  return null;
}

function validItem(item) {
  if (!isObject(item) || !positiveInteger(item.itemId) || !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 1e8) return false;
  if (item.suffix !== undefined && !Number.isSafeInteger(item.suffix)) return false;
  if (item.minUnitBuyout !== undefined && copper(item.minUnitBuyout) === null) return false;
  if (item.listings !== undefined && !(Number.isSafeInteger(item.listings) && item.listings >= 0)) return false;
  const prices = luaList(item.prices ?? []);
  if (!prices || prices.length > MAX_PRICE_POINTS) return false;
  return prices.every((point) => {
    const entry = luaList(point);
    return entry && entry.length >= 2 && copper(entry[0]) !== null && positiveInteger(entry[1]) && (entry[2] === undefined || positiveInteger(entry[2]));
  });
}

export function validAuctionScan(record) {
  const envelope = record?.envelope;
  const p = envelope?.payload;
  if (record?.kind !== "event" || !isObject(p) || p.schemaVersion !== 1) return false;
  if (typeof p.scanId !== "string" || !/^[\w:.-]{1,120}$/.test(p.scanId)) return false;
  if (!positiveInteger(p.observedAt)) return false;
  if (!isObject(p.market) || !normalizeFaction(p.market.faction)) return false;
  if (!isObject(p.query) || !QUERY_KINDS.has(p.query.kind)) return false;
  if (!COVERAGES.has(p.coverage)) return false;
  const items = luaList(p.items);
  if (!items || items.length === 0 || items.length > MAX_ITEMS || !items.every(validItem)) return false;
  return Boolean(normalizeRegion(envelope.region) && String(envelope.realm || "").trim() && envelope.installationId);
}

// Payload items → per-variant aggregates. Price points are the cheapest
// listings ([unit price, quantity, listings]); the item's own totals (all
// listings, not just the cheapest) replace the summed point quantities.
export function scanItems(payload) {
  const items = [];
  for (const raw of luaList(payload.items) || []) {
    const variant = { itemId: raw.itemId, suffix: raw.suffix || 0 };
    const points = (luaList(raw.prices ?? []) || []).map((point) => ({ ...variant, unitPrice: point[0], quantity: point[1], count: point[2] || 1 }));
    let aggregate = points.length ? aggregateListings(points)[0] : aggregateSummaryRow({ ...variant, quantity: raw.quantity, minUnitBuyout: raw.minUnitBuyout, listings: raw.listings });
    if (!aggregate) continue;
    aggregate = { ...aggregate, quantity: raw.quantity, listings: positiveInteger(raw.listings) ?? aggregate.listings,
      minUnitBuyout: copper(raw.minUnitBuyout) || aggregate.minUnitBuyout, complete: raw.complete !== false };
    if (!itemVariantKey(variant)) continue;
    items.push(aggregate);
  }
  return items;
}

export function recordAuctionScanInDatabase(db, { envelope, memberId }) {
  const p = envelope.payload;
  const region = normalizeRegion(envelope.region);
  const faction = normalizeFaction(p.market.faction);
  const marketKey = clientMarketKey({ region, realm: envelope.realm, faction });
  if (!marketKey) return { status: "invalid" };
  const realm = String(envelope.realm).trim().slice(0, 80);
  const houseName = faction === "neutral" ? "Blackwater" : faction === "alliance" ? "Alliance" : "Horde";
  return recordMarketSnapshotInDatabase(db, {
    market: { marketKey, kind: "client_house", region, realm, faction, name: `${region.toUpperCase()} ${realm} · ${houseName} (in-game)` },
    sourceType: "addon_scan", sourceId: `scan:${p.scanId}`, coverage: p.coverage, observedAt: p.observedAt,
    // Only a one-way hash: no player is ever named in market data.
    contributor: createHash("sha256").update(String(memberId)).digest("hex").slice(0, 16),
    items: scanItems(p),
  });
}
