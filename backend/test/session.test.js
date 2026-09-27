import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  attachSession,
  setSession,
} from "../src/Auth/session.js";

function response() {
  const headers = [];

  return {
    headers,
    append(name, value) {
      headers.push([name, value]);
    },
  };
}

function cookieValue(setCookieHeader) {
  return decodeURIComponent(
    setCookieHeader.split(";")[0].split("=").slice(1).join("="),
  );
}

function requestFor(value) {
  return {
    headers: {
      cookie: value ? `guild_session=${encodeURIComponent(value)}` : "",
    },
  };
}

function sign(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

test("signed session round-trips through the cookie middleware", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-for-holdfast-ci";

  try {
    const res = response();

    setSession(res, {
      user: { id: "member-one", username: "rook" },
      permissions: ["quests.edit"],
      verifiedAt: 123,
    });

    const token = cookieValue(res.headers[0][1]);
    const req = requestFor(token);

    attachSession(req, {}, () => {});

    assert.equal(req.auth.user.id, "member-one");
    assert.deepEqual(req.auth.permissions, ["quests.edit"]);
    assert.equal(req.auth.verifiedAt, 123);
    assert.ok(req.auth.exp > Date.now());
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("tampered session cookies are rejected", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-for-holdfast-ci";

  try {
    const res = response();
    setSession(res, {
      user: { id: "member-one", username: "rook" },
      permissions: [],
    });

    const token = cookieValue(res.headers[0][1]);
    const [payload, signature] = token.split(".");
    const tampered = `${payload.slice(0, -1)}A.${signature}`;
    const req = requestFor(tampered);

    attachSession(req, {}, () => {});

    assert.equal(req.auth, null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("expired signed sessions are rejected", () => {
  const previous = process.env.SESSION_SECRET;
  const secret = "test-session-secret-for-holdfast-ci";
  process.env.SESSION_SECRET = secret;

  try {
    const payload = Buffer.from(
      JSON.stringify({
        user: { id: "member-one" },
        permissions: [],
        exp: Date.now() - 1000,
      }),
    ).toString("base64url");
    const token = `${payload}.${sign(payload, secret)}`;
    const req = requestFor(token);

    attachSession(req, {}, () => {});

    assert.equal(req.auth, null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
