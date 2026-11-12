// Price and supply history at three resolutions.
//
//   hourly  one row per hour that had an observation, kept HOURLY_DAYS
//   daily   one row per day that had an observation, kept DAILY_DAYS
//   weekly  rolled up from daily rows, kept WEEKLY_YEARS
//
// Rows are only written from complete observations (every listing of the
// item visible) and only at the time they were observed. A bucket with no
// observation has no row: charts show a gap, never an invented price.
// A full snapshot that no longer lists an item writes quantity 0 with no
// price, which is an observation too ("none listed").
import { gapSeconds, median } from "./marketAnalysis.js";

export const HOURLY_DAYS = Math.max(2, Number(process.env.MARKET_HOURLY_RETENTION_DAYS) || 10);
export const DAILY_DAYS = Math.max(30, Number(process.env.MARKET_DAILY_RETENTION_DAYS) || 400);
export const WEEKLY_YEARS = 10;
const REFERENCE_DAYS = 14;

export function dayOf(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

// The Monday (UTC) of a day's week.
export function weekOf(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
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

// Weekly rows from daily rows, for the weeks that changed recently. Safe to
// run again: each week is recomputed from its days.
// How far back the weekly roll-up reads days: two weeks, or back to the
// last roll-up after a pause (a server that was down), never past the days
// still kept.
export function rollUpWindowDays(lastRanAt, now) {
  if (!Number.isFinite(lastRanAt) || lastRanAt <= 0 || lastRanAt > now) return 15;
  return Math.min(DAILY_DAYS, Math.max(15, Math.ceil((now - lastRanAt) / 86400) + 8));
}

// `marketKey` limits the roll-up to one market, so maintenance can run one
// short transaction per market.
// `range` ({ from, to }: item keys from inclusive to exclusive, either may
// be null) limits it further to a page of that market's items.
export function rollUpWeeksInDatabase(db, now, { sinceDays = 15, marketKey = null, range = null } = {}) {
  const since = weekOf(dayOf(now - sinceDays * 86400));
  const rows = marketKey
    ? db.prepare(`SELECT * FROM market_series_daily WHERE market_key = ? AND day >= ?
        AND (? IS NULL OR item_key >= ?) AND (? IS NULL OR item_key < ?) ORDER BY market_key, item_key, source_type, day`)
      .all(marketKey, since, range?.from ?? null, range?.from ?? null, range?.to ?? null, range?.to ?? null)
    : db.prepare(`SELECT * FROM market_series_daily WHERE day >= ? ORDER BY market_key, item_key, source_type, day`).all(since);
  const upsert = db.prepare(`INSERT OR REPLACE INTO market_series_weekly (market_key, item_key, source_type, week, days, samples,
      min_low, min_high, min_close, typical_low, typical_high, typical_close, typical_median, quantity_low, quantity_high, quantity_close, listings_close)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let weeks = 0;
  let group = null;
  const flush = () => {
    if (!group) return;
    const days = group.days;
    const last = days.at(-1);
    const values = (key) => days.map((day) => day[key]).filter((value) => value !== null && value !== undefined);
    const minOf = (key) => (values(key).length ? Math.min(...values(key)) : null);
    const maxOf = (key) => (values(key).length ? Math.max(...values(key)) : null);
    upsert.run(group.marketKey, group.itemKey, group.sourceType, group.week, days.length, days.reduce((sum, day) => sum + day.samples, 0),
      minOf("min_low"), maxOf("min_high"), last.min_close, minOf("typical_low"), maxOf("typical_high"), last.typical_close, median(values("typical_close")),
      minOf("quantity_low"), maxOf("quantity_high"), last.quantity_close, last.listings_close);
    weeks += 1;
  };
  for (const row of rows) {
    const week = weekOf(row.day);
    if (!group || group.marketKey !== row.market_key || group.itemKey !== row.item_key || group.sourceType !== row.source_type || group.week !== week) {
      flush();
      group = { marketKey: row.market_key, itemKey: row.item_key, sourceType: row.source_type, week, days: [] };
    }
    group.days.push(row);
  }
  flush();
  return weeks;
}

// Each summary's reference price: the median of the last REFERENCE_DAYS
// observed daily typical asks from the summary's own source.
export function refreshReferencePricesInDatabase(db, now, { marketKey: only = null, range = null } = {}) {
  const since = dayOf(now - REFERENCE_DAYS * 86400);
  const update = db.prepare("UPDATE market_summaries SET reference_price = ?, reference_days = ? WHERE market_key = ? AND item_key = ?");
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  let updated = 0;
  const markets = only ? [{ market_key: only }] : db.prepare("SELECT DISTINCT market_key FROM market_summaries").all();
  for (const { market_key: marketKey } of markets) {
    const rows = db.prepare(`SELECT d.item_key, d.typical_close, d.min_close FROM market_series_daily d
      JOIN market_summaries s ON s.market_key = d.market_key AND s.item_key = d.item_key AND s.source_type = d.source_type
      WHERE d.market_key = ? AND d.day >= ? AND (? IS NULL OR d.item_key >= ?) AND (? IS NULL OR d.item_key < ?)
      ORDER BY d.item_key`).all(marketKey, since, from, from, to, to);
    const byItem = new Map();
    for (const row of rows) {
      const value = row.typical_close ?? row.min_close;
      if (value === null) continue;
      if (!byItem.has(row.item_key)) byItem.set(row.item_key, []);
      byItem.get(row.item_key).push(value);
    }
    db.prepare(`UPDATE market_summaries SET reference_price = NULL, reference_days = 0 WHERE market_key = ?
      AND (? IS NULL OR item_key >= ?) AND (? IS NULL OR item_key < ?)`).run(marketKey, from, from, to, to);
    for (const [itemKey, values] of byItem) {
      update.run(median(values), values.length, marketKey, itemKey);
      updated += 1;
    }
  }
  return updated;
}

// Item-key ranges covering every item a market has history for, each about
// `size` items: maintenance works through a large market page by page.
export function marketItemRangesInDatabase(db, marketKey, size = 2000) {
  const keys = db.prepare("SELECT DISTINCT item_key FROM market_series_daily WHERE market_key = ? ORDER BY item_key").all(marketKey).map((row) => row.item_key);
  const ranges = [];
  for (let start = 0; start < keys.length; start += size) {
    ranges.push({ from: start === 0 ? null : keys[start], to: start + size < keys.length ? keys[start + size] : null });
  }
  return ranges.length ? ranges : [{ from: null, to: null }];
}

export function pruneSeriesInDatabase(db, now) {
  return {
    hourly: db.prepare("DELETE FROM market_series_hourly WHERE hour < ?").run(Math.floor((now - HOURLY_DAYS * 86400) / 3600)).changes,
    daily: db.prepare("DELETE FROM market_series_daily WHERE day < ?").run(dayOf(now - DAILY_DAYS * 86400)).changes,
    weekly: db.prepare("DELETE FROM market_series_weekly WHERE week < ?").run(dayOf(now - WEEKLY_YEARS * 365 * 86400)).changes,
  };
}

// Ranges: which resolution answers them and how far back they reach.
export const SERIES_RANGES = Object.freeze({
  "24h": { resolution: "hour", seconds: 86400 },
  "7d": { resolution: "hour", seconds: 7 * 86400 },
  "30d": { resolution: "day", seconds: 30 * 86400 },
  "90d": { resolution: "day", seconds: 90 * 86400 },
  "1y": { resolution: "day", seconds: 365 * 86400 },
  all: { resolution: "week", seconds: null },
});

const RESOLUTION_SECONDS = { hour: 3600, day: 86400, week: 7 * 86400 };

function point(row, resolution) {
  if (resolution === "hour") {
    return { t: row.hour * 3600, firstAt: row.first_at, lastAt: row.last_at, samples: row.samples, min: row.min_close, minLow: row.min_low,
      typical: row.typical_close, quantity: row.quantity_close, quantityLow: row.quantity_low, quantityHigh: row.quantity_high, listings: row.listings_close };
  }
  const key = resolution === "day" ? row.day : row.week;
  return { t: Date.parse(`${key}T00:00:00Z`) / 1000, label: key, firstAt: row.first_at ?? null, lastAt: row.last_at ?? null, samples: row.samples,
    days: row.days ?? undefined, min: row.min_close, minLow: row.min_low, minHigh: row.min_high, typical: row.typical_close,
    typicalLow: row.typical_low, typicalHigh: row.typical_high, typicalMedian: row.typical_median ?? undefined,
    quantity: row.quantity_close, quantityLow: row.quantity_low, quantityHigh: row.quantity_high, listings: row.listings_close };
}

// Points for one item variant in the given markets, per market and source.
export function readSeriesInDatabase(db, { marketKeys, itemKey, range = "7d", now }) {
  const spec = SERIES_RANGES[range] || SERIES_RANGES["7d"];
  const placeholders = marketKeys.map(() => "?").join(",");
  let rows;
  if (spec.resolution === "hour") {
    rows = db.prepare(`SELECT * FROM market_series_hourly WHERE market_key IN (${placeholders}) AND item_key = ? AND hour >= ? ORDER BY hour`)
      .all(...marketKeys, itemKey, Math.floor((now - spec.seconds) / 3600));
  } else if (spec.resolution === "day") {
    rows = db.prepare(`SELECT * FROM market_series_daily WHERE market_key IN (${placeholders}) AND item_key = ? AND day >= ? ORDER BY day`)
      .all(...marketKeys, itemKey, dayOf(now - spec.seconds));
  } else {
    rows = db.prepare(`SELECT * FROM market_series_weekly WHERE market_key IN (${placeholders}) AND item_key = ? ORDER BY week`).all(...marketKeys, itemKey);
  }
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.market_key}|${row.source_type}`;
    if (!groups.has(key)) groups.set(key, { marketKey: row.market_key, source: row.source_type, points: [] });
    groups.get(key).points.push(point(row, spec.resolution));
  }
  const resolutionSeconds = RESOLUTION_SECONDS[spec.resolution];
  const series = [...groups.values()].map((entry) => ({ ...entry, gapSeconds: gapSeconds(entry.points, resolutionSeconds),
    firstAt: entry.points[0]?.t ?? null, lastAt: entry.points.at(-1)?.lastAt ?? entry.points.at(-1)?.t ?? null }))
    .sort((a, b) => b.points.length - a.points.length);
  return { range: SERIES_RANGES[range] ? range : "7d", resolution: spec.resolution, resolutionSeconds, from: spec.seconds ? now - spec.seconds : null, to: now, series };
}

// The hourly and daily points the metrics need, for one market and source.
export function readMetricInputsInDatabase(db, { marketKey, itemKey, sourceType, now }) {
  const hourly = db.prepare(`SELECT * FROM market_series_hourly WHERE market_key = ? AND item_key = ? AND source_type = ? AND hour >= ? ORDER BY hour`)
    .all(marketKey, itemKey, sourceType, Math.floor((now - 8 * 86400) / 3600)).map((row) => point(row, "hour"));
  const daily = db.prepare(`SELECT * FROM market_series_daily WHERE market_key = ? AND item_key = ? AND source_type = ? AND day >= ? ORDER BY day`)
    .all(marketKey, itemKey, sourceType, dayOf(now - 31 * 86400)).map((row) => point(row, "day"));
  return { hourly, daily };
}
