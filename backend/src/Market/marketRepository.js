import { createHash } from "node:crypto";

import { withGuildDatabase } from "../Data/database.js";
import { marketMetrics, marketSignals } from "./marketAnalysis.js";
import {
  COVERAGES,
  MAX_ITEMS_PER_SNAPSHOT,
  SOURCE_TYPES,
  confidence,
  freshness,
  itemIdFromKey,
  positiveInteger,
  selectObservation,
} from "./marketModel.js";
import {
  dayOf,
  pruneSeriesInDatabase,
  readMetricInputsInDatabase,
  readSeriesInDatabase,
  refreshReferencePricesInDatabase,
  rollUpWeeksInDatabase,
  seriesWriter,
} from "./marketSeries.js";

// Raw per-snapshot observations are evidence for "why this price" and for
// choosing between sources; history lives in the series tables.
export const OBSERVATION_RETENTION_SECONDS = 3 * 86400;
// Observations older than this are refused: history would be rewritten.
export const MAX_OBSERVATION_AGE_SECONDS = 7 * 86400;
const CHECK_RETENTION_SECONDS = 14 * 86400;
const RUN_RETENTION_SECONDS = 30 * 86400;
const MIN_REFERENCE_DAYS_FILTER = 5;

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function ensureMarketInDatabase(db, market) {
  db.prepare(`INSERT INTO market_markets (market_key, kind, region, ruleset_id, house_id, realm, faction, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_key) DO UPDATE SET name = excluded.name,
      ruleset_id = COALESCE(market_markets.ruleset_id, excluded.ruleset_id)`)
    .run(market.marketKey, market.kind, market.region, market.rulesetId ?? null, market.houseId ?? null,
      text(market.realm, 80), market.faction || "", text(market.name, 120) || market.marketKey, new Date().toISOString());
}

function sortedByKey(items) {
  return [...items].sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}

export function snapshotHash(items) {
  const hash = createHash("sha256");
  for (const item of sortedByKey(items)) {
    hash.update(`${item.itemKey}|${item.minUnitBuyout}|${item.minQuantity ?? ""}|${item.typicalUnitBuyout}|${item.quantity}|${item.listings}|${item.minUnitBid}\n`);
  }
  return hash.digest("hex");
}

// What a snapshot claims to have seen. A full house, one API endpoint, or
// exactly the items of one in-game search: two snapshots are only compared
// (unchanged? something missing?) when their scopes match.
export function snapshotScope({ coverage, scope = "", items = [] }) {
  if (scope) return text(scope, 80);
  if (coverage === "full") return "full";
  const hash = createHash("sha256");
  for (const item of sortedByKey(items)) hash.update(`${item.itemKey}\n`);
  return `items:${hash.digest("hex").slice(0, 32)}`;
}

// The markets that are one auction house: an API house and the in-game
// markets an administrator linked to it. Never anything else.
export function marketGroupInDatabase(db, marketKey) {
  const market = db.prepare("SELECT market_key, kind, linked_market_key FROM market_markets WHERE market_key = ?").get(marketKey);
  if (!market) return [marketKey];
  const anchor = market.kind === "client_house" && market.linked_market_key ? market.linked_market_key : market.market_key;
  const linked = db.prepare("SELECT market_key FROM market_markets WHERE linked_market_key = ? ORDER BY market_key").all(anchor).map((row) => row.market_key);
  return [...new Set([anchor, ...linked])];
}

// Item names and filters ------------------------------------------------------------

function cleanName(value) {
  return text(String(value ?? "").replace(/[\u0000-\u001f|]/g, " "), 120);
}

