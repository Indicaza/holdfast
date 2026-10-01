import test from "node:test";
import assert from "node:assert/strict";

import {
  createRateLimiter,
  parseTrustProxy,
  requireTrustedMutationOrigin,
  securityHeaders,
  trustedOrigins,
} from "../src/Security/httpSecurity.js";

function fakeRequest({
  method = "GET",
  origin = "",
  referer = "",
  ip = "127.0.0.1",
} = {}) {
  return {
    method,
    ip,
    socket: { remoteAddress: ip },
    get(name) {
      const key = String(name).toLowerCase();

      if (key === "origin") return origin;
      if (key === "referer") return referer;
      return "";
    },
  };
}

function fakeResponse() {
  const headers = new Map();

  return {
    headers,
    statusCode: 200,
    body: null,
    set(name, value) {
      headers.set(name, value);
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function preserveEnvironment() {
  return {
    nodeEnv: process.env.NODE_ENV,
    frontendUrl: process.env.FRONTEND_URL,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL,
    trustedOrigins: process.env.TRUSTED_ORIGINS,
  };
}

function restoreEnvironment(previous) {
  for (const [key, value] of [
    ["NODE_ENV", previous.nodeEnv],
    ["FRONTEND_URL", previous.frontendUrl],
    ["RENDER_EXTERNAL_URL", previous.renderExternalUrl],
    ["TRUSTED_ORIGINS", previous.trustedOrigins],
  ]) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("security headers include baseline browser protections", () => {
  const previous = preserveEnvironment();

  try {
    process.env.NODE_ENV = "production";

    const req = fakeRequest();
    const res = fakeResponse();
    let continued = false;

    securityHeaders(req, res, () => {
      continued = true;
    });

    assert.equal(continued, true);
    const contentSecurityPolicy = res.headers.get("Content-Security-Policy");

    assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
    assert.match(contentSecurityPolicy, /script-src 'self'/);
    assert.match(contentSecurityPolicy, /connect-src 'self'/);
    assert.doesNotMatch(contentSecurityPolicy, /google(tagmanager|-analytics)/);
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
    assert.equal(
      res.headers.get("Referrer-Policy"),
      "strict-origin-when-cross-origin",
    );
    assert.match(
      res.headers.get("Strict-Transport-Security"),
      /max-age=/,
    );
  } finally {
    restoreEnvironment(previous);
  }
});

test("trusted origins include canonical and explicitly allowed browser origins", () => {
  const previous = preserveEnvironment();

  try {
    process.env.FRONTEND_URL = "https://holdfast.example/path";
    process.env.TRUSTED_ORIGINS =
      "https://admin.holdfast.example, https://holdfast.example/other";

    assert.deepEqual(
      [...trustedOrigins()].sort(),
      [
        "https://admin.holdfast.example",
        "https://holdfast.example",
      ].sort(),
    );
  } finally {
    restoreEnvironment(previous);
  }
});

test("trusted origins use Render's generated website URL by default", () => {
  const previous = preserveEnvironment();

  try {
    delete process.env.FRONTEND_URL;
    process.env.RENDER_EXTERNAL_URL = "https://holdfast.onrender.com";
    delete process.env.TRUSTED_ORIGINS;

    assert.deepEqual([...trustedOrigins()], ["https://holdfast.onrender.com"]);
  } finally {
    restoreEnvironment(previous);
  }
});

test("production mutation requests reject untrusted origins", () => {
  const previous = preserveEnvironment();

  try {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://holdfast.example";
    delete process.env.TRUSTED_ORIGINS;

    const req = fakeRequest({
      method: "POST",
      origin: "https://evil.example",
    });
    const res = fakeResponse();
    let continued = false;

    requireTrustedMutationOrigin(req, res, () => {
      continued = true;
    });

    assert.equal(continued, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "invalid_request_origin" });
  } finally {
    restoreEnvironment(previous);
  }
});

test("production mutation requests accept the configured frontend origin", () => {
  const previous = preserveEnvironment();

  try {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://holdfast.example";

    const req = fakeRequest({
      method: "PATCH",
      origin: "https://holdfast.example",
    });
    const res = fakeResponse();
    let continued = false;

    requireTrustedMutationOrigin(req, res, () => {
      continued = true;
    });

    assert.equal(continued, true);
    assert.equal(res.statusCode, 200);
  } finally {
    restoreEnvironment(previous);
  }
});

test("production mutation requests require origin evidence", () => {
  const previous = preserveEnvironment();

  try {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://holdfast.example";

    const req = fakeRequest({ method: "DELETE" });
    const res = fakeResponse();

    requireTrustedMutationOrigin(req, res, () => {
      throw new Error("request should not continue");
    });

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "request_origin_required" });
  } finally {
    restoreEnvironment(previous);
  }
});

test("rate limiter blocks requests above the configured window limit", () => {
  const limiter = createRateLimiter({
    name: "security-test-rate-limit",
    windowMs: 60_000,
    max: 2,
  });
  const req = fakeRequest({ ip: "203.0.113.10" });

  for (let index = 0; index < 2; index += 1) {
    const res = fakeResponse();
    let continued = false;

    limiter(req, res, () => {
      continued = true;
    });

    assert.equal(continued, true);
  }

  const blocked = fakeResponse();
  limiter(req, blocked, () => {
    throw new Error("rate-limited request should not continue");
  });

  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.body, { error: "rate_limit_exceeded" });
  assert.ok(Number(blocked.headers.get("Retry-After")) >= 1);
});

test("proxy trust accepts only explicit safe configuration forms", () => {
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy("loopback"), "loopback");
  assert.throws(() => parseTrustProxy("true"), /TRUST_PROXY/);
});
