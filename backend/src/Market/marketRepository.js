import { createHash } from "node:crypto";

import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { publicItemDefinition } from "../GameData/publicGameDataModel.js";
import { marketMetrics, marketSignals } from "./marketAnalysis.js";
import {
  categorySql,
  categoryTree,
  itemClassIds,
  likePattern,
  resolveCategory,
  searchKey,
  searchTokens,
} from "./marketCategories.js";
import {
  COVERAGES,
  MAX_ITEMS_PER_SNAPSHOT,
  SOURCE_TYPES,
  STALE_SECONDS,
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

// "Item 12345" is how game data names an item it could not resolve yet:
// never a name to show or search.
function placeholderName(name) {
  return /^Item \d+$/.test(name);
}

// Fills market_item_meta, the Auction House's item index, from the
// website's game data: the in-game item definitions players' add-ons sent
// (public_game_items) and the item catalog (game_data_catalog, Blizzard's
// item API among others). A scan's own name, quality and level are a last
// resort. By default only items it does not know yet (or only knows from a
// scan) are looked up; `refresh` re-reads every given item (catalog sync).
export function ensureItemMetaInDatabase(db, items, now = nowSeconds(), { refresh = false } = {}) {
  const wanted = new Map();
  for (const item of items) {
    const id = positiveInteger(item.itemId);
    // Prefer the base item's row (its name is the item's name).
    if (id && (!wanted.has(id) || item.itemKey === `i:${id}`)) wanted.set(id, item);
  }
  if (!wanted.size) return 0;
  const ids = [...wanted.keys()];
  let missing = ids;
  if (!refresh) {
    const known = new Map();
    for (let start = 0; start < ids.length; start += 500) {
      const chunk = ids.slice(start, start + 500);
      for (const row of db.prepare(`SELECT item_id, name_source FROM market_item_meta WHERE item_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) known.set(row.item_id, row.name_source);
    }
    missing = ids.filter((id) => !known.has(id) || known.get(id) === "" || known.get(id) === "addon");
  }
  if (!missing.length) return 0;
  const upsert = db.prepare(`INSERT INTO market_item_meta (item_id, name, name_source, quality_id, icon_file_id, item_class, item_class_id, item_subclass,
      item_subclass_id, item_level, required_level, stack_count, sell_price, bind_type, search_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      -- A name is only ever replaced by a name (never blanked by a lookup
      -- that found nothing new), and a scan's name never replaces game data.
      name = CASE WHEN excluded.name <> '' AND (excluded.name_source = 'game' OR name_source <> 'game') THEN excluded.name ELSE name END,
      search_name = CASE WHEN excluded.name <> '' AND (excluded.name_source = 'game' OR name_source <> 'game') THEN excluded.search_name ELSE search_name END,
      name_source = CASE WHEN excluded.name <> '' AND (excluded.name_source = 'game' OR name_source <> 'game') THEN excluded.name_source ELSE name_source END,
      quality_id = COALESCE(excluded.quality_id, quality_id),
      icon_file_id = COALESCE(excluded.icon_file_id, icon_file_id), item_class = COALESCE(excluded.item_class, item_class),
      item_class_id = COALESCE(excluded.item_class_id, item_class_id), item_subclass = COALESCE(excluded.item_subclass, item_subclass),
      item_subclass_id = COALESCE(excluded.item_subclass_id, item_subclass_id),
      item_level = COALESCE(excluded.item_level, item_level), required_level = COALESCE(excluded.required_level, required_level),
      stack_count = COALESCE(excluded.stack_count, stack_count), sell_price = COALESCE(excluded.sell_price, sell_price),
      bind_type = COALESCE(excluded.bind_type, bind_type), updated_at = excluded.updated_at`);
  const integer = (value) => (Number.isSafeInteger(Number(value)) && value !== null && value !== "" ? Number(value) : null);
  let written = 0;
  for (let start = 0; start < missing.length; start += 500) {
    const chunk = missing.slice(start, start + 500);
    const placeholders = chunk.map(() => "?").join(",");
    // English names first (the website is in English), then a language
    // nobody recorded, then any other; the newest of each wins. The full
    // definition (class, levels, binding) comes from the newest row that
    // has one.
    const game = new Map();
    const defined = new Map();
    for (const row of db.prepare(`SELECT item_id, name, quality_id, icon_file_id, definition_json FROM public_game_items
      WHERE item_id IN (${placeholders}) ORDER BY (locale = 'en_US') ASC, (locale = 'und') ASC, captured_at ASC`).all(...chunk)) {
      if (row.name && !placeholderName(row.name)) game.set(row.item_id, row);
      if (row.definition_json && row.definition_json !== "{}") defined.set(row.item_id, row);
    }
    const catalog = new Map();
    for (const row of db.prepare(`SELECT entity_id, name, quality_id, icon_file_id, metadata_json FROM game_data_catalog
      WHERE entity_type = 'item' AND entity_id IN (${placeholders}) AND name <> '' ORDER BY source_priority ASC, (locale = 'en_US') ASC, updated_at ASC`).all(...chunk.map(String))) {
      catalog.set(Number(row.entity_id), row);
    }
    for (const id of chunk) {
      const row = game.get(id);
      const full = defined.get(id);
      const cat = catalog.get(id);
      const scan = wanted.get(id) || {};
      const definition = full ? json(full.definition_json, {}) : {};
      const meta = cat ? json(cat.metadata_json || "{}", {}) : {};
      const name = cleanName(row?.name || cat?.name || "");
      // A variant's name ("… of the Bear") is not the item's name.
      const scanName = scan.itemKey && scan.itemKey !== `i:${id}` ? "" : cleanName(scan.name);
      const shown = name || scanName;
      const className = text(definition.itemClass?.name || meta.itemClassName, 60) || null;
      const subclassName = text(definition.itemSubclass?.name || meta.itemSubclassName, 60) || null;
      // A scan's class ids (the client's GetItemInfoInstant) only when no
      // game data has any.
      const known = definition.itemClass?.id ?? meta.itemClassId ?? (className ? undefined : scan.classId);
      const classes = itemClassIds({ classId: known, subclassId: definition.itemSubclass?.id ?? meta.itemSubclassId ?? (known === scan.classId ? scan.subclassId : undefined),
        className: className || "", subclassName: subclassName || "" });
      upsert.run(id, shown, name ? "game" : scanName ? "addon" : "",
        integer(row?.quality_id ?? full?.quality_id ?? cat?.quality_id ?? scan.qualityId), integer(row?.icon_file_id ?? full?.icon_file_id ?? cat?.icon_file_id ?? scan.iconFileDataId),
        className, classes.classId, subclassName, classes.subclassId,
        integer(definition.itemLevel ?? meta.itemLevel ?? scan.itemLevel),
        integer(definition.requiredLevel ?? meta.requiredLevel ?? scan.requiredLevel), integer(definition.stackCount), integer(definition.sellPrice ?? meta.sellPrice),
        integer(definition.bindType), searchKey(shown), now);
      written += 1;
    }
  }
  return written;
}

// Keeps the Auction House's item index in step with the game data, a
// bounded batch at a time: new rows of public_game_items and of the item
// catalog since the last batch (by rowid), and once a day a pass over
// everything so renamed items catch up. Returns { items, caughtUp }.
const CATALOG_SYNC = "catalog_sync";
const CATALOG_PASS_SECONDS = 20 * 3600;

function catalogCursor(db) {
  const row = db.prepare("SELECT ran_at, detail FROM market_maintenance WHERE name = ?").get(CATALOG_SYNC);
  const detail = row ? json(row.detail, {}) : {};
  return { game: Number(detail.game) || 0, catalog: Number(detail.catalog) || 0, passStartedAt: Number(detail.passStartedAt) || 0 };
}

// Whether game data arrived that the index has not read yet: two indexed
// probes, cheap enough to ask before a search.
export function catalogBehindInDatabase(db) {
  const cursor = catalogCursor(db);
  return Boolean(db.prepare("SELECT 1 FROM public_game_items WHERE rowid > ? LIMIT 1").get(cursor.game)
    || db.prepare("SELECT 1 FROM game_data_catalog WHERE rowid > ? AND entity_type = 'item' LIMIT 1").get(cursor.catalog));
}

export function syncMarketCatalogInDatabase(db, { limit = 2000, now = nowSeconds() } = {}) {
  const cursor = catalogCursor(db);
  if (!cursor.passStartedAt) cursor.passStartedAt = now;
  const game = db.prepare("SELECT rowid AS id, item_id FROM public_game_items WHERE rowid > ? ORDER BY rowid LIMIT ?").all(cursor.game, limit);
  const catalog = db.prepare(`SELECT rowid AS id, entity_id FROM game_data_catalog WHERE rowid > ? AND entity_type = 'item' ORDER BY rowid LIMIT ?`).all(cursor.catalog, limit);
  const ids = new Set([...game.map((row) => row.item_id), ...catalog.map((row) => positiveInteger(row.entity_id)).filter(Boolean)]);
  const items = ensureItemMetaInDatabase(db, [...ids].map((itemId) => ({ itemId })), now, { refresh: true });
  if (game.length) cursor.game = game.at(-1).id;
  if (catalog.length) cursor.catalog = catalog.at(-1).id;
  const caughtUp = game.length < limit && catalog.length < limit;
  // A full pass is done: start the next one after a day.
  if (caughtUp && now - cursor.passStartedAt >= CATALOG_PASS_SECONDS) {
    cursor.game = 0;
    cursor.catalog = 0;
    cursor.passStartedAt = now;
  }
  noteMaintenance(db, CATALOG_SYNC, now, cursor);
  return { items, caughtUp };
}

// Items listed in some market that the website cannot name or place in a
// category: Blizzard's auction API sends only item ids. Most listed first,
// each asked about at most once a week (unknown ids stay unknown).
export const ITEM_LOOKUP_RETRY_SECONDS = 7 * 86400;

export function itemsToLookUpInDatabase(db, { limit = 24, now = nowSeconds() } = {}) {
  return db.prepare(`SELECT m.item_id AS itemId FROM market_item_meta m
    WHERE (m.name_source <> 'game' OR m.item_class_id IS NULL) AND COALESCE(m.lookup_at, 0) < ?
      AND EXISTS (SELECT 1 FROM market_summaries s WHERE s.item_id = m.item_id AND +s.quantity > 0)
    ORDER BY (SELECT MAX(s.quantity) FROM market_summaries s WHERE s.item_id = m.item_id) DESC, m.item_id
    LIMIT ?`).all(now - ITEM_LOOKUP_RETRY_SECONDS, limit).map((row) => row.itemId);
}

export function markItemsLookedUpInDatabase(db, itemIds, now = nowSeconds()) {
  const mark = db.prepare("UPDATE market_item_meta SET lookup_at = ? WHERE item_id = ?");
  for (const id of itemIds) mark.run(now, id);
}

function rememberVariantNames(db, items, now) {
  const upsert = db.prepare(`INSERT INTO market_variant_names (item_key, name, search_name, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_key) DO UPDATE SET name = excluded.name, search_name = excluded.search_name, updated_at = excluded.updated_at`);
  for (const item of items) {
    if (item.itemKey === `i:${item.itemId}`) continue;
    const name = cleanName(item.name);
    if (name) upsert.run(item.itemKey, name, searchKey(name), now);
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

// Sort keys. In a search, rows with listings in the market always come
// before items that only matched the catalog.
const SORTS = {
  name: "COALESCE(NULLIF(m.name, ''), 'zzzz') COLLATE NOCASE", price: "COALESCE(s.min_unit_buyout, 1e18)", typical: "COALESCE(s.typical_unit_buyout, 1e18)",
  quantity: "COALESCE(s.quantity, 0)", listings: "COALESCE(s.listings, 0)", age: "COALESCE(s.confirmed_at, s.observed_at, 0)", change: "COALESCE(s.change_24h_pct, 0)",
  ilvl: "COALESCE(m.item_level, 0)", level: "COALESCE(m.required_level, 0)", quality: "COALESCE(m.quality_id, 0)",
  confidence: "COALESCE(s.complete, 0) * 2 + (COALESCE(s.confirmed_at, s.observed_at, 0) >= :fresh)",
  pct: "CASE WHEN s.reference_days >= 3 AND s.reference_price > 0 AND s.min_unit_buyout > 0 THEN s.min_unit_buyout * 1.0 / s.reference_price ELSE 1e9 END",
};
export const SEARCH_SORTS = Object.freeze(["relevance", ...Object.keys(SORTS)]);

function integerOrNull(value, max = 1000) {
  const number = Math.trunc(Number(value));
  return value === "" || value === undefined || value === null || !Number.isFinite(number) ? null : Math.max(0, Math.min(max, number));
}

// The category tree of a market with listing counts, cached until the
// market changes. Every category is in the tree, listed or not.
const categoryCaches = new WeakMap();
function marketCategories(db, market) {
  if (!categoryCaches.has(db)) categoryCaches.set(db, new Map());
  const categoryCache = categoryCaches.get(db);
  const version = `${market.last_changed_at}:${market.last_checked_at}:${market.linked_market_key}`;
  const cached = categoryCache.get(market.market_key);
  if (cached && cached.version === version && Date.now() - cached.at < 600_000) return cached.value;
  const counts = db.prepare(`SELECT m.item_class_id AS classId, m.item_subclass_id AS subclassId, COUNT(*) AS items FROM market_summaries s
    JOIN market_item_meta m ON m.item_id = s.item_id WHERE s.market_key = ? AND s.quantity > 0 AND m.item_class_id IS NOT NULL
    GROUP BY m.item_class_id, m.item_subclass_id`).all(market.market_key);
  const value = categoryTree(counts);
  categoryCache.set(market.market_key, { version, at: Date.now(), value });
  if (categoryCache.size > 200) categoryCache.delete(categoryCache.keys().next().value);
  return value;
}

// How completely a market has been seen: when every listing of the house
// was last visible (a Blizzard house download with both of its endpoints,
// or an in-game full scan). An item missing from a recent complete view is
// confirmed as not listed; otherwise its absence proves nothing.
function marketCoverageInDatabase(db, marketKey, now) {
  const markets = marketGroupInDatabase(db, marketKey);
  const scopes = new Map(db.prepare(`SELECT scope_key, MAX(confirmed_at) AS at FROM market_snapshots WHERE market_key IN (${markets.map(() => "?").join(",")})
    AND coverage = 'full' GROUP BY scope_key`).all(...markets).map((row) => [row.scope_key, row.at]));
  const api = scopes.has("api:auctions") && scopes.has("api:commodities") ? Math.min(scopes.get("api:auctions"), scopes.get("api:commodities")) : null;
  const fullAt = Math.max(api || 0, scopes.get("full") || 0) || null;
  const complete = Boolean(fullAt && now - fullAt <= STALE_SECONDS);
  return { fullAt, complete, ageSeconds: fullAt ? Math.max(0, now - fullAt) : null,
    note: complete ? null : fullAt ? "The last complete view of this auction house is over a day old." : "This market has never been seen complete: only individual searches." };
}

// Filters on item facts, as SQL over market_item_meta `m`.
function metaFilters({ category, subcategory, quality, minLevel, maxLevel, minItemLevel, maxItemLevel }) {
  const clauses = [];
  const params = [];
  const resolved = resolveCategory(text(category, 80), text(subcategory, 80));
  if (text(category, 80) && !resolved) clauses.push("0");
  const byCategory = categorySql(resolved, "m");
  if (byCategory) { clauses.push(byCategory.sql); params.push(...byCategory.params); }
  const qualityId = integerOrNull(quality, 8);
  if (qualityId !== null) { clauses.push("COALESCE(m.quality_id, 1) >= ?"); params.push(qualityId); }
  for (const [value, sql] of [[integerOrNull(minLevel), "COALESCE(m.required_level, 0) >= ?"], [integerOrNull(maxLevel), "COALESCE(m.required_level, 0) <= ?"],
    [integerOrNull(minItemLevel), "COALESCE(m.item_level, 0) >= ?"], [integerOrNull(maxItemLevel), "COALESCE(m.item_level, 0) <= ?"]]) {
    if (value !== null) { clauses.push(sql); params.push(value); }
  }
  return { clauses, params, category: resolved ? { key: resolved.category.key, subcategory: resolved.subcategory?.key || null } : null };
}

// Lowest ask at least 15% under the 14-day median, with at least five
// observed days behind that median.
const BELOW_MARKET = `s.reference_days >= ${MIN_REFERENCE_DAYS_FILTER} AND s.reference_price > 0 AND s.min_unit_buyout > 0 AND s.min_unit_buyout <= s.reference_price * 0.85`;

// The Auction House's Browse and Search.
//
// Browse (no search text): the market's listings, by category and filters.
// Only items with listings in this market; never catalog entries.
//
// Search (a name or an item id): every item the website knows that matches
// (the catalog), each with this market's listings attached where there are
// any, one row per listed variant. An item with nothing listed here is one
// row without a price, marked either "none listed" (a recent complete view
// of the house did not have it) or "unknown" (the market has not been seen
// completely, so it may be listed). `listed` hides those rows.
export function searchMarket({ marketKey, q = "", category = "", subcategory = "", quality = "", minLevel = "", maxLevel = "", minItemLevel = "", maxItemLevel = "",
  belowMarket = false, includeEmpty = false, listedOnly = false, sort = "", direction = "", page = 1, pageSize = 50, now = nowSeconds() }) {
  // Game data that arrived since the last batch is indexed first (bounded).
  if (text(q, 100)) catchUpCatalog(now);
  return withGuildDatabase((db) => {
    const market = db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(text(marketKey, 160));
    if (!market) return null;
    const query = text(q, 100);
    const tokens = searchTokens(query);
    const byId = /^\s*#?\d+\s*$/.test(query) ? positiveInteger(query.replace(/\D/g, "")) : null;
    const mode = query && (byId || tokens.length) ? "search" : "browse";
    const size = Math.min(100, Math.max(10, Math.trunc(Number(pageSize)) || 50));
    const current = Math.max(1, Math.trunc(Number(page)) || 1);
    const sortKey = SEARCH_SORTS.includes(sort) ? sort : mode === "search" ? "relevance" : "name";
    const dir = direction === "desc" ? "DESC" : "ASC";
    const below = belowMarket === true || belowMarket === "1" || belowMarket === "true";
    const listed = listedOnly === true || listedOnly === "1" || listedOnly === "true";
    const filters = metaFilters({ category, subcategory, quality, minLevel, maxLevel, minItemLevel, maxItemLevel });
    const fresh = now - STALE_SECONDS;
    const orderBy = (sortKey === "relevance" ? SORTS.name : SORTS[sortKey]).replace(":fresh", String(fresh));

    let total;
    let page_;
    let unlistedTotal = 0;
    let unlistedPage = [];
    if (mode === "browse") {
      const clauses = ["s.market_key = ?"];
      const params = [market.market_key];
      if (!includeEmpty) clauses.push("s.quantity > 0");
      if (filters.clauses.length) { clauses.push(`s.item_id IN (SELECT m.item_id FROM market_item_meta m WHERE ${filters.clauses.join(" AND ")})`); params.push(...filters.params); }
      if (below) clauses.push(BELOW_MARKET);
      const where = `WHERE ${clauses.join(" AND ")}`;
      total = db.prepare(`SELECT COUNT(*) AS n FROM market_summaries s ${where}`).get(...params)?.n ?? 0;
      // Sorting by a summary column pages without the item join.
      const join = /\bm\./.test(orderBy) ? "LEFT JOIN market_item_meta m ON m.item_id = s.item_id" : "";
      page_ = db.prepare(`SELECT s.rowid AS sid, s.item_id FROM market_summaries s ${join} ${where}
        ORDER BY ${orderBy} ${dir}, s.item_id ASC, s.item_key ASC LIMIT ? OFFSET ?`).all(...params, size, (current - 1) * size);
    } else {
      // Matching items: an exact id, or every word of the name.
      const hitClauses = [];
      const hitParams = [];
      let rank = "0";
      const rankParams = [];
      if (byId) { hitClauses.push("m.item_id = ?"); hitParams.push(byId); }
      else {
        const phrase = tokens.join(" ");
        for (const token of tokens) { hitClauses.push("m.search_name LIKE ? ESCAPE '\\'"); hitParams.push(likePattern(token)); }
        rank = "CASE WHEN m.search_name = ? THEN 0 WHEN m.search_name LIKE ? ESCAPE '\\' THEN 1 WHEN (' ' || m.search_name) LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END";
        rankParams.push(phrase, likePattern(phrase, { prefix: true }), likePattern(` ${phrase}`));
      }
      const hitWhere = [...hitClauses, ...filters.clauses].join(" AND ");
      // Variants found by their own name ("of the Bear") whose base item did
      // not match: only listed ones, they exist only in a market.
      const variantClauses = tokens.map(() => "v.search_name LIKE ? ESCAPE '\\'");
      const variantParams = tokens.map((token) => likePattern(token));
      // "+s.quantity": join by (item_id, market_key), never by scanning the
      // market's (market_key, quantity) index once per matching item.
      const listedWhere = `+s.quantity > 0${below ? ` AND ${BELOW_MARKET}` : ""}`;
      const rowsSql = `WITH hits AS (SELECT m.item_id, ${rank} AS rank FROM market_item_meta m WHERE ${hitWhere}),
        found AS (
          SELECT h.item_id, h.rank, s.rowid AS sid FROM hits h
            LEFT JOIN market_summaries s ON s.market_key = ? AND s.item_id = h.item_id AND ${listedWhere}
          ${variantClauses.length ? `UNION ALL
          SELECT s.item_id, 2, s.rowid FROM market_variant_names v
            JOIN market_summaries s ON s.item_key = v.item_key AND s.market_key = ? AND ${listedWhere}
            WHERE ${variantClauses.join(" AND ")} AND s.item_id NOT IN (SELECT item_id FROM hits)
            ${filters.clauses.length ? `AND s.item_id IN (SELECT m.item_id FROM market_item_meta m WHERE ${filters.clauses.join(" AND ")})` : ""}` : ""}
        )`;
      const rowsParams = [...rankParams, ...hitParams, ...filters.params, market.market_key,
        ...(variantClauses.length ? [market.market_key, ...variantParams, ...filters.params] : [])];
      // Below market and "listed only" drop rows without listings.
      const outer = below || listed ? "WHERE f.sid IS NOT NULL" : "";
      total = db.prepare(`${rowsSql} SELECT COUNT(*) AS n FROM found f ${outer}`).get(...rowsParams)?.n ?? 0;
      const order = sortKey === "relevance" ? `f.rank ASC, (f.sid IS NULL) ASC, ${SORTS.name} ASC`
        : `(f.sid IS NULL) ASC, ${orderBy} ${dir}, ${SORTS.name} ASC`;
      page_ = db.prepare(`${rowsSql} SELECT f.sid, f.item_id FROM found f LEFT JOIN market_summaries s ON s.rowid = f.sid
        LEFT JOIN market_item_meta m ON m.item_id = f.item_id ${outer}
        ORDER BY ${order}, f.item_id ASC, s.item_key ASC LIMIT ? OFFSET ?`).all(...rowsParams, size, (current - 1) * size);
      // With listings only: the best few known items that matched but have
      // nothing listed here, so the page can say "none on this AH".
      if (outer) {
        unlistedTotal = db.prepare(`${rowsSql} SELECT COUNT(*) AS n FROM found f WHERE f.sid IS NULL`).get(...rowsParams)?.n ?? 0;
        unlistedPage = db.prepare(`${rowsSql} SELECT f.sid, f.item_id FROM found f LEFT JOIN market_item_meta m ON m.item_id = f.item_id
          WHERE f.sid IS NULL ORDER BY f.rank ASC, ${SORTS.name} ASC, f.item_id ASC LIMIT 3`).all(...rowsParams);
      }
    }

    // Details for these rows only.
    const shown = [...page_, ...unlistedPage];
    const sids = shown.map((row) => row.sid).filter((sid) => sid !== null && sid !== undefined);
    const summaries = new Map(sids.length ? db.prepare(`SELECT s.rowid AS sid, s.*, v.name AS variant_name FROM market_summaries s
      LEFT JOIN market_variant_names v ON v.item_key = s.item_key WHERE s.rowid IN (${sids.map(() => "?").join(",")})`).all(...sids).map((row) => [row.sid, row]) : []);
    const item = metaFor(db, shown.map((row) => row.item_id));
    const coverage = marketCoverageInDatabase(db, market.market_key, now);
    const unlistedIds = [...new Set(shown.filter((row) => row.sid === null || row.sid === undefined).map((row) => row.item_id))];
    // Items a complete view saw with nothing listed.
    const noneListed = new Map(unlistedIds.length ? db.prepare(`SELECT item_id, MAX(COALESCE(confirmed_at, observed_at)) AS at FROM market_summaries
      WHERE market_key = ? AND item_id IN (${unlistedIds.map(() => "?").join(",")}) AND quantity = 0 GROUP BY item_id`)
      .all(market.market_key, ...unlistedIds).map((row) => [row.item_id, row.at]) : []);
    const describe = (row) => {
      const summary = summaries.get(row.sid);
      if (summary) return { item: item(row.item_id), ...summaryFromRow(summary, now), listing: summary.quantity > 0 ? "listed" : "none_listed" };
      const seenNone = noneListed.get(row.item_id) ?? null;
      const at = Math.max(seenNone || 0, coverage.complete ? coverage.fullAt : 0) || null;
      return { item: item(row.item_id), itemKey: null, variant: null, variantName: null,
        listing: at ? "none_listed" : "unknown", observedAt: at, ageSeconds: at ? Math.max(0, now - at) : null, stale: at ? now - at > STALE_SECONDS : null,
        minUnitBuyout: null, typicalUnitBuyout: null, quantity: null, listings: null, source: null, confidence: null, pct: null,
        listingNote: at ? (seenNone && seenNone >= (coverage.complete ? coverage.fullAt : 0) ? "None listed when this item was last checked." : "Not in the latest complete view of this auction house.")
          : coverage.note };
    };
    return {
      market: marketFromRow(market, now), mode, query, total: Number(total), page: current, pageSize: size, sort: sortKey, direction: dir.toLowerCase(),
      filters: { category: filters.category, listedOnly: listed }, coverage,
      categories: marketCategories(db, market), results: page_.map(describe),
      unlisted: { total: Number(unlistedTotal), items: unlistedPage.map(describe) },
    };
  });
}

// Indexes game data that arrived since the last catalog batch, so a newly
// seen item is searchable at once. Bounded: one batch, only when behind.
function catchUpCatalog(now) {
  try {
    if (!withGuildDatabase((db) => catalogBehindInDatabase(db))) return;
    withGuildTransaction((db) => syncMarketCatalogInDatabase(db, { limit: 500, now }));
  } catch (error) {
    // A busy database must never fail a search; the background sync catches up.
    if (!/busy|locked/i.test(String(error?.message))) throw error;
  }
}

// Suggestions while typing: names that start with the text first (an index
// range), then names containing every word (stops at the first matches).
// Prices only from the selected market, and only the base item's own:
// variants are counted, never priced here.
export function suggestItems({ q = "", marketKey = "", limit = 8, now = nowSeconds() }) {
  catchUpCatalog(now);
  return withGuildDatabase((db) => {
    const query = text(q, 60);
    const size = Math.min(20, Math.max(1, Number(limit) || 8));
    const byId = /^\s*#?\d+\s*$/.test(query) ? positiveInteger(query.replace(/\D/g, "")) : null;
    const key = searchKey(query);
    let rows = [];
    if (byId) rows = db.prepare("SELECT item_id, name, quality_id, icon_file_id FROM market_item_meta WHERE item_id = ?").all(byId);
    else if (key.length >= 2) {
      const tokens = searchTokens(query);
      rows = db.prepare(`SELECT item_id, name, quality_id, icon_file_id FROM market_item_meta WHERE search_name >= ? AND search_name < ?
        ORDER BY search_name LIMIT ?`).all(key, `${key}￿`, size);
      if (rows.length < size) {
        const seen = new Set(rows.map((row) => row.item_id));
        const more = db.prepare(`SELECT item_id, name, quality_id, icon_file_id, search_name FROM market_item_meta
          WHERE ${tokens.map(() => "search_name LIKE ? ESCAPE '\\'").join(" AND ")} LIMIT ?`).all(...tokens.map((token) => likePattern(token)), size * 4)
          .filter((row) => !seen.has(row.item_id))
          .sort((a, b) => Number(!(` ${b.search_name}`).includes(` ${key}`)) - Number(!(` ${a.search_name}`).includes(` ${key}`)) || a.name.length - b.name.length || a.name.localeCompare(b.name));
        rows = [...rows, ...more].slice(0, size);
      }
    }
    rows = rows.filter((row) => row.name);
    const market = text(marketKey, 160);
    const listed = new Map();
    if (market && rows.length) {
      for (const row of db.prepare(`SELECT item_id, item_key, min_unit_buyout, quantity FROM market_summaries WHERE market_key = ?
        AND item_id IN (${rows.map(() => "?").join(",")}) AND quantity > 0`).all(market, ...rows.map((row) => row.item_id))) {
        if (!listed.has(row.item_id)) listed.set(row.item_id, { base: null, variants: 0 });
        if (row.item_key === `i:${row.item_id}`) listed.get(row.item_id).base = row;
        else listed.get(row.item_id).variants += 1;
      }
    }
    return { marketKey: market || null, suggestions: rows.map((row) => {
      const here = listed.get(row.item_id);
      return { itemId: row.item_id, name: row.name, qualityId: row.quality_id, iconFileDataId: row.icon_file_id, listed: Boolean(here), priced: Boolean(here?.base),
        minUnitBuyout: here?.base?.min_unit_buyout ?? null, quantity: here?.base?.quantity ?? null, variants: here?.variants ?? 0 };
    }) };
  });
}

function evidenceFromRow(row) {
  return { marketKey: row.market_key, itemKey: row.item_key, source: row.source_type, coverage: row.coverage, complete: row.complete === 1,
    observedAt: row.observed_at, confirmedAt: row.confirmed_at ?? row.observed_at, minUnitBuyout: row.min_unit_buyout, minQuantity: row.min_quantity ?? null,
    typicalUnitBuyout: row.typical_unit_buyout, maxUnitBuyout: row.max_unit_buyout, minUnitBid: row.min_unit_bid, quantity: row.quantity,
    listings: row.listings, bidOnlyListings: row.bid_only_listings, pricePoints: row.price_points ? json(row.price_points, []) : [] };
}

// The item's base description as the item catalog shows it (the same
// public projection: tooltip lines the game rendered, slot, binding), from
// the newest English definition. Nothing when no player's game described it.
function itemDefinitionInDatabase(db, id) {
  const row = db.prepare(`SELECT definition_json, game_build FROM public_game_items WHERE item_id = ? AND definition_json <> '{}'
    ORDER BY (locale = 'en_US') DESC, captured_at DESC LIMIT 1`).get(id);
  if (!row) return { tooltipLines: [], described: false };
  const definition = publicItemDefinition(json(row.definition_json, {}), { base: true }) || {};
  return { tooltipLines: definition.tooltipLines || [], equipLocation: definition.equipLocation || "", described: true, gameBuild: row.game_build };
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
    const marketRow = selected ? db.prepare("SELECT * FROM market_markets WHERE market_key = ?").get(selected) : null;
    // Listed here, confirmed none listed, or not known: the same rule as Search.
    const coverage = marketRow ? marketCoverageInDatabase(db, selected, now) : null;
    const listedHere = here.some((row) => row.quantity > 0);
    const seenNone = here.filter((row) => row.quantity === 0).reduce((at, row) => Math.max(at, row.confirmed_at ?? row.observed_at), 0);
    const noneAt = Math.max(seenNone, coverage?.complete ? coverage.fullAt : 0) || null;
    return {
      item: { ...item, ...itemDefinitionInDatabase(db, id) },
      marketKey: selected || null,
      // The server chose the market only when none was asked for (the item
      // catalog page); the page says which market it shows.
      market: marketRow ? { marketKey: marketRow.market_key, name: marketRow.name, kind: marketRow.kind, region: marketRow.region, chosen: text(marketKey, 160) ? "requested" : "server" } : null,
      listing: listedHere ? "listed" : noneAt ? "none_listed" : "unknown",
      listingObservedAt: listedHere ? null : noneAt,
      listingAgeSeconds: !listedHere && noneAt ? Math.max(0, now - noneAt) : null,
      coverage,
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