// Fills market_item_meta for items it does not know yet (or only knows
// from a player's scan), from the website's game data. A scan's own name,
// quality and level are a last resort.
export function ensureItemMetaInDatabase(db, items, now = nowSeconds()) {
  const wanted = new Map();
  for (const item of items) {
    const id = positiveInteger(item.itemId);
    // Prefer the base item's row (its name is the item's name).
    if (id && (!wanted.has(id) || item.itemKey === `i:${id}`)) wanted.set(id, item);
  }
  if (!wanted.size) return 0;
  const ids = [...wanted.keys()];
  const known = new Map();
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    for (const row of db.prepare(`SELECT item_id, name_source FROM market_item_meta WHERE item_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) known.set(row.item_id, row.name_source);
  }
  const missing = ids.filter((id) => !known.has(id) || known.get(id) === "" || known.get(id) === "addon");
  if (!missing.length) return 0;
  const upsert = db.prepare(`INSERT INTO market_item_meta (item_id, name, name_source, quality_id, icon_file_id, item_class, item_class_id, item_subclass,
      item_level, required_level, stack_count, sell_price, bind_type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      -- A name is only ever replaced by a name (never blanked by a lookup
      -- that found nothing new).
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END,
      name_source = CASE WHEN excluded.name <> '' THEN excluded.name_source ELSE name_source END,
      quality_id = COALESCE(excluded.quality_id, quality_id),
      icon_file_id = COALESCE(excluded.icon_file_id, icon_file_id), item_class = COALESCE(excluded.item_class, item_class),
      item_class_id = COALESCE(excluded.item_class_id, item_class_id), item_subclass = COALESCE(excluded.item_subclass, item_subclass),
      item_level = COALESCE(excluded.item_level, item_level), required_level = COALESCE(excluded.required_level, required_level),
      stack_count = COALESCE(excluded.stack_count, stack_count), sell_price = COALESCE(excluded.sell_price, sell_price),
      bind_type = COALESCE(excluded.bind_type, bind_type), updated_at = excluded.updated_at`);
  const integer = (value) => (Number.isSafeInteger(Number(value)) && value !== null && value !== "" ? Number(value) : null);
  let written = 0;
  for (let start = 0; start < missing.length; start += 500) {
    const chunk = missing.slice(start, start + 500);
    const placeholders = chunk.map(() => "?").join(",");
    const game = new Map();
    for (const row of db.prepare(`SELECT item_id, name, quality_id, icon_file_id, definition_json FROM public_game_items
      WHERE item_id IN (${placeholders}) ORDER BY captured_at ASC`).all(...chunk)) game.set(row.item_id, row);
    const catalog = new Map();
    for (const row of db.prepare(`SELECT entity_id, name, quality_id, icon_file_id, metadata_json FROM game_data_catalog
      WHERE entity_type = 'item' AND entity_id IN (${placeholders}) AND name <> '' ORDER BY source_priority ASC`).all(...chunk.map(String))) catalog.set(Number(row.entity_id), row);
    for (const id of chunk) {
      const row = game.get(id);
      const cat = catalog.get(id);
      const scan = wanted.get(id) || {};
      const definition = row ? json(row.definition_json || "{}", {}) : {};
      const meta = cat ? json(cat.metadata_json || "{}", {}) : {};
      const name = cleanName(row?.name || cat?.name || "");
      // A variant's name ("… of the Bear") is not the item's name.
      const scanName = scan.itemKey && scan.itemKey !== `i:${id}` ? "" : cleanName(scan.name);
      upsert.run(id, name || scanName, name ? "game" : scanName ? "addon" : "",
        integer(row?.quality_id ?? cat?.quality_id ?? scan.qualityId), integer(row?.icon_file_id ?? cat?.icon_file_id ?? scan.iconFileDataId),
        text(definition.itemClass?.name, 60) || null, integer(definition.itemClass?.id ?? meta.itemClassId),
        text(definition.itemSubclass?.name, 60) || null, integer(definition.itemLevel ?? meta.itemLevel ?? scan.itemLevel),
        integer(definition.requiredLevel ?? meta.requiredLevel ?? scan.requiredLevel), integer(definition.stackCount), integer(definition.sellPrice),
        integer(definition.bindType), now);
      written += 1;
    }
  }
  return written;
}

function rememberVariantNames(db, items, now) {
  const upsert = db.prepare(`INSERT INTO market_variant_names (item_key, name, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(item_key) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`);
  for (const item of items) {
    if (item.itemKey === `i:${item.itemId}`) continue;
    const name = cleanName(item.name);
    if (name) upsert.run(item.itemKey, name, now);
  }
}

// Summaries -------------------------------------------------------------------------

// Statements for refreshing many summaries of one market, prepared once.
function summaryRefresher(db, marketKey, now) {
  const markets = marketGroupInDatabase(db, marketKey);
  // The latest complete and the latest partial observation of each market
  // and source: one indexed probe each. An observation counts as seen until
  // its snapshot was last confirmed.
  const probe = db.prepare(`SELECT o.*, sn.confirmed_at FROM market_observations o JOIN market_snapshots sn ON sn.id = o.snapshot_id
    WHERE o.market_key = ? AND o.item_key = ? AND o.source_type = ? AND o.complete = ? ORDER BY o.observed_at DESC LIMIT 1`);
  const combos = markets.flatMap((key) => SOURCE_TYPES.flatMap((source) => [[key, source, 1], [key, source, 0]]));
  const dayAgoStatement = db.prepare(`SELECT typical_close, min_close, last_at FROM market_series_hourly
    WHERE market_key = ? AND item_key = ? AND source_type = ? AND hour BETWEEN ? AND ?`);
  const upsert = db.prepare(`INSERT INTO market_summaries (market_key, item_key, item_id, source_type, snapshot_id, complete, observed_at, confirmed_at,
      min_unit_buyout, min_quantity, typical_unit_buyout, quantity, listings, price_points, selection_reason, notes_json, conflict, change_24h_pct, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_key, item_key) DO UPDATE SET item_id = excluded.item_id, source_type = excluded.source_type,
      snapshot_id = excluded.snapshot_id, complete = excluded.complete, observed_at = excluded.observed_at, confirmed_at = excluded.confirmed_at,
      min_unit_buyout = excluded.min_unit_buyout, min_quantity = excluded.min_quantity, typical_unit_buyout = excluded.typical_unit_buyout,
      quantity = excluded.quantity, listings = excluded.listings, price_points = excluded.price_points, selection_reason = excluded.selection_reason,
      notes_json = excluded.notes_json, conflict = excluded.conflict, change_24h_pct = excluded.change_24h_pct, updated_at = excluded.updated_at`);
  const updatedAt = new Date(now * 1000).toISOString();
  return (itemKey, itemId) => {
    const candidates = [];
    for (const [key, source, complete] of combos) {
      const row = probe.get(key, itemKey, source, complete);
      if (!row) continue;
      candidates.push({
        sourceType: row.source_type, snapshotId: row.snapshot_id, marketKey: row.market_key, complete: row.complete === 1,
        observedAt: Math.max(row.observed_at, row.confirmed_at ?? row.observed_at), firstSeenAt: row.observed_at,
        minUnitBuyout: row.min_unit_buyout, minQuantity: row.min_quantity, typicalUnitBuyout: row.typical_unit_buyout,
        maxUnitBuyout: row.max_unit_buyout, quantity: row.quantity, listings: row.listings, pricePoints: row.price_points,
      });
    }
    const selection = selectObservation(candidates, { now, marketKey });
    if (!selection) return;
    const chosen = selection.chosen;
    const current = chosen.typicalUnitBuyout ?? chosen.minUnitBuyout;
    const target = chosen.observedAt - 86400;
    let before = null;
    for (const row of dayAgoStatement.all(chosen.marketKey, itemKey, chosen.sourceType, Math.floor((target - 3 * 3600) / 3600), Math.floor((target + 3 * 3600) / 3600))) {
      if (!before || Math.abs(row.last_at - target) < Math.abs(before.last_at - target)) before = row;
    }
    const previous = before ? (before.typical_close ?? before.min_close) : null;
    const change = previous && current ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
    upsert.run(marketKey, itemKey, itemId, chosen.sourceType, chosen.snapshotId, chosen.complete ? 1 : 0, chosen.firstSeenAt, chosen.observedAt,
      chosen.minUnitBuyout, chosen.minQuantity ?? null, chosen.typicalUnitBuyout, chosen.quantity, chosen.listings, chosen.pricePoints ?? null,
      selection.reason, JSON.stringify(selection.notes), selection.conflict ? 1 : 0, change, updatedAt);
  };
}

// Ingestion -------------------------------------------------------------------------

// Starts a snapshot. Decides what the observation is:
//   duplicate   the same observation again (a retry): nothing changes
//   too_old     older than MAX_OBSERVATION_AGE_SECONDS: refused
//   unchanged   the same contents as the latest snapshot of the same scope,
//               seen at a later time: that snapshot is confirmed, history
//               gets a point at the new time, nothing else is stored
//   recorded    new contents: stored in full
export function beginMarketSnapshotInDatabase(db, { market, sourceType, sourceId, coverage, scope = "", observedAt, contributor = "", items,
  group = "", part = 1, parts = 1, now = nowSeconds() }) {
  if (!SOURCE_TYPES.includes(sourceType) || !COVERAGES.includes(coverage)) return { status: "invalid" };
  let at = positiveInteger(observedAt);
  if (!at || at > now + 300) return { status: "invalid" };
  at = Math.min(at, now);
  const rows = (items || []).filter((item) => item && item.itemKey && Number.isSafeInteger(item.quantity)).slice(0, MAX_ITEMS_PER_SNAPSHOT);
  if (!rows.length) return { status: "empty" };
  const source = text(sourceId, 120);
  const scopeKey = snapshotScope({ coverage, scope, items: rows });
  if (db.prepare("SELECT 1 FROM market_snapshot_checks WHERE market_key = ? AND source_type = ? AND source_id = ?").get(market.marketKey, sourceType, source)) {
    return { status: "duplicate" };
  }
  ensureMarketInDatabase(db, market);
  const check = db.prepare(`INSERT INTO market_snapshot_checks (market_key, source_type, source_id, scope_key, observed_at, checked_at, outcome, snapshot_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  if (at < now - MAX_OBSERVATION_AGE_SECONDS) {
    check.run(market.marketKey, sourceType, source, scopeKey, at, now, "too_old", null);
    return { status: "too_old" };
  }
  const hash = snapshotHash(rows);
  const latest = db.prepare(`SELECT id, content_hash, observed_at, confirmed_at FROM market_snapshots
    WHERE market_key = ? AND source_type = ? AND scope_key = ? ORDER BY confirmed_at DESC, id DESC LIMIT 1`).get(market.marketKey, sourceType, scopeKey);
  db.prepare("UPDATE market_markets SET last_checked_at = MAX(COALESCE(last_checked_at, 0), ?) WHERE market_key = ?").run(at, market.marketKey);
  if (latest && latest.content_hash === hash && parts === 1 && at >= latest.observed_at) {
    if (at <= latest.confirmed_at) {
      // Inside the period already confirmed: nothing new was learned.
      check.run(market.marketKey, sourceType, source, scopeKey, at, now, "unchanged", latest.id);
      return { status: "duplicate" };
    }
    db.prepare("UPDATE market_snapshots SET confirmed_at = ?, confirmations = confirmations + 1 WHERE id = ?").run(at, latest.id);
    check.run(market.marketKey, sourceType, source, scopeKey, at, now, "unchanged", latest.id);
    if (coverage === "full") db.prepare("UPDATE market_markets SET last_full_at = MAX(COALESCE(last_full_at, 0), ?) WHERE market_key = ?").run(at, market.marketKey);
    return { status: "unchanged", snapshotId: latest.id, scopeKey, observedAt: at, items: rows };
  }
  const inserted = db.prepare(`INSERT INTO market_snapshots (market_key, source_type, source_id, scope_key, coverage, content_hash, contributor_key,
      observed_at, confirmed_at, ingested_at, item_count, listing_count, scan_group, part, parts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(market.marketKey, sourceType, source, scopeKey, coverage, hash, text(contributor, 80), at, at, new Date(now * 1000).toISOString(),
      rows.length, rows.reduce((sum, item) => sum + (item.listings || 0), 0), text(group, 120), Math.max(1, part), Math.max(1, parts));
  const snapshotId = Number(inserted.lastInsertRowid);
  check.run(market.marketKey, sourceType, source, scopeKey, at, now, "recorded", snapshotId);
  db.prepare(`UPDATE market_markets SET last_snapshot_at = MAX(COALESCE(last_snapshot_at, 0), ?), last_changed_at = MAX(COALESCE(last_changed_at, 0), ?)
    WHERE market_key = ?`).run(at, at, market.marketKey);
  if (coverage === "full" && parts === 1) db.prepare("UPDATE market_markets SET last_full_at = MAX(COALESCE(last_full_at, 0), ?) WHERE market_key = ?").run(at, market.marketKey);
  return { status: "recorded", snapshotId, scopeKey, observedAt: at, items: rows };
}

// Stores part of a snapshot's items: raw observations (when recorded),
// history points and refreshed summaries for every market of the house.
export function addMarketSnapshotItemsInDatabase(db, { snapshotId, market, sourceType, coverage, observedAt, items, mode = "recorded", now = nowSeconds() }) {
  const insertObservation = db.prepare(`INSERT OR REPLACE INTO market_observations (snapshot_id, market_key, item_key, item_id, source_type,
      complete, observed_at, min_unit_buyout, min_quantity, typical_unit_buyout, max_unit_buyout, min_unit_bid, quantity, listings, bid_only_listings, price_points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const writeSeries = seriesWriter(db);
  const refreshers = marketGroupInDatabase(db, market.marketKey).map((key) => summaryRefresher(db, key, now));
  ensureItemMetaInDatabase(db, items, now);
  rememberVariantNames(db, items, now);
  for (const item of items) {
    const complete = coverage !== "partial" && item.complete !== false ? 1 : 0;
    if (mode === "recorded") {
      insertObservation.run(snapshotId, market.marketKey, item.itemKey, item.itemId, sourceType, complete, observedAt,
        item.minUnitBuyout ?? null, item.minQuantity ?? null, item.typicalUnitBuyout ?? null, item.maxUnitBuyout ?? null, item.minUnitBid ?? null,
        item.quantity, item.listings ?? null, item.bidOnlyListings || 0, item.pricePoints?.length ? JSON.stringify(item.pricePoints) : null);
    }
    // History is listing evidence only from complete views.
    if (complete) writeSeries(market.marketKey, sourceType, observedAt, item);
    for (const refresh of refreshers) refresh(item.itemKey, item.itemId);
  }
}

// The snapshots that make up one observation of a scope: one snapshot, or
// every part of a multi-part in-game full scan once all parts are in.
function observationSet(db, snapshot) {
  if (snapshot.parts <= 1 || !snapshot.scan_group) return [snapshot.id];
  const ids = db.prepare("SELECT id FROM market_snapshots WHERE market_key = ? AND scan_group = ?").all(snapshot.market_key, snapshot.scan_group).map((row) => row.id);
  return ids.length >= snapshot.parts ? ids : null;
}

// Finishes a full snapshot: items the previous full observation of the same
// scope listed that this one does not are recorded as "none listed", so
// supply drops to zero instead of the last price lingering. Partial and
// item-search snapshots never imply anything about items they did not see.
export function finishMarketSnapshotInDatabase(db, { snapshotId, market, sourceType, now = nowSeconds() }) {
  const snapshot = db.prepare("SELECT * FROM market_snapshots WHERE id = ?").get(snapshotId);
  if (!snapshot || snapshot.coverage !== "full") return { absent: 0 };
  const current = observationSet(db, snapshot);
  if (!current) return { absent: 0, waiting: true };
  if (current.length > 1) db.prepare("UPDATE market_markets SET last_full_at = MAX(COALESCE(last_full_at, 0), ?) WHERE market_key = ?").run(snapshot.observed_at, snapshot.market_key);
  const previousRow = db.prepare(`SELECT * FROM market_snapshots WHERE market_key = ? AND source_type = ? AND scope_key = ? AND coverage = 'full'
      AND id NOT IN (${current.map(() => "?").join(",")}) AND observed_at < ? ORDER BY observed_at DESC, id DESC LIMIT 1`)
    .get(snapshot.market_key, snapshot.source_type, snapshot.scope_key, ...current, snapshot.observed_at);
  if (!previousRow) return { absent: 0 };
  const previous = observationSet(db, previousRow);
  if (!previous) return { absent: 0 };
  const gone = db.prepare(`SELECT DISTINCT o.item_key, o.item_id FROM market_observations o WHERE o.snapshot_id IN (${previous.map(() => "?").join(",")})
      AND o.quantity > 0 AND NOT EXISTS (SELECT 1 FROM market_observations c WHERE c.snapshot_id IN (${current.map(() => "?").join(",")}) AND c.item_key = o.item_key)`)
    .all(...previous, ...current);
  if (!gone.length) return { absent: 0 };
  const items = gone.map((row) => ({ itemKey: row.item_key, itemId: row.item_id, minUnitBuyout: null, typicalUnitBuyout: null, quantity: 0, listings: 0, complete: true }));
  addMarketSnapshotItemsInDatabase(db, { snapshotId, market, sourceType, coverage: "full", observedAt: snapshot.observed_at, items, now });
  return { absent: items.length };
}

// A whole (small) snapshot in one go: in-game scans and tests.
export function recordMarketSnapshotInDatabase(db, input) {
  const begun = beginMarketSnapshotInDatabase(db, input);
  if (begun.status !== "recorded" && begun.status !== "unchanged") return { status: begun.status };
  const now = input.now ?? nowSeconds();
  addMarketSnapshotItemsInDatabase(db, { ...input, snapshotId: begun.snapshotId, observedAt: begun.observedAt, items: begun.items, mode: begun.status, now });
  const finished = begun.status === "recorded" ? finishMarketSnapshotInDatabase(db, { snapshotId: begun.snapshotId, market: input.market, sourceType: input.sourceType, now }) : { absent: 0 };
  return { status: begun.status, snapshotId: begun.snapshotId, items: begun.items.length, absent: finished.absent };
}

// A check that produced no snapshot: a provider's "not modified" answer
// (the market was checked; its data is as old as before) or a failure.
export function recordMarketCheckInDatabase(db, { marketKey, sourceType, sourceId, scope, outcome, now = nowSeconds() }) {
  db.prepare(`INSERT OR IGNORE INTO market_snapshot_checks (market_key, source_type, source_id, scope_key, observed_at, checked_at, outcome)
    VALUES (?, ?, ?, ?, NULL, ?, ?)`).run(marketKey, sourceType, text(sourceId, 120), text(scope, 80), now, outcome);
}

// Maintenance -------------------------------------------------------------------------

function noteMaintenance(db, name, now, detail) {
  db.prepare(`INSERT INTO market_maintenance (name, ran_at, detail) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET ran_at = excluded.ran_at, detail = excluded.detail`).run(name, now, JSON.stringify(detail));
}

// Bounded storage: raw observations 3 days, checks 14, hourly series 10,
// daily 400, weekly 10 years, provider runs 30 days.
export function pruneMarketDataInDatabase(db, now = nowSeconds()) {
  const cutoff = now - OBSERVATION_RETENTION_SECONDS;
  // A snapshot still shown by a summary keeps its observations.
  const observations = db.prepare(`DELETE FROM market_observations WHERE observed_at < ?
    AND snapshot_id NOT IN (SELECT snapshot_id FROM market_summaries)`).run(cutoff).changes;
  const snapshots = db.prepare(`DELETE FROM market_snapshots WHERE confirmed_at < ?
    AND id NOT IN (SELECT snapshot_id FROM market_summaries)`).run(cutoff).changes;
  const checks = db.prepare("DELETE FROM market_snapshot_checks WHERE checked_at < ?").run(now - CHECK_RETENTION_SECONDS).changes;
  const series = pruneSeriesInDatabase(db, now);
  const runs = db.prepare("DELETE FROM market_provider_runs WHERE started_at < ?").run(now - RUN_RETENTION_SECONDS).changes;
  db.prepare("DELETE FROM market_item_interest WHERE day < ?").run(dayOf(now - 30 * 86400));
  const result = { snapshots, observations, checks, ...series, runs };
  noteMaintenance(db, "prune", now, result);
  return result;
}

// Daily work: weekly roll-ups, reference prices, names learned since.
export function runMarketMaintenanceInDatabase(db, now = nowSeconds()) {
  const pruned = pruneMarketDataInDatabase(db, now);
  const weeks = rollUpWeeksInDatabase(db, now);
  const references = refreshReferencePricesInDatabase(db, now);
  const stale = db.prepare("SELECT item_id AS itemId FROM market_item_meta WHERE name_source IN ('', 'addon') LIMIT 5000").all();
  const names = ensureItemMetaInDatabase(db, stale, now);
  noteMaintenance(db, "rollup", now, { weeks, references, names });
  return { pruned, weeks, references, names };
}

// Reads ------------------------------------------------------------------------------

function variantLabel(itemKey, name) {
  if (name) return name;
  const parts = String(itemKey).split(":").slice(2);
  return parts.map((part) => (part.startsWith("s") ? `suffix ${part.slice(1)}` : part.startsWith("b") ? `bonus ${part.slice(1).replace(/\./g, ", ")}` : part)).join(" · ") || null;
}

function itemFromRow(row) {
  return { itemId: row.item_id, name: row.name || `Item ${row.item_id}`, nameKnown: Boolean(row.name), qualityId: row.quality_id ?? null,
    iconFileDataId: row.icon_file_id ?? null, itemClass: row.item_class || null, itemSubclass: row.item_subclass || null,
    itemLevel: row.item_level ?? null, requiredLevel: row.required_level ?? null, stackCount: row.stack_count ?? null,
    sellPrice: row.sell_price ?? null, bindType: row.bind_type ?? null };
}

// Item facts for display, from market_item_meta (filled from game data,
// or a player's scan when nothing better is known).
export function itemsInDatabase(db, ids, now = nowSeconds()) {
  ensureItemMetaInDatabase(db, ids.map((itemId) => ({ itemId })), now);
  return metaFor(db, ids);
}

function metaFor(db, ids) {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id)))];
  const map = new Map();
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500);
    for (const row of db.prepare(`SELECT * FROM market_item_meta WHERE item_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) map.set(row.item_id, row);
  }
  return (id) => itemFromRow(map.get(id) || { item_id: id });
}

export function summaryFromRow(row, now) {
  const seenAt = row.confirmed_at ?? row.observed_at;
  const fresh = freshness(seenAt, now);
  const base = confidence({ complete: row.complete === 1, observedAt: seenAt, quantity: row.quantity, listings: row.listings }, now);
  const reference = row.reference_price ?? null;
  return {
    itemKey: row.item_key, variant: row.item_key !== `i:${row.item_id}` ? row.item_key : null,
    variantName: row.item_key !== `i:${row.item_id}` ? variantLabel(row.item_key, row.variant_name) : null,
    minUnitBuyout: row.min_unit_buyout, minQuantity: row.min_quantity ?? null, typicalUnitBuyout: row.typical_unit_buyout,
    quantity: row.quantity, listings: row.listings, pricePoints: row.price_points ? json(row.price_points, []) : [],
    source: row.source_type, complete: row.complete === 1, observedAt: seenAt, unchangedSince: row.observed_at,
    ageSeconds: fresh.ageSeconds, stale: fresh.stale,
    confidence: row.conflict === 1 && base === "high" ? "medium" : base,
    change24hPct: row.change_24h_pct, conflict: row.conflict === 1, selectionReason: row.selection_reason,
    notes: json(row.notes_json || "[]", []),
    referencePrice: reference, referenceDays: row.reference_days ?? 0,
    // Lowest ask as a share of the 14-day median, once three days back it.
    pct: reference && row.min_unit_buyout && (row.reference_days ?? 0) >= 3 ? Math.round((row.min_unit_buyout / reference) * 100) : null,
  };
}

function marketFromRow(row, now) {
  const checked = freshness(row.last_checked_at ?? row.last_snapshot_at, now);
  return { marketKey: row.market_key, kind: row.kind, region: row.region, rulesetId: row.ruleset_id, houseId: row.house_id,
    realm: row.realm, faction: row.faction, name: row.name, linkedMarketKey: row.linked_market_key, linkShared: row.link_shared === 1,
    lastSnapshotAt: row.last_snapshot_at, lastCheckedAt: row.last_checked_at ?? row.last_snapshot_at, lastChangedAt: row.last_changed_at ?? row.last_snapshot_at,
    lastFullAt: row.last_full_at ?? null, ageSeconds: checked.ageSeconds, stale: checked.stale,
    changedAgeSeconds: (row.last_changed_at ?? row.last_snapshot_at) ? Math.max(0, now - (row.last_changed_at ?? row.last_snapshot_at)) : null };
}

export function readMarkets({ now = nowSeconds() } = {}) {
  return withGuildDatabase((db) => {
    const markets = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM market_summaries s WHERE s.market_key = m.market_key AND s.quantity > 0) AS items
      FROM market_markets m ORDER BY m.region, m.kind, m.name, m.market_key`).all();
    const endpoints = db.prepare("SELECT * FROM market_provider_endpoints").all();
    const byMarket = new Map();
    for (const row of endpoints) {
      if (!byMarket.has(row.market_key)) byMarket.set(row.market_key, []);
      byMarket.get(row.market_key).push(row);
    }
    return {
      markets: markets.map((row) => {
        const rows = byMarket.get(row.market_key) || [];
        const failing = rows.filter((entry) => entry.consecutive_failures > 0);
        return { ...marketFromRow(row, now), items: Number(row.items),
          provider: rows.length ? { name: rows[0].provider, lastSuccessAt: Math.max(0, ...rows.map((entry) => entry.last_success_at || 0)) || null,
            failing: failing.length > 0, lastError: failing.map((entry) => `${entry.endpoint}: ${entry.last_error}`).join("; ") } : null };
      }),
    };
  });
}

const SORTS = {
  name: "COALESCE(NULLIF(m.name, ''), 'zzzz') COLLATE NOCASE", price: "COALESCE(s.min_unit_buyout, 1e18)", typical: "COALESCE(s.typical_unit_buyout, 1e18)",
  quantity: "s.quantity", listings: "COALESCE(s.listings, 0)", age: "COALESCE(s.confirmed_at, s.observed_at)", change: "COALESCE(s.change_24h_pct, 0)",
  ilvl: "COALESCE(m.item_level, 0)", level: "COALESCE(m.required_level, 0)", quality: "COALESCE(m.quality_id, 0)",
  pct: "CASE WHEN s.reference_days >= 3 AND s.reference_price > 0 AND s.min_unit_buyout > 0 THEN s.min_unit_buyout * 1.0 / s.reference_price ELSE 1e9 END",
};

function integerOrNull(value, max = 1000) {
  const number = Math.trunc(Number(value));
  return value === "" || value === undefined || value === null || !Number.isFinite(number) ? null : Math.max(0, Math.min(max, number));
}

// The category tree of a market, cached until the market changes.
const categoryCaches = new WeakMap();
function marketCategories(db, market) {
  if (!categoryCaches.has(db)) categoryCaches.set(db, new Map());
  const categoryCache = categoryCaches.get(db);
  const version = `${market.last_changed_at}:${market.last_checked_at}:${market.linked_market_key}`;
  const cached = categoryCache.get(market.market_key);
  if (cached && cached.version === version && Date.now() - cached.at < 600_000) return cached.value;
  const rows = db.prepare(`SELECT m.item_class AS name, m.item_subclass AS subclass, COUNT(*) AS items FROM market_summaries s
    JOIN market_item_meta m ON m.item_id = s.item_id WHERE s.market_key = ? AND s.quantity > 0 AND m.item_class IS NOT NULL
    GROUP BY m.item_class, m.item_subclass ORDER BY m.item_class, m.item_subclass`).all(market.market_key);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.name)) grouped.set(row.name, { name: row.name, items: 0, subcategories: [] });
    const entry = grouped.get(row.name);
    entry.items += Number(row.items);
    if (row.subclass) entry.subcategories.push({ name: row.subclass, items: Number(row.items) });
  }
  const value = [...grouped.values()];
  categoryCache.set(market.market_key, { version, at: Date.now(), value });
  if (categoryCache.size > 200) categoryCache.delete(categoryCache.keys().next().value);
  return value;
}

