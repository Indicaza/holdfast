import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  attachSession,
  clearOAuthState,
  clearSession,
  readOAuthState,
  setOAuthState,
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

function signedToken(session, secret) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function readSession(token) {
  const req = requestFor(token);
  attachSession(req, {}, () => {});
  return req.auth;
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
    const tamperedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const tampered = `${payload}.${tamperedSignature}`;
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

test("session cookies use hardened production attributes", () => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.NODE_ENV = "production";

  try {
    const res = response();
    setSession(res, {
      user: { id: "member-one", username: "rook" },
      permissions: [],
    });

    const header = res.headers[0][1];
    assert.match(header, /^guild_session=/);
    assert.match(header, /; Path=\//);
    assert.match(header, /; HttpOnly/);
    assert.match(header, /; SameSite=Lax/);
    assert.match(header, /; Secure/);
    assert.match(header, /; Priority=High/);
    assert.doesNotMatch(header, /;\s*;/);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("cleared cookies expire immediately", () => {
  const res = response();

  clearSession(res);
  clearOAuthState(res);

  for (const [, header] of res.headers) {
    assert.match(header, /Max-Age=0/);
    assert.match(header, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  }
});

test("malformed percent-encoded cookies are ignored without throwing", () => {
  const req = {
    headers: { cookie: "guild_session=%E0%A4%A" },
  };

  assert.doesNotThrow(() => attachSession(req, {}, () => {}));
  assert.equal(req.auth, null);

  const stateRequest = {
    headers: { cookie: "guild_oauth_state=%ZZ" },
  };
  assert.equal(readOAuthState(stateRequest), null);
});

test("the first duplicate session cookie wins", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-for-holdfast-ci";

  try {
    const res = response();
    setSession(res, {
      user: { id: "member-one", username: "rook" },
      permissions: [],
    });
    const valid = cookieValue(res.headers[0][1]);
    const req = {
      headers: {
        cookie: `guild_session=${encodeURIComponent(valid)}; guild_session=forged`,
      },
    };

    attachSession(req, {}, () => {});
    assert.equal(req.auth.user.id, "member-one");
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("ambiguous and non-canonical session tokens are rejected", () => {
  const previous = process.env.SESSION_SECRET;
  const secret = "test-session-secret-for-holdfast-ci";
  process.env.SESSION_SECRET = secret;

  try {
    const token = signedToken(
      {
        user: { id: "member-one" },
        permissions: [],
        exp: Date.now() + 60_000,
      },
      secret,
    );

    assert.equal(readSession(`${token}.extra`), null);
    assert.equal(readSession(`${token}=`), null);
    assert.equal(readSession(`.${token.split(".")[1]}`), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("signed sessions still require a valid payload shape", () => {
  const previous = process.env.SESSION_SECRET;
  const secret = "test-session-secret-for-holdfast-ci";
  process.env.SESSION_SECRET = secret;
  const expiresSoon = Date.now() + 60_000;

  try {
    const invalidSessions = [
      null,
      [],
      { permissions: [], exp: expiresSoon },
      { user: { id: "" }, permissions: [], exp: expiresSoon },
      {
        user: { id: "member-one" },
        permissions: "site.admin",
        exp: expiresSoon,
      },
      {
        user: { id: "member-one" },
        permissions: [],
        exp: Date.now() + 31 * 24 * 60 * 60 * 1000,
      },
      {
        user: { id: "member-one" },
        permissions: [],
        verifiedAt: Date.now() + 10 * 60 * 1000,
        exp: expiresSoon,
      },
    ];

    for (const session of invalidSessions) {
      assert.equal(readSession(signedToken(session, secret)), null);
    }
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("session creation rejects malformed or oversized server payloads", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-for-holdfast-ci";

  try {
    assert.throws(
      () => setSession(response(), { user: {}, permissions: [] }),
      /user ID/,
    );
    assert.throws(
      () =>
        setSession(response(), {
          user: { id: "member-one" },
          permissions: [null],
        }),
      /permissions/,
    );
    assert.throws(
      () =>
        setSession(response(), {
          user: { id: "member-one", padding: "x".repeat(5000) },
          permissions: [],
        }),
      /too large/,
    );
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("OAuth state cookie round-trips independently of other cookies", () => {
  const res = response();
  setOAuthState(res, "nonce-value");
  const stateCookie = res.headers[0][1].split(";")[0];
  const req = {
    headers: {
      cookie: `unrelated=value; ${stateCookie}; guild_session=ignored`,
    },
  };

  assert.equal(readOAuthState(req), "nonce-value");
  assert.match(res.headers[0][1], /HttpOnly/);
  assert.match(res.headers[0][1], /SameSite=Lax/);
});
