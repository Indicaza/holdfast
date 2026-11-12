import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { iconStorageConfig, storeIcons } from "../GameData/iconRegistry.js";
import {
  addMarketSnapshotItemsInDatabase,
  beginMarketSnapshotInDatabase,
  ensureMarketInDatabase,
  finishMarketSnapshotInDatabase,
  recordMarketCheckInDatabase,
  ensureItemMetaInDatabase,
  itemsMissingTooltipsInDatabase,
  itemsToLookUpInDatabase,
  markItemsLookedUpInDatabase,
  runMarketMaintenanceInDatabase,
  syncMarketCatalogInDatabase,
} from "./marketRepository.js";

// Large houses are stored a chunk at a time, letting requests in between,
// so the website never pauses for a whole house.
const CHUNK_ITEMS = 2000;
const yieldToRequests = () => new Promise((resolve) => setImmediate(resolve));

// Refreshes external market data a little at a time: each tick reads at
// most one house, the most important one that is due. Failures back off
// (5 min doubling to 6 h) and never touch stored data, so the last good
// snapshot keeps being served, marked stale by its age.
//
// Priority: the official API returns whole houses, never single items, so
// favorites cannot make one item refresh sooner. They decide which houses
// refresh first and most often: houses holding items people favorited,
// shop for or look at refresh every interval; houses no one uses refresh
// at a quarter of the rate.
const TICK_MS = 60_000;
const DISCOVER_SECONDS = 6 * 3600;
const MAX_BACKOFF_SECONDS = 6 * 3600;
const IDLE_MULTIPLIER = 4;
// Pruning, weekly roll-ups and reference prices run daily, with or without
// a provider (in-game scans need them too).
const MAINTENANCE_SECONDS = 20 * 3600;
const MAINTENANCE_CHECK_MS = 3600_000;
// The Auction House item index follows the game data every few minutes, a
// bounded batch per transaction (see syncMarketCatalogInDatabase).
const CATALOG_SYNC_MS = 5 * 60_000;
const CATALOG_BATCHES_PER_RUN = 100;
// Listed items without names are looked up every minute, up to 240 a run.
const NAMES_MS = 60_000;

function nowSeconds(now) {
  return Math.floor(now() / 1000);
}

export function backoffSeconds(failures) {
  return Math.min(MAX_BACKOFF_SECONDS, 300 * 2 ** Math.max(0, failures - 1));
}

// How much people care about a market right now: favorites, shopping-list
// items and recent item views whose items it has.
export function marketPriorityInDatabase(db, marketKey) {
  return db.prepare(`SELECT
      (SELECT COUNT(*) FROM market_favorites f JOIN market_summaries s ON s.item_id = f.item_id AND s.market_key = ?) * 3
    + (SELECT COUNT(*) FROM market_shopping_list_items i JOIN market_summaries s ON s.item_id = i.item_id AND s.market_key = ?) * 2
    + (SELECT COALESCE(SUM(v.views), 0) FROM market_item_interest v JOIN market_summaries s ON s.item_id = v.item_id AND s.market_key = ?
        WHERE v.day >= date('now', '-7 day')) AS score`).get(marketKey, marketKey, marketKey).score;
}