// Search one market's summaries: name or id, category, quality, levels,
// below-market only; sort and page. Items with no listings left are hidden
// unless asked for (or searched by id).
export function searchMarket({ marketKey, q = "", category = "", subcategory = "", quality = "", minLevel = "", maxLevel = "", minItemLevel = "", maxItemLevel = "",
  belowMarket = false, includeEmpty = false, sort = "name", direction = "asc", page = 1, pageSize = 50, now = nowSeconds() }) {
  return withGuildDatabase((db) => {
    const market = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(text(marketKey, 160));
    if (!market) return null;
    const query = text(q, 100);
    const size = Math.min(100, Math.max(10, Math.trunc(Number(pageSize)) || 50));
    const current = Math.max(1, Math.trunc(Number(page)) || 1);
    const orderBy = SORTS[sort] || SORTS.name;
    const dir = direction === "desc" ? "DESC" : "ASC";
    // Filters on item facts select item ids from market_item_meta first, so
    // only the page of results is joined.
    const clauses = ["s.market_key = ?"];
    const params = [market.market_key];
    const meta = [];
    const metaParams = [];
    const byId = /^\d+$/.test(query);
    if (!includeEmpty && !byId) clauses.push("s.quantity > 0");
    if (query) {
      if (byId) { clauses.push("s.item_id = ?"); params.push(Number(query)); }
      else {
        const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
        clauses.push(`(s.item_id IN (SELECT item_id FROM market_item_meta WHERE name LIKE ? ESCAPE '\\')
          OR s.item_key IN (SELECT item_key FROM market_variant_names WHERE name LIKE ? ESCAPE '\\'))`);
        params.push(pattern, pattern);
      }
    }
    if (text(category, 80)) { meta.push("item_class = ?"); metaParams.push(text(category, 80)); }
    if (text(subcategory, 80)) { meta.push("item_subclass = ?"); metaParams.push(text(subcategory, 80)); }
    const qualityId = integerOrNull(quality, 8);
    if (qualityId !== null) { meta.push("COALESCE(quality_id, 1) >= ?"); metaParams.push(qualityId); }
    for (const [value, sql] of [[integerOrNull(minLevel), "COALESCE(required_level, 0) >= ?"], [integerOrNull(maxLevel), "COALESCE(required_level, 0) <= ?"],
      [integerOrNull(minItemLevel), "COALESCE(item_level, 0) >= ?"], [integerOrNull(maxItemLevel), "COALESCE(item_level, 0) <= ?"]]) {
      if (value !== null) { meta.push(sql); metaParams.push(value); }
    }
    if (meta.length) { clauses.push(`s.item_id IN (SELECT item_id FROM market_item_meta WHERE ${meta.join(" AND ")})`); params.push(...metaParams); }
    // Below market: the lowest ask at least 15% under the 14-day median,
    // with at least five observed days behind that median.
    if (belowMarket === true || belowMarket === "1" || belowMarket === "true") {
      clauses.push(`s.reference_days >= ${MIN_REFERENCE_DAYS_FILTER} AND s.reference_price > 0 AND s.min_unit_buyout > 0 AND s.min_unit_buyout <= s.reference_price * 0.85`);
    }
    const from = `FROM market_summaries s LEFT JOIN market_item_meta m ON m.item_id = s.item_id LEFT JOIN market_variant_names v ON v.item_key = s.item_key`;
    const where = `WHERE ${clauses.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM market_summaries s ${where}`).get(...params)?.n ?? 0;
    let rows;
    if (/\bm\./.test(orderBy)) {
      rows = db.prepare(`SELECT s.*, m.*, s.item_id AS item_id, v.name AS variant_name ${from} ${where}
        ORDER BY ${orderBy} ${dir}, s.item_id ASC, s.item_key ASC LIMIT ? OFFSET ?`).all(...params, size, (current - 1) * size);
    } else {
      // Sorting by a summary column: page first, then join just that page.
      const ids = db.prepare(`SELECT s.rowid AS id FROM market_summaries s ${where} ORDER BY ${orderBy} ${dir}, s.item_id ASC, s.item_key ASC LIMIT ? OFFSET ?`)
        .all(...params, size, (current - 1) * size).map((row) => row.id);
      const byId = new Map(ids.length ? db.prepare(`SELECT s.rowid AS row_id, s.*, m.*, s.item_id AS item_id, v.name AS variant_name ${from}
        WHERE s.rowid IN (${ids.map(() => "?").join(",")})`).all(...ids).map((row) => [row.row_id, row]) : []);
      rows = ids.map((id) => byId.get(id)).filter(Boolean);
    }
    return {
      market: marketFromRow(market, now), total: Number(total), page: current, pageSize: size, categories: marketCategories(db, market),
      results: rows.map((row) => ({ item: itemFromRow(row), ...summaryFromRow(row, now) })),
    };
  });
}

