// Market metrics and observations from stored history. Pure: no database.
//
// Everything here describes asking prices and listed supply that were
// actually observed. Listings that disappear are never counted as sales,
// and nothing is interpolated: a window without enough observations
// returns null with the reason instead of a number.

const HOUR = 3600;
const DAY = 86400;

// Thresholds for the observations ("signals"). Deliberately conservative.
export const SIGNAL_RULES = Object.freeze({
  belowMarketPct: -15,
  spikePct: 50,
  supplyRisePct: 50,
  supplyFallPct: -50,
  isolatedGapPct: -30,
  volatileDaily: 0.15,
  moderateDaily: 0.05,
});

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function median(values) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function pct(current, reference) {
  if (!finite(current) || !finite(reference) || Number(reference) <= 0) return null;
  return Math.round(((Number(current) - Number(reference)) / Number(reference)) * 1000) / 10;
}

function typicalOf(point) {
  return finite(point.typical) ? point.typical : finite(point.min) ? point.min : null;
}

function windowOf(points, from, to) {
  return points.filter((point) => point.t >= from && point.t <= to);
}

function sampleConfidence(samples, { high, medium }) {
  if (samples >= high) return "high";
  if (samples >= medium) return "medium";
  return "low";
}

// The observation nearest to `target` within ±tolerance seconds.
function nearest(points, target, tolerance) {
  let best = null;
  for (const point of points) {
    const at = point.lastAt ?? point.t;
    const distance = Math.abs(at - target);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { point, distance };
  }
  return best?.point || null;
}

// Daily volatility: the standard deviation of day-to-day log changes of the
// typical ask, using consecutive observed days only (a gap breaks the chain).
export function dailyVolatility(daily) {
  const returns = [];
  for (let index = 1; index < daily.length; index += 1) {
    const previous = daily[index - 1];
    const current = daily[index];
    const a = typicalOf(previous);
    const b = typicalOf(current);
    if (current.t - previous.t !== DAY || !a || !b) continue;
    returns.push(Math.log(b / a));
  }
  if (returns.length < 7) return { value: null, returns: returns.length };
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return { value: Math.round(Math.sqrt(variance) * 1000) / 1000, returns: returns.length };
}

