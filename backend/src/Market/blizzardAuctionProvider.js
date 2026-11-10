import { aggregateListings, apiMarketKey, factionFromHouseName, normalizeRegion, positiveInteger } from "./marketModel.js";

// Blizzard's WoW Forever auction data (undocumented, verified by the
// community in November 2026):
//   dynamic-forever-{region} namespace
//   /data/wow/ruleset/index                          rulesets (replace realms)
//   /data/wow/ruleset/{id}/auctions/                  houses (trailing slash required)
//   /data/wow/ruleset/{id}/auctions/{houseId}         auctions: item {id, bonus_lists}, buyout, bid, quantity
//   /data/wow/ruleset/{id}/auctions/{houseId}/commodities   commodities: unit_price, quantity
// Every ruleset currently lists the same 15 houses, so one ruleset is read.
// Credentials stay on the server; the browser never sees them.
const DEFAULT_REFRESH_MINUTES = 60;
const MIN_REFRESH_MINUTES = 30;
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PER_HOUR = 300;

function text(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

export function blizzardAuctionConfig(env = process.env) {
  const clientId = text(env.BLIZZARD_CLIENT_ID);
  const clientSecret = text(env.BLIZZARD_CLIENT_SECRET);
  const regions = text(env.MARKET_BLIZZARD_REGIONS || env.BLIZZARD_REGION || "us", 40).split(",").map(normalizeRegion).filter(Boolean);
  const refresh = Math.max(MIN_REFRESH_MINUTES, Number(env.MARKET_BLIZZARD_REFRESH_MINUTES) || DEFAULT_REFRESH_MINUTES);
  return {
    configured: Boolean(clientId && clientSecret) && env.MARKET_BLIZZARD_ENABLED !== "false",
    clientId, clientSecret,
    regions: regions.length ? [...new Set(regions)] : ["us"],
    namespace: (region) => text(env.MARKET_BLIZZARD_NAMESPACE, 80).replace("{region}", region) || `dynamic-forever-${region}`,
    rulesetId: positiveInteger(env.MARKET_BLIZZARD_RULESET) || null,
    rulesetScoped: env.MARKET_RULESET_SCOPED === "true",
    apiBaseUrl: (region) => text(env.BLIZZARD_API_BASE_URL || `https://${region}.api.blizzard.com`).replace(/\/$/, ""),
    oauthUrl: text(env.BLIZZARD_OAUTH_URL || "https://oauth.battle.net/token"),
    locale: text(env.BLIZZARD_LOCALE || "en_US", 16),
    refreshSeconds: refresh * 60,
    maxBytes: Math.max(1024 * 1024, Number(env.MARKET_BLIZZARD_MAX_BYTES) || DEFAULT_MAX_BYTES),
    timeoutMs: Math.max(5000, Number(env.MARKET_BLIZZARD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    maxRequestsPerHour: Math.max(10, Number(env.MARKET_BLIZZARD_MAX_REQUESTS_PER_HOUR) || DEFAULT_MAX_PER_HOUR),
  };
}

// A sliding one-hour window: requests past the limit wait for the next run
// instead of being sent. Blizzard's own limit is far higher (36,000/hour);
// this keeps the website a polite client and bounds what users can cause.
export function createRateLimiter({ maxPerHour, now = () => Date.now() }) {
  const sent = [];
  return {
    tryTake() {
      const cutoff = now() - 3600_000;
      while (sent.length && sent[0] < cutoff) sent.shift();
      if (sent.length >= maxPerHour) return false;
      sent.push(now());
      return true;
    },
    used() {
      const cutoff = now() - 3600_000;
      return sent.filter((at) => at >= cutoff).length;
    },
  };
}

export class ProviderError extends Error {
  constructor(code, { status = null, transient = true } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.transient = transient;
  }
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// Blizzard auction rows → listings for aggregation.
export function listingsFromBlizzard(auctions = [], { commodity = false } = {}) {
  const listings = [];
  for (const auction of list(auctions)) {
    const itemId = positiveInteger(auction?.item?.id);
    const quantity = positiveInteger(auction?.quantity);
    if (!itemId || !quantity) continue;
    listings.push(commodity
      ? { itemId, quantity, unitPrice: auction.unit_price }
      : { itemId, bonusLists: auction.item.bonus_lists, quantity, buyout: auction.buyout, bid: auction.bid });
  }
  return listings;
}

export function createBlizzardAuctionProvider({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const config = blizzardAuctionConfig(env);
  const limiter = createRateLimiter({ maxPerHour: config.maxRequestsPerHour, now });
  const tokens = new Map();

  async function token(region, force = false) {
    const cached = tokens.get(region);
    if (!force && cached && cached.expiresAt - 60_000 > now()) return cached.value;
    if (!limiter.tryTake()) throw new ProviderError("rate_limited");
    const response = await fetchImpl(config.oauthUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new ProviderError(`oauth_${response.status}`, { status: response.status, transient: response.status >= 500 });
    const payload = await response.json();
    const value = text(payload?.access_token, 4096);
    if (!value) throw new ProviderError("oauth_missing_token");
    tokens.set(region, { value, expiresAt: now() + Math.max(60, Number(payload?.expires_in) || 3600) * 1000 });
    return value;
  }

  // GET with a size cap, a timeout, If-Modified-Since and one re-auth.
  async function get(region, path, { ifModifiedSince = "", retryAuth = true } = {}) {
    const bearer = await token(region);
    if (!limiter.tryTake()) throw new ProviderError("rate_limited");
    const url = new URL(`${config.apiBaseUrl(region)}${path}`);
    url.searchParams.set("namespace", config.namespace(region));
    url.searchParams.set("locale", config.locale);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${bearer}`, ...(ifModifiedSince ? { "If-Modified-Since": ifModifiedSince } : {}) },
        signal: controller.signal,
      });
      if (response.status === 401 && retryAuth) {
        tokens.delete(region);
        return get(region, path, { ifModifiedSince, retryAuth: false });
      }
      if (response.status === 304) return { status: 304, payload: null, lastModified: ifModifiedSince };
      if (response.status === 404) throw new ProviderError("not_found", { status: 404, transient: false });
      if (response.status === 429) throw new ProviderError("blizzard_rate_limited", { status: 429 });
      if (!response.ok) throw new ProviderError(`http_${response.status}`, { status: response.status, transient: response.status >= 500 });
      const length = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(length) && length > config.maxBytes) throw new ProviderError("response_too_large", { transient: false });
      const body = await response.text();
      if (body.length > config.maxBytes) throw new ProviderError("response_too_large", { transient: false });
      return { status: response.status, payload: JSON.parse(body), lastModified: text(response.headers?.get?.("last-modified"), 64) };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error?.name === "AbortError" ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  // The houses to read in a region, from the configured or first ruleset.
  async function discoverMarkets(region) {
    let rulesetId = config.rulesetId;
    if (!rulesetId) {
      const index = await get(region, "/data/wow/ruleset/index");
      const rulesets = Object.values(index.payload || {}).find((value) => Array.isArray(value) && value.some((entry) => positiveInteger(entry?.id))) || [];
      rulesetId = rulesets.map((entry) => positiveInteger(entry?.id)).filter(Boolean).sort((a, b) => a - b)[0] || null;
      if (!rulesetId) throw new ProviderError("no_rulesets", { transient: false });
    }
    const houses = await get(region, `/data/wow/ruleset/${rulesetId}/auctions/`);
    return list(houses.payload?.auctions).map((house) => {
      const houseId = positiveInteger(house?.id);
      const name = text(typeof house?.name === "string" ? house.name : house?.name?.en_US, 120);
      const marketKey = apiMarketKey({ region, houseId, rulesetId, rulesetScoped: config.rulesetScoped });
      return marketKey ? { marketKey, kind: "api_house", region, rulesetId, houseId, faction: factionFromHouseName(name),
        name: `${region.toUpperCase()} ${name || `House ${houseId}`} (${houseId})` } : null;
    }).filter(Boolean);
  }

  // One house: its auctions and commodities as per-item aggregates. Unchanged
  // data (304) is reported as such and stores nothing.
  async function fetchMarket(market, { lastModified = "" } = {}) {
    const base = `/data/wow/ruleset/${market.rulesetId}/auctions/${market.houseId}`;
    const house = await get(market.region, base, { ifModifiedSince: lastModified });
    if (house.status === 304) return { status: "unchanged", lastModified: house.lastModified };
    let commodities = [];
    try {
      commodities = list((await get(market.region, `${base}/commodities`)).payload?.auctions);
    } catch (error) {
      if (error.code !== "not_found") throw error;
    }
    // Houses with nothing listed have no `auctions` field at all.
    const auctions = list(house.payload?.auctions);
    const listings = [...listingsFromBlizzard(auctions), ...listingsFromBlizzard(commodities, { commodity: true })];
    return {
      status: "ok", lastModified: house.lastModified, auctions: auctions.length + commodities.length,
      items: aggregateListings(listings),
      // When Blizzard generated the data, but never later than now (clocks drift).
      observedAt: Math.floor(Math.min(Date.parse(house.lastModified) || now(), now()) / 1000),
    };
  }

  return {
    name: "blizzard",
    sourceType: "official_api",
    config: { configured: config.configured, regions: config.regions, refreshSeconds: config.refreshSeconds, maxRequestsPerHour: config.maxRequestsPerHour },
    configured: () => config.configured,
    requestsUsed: () => limiter.used(),
    discoverMarkets,
    fetchMarket,
  };
}