export function suggestItems({ q = "", marketKey = "", limit = 8 }) {
  return withGuildDatabase((db) => {
    const query = text(q, 60);
    if (query.length < 2) return { suggestions: [] };
    const pattern = `${query.replace(/[\\%_]/g, "\\$&")}%`;
    const contains = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const market = text(marketKey, 160);
    const size = Math.min(20, Math.max(1, Number(limit) || 8));
    // Items the market has first, then any item the website knows.
    const priced = db.prepare(`SELECT m.item_id, m.name, m.quality_id, m.icon_file_id, MIN(s.min_unit_buyout) AS min_price, SUM(s.quantity) AS quantity,
        (m.name LIKE ? ESCAPE '\\') AS prefix
      FROM market_item_meta m JOIN market_summaries s ON s.item_id = m.item_id AND (? = '' OR s.market_key = ?) AND s.quantity > 0
      WHERE m.name LIKE ? ESCAPE '\\' GROUP BY m.item_id ORDER BY prefix DESC, LENGTH(m.name), m.name LIMIT ?`).all(pattern, market, market, contains, size);
    const seen = new Set(priced.map((row) => row.item_id));
    const others = priced.length >= size ? [] : db.prepare(`SELECT item_id, name, MAX(quality_id) AS quality_id, MAX(icon_file_id) AS icon_file_id,
        (name LIKE ? ESCAPE '\\') AS prefix FROM public_game_items WHERE name LIKE ? ESCAPE '\\' GROUP BY item_id
      ORDER BY prefix DESC, LENGTH(name), name LIMIT ?`).all(pattern, contains, size).filter((row) => !seen.has(row.item_id));
    return { suggestions: [...priced.map((row) => ({ itemId: row.item_id, name: row.name, qualityId: row.quality_id, iconFileDataId: row.icon_file_id, priced: true,
      minUnitBuyout: row.min_price, quantity: row.quantity })), ...others.map((row) => ({ itemId: row.item_id, name: row.name, qualityId: row.quality_id,
      iconFileDataId: row.icon_file_id, priced: false }))].slice(0, size) };
  });
}

