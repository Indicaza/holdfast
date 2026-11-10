import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { addMarketSnapshotItemsInDatabase, beginMarketSnapshotInDatabase, ensureMarketInDatabase, pruneMarketDataInDatabase } from "./marketRepository.js";

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

  function state(marketKey) {
    return withGuildDatabase((db) => db.prepare("SELECT * FROM market_provider_state WHERE provider = ? AND market_key = ?").get(provider.name, marketKey));
  }

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
    withGuildDatabase((db) => db.prepare(`UPDATE market_provider_runs SET finished_at = ?, status = ?, http_status = ?, auctions = ?, snapshot_id = ?, error = ?
      WHERE id = ?`).run(nowSeconds(now), fields.status, fields.httpStatus ?? null, fields.auctions ?? null, fields.snapshotId ?? null, fields.error || "", runId));
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
    try {
      const result = await provider.fetchMarket(market, { lastModified: row.last_modified });
      let snapshot = { status: "unchanged" };
      if (result.status === "ok") {
        const input = { market, sourceType: provider.sourceType, sourceId: `${provider.name}:${row.market_key}`, coverage: "full",
          observedAt: result.observedAt, items: result.items, now: nowSeconds(now) };
        const begun = withGuildTransaction((db) => beginMarketSnapshotInDatabase(db, input));
        snapshot = { status: begun.status, snapshotId: begun.snapshotId, items: begun.items?.length || 0 };
        for (let start = 0; begun.status === "recorded" && start < begun.items.length; start += CHUNK_ITEMS) {
          await yieldToRequests();
          withGuildTransaction((db) => addMarketSnapshotItemsInDatabase(db, { ...input, snapshotId: begun.snapshotId,
            items: begun.items.slice(start, start + CHUNK_ITEMS) }));
        }
      }
      withGuildDatabase((db) => db.prepare(`UPDATE market_provider_state SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
        last_error = '', next_due_at = ?, last_modified = ? WHERE provider = ? AND market_key = ?`)
        .run(at, at, at + interval, result.lastModified || row.last_modified || "", provider.name, row.market_key));
      const status = result.status === "unchanged" || snapshot.status === "duplicate" ? "unchanged" : snapshot.status;
      finishRun(runId, { status, auctions: result.auctions, snapshotId: snapshot.snapshotId });
      if (status === "unchanged") stats.unchanged += 1; else stats.refreshed += 1;
      log.info?.(`[market] ${row.market_key}: ${status}${result.auctions ? `, ${result.auctions} auctions, ${snapshot.items || 0} items` : ""}`);
      return { status, marketKey: row.market_key };
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
      if (stats.ticks % 60 === 0) withGuildTransaction((db) => pruneMarketDataInDatabase(db, nowSeconds(now)));
      return result;
    } finally {
      running = false;
    }
  }

  return { tick, discover, refreshOne, stats: () => ({ ...stats, requestsLastHour: provider.requestsUsed?.() ?? null }) };
}

export function startMarketRefresher({ provider, intervalMs = TICK_MS, log = console } = {}) {
  if (!provider?.configured()) {
    log.info?.("[market] No auction data provider configured; markets fill from in-game scans only.");
    return { stop() {}, refresher: null };
  }
  const refresher = createMarketRefresher({ provider, log });
  const timer = setInterval(() => { refresher.tick().catch((error) => log.error?.("[market] refresh tick failed", error)); }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), refresher };
}
