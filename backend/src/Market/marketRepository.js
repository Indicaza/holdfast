import { createHash } from "node:crypto";

import { withGuildDatabase } from "../Data/database.js";
import {
  COVERAGES,
  MAX_ITEMS_PER_SNAPSHOT,
  SOURCE_TYPES,
  confidence,
  freshness,
  positiveInteger,
  selectObservation,
} from "./marketModel.js";

export const OBSERVATION_RETENTION_SECONDS = 14 * 86400;
export const HISTORY_RETENTION_DAYS = 730;
const RUN_RETENTION_SECONDS = 30 * 86400;

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function dayOf(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function ensureMarketInDatabase(db, market) {
  db.prepare(`INSERT INTO market_markets (market_key, kind, region, ruleset_id, house_id, realm, faction, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_key) DO UPDATE SET name = excluded.name,
      ruleset_id = COALESCE(market_markets.ruleset_id, excluded.ruleset_id)`)
    .run(market.marketKey, market.kind, market.region, market.rulesetId ?? null, market.houseId ?? null,
      text(market.realm, 80), market.faction || "", text(market.name, 120) || market.marketKey, new Date().toISOString());
}

function snapshotHash(items) {
  const hash = createHash("sha256");
  for (const item of [...items].sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0))) {
    hash.update(`${item.itemKey}|${item.minUnitBuyout}|${item.typicalUnitBuyout}|${item.quantity}|${item.listings}|${item.minUnitBid}\n`);
  }
  return hash.digest("hex");
}

// The markets whose observations count toward `marketKey`'s summary: the
// market itself and any market an administrator linked to it.
function contributingMarkets(db, marketKey) {
  return [marketKey, ...db.prepare("SELECT market_key FROM market_markets WHERE linked_market_key = ?").all(marketKey).map((row) => row.market_key)];
}