export function createMarketRefresher({ provider, now = () => Date.now(), log = console } = {}) {
  let lastDiscovery = 0;
  let running = false;
  const stats = { ticks: 0, refreshed: 0, unchanged: 0, failed: 0, skipped: 0 };

  async function discover() {
    const markets = [];
    for (const region of provider.config.regions) {
      try {
        markets.push(...await provider.discoverMarkets(region));
      } catch (error) {
        log.warn?.(`[market] ${provider.name} ${region}: could not list auction houses (${error.code || error.message})`);
      }
    }
    if (markets.length) {
      withGuildTransaction((db) => {
        for (const market of markets) {
          ensureMarketInDatabase(db, market);
          db.prepare(`INSERT OR IGNORE INTO market_provider_state (provider, market_key, next_due_at) VALUES (?, ?, 0)`).run(provider.name, market.marketKey);
        }
      });
      lastDiscovery = nowSeconds(now);
    }
    return markets;
  }

  function nextMarket() {
    const at = nowSeconds(now);
    return withGuildDatabase((db) => {
      const due = db.prepare(`SELECT p.*, m.region, m.ruleset_id, m.house_id, m.faction, m.name FROM market_provider_state p
        JOIN market_markets m ON m.market_key = p.market_key WHERE p.provider = ? AND p.next_due_at <= ?`).all(provider.name, at);
      if (!due.length) return null;
      const ranked = due.map((row) => ({ row, priority: marketPriorityInDatabase(db, row.market_key), neverFetched: !row.last_success_at }))
        .sort((a, b) => Number(b.neverFetched) - Number(a.neverFetched) || b.priority - a.priority || a.row.next_due_at - b.row.next_due_at);
      return ranked[0];
    });
  }

  function finishRun(runId, fields) {
    withGuildDatabase((db) => db.prepare(`UPDATE market_provider_runs SET finished_at = ?, status = ?, http_status = ?, auctions = ?, snapshot_id = ?, error = ?, detail = ?
      WHERE id = ?`).run(nowSeconds(now), fields.status, fields.httpStatus ?? null, fields.auctions ?? null, fields.snapshotId ?? null, fields.error || "", fields.detail || "", runId));
  }

  function endpointState(marketKey) {
    return new Map(withGuildDatabase((db) => db.prepare("SELECT * FROM market_provider_endpoints WHERE provider = ? AND market_key = ?").all(provider.name, marketKey))
      .map((row) => [row.endpoint, row]));
  }

  // Stores one endpoint's answer: a new or unchanged snapshot (in chunks,
  // letting requests in between), a "not modified" check, or a failure.
  // Every outcome is recorded against that endpoint alone.
  async function storeEndpoint(market, result, previous) {
    const at = nowSeconds(now);
    const scope = `api:${result.endpoint}`;
    let outcome = { endpoint: result.endpoint, status: result.status, httpStatus: result.httpStatus ?? null };
    if (result.status === "ok") {
      const input = { market, sourceType: provider.sourceType, sourceId: `${provider.name}:${scope}:${result.lastModified || result.observedAt}`,
        coverage: "full", scope, observedAt: result.observedAt, items: result.items, allowEmpty: result.empty === true, now: at };
      const begun = withGuildTransaction((db) => beginMarketSnapshotInDatabase(db, input));
      for (let start = 0; (begun.status === "recorded" || begun.status === "unchanged") && start < begun.items.length; start += CHUNK_ITEMS) {
        await yieldToRequests();
        withGuildTransaction((db) => addMarketSnapshotItemsInDatabase(db, { ...input, snapshotId: begun.snapshotId, observedAt: begun.observedAt,
          items: begun.items.slice(start, start + CHUNK_ITEMS), mode: begun.status, now: at }));
      }
      let absent = 0;
      if (begun.status === "recorded") {
        await yieldToRequests();
        absent = withGuildTransaction((db) => finishMarketSnapshotInDatabase(db, { snapshotId: begun.snapshotId, market, sourceType: provider.sourceType, now: at })).absent;
      }
      outcome = { ...outcome, status: begun.status === "empty" ? "empty" : begun.status, snapshotId: begun.snapshotId ?? null, auctions: result.auctions,
        items: begun.items?.length || 0, absent, observedAt: result.observedAt };
    } else if (result.status === "not_modified") {
      withGuildDatabase((db) => recordMarketCheckInDatabase(db, { marketKey: market.marketKey, sourceType: provider.sourceType,
        sourceId: `${provider.name}:${scope}:checked:${at}`, scope, outcome: "not_modified", now: at }));
    } else if (result.status === "failed") {
      outcome.error = result.error;
    }
    const failed = result.status === "failed";
    const changed = outcome.status === "recorded";
    withGuildDatabase((db) => db.prepare(`INSERT INTO market_provider_endpoints (provider, market_key, endpoint, last_modified, last_checked_at, last_changed_at,
        last_success_at, last_failure_at, last_status, last_error, consecutive_failures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, market_key, endpoint) DO UPDATE SET last_modified = excluded.last_modified, last_checked_at = excluded.last_checked_at,
        last_changed_at = COALESCE(excluded.last_changed_at, last_changed_at), last_success_at = COALESCE(excluded.last_success_at, last_success_at),
        last_failure_at = COALESCE(excluded.last_failure_at, last_failure_at), last_status = excluded.last_status, last_error = excluded.last_error,
        consecutive_failures = excluded.consecutive_failures`)
      .run(provider.name, market.marketKey, result.endpoint, failed ? previous?.last_modified || "" : result.lastModified || previous?.last_modified || "", at,
        changed ? at : null, failed ? null : at, failed ? at : null, outcome.status, failed ? String(result.error).slice(0, 120) : "",
        failed ? (previous?.consecutive_failures || 0) + 1 : 0));
    return outcome;
  }

  async function refreshOne() {
    const next = nextMarket();
    if (!next) return { status: "idle" };
    const { row, priority } = next;
    const at = nowSeconds(now);
    const market = { marketKey: row.market_key, kind: "api_house", region: row.region, rulesetId: row.ruleset_id, houseId: row.house_id, faction: row.faction, name: row.name };
    const runId = withGuildDatabase((db) => Number(db.prepare(`INSERT INTO market_provider_runs (provider, market_key, started_at, status) VALUES (?, ?, ?, 'running')`)
      .run(provider.name, row.market_key, at).lastInsertRowid));
    const interval = provider.config.refreshSeconds * (priority > 0 ? 1 : IDLE_MULTIPLIER);
    const previous = endpointState(row.market_key);
    try {
      const lastModified = Object.fromEntries([...previous.entries()].map(([endpoint, state]) => [endpoint, state.last_modified]));
      const fetched = await provider.fetchMarket(market, { lastModified });
      const outcomes = [];
      for (const result of Object.values(fetched.endpoints)) outcomes.push(await storeEndpoint(market, result, previous.get(result.endpoint)));
      const failures = outcomes.filter((outcome) => outcome.status === "failed");
      const anyChanged = outcomes.some((outcome) => outcome.status === "recorded");
      const status = failures.length === outcomes.length ? "failed" : anyChanged ? "recorded" : "unchanged";
      const detail = JSON.stringify({ endpoints: outcomes });
      const auctions = outcomes.reduce((sum, outcome) => sum + (outcome.auctions || 0), 0);
      if (status === "failed") {
        const failuresInRow = (row.consecutive_failures || 0) + 1;
        const permanent = Object.values(fetched.endpoints).every((result) => result.transient === false);
        const wait = permanent ? Math.max(backoffSeconds(failuresInRow), 3600) : backoffSeconds(failuresInRow);
        const error = failures.map((outcome) => `${outcome.endpoint}: ${outcome.error}`).join("; ").slice(0, 120);
        withGuildDatabase((db) => db.prepare(`UPDATE market_provider_state SET last_attempt_at = ?, last_failure_at = ?, consecutive_failures = ?,
          last_error = ?, next_due_at = ? WHERE provider = ? AND market_key = ?`).run(at, at, failuresInRow, error, at + wait, provider.name, row.market_key));
        finishRun(runId, { status: "failed", httpStatus: failures[0]?.httpStatus, error, detail });
        stats.failed += 1;
        log.warn?.(`[market] ${row.market_key}: refresh failed (${error}), retry in ${Math.round(wait / 60)} min`);
        return { status: "failed", marketKey: row.market_key, error, endpoints: outcomes };
      }
      // One endpoint failing while the other worked: the house is refreshed
      // on schedule and the failing endpoint shows its own error.
      const partialError = failures.map((outcome) => `${outcome.endpoint}: ${outcome.error}`).join("; ").slice(0, 120);
      withGuildDatabase((db) => db.prepare(`UPDATE market_provider_state SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
        last_error = ?, next_due_at = ? WHERE provider = ? AND market_key = ?`).run(at, at, partialError, at + interval, provider.name, row.market_key));
      finishRun(runId, { status: failures.length ? `${status}_partial` : status, auctions, snapshotId: outcomes.find((outcome) => outcome.snapshotId)?.snapshotId, error: partialError, detail });
      if (status === "unchanged") stats.unchanged += 1; else stats.refreshed += 1;
      log.info?.(`[market] ${row.market_key}: ${outcomes.map((outcome) => `${outcome.endpoint} ${outcome.status}${outcome.items ? ` (${outcome.items} items)` : ""}`).join(", ")}`);
      return { status, marketKey: row.market_key, endpoints: outcomes };
    } catch (error) {
      if (error.code === "rate_limited") {
        // Our own limit: try again next tick, not a failure.
        withGuildDatabase((db) => db.prepare("DELETE FROM market_provider_runs WHERE id = ?").run(runId));
        stats.skipped += 1;
        return { status: "rate_limited" };
      }
      const failures = (row.consecutive_failures || 0) + 1;
      const wait = error.transient === false ? Math.max(backoffSeconds(failures), 3600) : backoffSeconds(failures);
      withGuildDatabase((db) => db.prepare(`UPDATE market_provider_state SET last_attempt_at = ?, last_failure_at = ?, consecutive_failures = ?,
        last_error = ?, next_due_at = ? WHERE provider = ? AND market_key = ?`)
        .run(at, at, failures, String(error.code || error.message).slice(0, 120), at + wait, provider.name, row.market_key));
      finishRun(runId, { status: "failed", httpStatus: error.status, error: String(error.code || error.message).slice(0, 120) });
      stats.failed += 1;
      log.warn?.(`[market] ${row.market_key}: refresh failed (${error.code || error.message}), retry in ${Math.round(wait / 60)} min`);
      return { status: "failed", marketKey: row.market_key, error: error.code || error.message };
    }
  }

  async function tick() {
    if (running || !provider.configured()) return { status: "skipped" };
    running = true;
    stats.ticks += 1;
    try {
      if (nowSeconds(now) - lastDiscovery > DISCOVER_SECONDS) await discover();
      const result = await refreshOne();
      return result;
    } finally {
      running = false;
    }
  }

  return { tick, discover, refreshOne, stats: () => ({ ...stats, requestsLastHour: provider.requestsUsed?.() ?? null }) };
}

