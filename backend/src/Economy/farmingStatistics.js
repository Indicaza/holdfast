// Rates and how far to trust them. Pure.
//
// A rate is always successes over every eligible observation (a Frilled
// Lichen chance is gathers that produced Frilled Lichen over all gathers of
// that source under the same filters), never over successful drops alone.

export const SKILL_BUCKET_SIZE = 25;
export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high", "very_high"]);

const Z_95 = 1.96;

// Wilson score interval: honest for small samples and rates near 0 or 1,
// where the normal approximation claims certainty it does not have.
export function wilsonInterval(successes, observations) {
  const n = Number(observations) || 0;
  if (n <= 0) return { low: 0, high: 0 };
  const p = Math.min(1, Math.max(0, (Number(successes) || 0) / n));
  const z2 = Z_95 * Z_95;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margin = (Z_95 / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

// Low / medium / high / very high, from how wide the 95% interval is relative
// to the rate itself. 3 of 12 (25%, plausibly anywhere from 9% to 53%) is low;
// 284 of 11,300 (2.51%, 2.2% to 2.8%) is very high. Fewer than 30
// observations is never more than low, whatever the arithmetic says.
export function rateConfidence(successes, observations) {
  const n = Number(observations) || 0;
  const k = Number(successes) || 0;
  if (n < 30) return "low";
  // Never seen: only the sample size says how rare it could still be.
  if (k <= 0) {
    if (n < 100) return "low";
    if (n < 1000) return "medium";
    return n < 10000 ? "high" : "very_high";
  }
  const rate = k / n;
  const { low, high } = wilsonInterval(k, n);
  const relativeHalfWidth = (high - low) / 2 / rate;
  if (relativeHalfWidth <= 0.15) return "very_high";
  if (relativeHalfWidth <= 0.3) return "high";
  if (relativeHalfWidth <= 0.6) return "medium";
  return "low";
}

export function observedRate(successes, observations) {
  const n = Number(observations) || 0;
  const k = Number(successes) || 0;
  const interval = wilsonInterval(k, n);
  return {
    successes: k,
    observations: n,
    rate: n > 0 ? k / n : 0,
    low: interval.low,
    high: interval.high,
    confidence: rateConfidence(k, n),
  };
}

// 1-25, 26-50, … Skill 0 (or missing) has no bucket.
export function skillBucket(skillLevel, size = SKILL_BUCKET_SIZE) {
  const skill = Number(skillLevel);
  if (!Number.isFinite(skill) || skill < 1) return null;
  const index = Math.floor((Math.trunc(skill) - 1) / size);
  return { index, min: index * size + 1, max: (index + 1) * size, label: `${index * size + 1}-${(index + 1) * size}` };
}
