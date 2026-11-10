// Pure market rules: market identity, item variants, price aggregation and
// which observation a summary shows. No database access here.

export const SOURCE_TYPES = Object.freeze(["addon_scan", "official_api", "provider"]);
export const COVERAGES = Object.freeze(["full", "items", "partial"]);
// Observations within this window of the newest one count as the same
// period when sources disagree.
export const SAME_PERIOD_SECONDS = 2 * 60 * 60;
// A summary older than this is shown as stale.
export const STALE_SECONDS = 24 * 60 * 60;
export const MAX_ITEMS_PER_SNAPSHOT = 50000;
export const MAX_LISTINGS_PER_SNAPSHOT = 250000;
// Disagreement above this is flagged as a conflict.
export const CONFLICT_RATIO = 0.15;
// The typical price is the quantity-weighted median of the cheapest share of
// the market, so a few absurd listings do not move it.
const TYPICAL_SHARE = 0.3;
const SOURCE_RANK = Object.freeze({ addon_scan: 3, official_api: 2, provider: 1 });

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
  return {
    itemKey: entry.itemKey,
    itemId: entry.itemId,
    minUnitBuyout: sorted[0]?.unit ?? null,
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
  return { itemKey, itemId: itemIdFromKey(itemKey), minUnitBuyout: min && min > 0 ? min : null,
    typicalUnitBuyout: null, maxUnitBuyout: null, minUnitBid: null, quantity,
    listings: positiveInteger(row.listings) ?? null, bidOnlyListings: 0 };
}

function price(candidate) {
  return candidate.typicalUnitBuyout ?? candidate.minUnitBuyout ?? null;
}

function ageLabel(seconds) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

const SOURCE_LABELS = { addon_scan: "in-game scan", official_api: "Blizzard API snapshot", provider: "data provider" };

// Chooses which observation an item's summary shows, from the latest
// observation of each source in one market:
// 1. Complete observations beat partial ones; a partial view (a browse page,
//    a truncated search) is used only when nothing complete exists, so a
//    narrow search never replaces what a broader scan saw.
// 2. Among complete observations, the newest wins, except that observations
//    from the same period (within SAME_PERIOD_SECONDS of the newest) are
//    ranked by source: an in-game scan, then the official API, then a
//    provider. An old in-game scan never beats a newer API snapshot.
// Every candidate is kept with the result so the choice can be explained.
export function selectObservation(candidates = [], { now = Math.floor(Date.now() / 1000) } = {}) {
  const valid = candidates.filter((entry) => entry && SOURCE_TYPES.includes(entry.sourceType) && Number.isFinite(entry.observedAt));
  if (!valid.length) return null;
  const complete = valid.filter((entry) => entry.complete);
  const pool = complete.length ? complete : valid;
  const newest = Math.max(...pool.map((entry) => entry.observedAt));
  const samePeriod = pool.filter((entry) => newest - entry.observedAt <= SAME_PERIOD_SECONDS);
  samePeriod.sort((a, b) => (SOURCE_RANK[b.sourceType] - SOURCE_RANK[a.sourceType]) || (b.observedAt - a.observedAt));
  const chosen = samePeriod[0];
  const chosenPrice = price(chosen);
  const others = valid.filter((entry) => entry !== chosen);
  const conflicting = others.filter((entry) => {
    const other = price(entry);
    return chosenPrice && other && Math.abs(other - chosenPrice) / chosenPrice > CONFLICT_RATIO;
  });
  const reasons = [`${SOURCE_LABELS[chosen.sourceType]} from ${ageLabel(Math.max(0, now - chosen.observedAt))} ago`];
  if (!chosen.complete) reasons.push("partial view: not every listing was visible");
  const outranked = samePeriod.slice(1);
  if (outranked.length) reasons.push(`preferred over ${outranked.map((entry) => SOURCE_LABELS[entry.sourceType]).join(", ")} from the same period`);
  const newer = others.filter((entry) => entry.observedAt > chosen.observedAt);
  if (newer.length) reasons.push(`newer ${newer.map((entry) => SOURCE_LABELS[entry.sourceType]).join(", ")} ${newer.length === 1 ? "is" : "are"} partial`);
  const older = others.filter((entry) => entry.complete && newest - entry.observedAt > SAME_PERIOD_SECONDS);
  if (older.length) reasons.push(`older ${older.map((entry) => SOURCE_LABELS[entry.sourceType]).join(", ")} not used`);
  if (conflicting.length) reasons.push(`${conflicting.length} other source${conflicting.length === 1 ? "" : "s"} disagree by more than ${Math.round(CONFLICT_RATIO * 100)}%`);
  return { chosen, reason: reasons.join("; "), conflict: conflicting.length > 0, candidates: valid };
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
