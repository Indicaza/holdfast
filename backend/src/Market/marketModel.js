// Pure market rules: market identity, item variants, price aggregation and
// which observation a summary shows. No database access here.

export const SOURCE_TYPES = Object.freeze(["addon_scan", "official_api", "provider"]);
export const COVERAGES = Object.freeze(["full", "items", "partial"]);
// Sources only outrank one another when their observations are this close
// in time: an in-game scan beats a Blizzard snapshot taken within 45
// minutes of it, never one taken hours later.
export const SAME_PERIOD_SECONDS = 45 * 60;
// A complete observation is preferred over a newer partial one only while it
// is at most this much older.
export const COMPLETE_GRACE_SECONDS = 6 * 60 * 60;
// A summary older than this is shown as stale.
export const STALE_SECONDS = 24 * 60 * 60;
export const MAX_ITEMS_PER_SNAPSHOT = 50000;
export const MAX_LISTINGS_PER_SNAPSHOT = 250000;
// Disagreement above this is flagged as a conflict.
export const CONFLICT_RATIO = 0.15;
// The typical price is the quantity-weighted median of the cheapest share of
// the market, so a few absurd listings do not move it.
const TYPICAL_SHARE = 0.3;
// Reliability when observations are equally fresh and complete: what a
// player's client showed is the live house; Blizzard's snapshot is up to an
// hour behind; a third-party provider is a copy of either.
const SOURCE_RANK = Object.freeze({ addon_scan: 3, official_api: 2, provider: 1 });
export const PRICE_POINTS = 10;

const REGIONS = new Set(["us", "eu", "kr", "tw"]);
const FACTIONS = new Set(["alliance", "horde", "neutral"]);