// Runs maintenance when the last run is older than MAINTENANCE_SECONDS.
export function maintainMarketsIfDue(now = Math.floor(Date.now() / 1000)) {
  const last = withGuildDatabase((db) => db.prepare("SELECT ran_at FROM market_maintenance WHERE name = 'rollup'").get()?.ran_at || 0);
  if (now - last < MAINTENANCE_SECONDS) return null;
  return withGuildTransaction((db) => runMarketMaintenanceInDatabase(db, now));
}

// Indexes new game data for Auction House search, yielding to requests
// between batches. Returns how many items were (re)indexed.
export async function syncMarketCatalog({ batches = CATALOG_BATCHES_PER_RUN, now = () => Math.floor(Date.now() / 1000) } = {}) {
  let items = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const result = withGuildTransaction((db) => syncMarketCatalogInDatabase(db, { now: now() }));
    items += result.items;
    if (result.caughtUp) break;
    await yieldToRequests();
  }
  return items;
}

// Names and classes for listed items nobody has described: Blizzard's
// auction API sends only item ids, so each unknown id is looked up once in
// Blizzard's item API (through the website's game data provider, which
// stores the answer in the item catalog), then the Auction House's item
// index is refreshed for it. A batch at a time; ids that are not found are
// asked again after a week.
export function marketItemDataEnv(env = process.env) {
  const region = String(env.BLIZZARD_REGION || "us").trim().toLowerCase() || "us";
  const configured = String(env.BLIZZARD_STATIC_NAMESPACES || `static-classic1x-${region},static-classic-${region}`).split(",").map((value) => value.trim()).filter(Boolean);
  const forever = String(env.MARKET_ITEM_NAMESPACE || `static-forever-${region}`).trim();
  return { ...env, BLIZZARD_STATIC_NAMESPACES: [...new Set([forever, ...configured])].join(",") };
}