function evidenceFromRow(row) {
  return { marketKey: row.market_key, itemKey: row.item_key, source: row.source_type, coverage: row.coverage, complete: row.complete === 1,
    observedAt: row.observed_at, confirmedAt: row.confirmed_at ?? row.observed_at, minUnitBuyout: row.min_unit_buyout, minQuantity: row.min_quantity ?? null,
    typicalUnitBuyout: row.typical_unit_buyout, maxUnitBuyout: row.max_unit_buyout, minUnitBid: row.min_unit_bid, quantity: row.quantity,
    listings: row.listings, bidOnlyListings: row.bid_only_listings, pricePoints: row.price_points ? json(row.price_points, []) : [] };
}

// One item in one market: every variant's summary, the evidence behind the
// selected variant, and the item in other markets.
export function readItemMarket({ itemId, itemKey = "", marketKey = "", now = nowSeconds() }) {
  const id = positiveInteger(itemId);
  if (!id) return null;
  return withGuildDatabase((db) => {
    ensureItemMetaInDatabase(db, [{ itemId: id }], now);
    const item = metaFor(db, [id])(id);
    const summaries = db.prepare(`SELECT s.*, m.name AS market_name, m.region, m.kind, v.name AS variant_name FROM market_summaries s
      JOIN market_markets m ON m.market_key = s.market_key LEFT JOIN market_variant_names v ON v.item_key = s.item_key
      WHERE s.item_id = ? ORDER BY s.market_key, s.item_key`).all(id);
    const selected = text(marketKey, 160) || summaries.find((row) => row.quantity > 0)?.market_key || summaries[0]?.market_key || "";
    const here = summaries.filter((row) => row.market_key === selected);
    const requestedKey = text(itemKey, 120);
    const focus = here.find((row) => row.item_key === requestedKey) || here.find((row) => row.item_key === `i:${id}`) || [...here].sort((a, b) => b.quantity - a.quantity)[0] || null;
    const markets = selected ? marketGroupInDatabase(db, selected) : [];
    const evidence = focus ? db.prepare(`SELECT o.*, sn.coverage, sn.confirmed_at FROM market_observations o JOIN market_snapshots sn ON sn.id = o.snapshot_id
      WHERE o.item_key = ? AND o.market_key IN (${markets.map(() => "?").join(",")}) ORDER BY sn.confirmed_at DESC LIMIT 20`).all(focus.item_key, ...markets) : [];
    return {
      item,
      marketKey: selected || null,
      itemKey: focus?.item_key || `i:${id}`,
      variants: here.map((row) => ({ ...summaryFromRow(row, now), label: row.item_key === `i:${id}` ? "Base item" : variantLabel(row.item_key, row.variant_name) })),
      markets: summaries.map((row) => ({ marketKey: row.market_key, marketName: row.market_name, region: row.region, kind: row.kind, ...summaryFromRow(row, now) })),
      evidence: evidence.map(evidenceFromRow),
      basis: "Listing prices people asked for, not completed sales.",
    };
  });
}

