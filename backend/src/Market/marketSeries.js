// Price and supply history at four resolutions, finer for watched items.
//
//                normal items   watched items (favorites, lists, views)
//   hourly       48 hours       7 days
//   daily        30 days        90 days
//   weekly       52 weeks       52 weeks
//   monthly      24 months      24 months
//
// Hourly and daily rows are written as observations arrive; weekly and
// monthly rows are rolled up from daily rows by maintenance. Rows are only
// written from complete observations (every listing of the item visible)
// and only at the time they were observed. A bucket with no observation has
// no row: charts show a gap, never an invented price. A full snapshot that
// no longer lists an item writes quantity 0 with no price, which is an
// observation too ("none listed").
//
// Nothing is deleted before the coarser resolution holding it exists: an
// hourly row only once its day's row exists, a daily row only once its week
// and month are rolled up *and final*, a weekly row only once its month is
// final. A period is final when observations can no longer arrive for any
// of its days (see LATE_DAYS); final rows are never recomputed, so deleting
// their days can never shrink them.
import { gapSeconds, median } from "./marketAnalysis.js";

export const RETENTION = Object.freeze({
  hourlyHours: 48,
  watchedHourlyHours: 7 * 24,
  dailyDays: 30,
  watchedDailyDays: 90,
  weeklyWeeks: 52,
  monthlyMonths: 24,
  watchedLimit: 3000,
});
// Observations up to 7 days old are accepted (MAX_OBSERVATION_AGE_SECONDS in
// marketRepository.js); a day more of margin before a period is final.
export const LATE_DAYS = 8;
// How long views count toward the watched set.
const INTEREST_DAYS = 14;
const REFERENCE_DAYS = 14;
// Item keys sort below this: the open end of a key range.
const KEY_MAX = "\u{10FFFF}";