// Metrics for one item variant in one market.
//   current  the summary shown now: { min, typical, quantity, listings, minQuantity, observedAt }
//   hourly   hourly points (t = bucket start), oldest first
//   daily    daily points (t = day start, UTC), oldest first
export function marketMetrics({ current = null, hourly = [], daily = [], now = Math.floor(Date.now() / 1000) }) {
  const hours7 = windowOf(hourly, now - 7 * DAY, now);
  const days30 = windowOf(daily, now - 30 * DAY, now);
  const currentTypical = current ? (current.typical ?? current.min ?? null) : null;

  const dayAgo = nearest(hourly, now - DAY, 3 * HOUR);
  const change24h = currentTypical && dayAgo && typicalOf(dayAgo)
    ? { pct: pct(currentTypical, typicalOf(dayAgo)), from: typicalOf(dayAgo), at: dayAgo.lastAt ?? dayAgo.t }
    : { pct: null, reason: "No observation from 21–27 hours ago." };

  const typical7 = hours7.map(typicalOf).filter(finite);
  const daysCovered7 = new Set(hours7.map((point) => Math.floor(point.t / DAY))).size;
  const median7d = typical7.length >= 6 && daysCovered7 >= 2
    ? { value: median(typical7), samples: typical7.length, basis: "median of hourly typical asks" }
    : { value: null, samples: typical7.length, reason: "Needs at least 6 observed hours over 2 days." };
  const minMedian7 = median(hours7.map((point) => point.min));

  const typical30 = days30.map(typicalOf).filter(finite);
  const median30d = typical30.length >= 5
    ? { value: median(typical30), samples: typical30.length, basis: "median of daily closing typical asks" }
    : { value: null, samples: typical30.length, reason: "Needs at least 5 observed days." };
  const minMedian30 = median(days30.map((point) => point.min));

  const range = (points, lowKey, highKey) => {
    const lows = points.map((point) => point[lowKey] ?? point.min).filter(finite);
    const highs = points.map((point) => point[highKey] ?? typicalOf(point)).filter(finite);
    return lows.length ? { low: Math.min(...lows), high: Math.max(...highs, ...lows), samples: lows.length } : null;
  };

  const volatility = dailyVolatility(days30);
  const reference = median30d.value ?? median7d.value;
  // Only from a window with enough observations, like the typical median.
  const referenceMin = median30d.value ? minMedian30 : median7d.value ? minMedian7 : null;
  const quantityMedian7 = median(hours7.map((point) => point.quantity));
  const listingsMedian7 = median(hours7.map((point) => point.listings));

  const spikes = [];
  if (median7d.value) {
    for (const point of hours7) {
      const value = typicalOf(point);
      if (!value) continue;
      const change = pct(value, median7d.value);
      if (change >= SIGNAL_RULES.spikePct || change <= -40) spikes.push({ at: point.lastAt ?? point.t, price: value, pct: change, kind: change > 0 ? "spike" : "dip" });
    }
  }

  return {
    current,
    change24h,
    median7d,
    median30d,
    range7d: range(hours7, "minLow", "typical"),
    range30d: range(days30, "minLow", "typicalHigh"),
    volatility30d: {
      value: volatility.value,
      returns: volatility.returns,
      level: volatility.value === null ? null : volatility.value >= SIGNAL_RULES.volatileDaily ? "high" : volatility.value >= SIGNAL_RULES.moderateDaily ? "moderate" : "low",
      basis: "standard deviation of day-to-day changes in the typical ask, consecutive days only",
      reason: volatility.value === null ? "Needs at least 7 pairs of consecutive observed days." : undefined,
    },
    vsTypical: { pct: pct(currentTypical, reference), reference, basis: median30d.value ? "30-day median" : median7d.value ? "7-day median" : null },
    vsTypicalMin: { pct: pct(current?.min, referenceMin), reference: referenceMin },
    supply: {
      quantity: current?.quantity ?? null,
      median7d: quantityMedian7,
      changePct: pct(current?.quantity, quantityMedian7),
      listings: current?.listings ?? null,
      listingsMedian7d: listingsMedian7,
      listingsChangePct: pct(current?.listings, listingsMedian7),
      samples: hours7.filter((point) => finite(point.quantity)).length,
    },
    spikes: spikes.slice(-8),
    coverage: {
      hours7d: hours7.length,
      hoursPossible7d: 168,
      days30d: days30.length,
      daysPossible30d: 30,
    },
  };
}

function signal(type, title, explanation, { metrics, from, to, samples, confidence }) {
  return { type, title, explanation, metrics, window: { from, to }, samples, confidence };
}