function resolveItemKey(db, { itemId, itemKey, marketKey }) {
  const id = positiveInteger(itemId);
  if (!id) return null;
  const requested = text(itemKey, 120);
  if (requested && itemIdFromKey(requested) === id) return requested;
  const base = `i:${id}`;
  if (db.prepare("SELECT 1 FROM market_summaries WHERE market_key = ? AND item_key = ?").get(marketKey, base)) return base;
  // An item only ever seen as variants: the most listed one, never merged.
  return db.prepare("SELECT item_key FROM market_summaries WHERE market_key = ? AND item_id = ? ORDER BY quantity DESC LIMIT 1").get(marketKey, id)?.item_key || base;
}

// History for one item variant in a market (and its linked markets), at
// the resolution the range needs.
export function readItemSeries({ itemId, itemKey = "", marketKey, range = "7d", now = nowSeconds() }) {
  const id = positiveInteger(itemId);
  if (!id || !text(marketKey, 160)) return null;
  return withGuildDatabase((db) => {
    const key = resolveItemKey(db, { itemId: id, itemKey, marketKey: text(marketKey, 160) });
    const markets = marketGroupInDatabase(db, text(marketKey, 160));
    const series = readSeriesInDatabase(db, { marketKeys: markets, itemKey: key, range, now });
    return { itemId: id, itemKey: key, marketKey: text(marketKey, 160), ...series,
      basis: "Observed asking prices per unit and listed quantity. Hours or days without an observation are gaps. Disappearing listings are not sales." };
  });
}

function analysisInDatabase(db, { marketKey, itemKey, now }) {
  const row = db.prepare(`SELECT s.*, v.name AS variant_name FROM market_summaries s LEFT JOIN market_variant_names v ON v.item_key = s.item_key
    WHERE s.market_key = ? AND s.item_key = ?`).get(marketKey, itemKey);
  if (!row) return { itemKey, summary: null, metrics: null, signals: [], note: "No observations of this item in this market." };
  const summary = summaryFromRow(row, now);
  const groups = marketGroupInDatabase(db, marketKey);
  // History from the market and source the shown price came from; failing
  // that, the market of the house with the most history.
  const origin = db.prepare("SELECT market_key FROM market_snapshots WHERE id = ?").get(row.snapshot_id)?.market_key || marketKey;
  let inputs = readMetricInputsInDatabase(db, { marketKey: origin, itemKey, sourceType: row.source_type, now });
  let basis = { marketKey: origin, source: row.source_type };
  if (!inputs.hourly.length && !inputs.daily.length) {
    for (const key of groups) {
      for (const source of SOURCE_TYPES) {
        const candidate = readMetricInputsInDatabase(db, { marketKey: key, itemKey, sourceType: source, now });
        if (candidate.hourly.length + candidate.daily.length > inputs.hourly.length + inputs.daily.length) { inputs = candidate; basis = { marketKey: key, source }; }
      }
    }
  }
  const current = { min: summary.minUnitBuyout, typical: summary.typicalUnitBuyout, quantity: summary.quantity, listings: summary.listings,
    minQuantity: summary.minQuantity, observedAt: summary.observedAt };
  const metrics = marketMetrics({ current, hourly: inputs.hourly, daily: inputs.daily, now });
  return { itemKey, summary, basis, metrics, signals: marketSignals(metrics, { now }),
    note: summary.stale ? "The newest observation is more than a day old; metrics describe the past." : null };
}

