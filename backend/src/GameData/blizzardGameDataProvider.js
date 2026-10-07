import { withGuildDatabase } from "../Data/database.js";
import {
  resolveGameDataBundleInDatabase,
  upsertGameDataEntityInDatabase,
} from "./gameDataCatalog.js";

const ENTITY_CONFIG = Object.freeze({
  item: {
    resourcePath: (id) => `/data/wow/item/${id}`,
    mediaPath: (id) => `/data/wow/media/item/${id}`,
  },
  spell: {
    resourcePath: (id) => `/data/wow/spell/${id}`,
    mediaPath: (id) => `/data/wow/media/spell/${id}`,
  },
  recipe: {
    resourcePath: (id) => `/data/wow/recipe/${id}`,
    mediaPath: (id) => `/data/wow/media/recipe/${id}`,
  },
  profession: {
    resourcePath: (id) => `/data/wow/profession/${id}`,
    mediaPath: (id) => `/data/wow/media/profession/${id}`,
  },
});

const QUALITY_IDS = Object.freeze({
  POOR: 0,
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
  ARTIFACT: 6,
  HEIRLOOM: 7,
  WOW_TOKEN: 8,
});

const DEFAULT_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_FAILURE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_ENTITIES = 32;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8000;

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function positiveInteger(value, fallback) {
  const number = integer(value, fallback);
  return number && number > 0 ? number : fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRegion(value) {
  const region = text(value || "us", 8).toLowerCase();
  return ["us", "eu", "kr", "tw"].includes(region) ? region : "us";
}

function namespacesFromEnv(env, region) {
  const configured = text(env.BLIZZARD_STATIC_NAMESPACES, 512)
    .split(",")
    .map((value) => text(value, 80))
    .filter(Boolean);
  const defaults = [
    `static-classic1x-${region}`,
    `static-classic-${region}`,
    `static-${region}`,
  ];
  return [...new Set(configured.length ? configured : defaults)];
}

export function blizzardGameDataConfig(env = process.env) {
  const region = normalizeRegion(env.BLIZZARD_REGION);
  const clientId = text(env.BLIZZARD_CLIENT_ID, 256);
  const clientSecret = text(env.BLIZZARD_CLIENT_SECRET, 256);
  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    region,
    locale: text(env.BLIZZARD_LOCALE || "en_US", 16) || "en_US",
    namespaces: namespacesFromEnv(env, region),
    apiBaseUrl: text(env.BLIZZARD_API_BASE_URL || `https://${region}.api.blizzard.com`, 256).replace(/\/$/, ""),
    oauthUrl: text(env.BLIZZARD_OAUTH_URL || "https://oauth.battle.net/token", 256),
    refreshMs: positiveInteger(env.BLIZZARD_GAME_DATA_REFRESH_MS, DEFAULT_REFRESH_MS),
    failureTtlMs: positiveInteger(env.BLIZZARD_GAME_DATA_FAILURE_TTL_MS, DEFAULT_FAILURE_TTL_MS),
    maxEntities: Math.min(64, positiveInteger(env.BLIZZARD_GAME_DATA_MAX_PER_REQUEST, DEFAULT_MAX_ENTITIES)),
    concurrency: Math.min(8, positiveInteger(env.BLIZZARD_GAME_DATA_CONCURRENCY, DEFAULT_CONCURRENCY)),
    timeoutMs: Math.min(30000, positiveInteger(env.BLIZZARD_GAME_DATA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  };
}

function httpsUrl(value) {
  const source = text(value, 1000);
  if (!source) return "";
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function mediaDescriptor(payload) {
  const assets = array(payload?.assets);
  const asset = assets.find((entry) => entry?.key === "icon") || assets[0] || null;
  return {
    iconFileId: integer(asset?.file_data_id ?? asset?.fileDataId),
    mediaUrl: httpsUrl(asset?.value),
    mediaKey: text(asset?.key, 64),
  };
}

function qualityId(payload) {
  const direct = integer(payload?.quality?.id ?? payload?.quality_id ?? payload?.qualityId);
  if (direct !== null) return direct;
  return QUALITY_IDS[text(payload?.quality?.type, 32).toUpperCase()] ?? null;
}

function itemMetadata(payload, media, namespace) {
  return {
    mediaUrl: media.mediaUrl,
    mediaKey: media.mediaKey,
    namespace,
    description: text(payload?.description, 2000),
    itemLevel: integer(payload?.level ?? payload?.item_level ?? payload?.itemLevel),
    requiredLevel: integer(payload?.required_level ?? payload?.requiredLevel),
    itemClassId: integer(payload?.item_class?.id ?? payload?.itemClass?.id),
    itemClassName: text(payload?.item_class?.name ?? payload?.itemClass?.name, 96),
    itemSubclassId: integer(payload?.item_subclass?.id ?? payload?.itemSubclass?.id),
    itemSubclassName: text(payload?.item_subclass?.name ?? payload?.itemSubclass?.name, 96),
    inventoryType: text(payload?.inventory_type?.type ?? payload?.inventory_type?.name ?? payload?.inventoryType, 96),
    purchasePrice: integer(payload?.purchase_price ?? payload?.purchasePrice),
    sellPrice: integer(payload?.sell_price ?? payload?.sellPrice),
  };
}

function recipeMetadata(payload, media, namespace) {
  const reagents = array(payload?.reagents).map((entry) => ({
    itemId: integer(entry?.reagent?.id ?? entry?.item?.id ?? entry?.itemId),
    name: text(entry?.reagent?.name ?? entry?.item?.name, 160),
    quantity: integer(entry?.quantity, 0) ?? 0,
  })).filter((entry) => entry.itemId);
  return {
    mediaUrl: media.mediaUrl,
    mediaKey: media.mediaKey,
    namespace,
    craftedItemId: integer(payload?.crafted_item?.id ?? payload?.craftedItem?.id),
    craftedItemName: text(payload?.crafted_item?.name ?? payload?.craftedItem?.name, 160),
    craftedQuantity: Number(payload?.crafted_quantity?.value ?? payload?.craftedQuantity?.value ?? 0) || 0,
    reagents,
  };
}

function professionMetadata(payload, media, namespace) {
  return {
    mediaUrl: media.mediaUrl,
    mediaKey: media.mediaKey,
    namespace,
    description: text(payload?.description, 2000),
    type: text(payload?.type?.type ?? payload?.type?.name, 96),
    skillTiers: array(payload?.skill_tiers ?? payload?.skillTiers).map((entry) => ({
      id: integer(entry?.id),
      name: text(entry?.name, 160),
    })).filter((entry) => entry.id),
  };
}

function spellMetadata(payload, media, namespace) {
  return {
    mediaUrl: media.mediaUrl,
    mediaKey: media.mediaKey,
    namespace,
    description: text(payload?.description, 2000),
  };
}

function normalizedEntries(type, id, payload, mediaPayload, namespace, locale, observedAt) {
  const media = mediaDescriptor(mediaPayload);
  const base = {
    type,
    id,
    gameBuild: "",
    locale,
    name: text(payload?.name, 160),
    iconFileId: media.iconFileId,
    source: "blizzard",
    observedAt,
  };

  if (type === "item") {
    return [{
      ...base,
      qualityId: qualityId(payload),
      metadata: itemMetadata(payload, media, namespace),
    }];
  }

  if (type === "spell") {
    return [{ ...base, metadata: spellMetadata(payload, media, namespace) }];
  }

  if (type === "profession") {
    return [{ ...base, metadata: professionMetadata(payload, media, namespace) }];
  }

  if (type === "recipe") {
    const metadata = recipeMetadata(payload, media, namespace);
    const entries = [{ ...base, metadata }];
    if (metadata.craftedItemId) {
      entries.push({
        type: "item",
        id: metadata.craftedItemId,
        gameBuild: "",
        locale,
        name: metadata.craftedItemName,
        source: "blizzard",
        observedAt,
        metadata: { namespace },
      });
    }
    for (const reagent of metadata.reagents) {
      entries.push({
        type: "item",
        id: reagent.itemId,
        gameBuild: "",
        locale,
        name: reagent.name,
        source: "blizzard",
        observedAt,
        metadata: { namespace },
      });
    }
    return entries;
  }

  return [];
}

function referenceIds(references, bucket) {
  const values = references?.[`${bucket}s`] ?? references?.[bucket] ?? [];
  const seen = new Set();
  const result = [];
  for (const value of array(values)) {
    const id = integer(value);
    if (!id || id < 1 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function candidateList(references, bundle, nowMs, config) {
  const result = [];
  for (const type of ["item", "spell", "profession", "recipe"]) {
    for (const id of referenceIds(references, type)) {
      const entry = bundle?.[`${type}s`]?.[String(id)] || null;
      const updatedAt = new Date(entry?.updatedAt || 0).getTime();
      const authoritative = entry?.source === "blizzard";
      const fresh = authoritative && Number.isFinite(updatedAt) && nowMs - updatedAt < config.refreshMs;
      if (!fresh) result.push({ type, id });
      if (result.length >= config.maxEntities) return result;
    }
  }
  return result;
}

async function mapConcurrent(values, concurrency, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return result;
}

export function createBlizzardGameDataProvider({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const config = blizzardGameDataConfig(env);
  let token = "";
  let tokenExpiresAt = 0;
  const failures = new Map();

  function publicStatus() {
    return {
      provider: "blizzard",
      configured: config.configured,
      region: config.region,
      locale: config.locale,
      namespaces: [...config.namespaces],
      maxEntities: config.maxEntities,
      concurrency: config.concurrency,
    };
  }

  async function accessToken(force = false) {
    if (!config.configured) return "";
    const nowMs = now();
    if (!force && token && tokenExpiresAt - 60_000 > nowMs) return token;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      const response = await fetchImpl(config.oauthUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`blizzard_oauth_${response.status}`);
      const payload = await response.json();
      token = text(payload?.access_token, 4096);
      const expiresIn = Math.max(60, Number(payload?.expires_in) || 3600);
      tokenExpiresAt = nowMs + expiresIn * 1000;
      if (!token) throw new Error("blizzard_oauth_missing_token");
      return token;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestJson(path, namespace, retryAuth = true) {
    const bearer = await accessToken();
    const url = new URL(`${config.apiBaseUrl}${path}`);
    url.searchParams.set("namespace", namespace);
    url.searchParams.set("locale", config.locale);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: controller.signal,
      });
      if (response.status === 401 && retryAuth) {
        token = "";
        tokenExpiresAt = 0;
        await accessToken(true);
        return requestJson(path, namespace, false);
      }
      if (response.status === 404 || response.status === 400) {
        return { status: response.status, payload: null };
      }
      if (!response.ok) throw new Error(`blizzard_api_${response.status}`);
      return { status: response.status, payload: await response.json() };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchEntity(type, id) {
    const entity = ENTITY_CONFIG[type];
    if (!entity) return { status: "unsupported", entries: [] };
    const failureKey = `${type}:${id}:${config.locale}`;
    const failedUntil = failures.get(failureKey) || 0;
    if (failedUntil > now()) return { status: "cached-miss", entries: [] };

    for (const namespace of config.namespaces) {
      const resource = await requestJson(entity.resourcePath(id), namespace);
      if (!resource.payload) continue;
      let media = { payload: null };
      try {
        media = await requestJson(entity.mediaPath(id), namespace);
      } catch {
        media = { payload: null };
      }
      return {
        status: "ok",
        namespace,
        entries: normalizedEntries(
          type,
          id,
          resource.payload,
          media.payload,
          namespace,
          config.locale,
          new Date(now()).toISOString(),
        ),
      };
    }

    failures.set(failureKey, now() + config.failureTtlMs);
    return { status: "not-found", entries: [] };
  }

  async function hydrateReferences(references = {}, { gameBuild = "" } = {}) {
    if (!config.configured) {
      return { ...publicStatus(), attempted: 0, hydrated: 0, failed: 0 };
    }

    const bundle = withGuildDatabase((db) =>
      resolveGameDataBundleInDatabase(db, references, {
        gameBuild,
        locale: config.locale,
      }),
    );
    const candidates = candidateList(references, bundle, now(), config);
    if (!candidates.length) {
      return { ...publicStatus(), attempted: 0, hydrated: 0, failed: 0 };
    }

    const results = await mapConcurrent(candidates, config.concurrency, async ({ type, id }) => {
      try {
        return await fetchEntity(type, id);
      } catch {
        return { status: "error", entries: [] };
      }
    });
    const entries = results.flatMap((result) => result?.entries || []);
    if (entries.length) {
      withGuildDatabase((db) => {
        for (const entry of entries) upsertGameDataEntityInDatabase(db, entry);
      });
    }

    return {
      ...publicStatus(),
      attempted: candidates.length,
      hydrated: results.filter((result) => result?.status === "ok").length,
      failed: results.filter((result) => !["ok", "cached-miss"].includes(result?.status)).length,
    };
  }

  return {
    status: publicStatus,
    hydrateReferences,
  };
}