// Observations a reader (or a later recommender) can act on. Each says what
// it is based on and how sure it is. None is a promise of profit.
export function marketSignals(metrics, { now = Math.floor(Date.now() / 1000) } = {}) {
  const signals = [];
  const current = metrics.current;
  if (!current) return signals;
  const days = metrics.median30d.samples;
  const hours = metrics.median7d.samples;
  const window30 = { from: now - 30 * DAY, to: now };
  const window7 = { from: now - 7 * DAY, to: now };
  const reference = metrics.median30d.value ? "30-day" : "7-day";
  const refSamples = metrics.median30d.value ? days : hours;
  const refWindow = metrics.median30d.value ? window30 : window7;
  const refConfidence = metrics.median30d.value ? sampleConfidence(days, { high: 20, medium: 10 }) : sampleConfidence(hours, { high: 72, medium: 24 });

  if (finite(metrics.vsTypicalMin.pct) && metrics.vsTypicalMin.pct <= SIGNAL_RULES.belowMarketPct) {
    signals.push(signal("below_recent_market", "Below recent market",
      `The lowest ask is ${Math.abs(metrics.vsTypicalMin.pct)}% under its ${reference} median.`,
      { metrics: { lowestAsk: current.min, medianLowestAsk: metrics.vsTypicalMin.reference, pct: metrics.vsTypicalMin.pct }, ...refWindow, samples: refSamples, confidence: refConfidence }));
  }
  if (finite(metrics.vsTypical.pct) && metrics.vsTypical.pct >= SIGNAL_RULES.spikePct) {
    signals.push(signal("price_spike", "Price spike",
      `The typical ask is ${metrics.vsTypical.pct}% above its ${reference} median.`,
      { metrics: { typicalAsk: current.typical ?? current.min, median: metrics.vsTypical.reference, pct: metrics.vsTypical.pct }, ...refWindow, samples: refSamples, confidence: refConfidence }));
  }
  if (finite(current.min) && finite(current.typical) && current.typical > 0) {
    const gap = pct(current.min, current.typical);
    const thin = finite(current.minQuantity) && current.quantity > 0 && (current.minQuantity <= 2 || current.minQuantity / current.quantity <= 0.05);
    if (gap <= SIGNAL_RULES.isolatedGapPct && thin) {
      signals.push(signal("isolated_low_listing", "Isolated cheap listing",
        `Only ${current.minQuantity} unit${current.minQuantity === 1 ? "" : "s"} at the lowest ask, ${Math.abs(gap)}% under the typical ask. Expect the next price up once ${current.minQuantity === 1 ? "it is" : "they are"} gone.`,
        { metrics: { lowestAsk: current.min, unitsAtLowest: current.minQuantity, typicalAsk: current.typical, quantity: current.quantity }, from: current.observedAt, to: current.observedAt, samples: 1, confidence: "medium" }));
    }
  }
  const supply = metrics.supply;
  if (finite(supply.changePct) && supply.samples >= 12) {
    const confidence = sampleConfidence(supply.samples, { high: 72, medium: 24 });
    if (supply.changePct >= SIGNAL_RULES.supplyRisePct) {
      signals.push(signal("supply_increasing", "Supply rising",
        `${supply.quantity.toLocaleString("en-US")} listed now, ${supply.changePct}% above the 7-day median of ${supply.median7d.toLocaleString("en-US")}.`,
        { metrics: { quantity: supply.quantity, median: supply.median7d, pct: supply.changePct }, ...window7, samples: supply.samples, confidence }));
    } else if (supply.changePct <= SIGNAL_RULES.supplyFallPct) {
      signals.push(signal("supply_decreasing", "Supply falling",
        `${supply.quantity.toLocaleString("en-US")} listed now, ${Math.abs(supply.changePct)}% below the 7-day median of ${supply.median7d.toLocaleString("en-US")}. Fewer listings does not mean they sold.`,
        { metrics: { quantity: supply.quantity, median: supply.median7d, pct: supply.changePct }, ...window7, samples: supply.samples, confidence }));
    }
  }
  if (metrics.volatility30d.level === "high") {
    signals.push(signal("volatile_market", "Volatile market",
      `The typical ask moves about ${Math.round(metrics.volatility30d.value * 100)}% from one day to the next.`,
      { metrics: { dailyVolatility: metrics.volatility30d.value }, ...window30, samples: metrics.volatility30d.returns,
        confidence: sampleConfidence(metrics.volatility30d.returns, { high: 20, medium: 10 }) }));
  }
  return signals;
}

// Where a chart line should break: twice the usual spacing between
// observations, never less than two buckets.
export function gapSeconds(points, resolution) {
  const spacing = [];
  for (let index = 1; index < points.length; index += 1) spacing.push(points[index].t - points[index - 1].t);
  const usual = median(spacing) || resolution;
  return Math.max(2 * resolution, Math.round(usual * 2.5));
}