export function readItemAnalysis({ itemId, itemKey = "", marketKey, now = nowSeconds() }) {
  const id = positiveInteger(itemId);
  if (!id || !text(marketKey, 160)) return null;
  return withGuildDatabase((db) => {
    const key = resolveItemKey(db, { itemId: id, itemKey, marketKey: text(marketKey, 160) });
    return { itemId: id, marketKey: text(marketKey, 160), ...analysisInDatabase(db, { marketKey: text(marketKey, 160), itemKey: key, now }),
      disclaimer: "Observations from asking prices and listed supply, not completed sales. Not a promise of profit." };
  });
}

// Metrics and signals for many items (favorites, a watch list), capped.
export function readAnalysesInDatabase(db, { marketKey, itemKeys, now = nowSeconds() }) {
  const out = new Map();
  for (const itemKey of [...new Set(itemKeys)].slice(0, 200)) out.set(itemKey, analysisInDatabase(db, { marketKey, itemKey, now }));
  return out;
}

// Prices for many items at once (recipes, dungeon loot, shopping lists).
// By item id the base item is priced; an item only listed as variants
// reports its variants instead of borrowing one's price. Variant keys
// ("i:15210:s-1081") are priced exactly.
export function readPricesInDatabase(db, { marketKey, itemIds = [], itemKeys = [], now = nowSeconds() }) {
  const ids = [...new Set((itemIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500);
  const keys = [...new Set((itemKeys || []).map((key) => text(key, 120)).filter((key) => itemIdFromKey(key)))].slice(0, 500);
  const prices = new Map();
  if ((!ids.length && !keys.length) || !marketKey) return prices;
  const wanted = [...ids.map((id) => `i:${id}`), ...keys];
  for (let start = 0; start < wanted.length; start += 500) {
    const chunk = wanted.slice(start, start + 500);
    for (const row of db.prepare(`SELECT s.*, v.name AS variant_name FROM market_summaries s LEFT JOIN market_variant_names v ON v.item_key = s.item_key
      WHERE s.market_key = ? AND s.item_key IN (${chunk.map(() => "?").join(",")})`).all(text(marketKey, 160), ...chunk)) {
      prices.set(row.item_key === `i:${row.item_id}` && ids.includes(row.item_id) ? row.item_id : row.item_key, summaryFromRow(row, now));
    }
  }
  const unpriced = ids.filter((id) => !prices.has(id));
  for (let start = 0; start < unpriced.length; start += 500) {
    const chunk = unpriced.slice(start, start + 500);
    const variants = new Map();
    for (const row of db.prepare(`SELECT s.*, v.name AS variant_name FROM market_summaries s LEFT JOIN market_variant_names v ON v.item_key = s.item_key
      WHERE s.market_key = ? AND s.item_id IN (${chunk.map(() => "?").join(",")}) AND s.quantity > 0`).all(text(marketKey, 160), ...chunk)) {
      if (!variants.has(row.item_id)) variants.set(row.item_id, []);
      variants.get(row.item_id).push(summaryFromRow(row, now));
    }
    for (const [id, list] of variants) {
      prices.set(id, { itemKey: `i:${id}`, variantsOnly: true, variants: list, minUnitBuyout: null, typicalUnitBuyout: null, quantity: list.reduce((sum, entry) => sum + entry.quantity, 0),
        source: null, stale: list.every((entry) => entry.stale), confidence: "low",
        selectionReason: `Listed only as ${list.length} version${list.length === 1 ? "" : "s"} with different stats; each is priced on its own.` });
    }
  }
  return prices;
}

export function readPrices({ marketKey, itemIds = [], itemKeys = [], now = nowSeconds() }) {
  return withGuildDatabase((db) => {
    const prices = readPricesInDatabase(db, { marketKey, itemIds, itemKeys, now });
    const item = metaFor(db, [...prices.keys()].map((key) => (typeof key === "number" ? key : itemIdFromKey(key))));
    return { marketKey: text(marketKey, 160), prices: [...prices.entries()].map(([key, price]) => ({ item: item(typeof key === "number" ? key : itemIdFromKey(key)), ...price })) };
  });
}

// Counts an item view toward refresh priority. Anonymous and capped per day.
export function noteItemInterest(itemId, now = nowSeconds()) {
  const id = positiveInteger(itemId);
  if (!id) return;
  withGuildDatabase((db) => db.prepare(`INSERT INTO market_item_interest (item_id, day, views) VALUES (?, ?, 1)
    ON CONFLICT(item_id, day) DO UPDATE SET views = MIN(100000, views + 1)`).run(id, dayOf(now)));
}

// Links an in-game market to the API house an administrator verified it
// is. Only same region and same kind of house (faction, or Blackwater for
// neutral). A second realm on the same house must be confirmed with
// `shared`: Forever's rulesets appear to share houses, but that is for an
// administrator to check, never assumed.
export function setMarketLink({ marketKey, linkedMarketKey, shared = false, now = nowSeconds() }) {
  return withGuildDatabase((db) => {
    const market = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(text(marketKey, 160));
    if (!market || market.kind !== "client_house") return { status: "not-found" };
    const before = marketGroupInDatabase(db, market.market_key);
    if (!linkedMarketKey) {
      db.prepare("UPDATE market_markets SET linked_market_key = NULL, link_shared = 0 WHERE market_key = ?").run(market.market_key);
      refreshGroupSummaries(db, [...before, market.market_key], now);
      return { status: "unlinked" };
    }
    const target = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(text(linkedMarketKey, 160));
    if (!target || target.kind !== "api_house") return { status: "not-found" };
    if (target.region !== market.region) return { status: "invalid", reason: "region_mismatch" };
    if (!target.faction || target.faction !== market.faction) return { status: "invalid", reason: "faction_mismatch" };
    const otherRealms = db.prepare("SELECT realm FROM market_markets WHERE linked_market_key = ? AND market_key <> ? AND realm <> ?")
      .all(target.market_key, market.market_key, market.realm);
    if (otherRealms.length && shared !== true) return { status: "conflict", reason: "house_linked_to_other_realm", realms: otherRealms.map((row) => row.realm) };
    db.prepare("UPDATE market_markets SET linked_market_key = ?, link_shared = ? WHERE market_key = ?").run(target.market_key, otherRealms.length ? 1 : 0, market.market_key);
    refreshGroupSummaries(db, [...before, ...marketGroupInDatabase(db, market.market_key)], now);
    return { status: "linked" };
  });
}

// Recomputes every summary of the given markets after a link changed.
function refreshGroupSummaries(db, marketKeys, now) {
  for (const key of new Set(marketKeys)) {
    const refresh = summaryRefresher(db, key, now);
    const markets = marketGroupInDatabase(db, key);
    for (const row of db.prepare(`SELECT DISTINCT item_key, item_id FROM market_observations WHERE market_key IN (${markets.map(() => "?").join(",")})`).all(...markets)) {
      refresh(row.item_key, row.item_id);
    }
    // Summaries whose evidence now belongs to another house are dropped.
    db.prepare(`DELETE FROM market_summaries WHERE market_key = ? AND snapshot_id NOT IN
      (SELECT id FROM market_snapshots WHERE market_key IN (${markets.map(() => "?").join(",")}))`).run(key, ...markets);
  }
}

// How closely an in-game market's prices match each API house of the same
// region and faction, from items both saw within three hours of each other.
// Evidence for an administrator deciding a link; never acted on alone.
export function linkEvidenceInDatabase(db, clientKey, now = nowSeconds()) {
  const client = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(clientKey);
  if (!client) return [];
  const houses = db.prepare("SELECT * FROM market_markets WHERE kind = 'api_house' AND region = ? AND faction = ?").all(client.region, client.faction);
  return houses.map((house) => {
    const pairs = db.prepare(`SELECT a.min_unit_buyout AS a, b.min_unit_buyout AS b FROM market_observations a
      JOIN market_observations b ON b.item_key = a.item_key AND b.market_key = ? AND ABS(a.observed_at - b.observed_at) <= 10800
      WHERE a.market_key = ? AND a.complete = 1 AND b.complete = 1 AND a.min_unit_buyout > 0 AND b.min_unit_buyout > 0 AND a.observed_at >= ?
      LIMIT 5000`).all(house.market_key, clientKey, now - 3 * 86400);
    const ratios = pairs.map((pair) => Math.abs(pair.a - pair.b) / pair.b);
    const sorted = [...ratios].sort((x, y) => x - y);
    return { marketKey: house.market_key, name: house.name, comparedItems: pairs.length,
      exactShare: pairs.length ? Math.round((pairs.filter((pair) => pair.a === pair.b).length / pairs.length) * 100) : null,
      within5PctShare: pairs.length ? Math.round((ratios.filter((ratio) => ratio <= 0.05).length / pairs.length) * 100) : null,
      medianDifferencePct: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 1000) / 10 : null };
  }).sort((a, b) => (b.exactShare ?? -1) - (a.exactShare ?? -1));
}

// Administrators: what is arriving, from where, how old, and how big.
export function readMarketDiagnostics({ refresherStats = null, providerConfig = null, now = nowSeconds() } = {}) {
  return withGuildDatabase((db) => {
    const markets = db.prepare("SELECT * FROM market_markets ORDER BY region, kind, name").all();
    const counts = new Map(db.prepare(`SELECT market_key, COUNT(*) AS items, SUM(quantity > 0) AS listed, SUM(conflict) AS conflicts,
        SUM(CASE WHEN COALESCE(confirmed_at, observed_at) < ? THEN 1 ELSE 0 END) AS stale FROM market_summaries GROUP BY market_key`)
      .all(now - 86400).map((row) => [row.market_key, row]));
    const sources = db.prepare(`SELECT market_key, source_type, coverage, COUNT(*) AS snapshots, MAX(confirmed_at) AS last_seen, MAX(observed_at) AS last_changed,
        COUNT(DISTINCT NULLIF(contributor_key, '')) AS contributors FROM market_snapshots WHERE confirmed_at >= ? GROUP BY market_key, source_type, coverage`).all(now - 7 * 86400);
    const checks = db.prepare(`SELECT market_key, outcome, COUNT(*) AS n, MAX(checked_at) AS last FROM market_snapshot_checks WHERE checked_at >= ?
      GROUP BY market_key, outcome`).all(now - 86400);
    const endpoints = db.prepare("SELECT * FROM market_provider_endpoints ORDER BY market_key, endpoint").all();
    const runs = db.prepare(`SELECT * FROM market_provider_runs ORDER BY started_at DESC LIMIT 40`).all();
    const tables = ["market_snapshots", "market_observations", "market_snapshot_checks", "market_summaries", "market_series_hourly", "market_series_daily",
      "market_series_weekly", "market_item_meta", "market_provider_runs"];
    const storage = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    const pageSize = db.prepare("PRAGMA page_size").get().page_size;
    const pageCount = db.prepare("PRAGMA page_count").get().page_count;
    const maintenance = Object.fromEntries(db.prepare("SELECT * FROM market_maintenance").all().map((row) => [row.name, { ranAt: row.ran_at, detail: json(row.detail, {}) }]));
    const conflicts = [];
    const linkedRealms = new Map();
    for (const market of markets.filter((row) => row.linked_market_key)) {
      if (!linkedRealms.has(market.linked_market_key)) linkedRealms.set(market.linked_market_key, new Set());
      linkedRealms.get(market.linked_market_key).add(market.realm);
    }
    for (const [house, realms] of linkedRealms) {
      if (realms.size > 1) conflicts.push({ kind: "shared_house", marketKey: house, text: `${realms.size} realms are linked to this house: ${[...realms].join(", ")}. Confirmed as shared by an administrator.` });
    }
    for (const market of markets.filter((row) => row.kind === "client_house" && !row.linked_market_key)) {
      conflicts.push({ kind: "unlinked", marketKey: market.market_key, text: "In-game market not linked to an API house; its scans stand alone.", evidence: linkEvidenceInDatabase(db, market.market_key, now) });
    }
    const bySource = (key) => sources.filter((row) => row.market_key === key).map((row) => ({ source: row.source_type, coverage: row.coverage, snapshots7d: row.snapshots,
      lastSeenAt: row.last_seen, lastChangedAt: row.last_changed, contributors7d: row.contributors }));
    return {
      now,
      provider: { config: providerConfig, stats: refresherStats },
      markets: markets.map((row) => {
        const count = counts.get(row.market_key) || {};
        return { ...marketFromRow(row, now), summaries: count.items || 0, listed: count.listed || 0, conflicts: count.conflicts || 0, staleSummaries: count.stale || 0,
          sources: bySource(row.market_key),
          checks24h: Object.fromEntries(checks.filter((check) => check.market_key === row.market_key).map((check) => [check.outcome, { count: check.n, lastAt: check.last }])),
          endpoints: endpoints.filter((entry) => entry.market_key === row.market_key).map((entry) => ({ endpoint: entry.endpoint, lastModified: entry.last_modified,
            lastCheckedAt: entry.last_checked_at, lastChangedAt: entry.last_changed_at, lastSuccessAt: entry.last_success_at, lastFailureAt: entry.last_failure_at,
            lastStatus: entry.last_status, lastError: entry.last_error, consecutiveFailures: entry.consecutive_failures })),
          warnings: [
            ...(row.last_checked_at && now - row.last_checked_at > 86400 ? ["No check in over a day: prices are shown as stale."] : []),
            ...(!row.last_checked_at ? ["Never received data."] : []),
            ...endpoints.filter((entry) => entry.market_key === row.market_key && entry.consecutive_failures > 0).map((entry) => `${entry.endpoint} failing ${entry.consecutive_failures}× (${entry.last_error})`),
          ] };
      }),
      runs: runs.map((row) => ({ marketKey: row.market_key, provider: row.provider, startedAt: row.started_at, finishedAt: row.finished_at, status: row.status,
        httpStatus: row.http_status, auctions: row.auctions, error: row.error, detail: json(row.detail || "{}", {}) })),
      storage: { rows: storage, databaseBytes: pageSize * pageCount, retention: { observationsDays: OBSERVATION_RETENTION_SECONDS / 86400, checksDays: CHECK_RETENTION_SECONDS / 86400 } },
      maintenance,
      identity: conflicts,
    };
  });
}
