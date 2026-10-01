import { publicWebsiteUrl } from "../Config/environment.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const rateBuckets = new Map();

function normalizeOrigin(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function trustedOrigins() {
  const origins = new Set();
  const frontend = normalizeOrigin(publicWebsiteUrl());

  if (frontend) {
    origins.add(frontend);
  }

  for (const entry of String(process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((value) => normalizeOrigin(value.trim()))
    .filter(Boolean)) {
    origins.add(entry);
  }

  return origins;
}

export function corsOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (trustedOrigins().has(normalizeOrigin(origin))) {
    callback(null, true);
    return;
  }

  const error = new Error("CORS origin rejected");
  error.code = "cors_origin_rejected";
  callback(error);
}

function requestOrigin(req) {
  const origin = normalizeOrigin(req.get("Origin"));

  if (origin) {
    return origin;
  }

  return normalizeOrigin(req.get("Referer"));
}

export function requireTrustedMutationOrigin(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = requestOrigin(req);

  if (!origin) {
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }

    res.status(403).json({ error: "request_origin_required" });
    return;
  }

  if (!trustedOrigins().has(origin)) {
    res.status(403).json({ error: "invalid_request_origin" });
    return;
  }

  next();
}

export function securityHeaders(req, res, next) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
  ];

  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
    res.set(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains",
    );
  }

  res.set("Content-Security-Policy", directives.join("; "));
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.set("Cross-Origin-Opener-Policy", "same-origin");

  next();
}

function rateLimitKey(req, name) {
  return `${name}:${req.ip || req.socket?.remoteAddress || "unknown"}`;
}

function pruneExpiredBuckets(now) {
  if (rateBuckets.size < 5000) {
    return;
  }

  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

export function createRateLimiter({
  name,
  windowMs = 10 * 60 * 1000,
  max = 60,
} = {}) {
  if (!name) {
    throw new Error("Rate limiter name is required");
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    pruneExpiredBuckets(now);

    const key = rateLimitKey(req, name);
    let bucket = rateBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
      rateBuckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );

    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(remaining));
    res.set(
      "RateLimit-Reset",
      String(Math.ceil(bucket.resetAt / 1000)),
    );

    if (bucket.count > max) {
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "rate_limit_exceeded" });
      return;
    }

    next();
  };
}

export function parseTrustProxy(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  if (["loopback", "linklocal", "uniquelocal"].includes(normalized)) {
    return normalized;
  }

  throw new Error(
    "TRUST_PROXY must be a hop count or one of loopback, linklocal, uniquelocal",
  );
}