// Statements for refreshing many summaries of one market, prepared once.
function summaryRefresher(db, marketKey, now) {
  const markets = contributingMarkets(db, marketKey);
  const placeholders = markets.map(() => "?").join(", ");
  const candidatesStatement = db.prepare(`SELECT * FROM market_observations WHERE market_key IN (${placeholders}) AND item_key = ?
    ORDER BY observed_at DESC LIMIT 30`);
  const previousStatement = db.prepare(`SELECT typical_unit_buyout, min_unit_buyout FROM market_history
    WHERE market_key = ? AND item_key = ? AND day < ? ORDER BY day DESC LIMIT 1`);
  const upsert = db.prepare(`INSERT INTO market_summaries (market_key, item_key, item_id, source_type, snapshot_id, complete, observed_at,
      min_unit_buyout, typical_unit_buyout, quantity, listings, selection_reason, conflict, change_24h_pct, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_key, item_key) DO UPDATE SET item_id = excluded.item_id, source_type = excluded.source_type,
      snapshot_id = excluded.snapshot_id, complete = excluded.complete, observed_at = excluded.observed_at,
      min_unit_buyout = excluded.min_unit_buyout, typical_unit_buyout = excluded.typical_unit_buyout,
      quantity = excluded.quantity, listings = excluded.listings, selection_reason = excluded.selection_reason,
      conflict = excluded.conflict, change_24h_pct = excluded.change_24h_pct, updated_at = excluded.updated_at`);
  const updatedAt = new Date(now * 1000).toISOString();
  return (itemKey, itemId) => {
    // The latest complete and the latest partial observation of each source.
    const seen = new Set();
    const candidates = [];
    for (const row of candidatesStatement.all(...markets, itemKey)) {
      const key = `${row.source_type}:${row.complete}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        sourceType: row.source_type, snapshotId: row.snapshot_id, marketKey: row.market_key, complete: row.complete === 1,
        observedAt: row.observed_at, minUnitBuyout: row.min_unit_buyout, typicalUnitBuyout: row.typical_unit_buyout,
        maxUnitBuyout: row.max_unit_buyout, quantity: row.quantity, listings: row.listings,
      });
    }
    const selection = selectObservation(candidates, { now });
    if (!selection) return;
    const chosen = selection.chosen;
    const previous = previousStatement.get(marketKey, itemKey, dayOf(chosen.observedAt));
    const before = previous ? (previous.typical_unit_buyout ?? previous.min_unit_buyout) : null;
    const current = chosen.typicalUnitBuyout ?? chosen.minUnitBuyout;
    const change = before && current ? Math.round(((current - before) / before) * 1000) / 10 : null;
    upsert.run(marketKey, itemKey, itemId, chosen.sourceType, chosen.snapshotId, chosen.complete ? 1 : 0, chosen.observedAt,
      chosen.minUnitBuyout, chosen.typicalUnitBuyout, chosen.quantity, chosen.listings, selection.reason,
      selection.conflict ? 1 : 0, change, updatedAt);
  };
}

// Starts a snapshot: checks it and stores its row. A snapshot with the same
// content as one already stored for the market and source is a duplicate
// (a retry, a re-sent scan) and changes nothing.
export function beginMarketSnapshotInDatabase(db, { market, sourceType, sourceId, coverage, observedAt, contributor = "", items, now = nowSeconds() }) {
  if (!SOURCE_TYPES.includes(sourceType) || !COVERAGES.includes(coverage)) return { status: "invalid" };
  const at = positiveInteger(observedAt);
  if (!at || at > now + 300) return { status: "invalid" };
  const rows = (items || []).filter((item) => item && item.itemKey && Number.isSafeInteger(item.quantity)).slice(0, MAX_ITEMS_PER_SNAPSHOT);
  if (!rows.length) return { status: "empty" };
  ensureMarketInDatabase(db, market);
  const inserted = db.prepare(`INSERT OR IGNORE INTO market_snapshots (market_key, source_type, source_id, coverage, content_hash,
      contributor_key, observed_at, ingested_at, item_count, listing_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(market.marketKey, sourceType, text(sourceId, 120), coverage, snapshotHash(rows), text(contributor, 80), at, new Date(now * 1000).toISOString(),
      rows.length, rows.reduce((sum, item) => sum + (item.listings || 0), 0));
  if (!inserted.changes) return { status: "duplicate" };
  db.prepare("UPDATE market_markets SET last_snapshot_at = MAX(COALESCE(last_snapshot_at, 0), ?) WHERE market_key = ?").run(at, market.marketKey);
  return { status: "recorded", snapshotId: Number(inserted.lastInsertRowid), items: rows };
}

// Stores part of a snapshot's items: raw per-item aggregates, a daily
// history row per item, and refreshed summaries.
export function addMarketSnapshotItemsInDatabase(db, { snapshotId, market, sourceType, coverage, observedAt, items, now = nowSeconds() }) {
  const insertObservation = db.prepare(`INSERT OR REPLACE INTO market_observations (snapshot_id, market_key, item_key, item_id, source_type,
      complete, observed_at, min_unit_buyout, typical_unit_buyout, max_unit_buyout, min_unit_bid, quantity, listings, bid_only_listings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const history = db.prepare(`INSERT INTO market_history (market_key, item_key, day, source_type, min_unit_buyout, typical_unit_buyout,
      max_quantity, max_listings, samples) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(market_key, item_key, day, source_type) DO UPDATE SET
      min_unit_buyout = CASE WHEN market_history.min_unit_buyout IS NULL THEN excluded.min_unit_buyout
        WHEN excluded.min_unit_buyout IS NULL THEN market_history.min_unit_buyout
        ELSE MIN(market_history.min_unit_buyout, excluded.min_unit_buyout) END,
      typical_unit_buyout = COALESCE(excluded.typical_unit_buyout, market_history.typical_unit_buyout),
      max_quantity = MAX(market_history.max_quantity, excluded.max_quantity),
      max_listings = MAX(COALESCE(market_history.max_listings, 0), COALESCE(excluded.max_listings, 0)),
      samples = market_history.samples + 1`);
  const day = dayOf(observedAt);
  const linked = db.prepare("SELECT linked_market_key FROM market_markets WHERE market_key = ?").get(market.marketKey)?.linked_market_key;
  const refresh = summaryRefresher(db, market.marketKey, now);
  const refreshLinked = linked ? summaryRefresher(db, linked, now) : null;
  for (const item of items) {
    const complete = coverage !== "partial" && item.complete !== false ? 1 : 0;
    insertObservation.run(snapshotId, market.marketKey, item.itemKey, item.itemId, sourceType, complete, observedAt,
      item.minUnitBuyout, item.typicalUnitBuyout, item.maxUnitBuyout, item.minUnitBid, item.quantity, item.listings, item.bidOnlyListings || 0);
    // History is listing evidence only from complete views.
    if (complete) history.run(market.marketKey, item.itemKey, day, sourceType, item.minUnitBuyout, item.typicalUnitBuyout, item.quantity, item.listings);
    refresh(item.itemKey, item.itemId);
    if (refreshLinked) refreshLinked(item.itemKey, item.itemId);
  }
}

// A whole (small) snapshot in one go: in-game scans and tests.
export function recordMarketSnapshotInDatabase(db, input) {
  const begun = beginMarketSnapshotInDatabase(db, input);
  if (begun.status !== "recorded") return { status: begun.status };
  const now = input.now ?? nowSeconds();
  addMarketSnapshotItemsInDatabase(db, { ...input, snapshotId: begun.snapshotId, observedAt: positiveInteger(input.observedAt), items: begun.items, now });
  return { status: "recorded", snapshotId: begun.snapshotId, items: begun.items.length };
}

// Bounded storage: observations for 14 days, history for two years, provider
// runs for 30 days. Summaries keep their own copy of the shown values.
export function pruneMarketDataInDatabase(db, now = nowSeconds()) {
  const cutoff = now - OBSERVATION_RETENTION_SECONDS;
  const observations = db.prepare("DELETE FROM market_observations WHERE observed_at < ?").run(cutoff).changes;
  const snapshots = db.prepare("DELETE FROM market_snapshots WHERE observed_at < ?").run(cutoff).changes;
  const history = db.prepare("DELETE FROM market_history WHERE day < ?").run(dayOf(now - HISTORY_RETENTION_DAYS * 86400)).changes;
  const runs = db.prepare("DELETE FROM market_provider_runs WHERE started_at < ?").run(now - RUN_RETENTION_SECONDS).changes;
  db.prepare("DELETE FROM market_item_interest WHERE day < ?").run(dayOf(now - 30 * 86400));
  return { snapshots, observations, history, runs };
}

// Reads ------------------------------------------------------------------------

function itemNames(db, ids) {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id)))];
  const names = new Map();
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500);
    const placeholders = chunk.map(() => "?").join(",");
    for (const row of db.prepare(`SELECT item_id, name, quality_id, icon_file_id, definition_json FROM public_game_items
      WHERE item_id IN (${placeholders}) ORDER BY captured_at ASC`).all(...chunk)) {
      let definition = {};
      try { definition = JSON.parse(row.definition_json || "{}"); } catch { definition = {}; }
      names.set(row.item_id, { name: row.name, qualityId: row.quality_id, iconFileDataId: row.icon_file_id,
        sellPrice: Number.isSafeInteger(definition.sellPrice) ? definition.sellPrice : null,
        bindType: Number.isSafeInteger(definition.bindType) ? definition.bindType : null,
        stackCount: Number.isSafeInteger(definition.stackCount) ? definition.stackCount : null,
        itemClass: definition.itemClass?.name || null, itemClassId: Number.isSafeInteger(definition.itemClass?.id) ? definition.itemClass.id : null,
        itemSubclass: definition.itemSubclass?.name || null });
    }
    for (const row of db.prepare(`SELECT entity_id, name, quality_id, icon_file_id FROM game_data_catalog
      WHERE entity_type = 'item' AND entity_id IN (${placeholders}) AND name <> ''`).all(...chunk.map(String))) {
      const id = Number(row.entity_id);
      if (!names.has(id)) names.set(id, { name: row.name, qualityId: row.quality_id, iconFileDataId: row.icon_file_id });
    }
  }
  return names;
}

function itemInfo(names, itemId) {
  const known = names.get(itemId);
  return { itemId, name: known?.name || `Item ${itemId}`, nameKnown: Boolean(known?.name), qualityId: known?.qualityId ?? null,
    iconFileDataId: known?.iconFileDataId ?? null, itemClass: known?.itemClass || null, itemSubclass: known?.itemSubclass || null };
}

function summaryFromRow(row, now) {
  const fresh = freshness(row.observed_at, now);
  return {
    itemKey: row.item_key, variant: row.item_key !== `i:${row.item_id}` ? row.item_key : null,
    minUnitBuyout: row.min_unit_buyout, typicalUnitBuyout: row.typical_unit_buyout, quantity: row.quantity, listings: row.listings,
    source: row.source_type, complete: row.complete === 1, observedAt: row.observed_at, ageSeconds: fresh.ageSeconds, stale: fresh.stale,
    confidence: confidence({ complete: row.complete === 1, observedAt: row.observed_at, quantity: row.quantity, listings: row.listings }, now),
    change24hPct: row.change_24h_pct, conflict: row.conflict === 1, selectionReason: row.selection_reason,
  };
}

function marketFromRow(row, now) {
  const fresh = freshness(row.last_snapshot_at, now);
  return { marketKey: row.market_key, kind: row.kind, region: row.region, rulesetId: row.ruleset_id, houseId: row.house_id,
    realm: row.realm, faction: row.faction, name: row.name, linkedMarketKey: row.linked_market_key,
    lastSnapshotAt: row.last_snapshot_at, ageSeconds: fresh.ageSeconds, stale: fresh.stale };
}

export function readMarkets({ now = nowSeconds() } = {}) {
  return withGuildDatabase((db) => {
    const markets = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM market_summaries s WHERE s.market_key = m.market_key) AS items
      FROM market_markets m ORDER BY m.region, m.kind, m.name, m.market_key`).all();
    const providers = db.prepare(`SELECT market_key, provider, last_success_at, last_failure_at, last_error, consecutive_failures
      FROM market_provider_state`).all();
    const byMarket = new Map(providers.map((row) => [row.market_key, row]));
    return {
      markets: markets.map((row) => {
        const provider = byMarket.get(row.market_key);
        return { ...marketFromRow(row, now), items: Number(row.items),
          provider: provider ? { name: provider.provider, lastSuccessAt: provider.last_success_at, lastFailureAt: provider.last_failure_at,
            failing: provider.consecutive_failures > 0, lastError: provider.consecutive_failures > 0 ? provider.last_error : "" } : null };
      }),
    };
  });
}

const SORTS = {
  name: "name COLLATE NOCASE", price: "COALESCE(s.min_unit_buyout, 1e18)", typical: "COALESCE(s.typical_unit_buyout, 1e18)",
  quantity: "s.quantity", age: "s.observed_at", change: "COALESCE(s.change_24h_pct, 0)",
};

// Search one market's summaries by name or item id, with a category, sort
// and paging. Items whose names the website does not know yet are found by
// id only.
export function searchMarket({ marketKey, q = "", category = "", sort = "name", direction = "asc", page = 1, pageSize = 50, now = nowSeconds() }) {
  return withGuildDatabase((db) => {
    const market = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(text(marketKey, 160));
    if (!market) return null;
    const query = text(q, 100);
    const size = Math.min(100, Math.max(10, Math.trunc(Number(pageSize)) || 50));
    const current = Math.max(1, Math.trunc(Number(page)) || 1);
    const orderBy = SORTS[sort] || SORTS.name;
    const dir = direction === "desc" ? "DESC" : "ASC";
    // Names: the newest stored name per item.
    const nameSql = `(SELECT p.name FROM public_game_items p WHERE p.item_id = s.item_id ORDER BY p.captured_at DESC LIMIT 1)`;
    const catalogSql = `(SELECT c.name FROM game_data_catalog c WHERE c.entity_type = 'item' AND c.entity_id = CAST(s.item_id AS TEXT) AND c.name <> '' LIMIT 1)`;
    const classSql = `(SELECT json_extract(p.definition_json, '$.itemClass.name') FROM public_game_items p WHERE p.item_id = s.item_id AND p.definition_json <> '{}' ORDER BY p.captured_at DESC LIMIT 1)`;
    const clauses = ["s.market_key = ?"];
    const params = [market.market_key];
    if (query) {
      if (/^\d+$/.test(query)) { clauses.push("s.item_id = ?"); params.push(Number(query)); }
      else { clauses.push(`name LIKE ? ESCAPE '\\'`); params.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`); }
    }
    if (text(category, 80)) { clauses.push("item_class = ?"); params.push(text(category, 80)); }
    const base = `SELECT s.*, COALESCE(${nameSql}, ${catalogSql}, '') AS name, ${classSql} AS item_class FROM market_summaries s`;
    const where = `WHERE ${clauses.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${base}) s ${where}`).get(...params)?.n ?? 0;
    const rows = db.prepare(`SELECT * FROM (${base}) s ${where} ORDER BY ${orderBy} ${dir}, s.item_id ASC LIMIT ? OFFSET ?`)
      .all(...params, size, (current - 1) * size);
    const names = itemNames(db, rows.map((row) => row.item_id));
    const categories = db.prepare(`SELECT item_class AS name, COUNT(*) AS items FROM (SELECT ${classSql} AS item_class FROM market_summaries s WHERE s.market_key = ?)
      WHERE item_class IS NOT NULL GROUP BY item_class ORDER BY item_class`).all(market.market_key);
    return {
      market: marketFromRow(market, now), total: Number(total), page: current, pageSize: size, categories,
      results: rows.map((row) => ({ item: itemInfo(names, row.item_id), ...summaryFromRow(row, now) })),
    };
  });
}

export function suggestItems({ q = "", marketKey = "", limit = 8 }) {
  return withGuildDatabase((db) => {
    const query = text(q, 60);
    if (query.length < 2) return { suggestions: [] };
    const pattern = `${query.replace(/[\\%_]/g, "\\$&")}%`;
    const contains = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db.prepare(`SELECT item_id, name, MAX(quality_id) AS quality_id, MAX(icon_file_id) AS icon_file_id,
        (name LIKE ? ESCAPE '\\') AS prefix,
        EXISTS(SELECT 1 FROM market_summaries s WHERE s.item_id = p.item_id AND (? = '' OR s.market_key = ?)) AS priced
      FROM public_game_items p WHERE name LIKE ? ESCAPE '\\' GROUP BY item_id
      ORDER BY priced DESC, prefix DESC, LENGTH(name), name LIMIT ?`)
      .all(pattern, text(marketKey, 160), text(marketKey, 160), contains, Math.min(20, Math.max(1, Number(limit) || 8)));
    return { suggestions: rows.map((row) => ({ itemId: row.item_id, name: row.name, qualityId: row.quality_id,
      iconFileDataId: row.icon_file_id, priced: row.priced === 1 })) };
  });
}

// Every market's view of one item, and for the chosen market all of its
// variants with every source's latest observation, for the "why this
// price" explanation.
export function readItemMarket({ itemId, marketKey = "", now = nowSeconds() }) {
  const id = positiveInteger(itemId);
  if (!id) return null;
  return withGuildDatabase((db) => {
    const names = itemNames(db, [id]);
    const info = names.get(id) || {};
    const summaries = db.prepare(`SELECT s.*, m.name AS market_name, m.region, m.kind FROM market_summaries s
      JOIN market_markets m ON m.market_key = s.market_key WHERE s.item_id = ? ORDER BY s.market_key, s.item_key`).all(id);
    const selected = text(marketKey, 160) || summaries[0]?.market_key || "";
    const markets = contributingMarkets(db, selected);
    const evidence = selected ? db.prepare(`SELECT o.*, sn.coverage FROM market_observations o JOIN market_snapshots sn ON sn.id = o.snapshot_id
      WHERE o.item_id = ? AND o.market_key IN (${markets.map(() => "?").join(",")}) ORDER BY o.observed_at DESC LIMIT 20`).all(id, ...markets) : [];
    return {
      item: { ...itemInfo(names, id), sellPrice: info.sellPrice ?? null, bindType: info.bindType ?? null, stackCount: info.stackCount ?? null },
      marketKey: selected || null,
      markets: summaries.map((row) => ({ marketKey: row.market_key, marketName: row.market_name, region: row.region, kind: row.kind, ...summaryFromRow(row, now) })),
      evidence: evidence.map((row) => ({ marketKey: row.market_key, itemKey: row.item_key, source: row.source_type, coverage: row.coverage,
        complete: row.complete === 1, observedAt: row.observed_at, minUnitBuyout: row.min_unit_buyout, typicalUnitBuyout: row.typical_unit_buyout,
        maxUnitBuyout: row.max_unit_buyout, minUnitBid: row.min_unit_bid, quantity: row.quantity, listings: row.listings,
        bidOnlyListings: row.bid_only_listings })),
      basis: "Listing prices people asked for, not completed sales.",
    };
  });
}

const RANGES = { "7d": 7, "30d": 30, "90d": 90, "1y": 365, "2y": 730 };

// Daily history for one item in one market. Long ranges are thinned to at
// most ~120 points (weekly buckets) so charts stay light.
export function readItemHistory({ itemId, marketKey, range = "30d", now = nowSeconds() }) {
  const id = positiveInteger(itemId);
  const days = RANGES[range] || 30;
  if (!id) return null;
  return withGuildDatabase((db) => {
    const since = dayOf(now - days * 86400);
    const rows = db.prepare(`SELECT day, source_type, min_unit_buyout, typical_unit_buyout, max_quantity, max_listings
      FROM market_history WHERE market_key = ? AND item_key = ? AND day >= ? ORDER BY day, source_type`)
      .all(text(marketKey, 160), `i:${id}`, since);
    const step = days > 120 ? 7 : 1;
    const buckets = new Map();
    for (const row of rows) {
      const index = Math.floor((Date.parse(row.day) / 86400000) / step);
      const key = `${index}:${row.source_type}`;
      const entry = buckets.get(key) || { day: row.day, source: row.source_type, minUnitBuyout: null, typicalUnitBuyout: null, quantity: 0, listings: null };
      if (row.min_unit_buyout !== null) entry.minUnitBuyout = entry.minUnitBuyout === null ? row.min_unit_buyout : Math.min(entry.minUnitBuyout, row.min_unit_buyout);
      if (row.typical_unit_buyout !== null) entry.typicalUnitBuyout = row.typical_unit_buyout;
      entry.quantity = Math.max(entry.quantity, row.max_quantity);
      entry.listings = row.max_listings === null ? entry.listings : Math.max(entry.listings || 0, row.max_listings);
      buckets.set(key, entry);
    }
    return { itemId: id, marketKey: text(marketKey, 160), range: RANGES[range] ? range : "30d", bucketDays: step,
      basis: "Observed asking prices and supply. Disappearing listings are not counted as sales.",
      points: [...buckets.values()] };
  });
}

// Prices for many items at once (recipes, dungeon loot, shopping lists).
export function readPricesInDatabase(db, { marketKey, itemIds, now = nowSeconds() }) {
  const ids = [...new Set((itemIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500);
  const prices = new Map();
  if (!ids.length || !marketKey) return prices;
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    for (const row of db.prepare(`SELECT * FROM market_summaries WHERE market_key = ? AND item_key IN (${chunk.map(() => "?").join(",")})`)
      .all(text(marketKey, 160), ...chunk.map((id) => `i:${id}`))) prices.set(row.item_id, summaryFromRow(row, now));
  }
  return prices;
}

export function readPrices({ marketKey, itemIds, now = nowSeconds() }) {
  return withGuildDatabase((db) => {
    const prices = readPricesInDatabase(db, { marketKey, itemIds, now });
    const names = itemNames(db, [...prices.keys()]);
    return { marketKey: text(marketKey, 160), prices: [...prices.entries()].map(([itemId, price]) => ({ item: itemInfo(names, itemId), ...price })) };
  });
}

// Counts an item view toward refresh priority. Anonymous and capped per day.
export function noteItemInterest(itemId, now = nowSeconds()) {
  const id = positiveInteger(itemId);
  if (!id) return;
  withGuildDatabase((db) => db.prepare(`INSERT INTO market_item_interest (item_id, day, views) VALUES (?, ?, 1)
    ON CONFLICT(item_id, day) DO UPDATE SET views = MIN(100000, views + 1)`).run(id, dayOf(now)));
}

export function setMarketLink({ marketKey, linkedMarketKey }) {
  return withGuildDatabase((db) => db.prepare("UPDATE market_markets SET linked_market_key = ? WHERE market_key = ? AND kind = 'client_house'")
    .run(linkedMarketKey ? text(linkedMarketKey, 160) : null, text(marketKey, 160)).changes > 0);
}