function text(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function slug(value, max = 80) {
  return text(value, max).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function positiveInteger(value, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= max ? number : null;
}

export function copper(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 1e12 ? number : null;
}

export function normalizeRegion(value) {
  const region = text(value, 8).toLowerCase();
  return REGIONS.has(region) ? region : null;
}

export function normalizeFaction(value) {
  const faction = text(value, 20).toLowerCase();
  return FACTIONS.has(faction) ? faction : "";
}

// An auction house from the official API: region and house id. The ruleset
// is recorded but not part of the key, because every Forever ruleset
// currently lists the same houses with the same auctions (counting them per
// ruleset would multiply supply). MARKET_RULESET_SCOPED=true restores
// per-ruleset markets if Blizzard starts separating them.
export function apiMarketKey({ region, houseId, rulesetId, rulesetScoped = false }) {
  const r = normalizeRegion(region);
  const house = positiveInteger(houseId);
  if (!r || !house) return null;
  return rulesetScoped && positiveInteger(rulesetId) ? `api:${r}:ruleset-${rulesetId}:house-${house}` : `api:${r}:house-${house}`;
}

// The auction house a player saw in game: region, realm (ruleset name on
// Forever), and the faction of the house (alliance, horde, or neutral for
// the Blackwater houses).
export function clientMarketKey({ region, realm, faction }) {
  const r = normalizeRegion(region);
  const realmSlug = slug(realm);
  const f = normalizeFaction(faction);
  if (!r || !realmSlug || !f) return null;
  return `game:${r}:${realmSlug}:${f}`;
}

// Faction of an API house from its name ("Alliance Auction House", "Horde
// Auction House", "Blackwater Auction House").
export function factionFromHouseName(name) {
  const value = text(name).toLowerCase();
  if (value.includes("alliance")) return "alliance";
  if (value.includes("horde")) return "horde";
  if (value.includes("blackwater") || value.includes("neutral")) return "neutral";
  return "";
}

// The identity of an item variant. Items that differ only in per-copy data
// (who made it, the level it dropped at) are the same variant; a random
// suffix ("of the Bear") or bonus list is a different one.
export function itemVariantKey({ itemId, suffix = 0, bonusLists = [] } = {}) {
  const id = positiveInteger(itemId);
  if (!id) return null;
  const parts = [`i:${id}`];
  const suffixId = Number(suffix);
  if (Number.isSafeInteger(suffixId) && suffixId !== 0) parts.push(`s${suffixId}`);
  const bonuses = (Array.isArray(bonusLists) ? bonusLists : []).map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0).sort((a, b) => a - b);
  if (bonuses.length) parts.push(`b${[...new Set(bonuses)].slice(0, 16).join(".")}`);
  return parts.join(":");
}

export function itemIdFromKey(itemKey) {
  const match = /^i:(\d+)/.exec(String(itemKey || ""));
  return match ? Number(match[1]) : null;
}

function weightedPercentile(sorted, total, fraction) {
  const target = Math.max(1, Math.ceil(total * fraction));
  let seen = 0;
  for (const entry of sorted) {
    seen += entry.quantity;
    if (seen >= target) return entry.unit;
  }
  return sorted.at(-1)?.unit ?? null;
}

// Listings → per-variant aggregates. A listing gives a unit price (copper per
// item) or a stack buyout, which is divided by its quantity; never both
// mixed. `count` lets a client send one row for several identical listings.
export function aggregateListings(listings = []) {
  const byKey = new Map();
  for (const listing of listings) {
    const itemKey = itemVariantKey(listing);
    const quantity = positiveInteger(listing?.quantity, 1e7);
    const count = positiveInteger(listing?.count ?? 1, 1e6);
    if (!itemKey || !quantity || !count) continue;
    const entry = byKey.get(itemKey) || { itemKey, itemId: itemIdFromKey(itemKey), prices: [], quantity: 0, listings: 0, bidOnly: 0, minBid: null };
    const unit = copper(listing.unitPrice) ?? (copper(listing.buyout) !== null ? Math.round(copper(listing.buyout) / quantity) : null);
    const bid = copper(listing.bid);
    entry.quantity += quantity * count;
    entry.listings += count;
    if (unit !== null && unit > 0) entry.prices.push({ unit, quantity: quantity * count });
    else entry.bidOnly += count;
    if (bid !== null && bid > 0) {
      const unitBid = Math.round(bid / quantity);
      entry.minBid = entry.minBid === null ? unitBid : Math.min(entry.minBid, unitBid);
    }
    byKey.set(itemKey, entry);
  }
  return [...byKey.values()].map((entry) => summarizePrices(entry));
}

function summarizePrices(entry) {
  const sorted = entry.prices.sort((a, b) => a.unit - b.unit);
  const priced = sorted.reduce((sum, value) => sum + value.quantity, 0);
  const cheapest = [];
  let taken = 0;
  for (const value of sorted) {
    if (cheapest.length && taken >= priced * TYPICAL_SHARE) break;
    cheapest.push(value);
    taken += value.quantity;
  }
  const points = [];
  for (const value of sorted) {
    const last = points.at(-1);
    if (last && last[0] === value.unit) last[1] += value.quantity;
    else if (points.length < PRICE_POINTS) points.push([value.unit, value.quantity]);
    else break;
  }
  return {
    itemKey: entry.itemKey,
    itemId: entry.itemId,
    minUnitBuyout: sorted[0]?.unit ?? null,
    minQuantity: points[0]?.[1] ?? null,
    pricePoints: points,
    typicalUnitBuyout: cheapest.length ? weightedPercentile(cheapest, taken, 0.5) : null,
    maxUnitBuyout: sorted.length ? weightedPercentile(sorted, priced, 0.9) : null,
    minUnitBid: entry.minBid,
    quantity: entry.quantity,
    listings: entry.listings,
    bidOnlyListings: entry.bidOnly,
  };
}

// Client aggregates (browse rows: lowest price and total quantity, no
// listings) are taken as they are.
export function aggregateSummaryRow(row = {}) {
  const itemKey = itemVariantKey(row);
  const quantity = Number(row.quantity);
  if (!itemKey || !Number.isSafeInteger(quantity) || quantity < 0) return null;
  const min = copper(row.minUnitBuyout);
  return { itemKey, itemId: itemIdFromKey(itemKey), minUnitBuyout: min && min > 0 ? min : null, minQuantity: null, pricePoints: [],
    typicalUnitBuyout: null, maxUnitBuyout: null, minUnitBid: null, quantity,
    listings: positiveInteger(row.listings) ?? null, bidOnlyListings: 0 };
}

function price(candidate) {
  return candidate.typicalUnitBuyout ?? candidate.minUnitBuyout ?? null;
}

export function ageLabel(seconds) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

export const SOURCE_LABELS = Object.freeze({ addon_scan: "in-game scan", official_api: "Blizzard API snapshot", provider: "data provider" });

function describe(entry, now) {
  return `${SOURCE_LABELS[entry.sourceType]} from ${ageLabel(Math.max(0, now - entry.observedAt))} ago`;
}

// Chooses which observation an item's summary shows from the latest
// complete and latest partial observation of each source (in one market, or
// a market and the markets linked to it). In order:
// 1. Recency first. A complete observation (every listing of the item was
//    visible) is preferred over a newer partial one only while it is at most
//    COMPLETE_GRACE_SECONDS older; past that the newer partial view wins and
//    says so, because a narrow fresh look beats a stale complete one.
// 2. Within that pool, observations within SAME_PERIOD_SECONDS of the newest
//    are ranked by source (in-game scan, Blizzard API, provider). An older
//    in-game scan never beats a newer API snapshot taken after it.
// 3. Every other recent candidate that disagrees by more than CONFLICT_RATIO
//    is reported with its own numbers.
// Returns notes ({ code, text }) so the website can explain the choice.
export function selectObservation(candidates = [], { now = Math.floor(Date.now() / 1000), marketKey = null } = {}) {
  const valid = candidates.filter((entry) => entry && SOURCE_TYPES.includes(entry.sourceType) && Number.isFinite(entry.observedAt));
  if (!valid.length) return null;
  const newestAny = Math.max(...valid.map((entry) => entry.observedAt));
  const complete = valid.filter((entry) => entry.complete && newestAny - entry.observedAt <= COMPLETE_GRACE_SECONDS);
  const pool = complete.length ? complete : valid;
  const newest = Math.max(...pool.map((entry) => entry.observedAt));
  const samePeriod = pool.filter((entry) => newest - entry.observedAt <= SAME_PERIOD_SECONDS);
  samePeriod.sort((a, b) => (SOURCE_RANK[b.sourceType] - SOURCE_RANK[a.sourceType]) || (b.observedAt - a.observedAt));
  const chosen = samePeriod[0];
  const chosenPrice = price(chosen);
  const notes = [{ code: "chosen", text: describe(chosen, now) }];
  if (marketKey && chosen.marketKey && chosen.marketKey !== marketKey) notes.push({ code: "linked", text: "seen in a linked market (an administrator confirmed it is the same auction house)" });
  if (!chosen.complete) {
    const olderComplete = valid.filter((entry) => entry.complete);
    notes.push({ code: "partial", text: `partial view: not every listing was visible, the lowest ask may be lower${olderComplete.length ? `; the last complete view is ${ageLabel(Math.max(0, now - Math.max(...olderComplete.map((entry) => entry.observedAt))))} old` : ""}` });
  }
  const outranked = samePeriod.slice(1);
  if (outranked.length) notes.push({ code: "outranked", text: `preferred over ${outranked.map((entry) => describe(entry, now)).join(", ")} from the same period` });
  const newerPartial = valid.filter((entry) => entry !== chosen && !entry.complete && entry.observedAt > chosen.observedAt);
  if (newerPartial.length) notes.push({ code: "newer_partial", text: `newer partial ${newerPartial.map((entry) => SOURCE_LABELS[entry.sourceType]).join(", ")} not used` });
  const recent = valid.filter((entry) => entry !== chosen && newestAny - entry.observedAt <= COMPLETE_GRACE_SECONDS);
  const conflicts = recent.map((entry) => {
    const other = price(entry);
    if (!chosenPrice || !other) return null;
    const ratio = (other - chosenPrice) / chosenPrice;
    return Math.abs(ratio) > CONFLICT_RATIO ? { source: entry.sourceType, marketKey: entry.marketKey ?? null, observedAt: entry.observedAt, complete: Boolean(entry.complete),
      price: other, differencePct: Math.round(ratio * 1000) / 10 } : null;
  }).filter(Boolean);
  for (const conflict of conflicts) {
    notes.push({ code: "conflict", text: `${SOURCE_LABELS[conflict.source]} from ${ageLabel(Math.max(0, now - conflict.observedAt))} ago${conflict.complete ? "" : " (partial)"} asks ${conflict.differencePct > 0 ? "+" : ""}${conflict.differencePct}%` });
  }
  const superseded = valid.filter((entry) => entry !== chosen && newestAny - entry.observedAt > COMPLETE_GRACE_SECONDS);
  if (superseded.length) notes.push({ code: "superseded", text: `older ${[...new Set(superseded.map((entry) => SOURCE_LABELS[entry.sourceType]))].join(", ")} not used` });
  return { chosen, reason: notes.map((note) => note.text).join("; "), notes, conflict: conflicts.length > 0, conflicts, candidates: valid };
}

export function freshness(observedAt, now = Math.floor(Date.now() / 1000)) {
  if (!Number.isFinite(observedAt)) return { ageSeconds: null, stale: true };
  const ageSeconds = Math.max(0, now - observedAt);
  return { ageSeconds, stale: ageSeconds > STALE_SECONDS };
}

// Confidence from coverage, age and how much of the item was seen.
export function confidence({ complete, observedAt, quantity, listings }, now = Math.floor(Date.now() / 1000)) {
  const { ageSeconds } = freshness(observedAt, now);
  if (!complete) return "low";
  if (ageSeconds > STALE_SECONDS) return "low";
  if ((listings ?? 0) >= 5 || quantity >= 20) return ageSeconds <= 6 * 3600 ? "high" : "medium";
  return "medium";
}
