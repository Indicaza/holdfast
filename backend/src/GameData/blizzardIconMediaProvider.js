import { blizzardGameDataConfig } from "./blizzardGameDataProvider.js";

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function text(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function httpsUrl(value) {
  const source = text(value);
  if (!source) return "";
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function findMediaUrl(payload, fileDataId) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  for (const result of results) {
    const data = result?.data && typeof result.data === "object" ? result.data : result;
    const assets = Array.isArray(data?.assets) ? data.assets : [];
    const exact = assets.find(
      (asset) => integer(asset?.file_data_id ?? asset?.fileDataId) === fileDataId,
    );
    const icon = exact || assets.find((asset) => asset?.key === "icon") || assets[0];
    const url = httpsUrl(icon?.value);
    if (url) return url;
  }
  return "";
}

export function createBlizzardIconMediaProvider({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const config = blizzardGameDataConfig(env);
  const cache = new Map();
  let token = "";
  let tokenExpiresAt = 0;
  let tokenPromise = null;

  async function loadToken() {
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
      tokenExpiresAt = now() + Math.max(60, Number(payload?.expires_in) || 3600) * 1000;
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

  async function search(fileDataId, namespace, retryAuth = true) {
    const bearer = await accessToken();
    const url = new URL(`${config.apiBaseUrl}/data/wow/search/media`);
    url.searchParams.set("namespace", namespace);
    url.searchParams.set("locale", config.locale);
    url.searchParams.set("assets.file_data_id", String(fileDataId));
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
        return search(fileDataId, namespace, false);
      }
      if (!response.ok) return "";
      return findMediaUrl(await response.json(), fileDataId);
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolve(fileDataIds = []) {
    if (!config.configured) return {};
    const ids = [...new Set(fileDataIds.map(integer).filter(Boolean))].slice(0, 32);
    const resolved = {};
    const namespaces = [
      ...config.namespaces,
      `static-${config.region}`,
    ].filter((value, index, values) => value && values.indexOf(value) === index);

    for (const id of ids) {
      const cached = cache.get(id);
      if (cached && cached.expiresAt > now()) {
        if (cached.url) resolved[String(id)] = cached.url;
        continue;
      }

      let url = "";
      try {
        for (const namespace of namespaces) {
          url = await search(id, namespace);
          if (url) break;
        }
      } catch {
        url = "";
      }

      cache.set(id, {
        url,
        expiresAt: now() + (url ? config.refreshMs : config.failureTtlMs),
      });
      if (url) resolved[String(id)] = url;
    }

    return resolved;
  }

  return {
    resolve,
    status() {
      return {
        provider: "blizzard-icon-media",
        configured: config.configured,
        region: config.region,
      };
    },
  };
}