export function dayOf(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The Monday (UTC) of a day's week.
export function weekOf(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

// The first day of a day's month.
export function monthOf(day) {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(month) {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function monthsBefore(seconds, months) {
  const date = new Date(seconds * 1000);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

const lowest = (column) => `CASE WHEN ${column} IS NULL THEN excluded.${column} WHEN excluded.${column} IS NULL THEN ${column} ELSE MIN(${column}, excluded.${column}) END`;
const highest = (column) => `CASE WHEN ${column} IS NULL THEN excluded.${column} WHEN excluded.${column} IS NULL THEN ${column} ELSE MAX(${column}, excluded.${column}) END`;
// Close values: the newest observation in the bucket wins, whatever order
// observations arrive in. (SET expressions all read the old row.)
const close = (column) => `CASE WHEN excluded.last_at >= last_at THEN excluded.${column} ELSE ${column} END`;

// Statements for writing series points, prepared once per snapshot chunk.
export function seriesWriter(db) {
  const hourly = db.prepare(`INSERT INTO market_series_hourly (market_key, item_key, source_type, hour, first_at, last_at, samples,
      min_low, min_close, typical_close, quantity_low, quantity_high, quantity_close, listings_close)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_key, item_key, source_type, hour) DO UPDATE SET
      samples = samples + 1, first_at = MIN(first_at, excluded.first_at), last_at = MAX(last_at, excluded.last_at),
      min_low = ${lowest("min_low")}, min_close = ${close("min_close")}, typical_close = ${close("typical_close")},
      quantity_low = MIN(quantity_low, excluded.quantity_low), quantity_high = MAX(quantity_high, excluded.quantity_high),
      quantity_close = ${close("quantity_close")}, listings_close = ${close("listings_close")}`);
  const daily = db.prepare(`INSERT INTO market_series_daily (market_key, item_key, source_type, day, first_at, last_at, samples,
      min_low, min_high, min_close, typical_low, typical_high, typical_close, quantity_low, quantity_high, quantity_close, listings_close)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_key, item_key, source_type, day) DO UPDATE SET
      samples = samples + 1, first_at = MIN(COALESCE(first_at, excluded.first_at), excluded.first_at),
      last_at = MAX(COALESCE(last_at, 0), excluded.last_at),
      min_low = ${lowest("min_low")}, min_high = ${highest("min_high")}, min_close = CASE WHEN excluded.last_at >= COALESCE(last_at, 0) THEN excluded.min_close ELSE min_close END,
      typical_low = ${lowest("typical_low")}, typical_high = ${highest("typical_high")},
      typical_close = CASE WHEN excluded.last_at >= COALESCE(last_at, 0) THEN excluded.typical_close ELSE typical_close END,
      quantity_low = MIN(quantity_low, excluded.quantity_low), quantity_high = MAX(quantity_high, excluded.quantity_high),
      quantity_close = CASE WHEN excluded.last_at >= COALESCE(last_at, 0) THEN excluded.quantity_close ELSE quantity_close END,
      listings_close = CASE WHEN excluded.last_at >= COALESCE(last_at, 0) THEN excluded.listings_close ELSE listings_close END`);
  return (marketKey, sourceType, at, item) => {
    const min = item.minUnitBuyout ?? null;
    const typical = item.typicalUnitBuyout ?? null;
    const listings = item.listings ?? null;
    hourly.run(marketKey, item.itemKey, sourceType, Math.floor(at / 3600), at, at, min, min, typical, item.quantity, item.quantity, item.quantity, listings);
    daily.run(marketKey, item.itemKey, sourceType, dayOf(at), at, at, min, min, min, typical, typical, typical, item.quantity, item.quantity, item.quantity, listings);
  };
}

// How far back the roll-up reads days: since the last roll-up plus the
// days late observations can still change (a server that was down catches
// up). Never rolled up before: everything stored.
export function rollUpWindowDays(lastRanAt, now) {
  if (!Number.isFinite(lastRanAt) || lastRanAt <= 0 || lastRanAt > now) return Infinity;
  return Math.max(15, Math.ceil((now - lastRanAt) / 86400) + LATE_DAYS + 1);
}

// Week and month rows from day rows. A window starts at the Monday of the
// first day of a month, so every week and month it touches is read whole;
// periods that start before the window were finished by an earlier run.
// Final rows are left alone.
//
// `marketKey` limits the roll-up to one market and `range` ({ from, to }:
// item keys, from inclusive, to exclusive, either may be null) to a page of
// its items, so maintenance runs as many short transactions.
export function rollUpSeriesInDatabase(db, now, { sinceDays = 15, marketKey = null, range = null } = {}) {
  const since = Number.isFinite(sinceDays) ? weekOf(monthOf(dayOf(now - sinceDays * 86400))) : "0000-00-00";
  const finalBefore = dayOf(now - LATE_DAYS * 86400);
  const rows = marketKey
    ? db.prepare(`SELECT * FROM market_series_daily WHERE market_key = ? AND item_key >= ? AND item_key < ? AND day >= ?
        ORDER BY market_key, item_key, source_type, day`).all(marketKey, range?.from ?? "", range?.to ?? KEY_MAX, since)
    : db.prepare(`SELECT * FROM market_series_daily WHERE day >= ? ORDER BY market_key, item_key, source_type, day`).all(since);
  const tables = {
    week: { table: "market_series_weekly", column: "week", end: (week) => addDays(week, 6) },
    month: { table: "market_series_monthly", column: "month", end: monthEnd },
  };
  const statements = Object.fromEntries(Object.entries(tables).map(([kind, spec]) => [kind, {
    final: db.prepare(`SELECT final FROM ${spec.table} WHERE market_key = ? AND item_key = ? AND source_type = ? AND ${spec.column} = ?`),
    upsert: db.prepare(`INSERT OR REPLACE INTO ${spec.table} (market_key, item_key, source_type, ${spec.column}, days, samples,
        min_low, min_high, min_close, typical_low, typical_high, typical_close, typical_median, quantity_low, quantity_high, quantity_close, listings_close, final)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  }]));
  const counts = { weeks: 0, months: 0 };
  const flush = (kind, group) => {
    if (!group || group.start < since) return;
    const spec = tables[kind];
    const statement = statements[kind];
    if (statement.final.get(group.marketKey, group.itemKey, group.sourceType, group.start)?.final === 1) return;
    const days = group.days;
    const last = days.at(-1);
    const values = (key) => days.map((day) => day[key]).filter((value) => value !== null && value !== undefined);
    const minOf = (key) => (values(key).length ? Math.min(...values(key)) : null);
    const maxOf = (key) => (values(key).length ? Math.max(...values(key)) : null);
    statement.upsert.run(group.marketKey, group.itemKey, group.sourceType, group.start, days.length, days.reduce((sum, day) => sum + day.samples, 0),
      minOf("min_low"), maxOf("min_high"), last.min_close, minOf("typical_low"), maxOf("typical_high"), last.typical_close, median(values("typical_close")),
      minOf("quantity_low"), maxOf("quantity_high"), last.quantity_close, last.listings_close, spec.end(group.start) < finalBefore ? 1 : 0);
    counts[kind === "week" ? "weeks" : "months"] += 1;
  };
  const open = { week: null, month: null };
  for (const row of rows) {
    for (const [kind, start] of [["week", weekOf(row.day)], ["month", monthOf(row.day)]]) {
      const group = open[kind];
      if (!group || group.marketKey !== row.market_key || group.itemKey !== row.item_key || group.sourceType !== row.source_type || group.start !== start) {
        flush(kind, group);
        open[kind] = { marketKey: row.market_key, itemKey: row.item_key, sourceType: row.source_type, start, days: [] };
      }
      open[kind].days.push(row);
    }
  }
  flush("week", open.week);
  flush("month", open.month);
  return counts;
}

// Weeks only, as before months existed (callers that count weeks).
export function rollUpWeeksInDatabase(db, now, options = {}) {
  return rollUpSeriesInDatabase(db, now, options).weeks;
}

// Each summary's reference price: the median of the last REFERENCE_DAYS
// observed daily typical asks from the summary's own source.
export function refreshReferencePricesInDatabase(db, now, { marketKey: only = null, range = null } = {}) {
  const since = dayOf(now - REFERENCE_DAYS * 86400);
  const update = db.prepare("UPDATE market_summaries SET reference_price = ?, reference_days = ? WHERE market_key = ? AND item_key = ?");
  const from = range?.from ?? "";
  const to = range?.to ?? KEY_MAX;
  let updated = 0;
  const markets = only ? [{ market_key: only }] : db.prepare("SELECT DISTINCT market_key FROM market_summaries").all();
  for (const { market_key: marketKey } of markets) {
    const rows = db.prepare(`SELECT d.item_key, d.typical_close, d.min_close FROM market_series_daily d
      JOIN market_summaries s ON s.market_key = d.market_key AND s.item_key = d.item_key AND s.source_type = d.source_type
      WHERE d.market_key = ? AND d.item_key >= ? AND d.item_key < ? AND d.day >= ?
      ORDER BY d.item_key`).all(marketKey, from, to, since);
    const byItem = new Map();
    for (const row of rows) {
      const value = row.typical_close ?? row.min_close;
      if (value === null) continue;
      if (!byItem.has(row.item_key)) byItem.set(row.item_key, []);
      byItem.get(row.item_key).push(value);
    }
    db.prepare(`UPDATE market_summaries SET reference_price = NULL, reference_days = 0 WHERE market_key = ?
      AND item_key >= ? AND item_key < ?`).run(marketKey, from, to);
    for (const [itemKey, values] of byItem) {
      update.run(median(values), values.length, marketKey, itemKey);
      updated += 1;
    }
  }
  return updated;
}

// Item-key ranges covering every item a market has, each about `size`
// items: maintenance works through a large market page by page. The first
// range starts at the beginning and the last runs to the end, so rows of
// items the summaries do not know are covered too.
export function marketItemRangesInDatabase(db, marketKey, size = 2000) {
  const keys = db.prepare("SELECT item_key FROM market_summaries WHERE market_key = ? ORDER BY item_key").all(marketKey).map((row) => row.item_key);
  const ranges = [];
  for (let start = 0; start < keys.length; start += size) {
    ranges.push({ from: start === 0 ? null : keys[start], to: start + size < keys.length ? keys[start + size] : null });
  }
  return ranges.length ? ranges : [{ from: null, to: null }];
}

// The item variants people care about, per market: favorites, shopping
// lists and recent views of the item, every variant the market has, most
// wanted first, at most RETENTION.watchedLimit. Rebuilt by maintenance.
export function refreshWatchedInDatabase(db, now, { limit = RETENTION.watchedLimit } = {}) {
  const rows = db.prepare(`WITH interest AS (
      SELECT item_id, SUM(score) AS score FROM (
        SELECT item_id, 3.0 AS score FROM market_favorites
        UNION ALL SELECT item_id, 2.0 FROM market_shopping_list_items
        UNION ALL SELECT item_id, MIN(views, 20) * 0.25 FROM market_item_interest WHERE day >= ?
      ) GROUP BY item_id)
    SELECT s.market_key, s.item_key, s.item_id, i.score FROM interest i JOIN market_summaries s ON s.item_id = i.item_id
    ORDER BY i.score DESC, s.quantity DESC, s.market_key, s.item_key LIMIT ?`).all(dayOf(now - INTEREST_DAYS * 86400), limit);
  db.prepare("DELETE FROM market_watched").run();
  const insert = db.prepare("INSERT INTO market_watched (market_key, item_key, item_id, score, updated_at) VALUES (?, ?, ?, ?, ?)");
  for (const row of rows) insert.run(row.market_key, row.item_key, row.item_id, row.score, now);
  return rows.length;
}

export function isWatchedInDatabase(db, marketKeys, itemKey) {
  if (!marketKeys.length) return false;
  return Boolean(db.prepare(`SELECT 1 FROM market_watched WHERE market_key IN (${marketKeys.map(() => "?").join(",")}) AND item_key = ? LIMIT 1`)
    .get(...marketKeys, itemKey));
}

// Retention, one statement per resolution, run per market and item range
// (the tables are keyed by market and item, so each run is a short range
// scan). Every delete names the coarser row that must already hold what it
// removes.
const WATCHED = (table) => `EXISTS (SELECT 1 FROM market_watched w WHERE w.market_key = ${table}.market_key AND w.item_key = ${table}.item_key)`;
const SAME_SERIES = (alias, table) => `${alias}.market_key = ${table}.market_key AND ${alias}.item_key = ${table}.item_key AND ${alias}.source_type = ${table}.source_type`;

export function seriesPruneSteps(now) {
  const hour = (hours) => Math.floor((now - hours * 3600) / 3600);
  const day = (days) => dayOf(now - days * 86400);
  const range = "market_key = ? AND item_key >= ? AND item_key < ?";
  return [
    {
      name: "hourly",
      table: "market_series_hourly",
      sql: `DELETE FROM market_series_hourly WHERE ${range} AND hour < ? AND (hour < ? OR NOT ${WATCHED("market_series_hourly")})
        AND EXISTS (SELECT 1 FROM market_series_daily d WHERE ${SAME_SERIES("d", "market_series_hourly")} AND d.day = date(market_series_hourly.hour * 3600, 'unixepoch'))`,
      held: `SELECT COUNT(*) AS n FROM market_series_hourly WHERE ${range} AND hour < ? AND (hour < ? OR NOT ${WATCHED("market_series_hourly")})`,
      params: [hour(RETENTION.hourlyHours), hour(RETENTION.watchedHourlyHours)],
    },
    {
      name: "daily",
      table: "market_series_daily",
      sql: `DELETE FROM market_series_daily WHERE ${range} AND day < ? AND (day < ? OR NOT ${WATCHED("market_series_daily")})
        AND EXISTS (SELECT 1 FROM market_series_weekly w WHERE ${SAME_SERIES("w", "market_series_daily")} AND w.final = 1
          AND w.week = date(market_series_daily.day, '-' || ((CAST(strftime('%w', market_series_daily.day) AS INTEGER) + 6) % 7) || ' days'))
        AND EXISTS (SELECT 1 FROM market_series_monthly m WHERE ${SAME_SERIES("m", "market_series_daily")} AND m.final = 1
          AND m.month = substr(market_series_daily.day, 1, 7) || '-01')`,
      held: `SELECT COUNT(*) AS n FROM market_series_daily WHERE ${range} AND day < ? AND (day < ? OR NOT ${WATCHED("market_series_daily")})`,
      params: [day(RETENTION.dailyDays), day(RETENTION.watchedDailyDays)],
    },
    {
      name: "weekly",
      table: "market_series_weekly",
      sql: `DELETE FROM market_series_weekly WHERE ${range} AND week < ? AND final = 1
        AND EXISTS (SELECT 1 FROM market_series_monthly m WHERE ${SAME_SERIES("m", "market_series_weekly")} AND m.final = 1
          AND m.month = substr(market_series_weekly.week, 1, 7) || '-01')`,
      held: `SELECT COUNT(*) AS n FROM market_series_weekly WHERE ${range} AND week < ?`,
      params: [day(RETENTION.weeklyWeeks * 7)],
    },
    {
      name: "monthly",
      table: "market_series_monthly",
      sql: `DELETE FROM market_series_monthly WHERE ${range} AND month < ?`,
      held: null,
      params: [monthsBefore(now, RETENTION.monthlyMonths)],
    },
  ];
}

export function runSeriesPruneStepInDatabase(db, step, marketKey, range = null) {
  const keys = [marketKey, range?.from ?? "", range?.to ?? KEY_MAX];
  const removed = Number(db.prepare(step.sql).run(...keys, ...step.params).changes);
  // Rows past their retention that stay because a coarser row is missing:
  // non-zero only if roll-ups are behind. Shown in diagnostics.
  const held = step.held ? Number(db.prepare(step.held).get(...keys, ...step.params).n) : 0;
  return { removed, held };
}

// Ranges: which resolution answers them and how far back they reach.
// `watched` is the finer resolution watched items keep.
export const SERIES_RANGES = Object.freeze({
  "24h": { resolution: "hour", seconds: 86400 },
  "7d": { resolution: "day", watched: "hour", seconds: 7 * 86400 },
  "30d": { resolution: "day", seconds: 30 * 86400 },
  "90d": { resolution: "week", watched: "day", seconds: 90 * 86400 },
  "1y": { resolution: "week", seconds: 365 * 86400 },
  all: { resolution: "month", seconds: null },
});

const RESOLUTION_SECONDS = { hour: 3600, day: 86400, week: 7 * 86400, month: 30 * 86400 };
const RESOLUTION_TABLES = {
  day: { table: "market_series_daily", column: "day" },
  week: { table: "market_series_weekly", column: "week" },
  month: { table: "market_series_monthly", column: "month" },
};

function point(row, resolution) {
  if (resolution === "hour") {
    return { t: row.hour * 3600, firstAt: row.first_at, lastAt: row.last_at, samples: row.samples, min: row.min_close, minLow: row.min_low,
      typical: row.typical_close, quantity: row.quantity_close, quantityLow: row.quantity_low, quantityHigh: row.quantity_high, listings: row.listings_close };
  }
  const key = row[RESOLUTION_TABLES[resolution].column];
  return { t: Date.parse(`${key}T00:00:00Z`) / 1000, label: key, firstAt: row.first_at ?? null, lastAt: row.last_at ?? null, samples: row.samples,
    days: row.days ?? undefined, min: row.min_close, minLow: row.min_low, minHigh: row.min_high, typical: row.typical_close,
    typicalLow: row.typical_low, typicalHigh: row.typical_high, typicalMedian: row.typical_median ?? undefined,
    quantity: row.quantity_close, quantityLow: row.quantity_low, quantityHigh: row.quantity_high, listings: row.listings_close };
}

// Points for one item variant in the given markets, per market and source.
export function readSeriesInDatabase(db, { marketKeys, itemKey, range = "7d", now }) {
  const name = SERIES_RANGES[range] ? range : "7d";
  const spec = SERIES_RANGES[name];
  const watched = isWatchedInDatabase(db, marketKeys, itemKey);
  const resolution = watched && spec.watched ? spec.watched : spec.resolution;
  const placeholders = marketKeys.map(() => "?").join(",");
  let rows;
  if (resolution === "hour") {
    rows = db.prepare(`SELECT * FROM market_series_hourly WHERE market_key IN (${placeholders}) AND item_key = ? AND hour >= ? ORDER BY hour`)
      .all(...marketKeys, itemKey, Math.floor((now - spec.seconds) / 3600));
  } else {
    const { table, column } = RESOLUTION_TABLES[resolution];
    // A week or month that started before the range still overlaps it.
    const from = spec.seconds ? (resolution === "week" ? weekOf(dayOf(now - spec.seconds)) : resolution === "month" ? monthOf(dayOf(now - spec.seconds)) : dayOf(now - spec.seconds)) : "0000-00-00";
    rows = db.prepare(`SELECT * FROM ${table} WHERE market_key IN (${placeholders}) AND item_key = ? AND ${column} >= ? ORDER BY ${column}`)
      .all(...marketKeys, itemKey, from);
  }
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.market_key}|${row.source_type}`;
    if (!groups.has(key)) groups.set(key, { marketKey: row.market_key, source: row.source_type, points: [] });
    groups.get(key).points.push(point(row, resolution));
  }
  const resolutionSeconds = RESOLUTION_SECONDS[resolution];
  const series = [...groups.values()].map((entry) => ({ ...entry, gapSeconds: gapSeconds(entry.points, resolutionSeconds),
    firstAt: entry.points[0]?.t ?? null, lastAt: entry.points.at(-1)?.lastAt ?? entry.points.at(-1)?.t ?? null }))
    .sort((a, b) => b.points.length - a.points.length);
  return { range: name, resolution, resolutionSeconds, watched, from: spec.seconds ? now - spec.seconds : null, to: now, series };
}

// The hourly and daily points the metrics need, for one market and source,
// and how many hours of hourly detail exist for it (watched or not).
export function readMetricInputsInDatabase(db, { marketKey, itemKey, sourceType, now }) {
  const hourly = db.prepare(`SELECT * FROM market_series_hourly WHERE market_key = ? AND item_key = ? AND source_type = ? AND hour >= ? ORDER BY hour`)
    .all(marketKey, itemKey, sourceType, Math.floor((now - 8 * 86400) / 3600)).map((row) => point(row, "hour"));
  const daily = db.prepare(`SELECT * FROM market_series_daily WHERE market_key = ? AND item_key = ? AND source_type = ? AND day >= ? ORDER BY day`)
    .all(marketKey, itemKey, sourceType, dayOf(now - 31 * 86400)).map((row) => point(row, "day"));
  const watched = isWatchedInDatabase(db, [marketKey], itemKey);
  return { hourly, daily, hourlyHours: watched ? RETENTION.watchedHourlyHours : RETENTION.hourlyHours, watched };
}

// Live Auction House storage budgets: every market_* table and index.
export const STORAGE_BUDGET = Object.freeze({ warningBytes: 2 * 1024 ** 3, criticalBytes: 3 * 1024 ** 3 });

export function storageStatus(bytes) {
  return bytes >= STORAGE_BUDGET.criticalBytes ? "critical" : bytes >= STORAGE_BUDGET.warningBytes ? "warning" : "ok";
}

export function marketStorageObjectsInDatabase(db) {
  return db.prepare(`SELECT name, tbl_name AS tableName FROM sqlite_master
    WHERE type IN ('table', 'index') AND substr(tbl_name, 1, 7) = 'market_' ORDER BY tbl_name, name`).all();
}

export function btreeBytesInDatabase(db, name) {
  return Number(db.prepare("SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE name = ? AND aggregate = TRUE").get(name).bytes);
}

// Bytes of every Auction House table (with its indexes), against the budgets.
export function measureMarketStorageInDatabase(db) {
  const tables = {};
  let bytes = 0;
  for (const object of marketStorageObjectsInDatabase(db)) {
    const size = btreeBytesInDatabase(db, object.name);
    tables[object.tableName] = (tables[object.tableName] || 0) + size;
    bytes += size;
  }
  return { bytes, status: storageStatus(bytes), budget: STORAGE_BUDGET, tables };
}
