import { blizzardGameDataConfig } from "./blizzardGameDataProvider.js";

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function httpsUrl(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function mediaUrlFromSearch(payload, fileDataId) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  for (const result of results) {
    const data = result?.data && typeof result.data === "object" ? result.data : result;
    const assets = Array.isArray(data?.assets) ? data.assets : [];
    const exact = assets.find((asset) => Number(asset?.file_data_id ?? asset?.fileDataId) === fileDataId);
    const icon = exact || assets.find((asset) => asset?.key === "icon") || assets[0];
    const url = httpsUrl(icon?.value);
    if (url) return url;
  }
  return "";
}

export function createBlizzardIconMediaResolver({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const config = blizzardGameDataConfig(env);
  const namespace = String(env.BLIZZARD_MEDIA_NAMESPACE || `static-${config.region}`).trim();
  const cache = new Map();
  let token = "";
  let tokenExpiresAt = 0;
  let tokenPromise = null;

  async function loadToken() {
    if (!config.configured) return "";
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
      token = String(payload?.access_token || "").trim();
      tokenExpiresAt = now() + Math.max(60, Number(payload?.expires_in) || 3600) * 1000;
      if (!token) throw new Error("blizzard_oauth_missing_token");
      return token;
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken(force = false) {
    if (!config.configured) return "";
    if (!force && token && tokenExpiresAt - 60_000 > now()) return token;
    if (!force && tokenPromise) return tokenPromise;
    tokenPromise = loadToken();
    try {
      return await tokenPromise;
    } finally {
      tokenPromise = null;
    }
  }

  async function resolveRemote(id, retryAuth = true) {
    const bearer = await accessToken();
    const url = new URL(`${config.apiBaseUrl}/data/wow/search/media`);
    url.searchParams.set("namespace", namespace);
    url.searchParams.set("locale", config.locale);
    url.searchParams.set("assets.file_data_id", String(id));
    url.searchParams.set("_page", "1");
    url.searchParams.set("orderby", "id");

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
        return resolveRemote(id, false);
      }
      if (!response.ok) return "";
      return mediaUrlFromSearch(await response.json(), id);
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolve(fileDataId) {
    const id = positiveInteger(fileDataId);
    if (!id || !config.configured) return "";

    const cached = cache.get(id);
    if (cached && cached.expiresAt > now()) return cached.url;

    const mediaUrl = await resolveRemote(id);
    cache.set(id, {
      url: mediaUrl,
      expiresAt: now() + (mediaUrl ? 24 * 60 * 60_000 : 15 * 60_000),
    });
    if (cache.size > 1000) cache.delete(cache.keys().next().value);
    return mediaUrl;
  }

  return {
    resolve,
    status() {
      return {
        configured: config.configured,
        provider: "blizzard-media-search",
        region: config.region,
        namespace,
      };
    },
  };
}