export async function resolveMarketItemNames({ itemProvider, batches = 10, batchSize = 0, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const status = itemProvider?.status?.();
  if (!status?.configured) return { looked: 0, named: 0 };
  // One batch is what the provider asks Blizzard for at once.
  batchSize = batchSize || status.maxEntities || 24;
  let looked = 0;
  let named = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const ids = withGuildTransaction((db) => {
      const due = itemsToLookUpInDatabase(db, { limit: batchSize, now: now() });
      // Then items named but without Blizzard's tooltip text yet.
      if (due.length < batchSize) due.push(...itemsMissingTooltipsInDatabase(db, { limit: batchSize - due.length, now: now() }).filter((id) => !due.includes(id)));
      markItemsLookedUpInDatabase(db, due, now());
      return due;
    });
    if (!ids.length) break;
    const result = await itemProvider.hydrateReferences({ items: ids });
    looked += ids.length;
    named += result?.hydrated || 0;
    withGuildTransaction((db) => ensureItemMetaInDatabase(db, ids.map((itemId) => ({ itemId })), now(), { refresh: true }));
    await yieldToRequests();
  }
  return { looked, named };
}

export function startMarketRefresher({ provider, itemProvider = null, intervalMs = TICK_MS, log = console } = {}) {
  const maintain = () => {
    try { maintainMarketsIfDue(); } catch (error) { log.error?.("[market] maintenance failed", error); }
  };
  let syncing = false;
  const catalog = () => {
    if (syncing) return;
    syncing = true;
    syncMarketCatalog()
      .then((items) => { if (items) log.info?.(`[market] indexed ${items} catalog items for search`); })
      .catch((error) => log.error?.("[market] catalog sync failed", error))
      .finally(() => { syncing = false; });
  };
  let naming = false;
  const names = () => {
    if (naming) return;
    naming = true;
    resolveMarketItemNames({ itemProvider })
      .then(({ looked, named }) => { if (looked) log.info?.(`[market] looked up ${looked} listed items, ${named} found in Blizzard's item data`); })
      .catch((error) => log.error?.("[market] item lookup failed", error))
      .finally(() => { naming = false; });
  };
  const first = setTimeout(maintain, 60_000);
  const maintenance = setInterval(maintain, MAINTENANCE_CHECK_MS);
  const firstCatalog = setTimeout(catalog, 15_000);
  const catalogTimer = setInterval(catalog, CATALOG_SYNC_MS);
  const namesTimer = setInterval(names, NAMES_MS);
  // Copies of icons in object storage, a few at a time, only when configured.
  let copying = false;
  const icons = () => {
    if (copying || !iconStorageConfig()) return;
    copying = true;
    storeIcons().catch((error) => log.error?.("[icons] copying icons failed", error)).finally(() => { copying = false; });
  };
  const iconsTimer = setInterval(icons, CATALOG_SYNC_MS);
  for (const timer of [first, maintenance, firstCatalog, catalogTimer, namesTimer, iconsTimer]) timer.unref?.();
  const stopMaintenance = () => { clearTimeout(first); clearInterval(maintenance); clearTimeout(firstCatalog); clearInterval(catalogTimer); clearInterval(namesTimer); clearInterval(iconsTimer); };
  if (!provider?.configured()) {
    log.info?.("[market] No auction data provider configured; markets fill from in-game scans only.");
    return { stop: stopMaintenance, refresher: null };
  }
  const refresher = createMarketRefresher({ provider, log });
  const timer = setInterval(() => { refresher.tick().catch((error) => log.error?.("[market] refresh tick failed", error)); }, intervalMs);
  timer.unref?.();
  return { stop: () => { clearInterval(timer); stopMaintenance(); }, refresher };
}
