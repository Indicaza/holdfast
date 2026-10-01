import assert from "node:assert/strict";
import test from "node:test";

import { createDiscordSessionRefresher } from "../src/Auth/discordSession.js";

const GUILD_ID = "223456789012345678";
const USER_ONE = "323456789012345678";
const USER_TWO = "423456789012345678";
const ROLE_ID = "523456789012345678";
const FIXED_NOW = Date.now();
const silentLogger = { error() {} };

function environment(overrides = {}) {
  return {
    DISCORD_GUILD_ID: GUILD_ID,
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_SESSION_REVERIFY_SECONDS: "60",
    ...overrides,
  };
}

function request(userId = USER_ONE, overrides = {}) {
  return {
    auth: {
      user: { id: userId, username: "rook" },
      permissions: [],
      verifiedAt: 0,
      ...overrides,
    },
  };
}

function response() {
  const headers = new Map();

  return {
    body: null,
    headers,
    statusCode: 200,
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

function guildMember(userId = USER_ONE, overrides = {}) {
  return {
    user: {
      id: userId,
      username: "rook",
      global_name: "Rook",
      avatar: "avatar_hash",
    },
    roles: [ROLE_ID],
    nick: "Commander Rook",
    joined_at: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function harness(overrides = {}) {
  const events = {
    cleared: 0,
    departed: [],
    fetches: [],
    sessions: [],
    upserts: [],
  };
  const fetchImpl =
    overrides.fetchImpl ||
    (async (url, options) => {
      events.fetches.push({ url: String(url), options });
      return jsonResponse(guildMember());
    });
  const middleware = createDiscordSessionRefresher({
    env: environment(),
    now: () => FIXED_NOW,
    fetchImpl,
    permissionResolver: () => ["quests.edit"],
    markDeparted: async (userId) => events.departed.push(userId),
    upsertMember: async (...args) => events.upserts.push(args),
    clearSessionImpl: () => {
      events.cleared += 1;
    },
    setSessionImpl: (res, value) => events.sessions.push(value),
    logger: silentLogger,
    ...overrides,
  });

  return { events, middleware };
}

async function run(middleware, req = request()) {
  const res = response();
  let nextCalls = 0;
  await middleware(req, res, () => {
    nextCalls += 1;
  });
  return { nextCalls, req, res };
}

test("fresh Discord sessions bypass network revalidation", async () => {
  const { events, middleware } = harness();
  const result = await run(
    middleware,
    request(USER_ONE, { verifiedAt: FIXED_NOW - 1000 }),
  );

  assert.equal(result.nextCalls, 1);
  assert.equal(events.fetches.length, 0);
  assert.equal(events.sessions.length, 0);
});

test("default revalidation stays quiet for the 30 day session lifetime", async () => {
  let fetches = 0;
  const env = environment({ DISCORD_SESSION_REVERIFY_SECONDS: "" });
  const { middleware } = harness({
    env,
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse(guildMember());
    },
  });
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const fresh = await run(
    middleware,
    request(USER_ONE, { verifiedAt: FIXED_NOW - thirtyDaysMs + 1000 }),
  );

  assert.equal(fresh.nextCalls, 1);
  assert.equal(fetches, 0);

  const stale = await run(
    middleware,
    request(USER_ONE, { verifiedAt: FIXED_NOW - thirtyDaysMs }),
  );

  assert.equal(stale.nextCalls, 1);
  assert.equal(fetches, 1);
});

test("future verification timestamps do not bypass Discord", async () => {
  const { events, middleware } = harness();
  const result = await run(
    middleware,
    request(USER_ONE, { verifiedAt: FIXED_NOW + 1000 }),
  );

  assert.equal(result.nextCalls, 1);
  assert.equal(events.fetches.length, 1);
});

test("stale sessions refresh identity, permissions, persistence, and cookie", async () => {
  const { events, middleware } = harness();
  const result = await run(middleware);

  assert.equal(result.nextCalls, 1);
  assert.equal(result.res.statusCode, 200);
  assert.equal(events.fetches.length, 1);
  assert.equal(
    events.fetches[0].options.headers.Authorization,
    "Bot bot-token",
  );
  assert.ok(events.fetches[0].options.signal instanceof AbortSignal);
  assert.equal(result.req.auth.user.id, USER_ONE);
  assert.equal(result.req.auth.user.guildNickname, "Commander Rook");
  assert.deepEqual(result.req.auth.permissions, ["quests.edit"]);
  assert.equal(result.req.auth.verifiedAt, FIXED_NOW);
  assert.equal(events.upserts.length, 1);
  assert.equal(events.sessions.length, 1);
});

test("departed guild members lose their session before the request continues", async () => {
  const { events, middleware } = harness({
    fetchImpl: async (url, options) => {
      events.fetches.push({ url: String(url), options });
      return jsonResponse({ message: "Unknown Member" }, 404);
    },
  });
  const result = await run(middleware);

  assert.equal(result.nextCalls, 1);
  assert.equal(result.req.auth, null);
  assert.deepEqual(events.departed, [USER_ONE]);
  assert.equal(events.cleared, 1);
  assert.equal(events.sessions.length, 0);
});

test("Discord outages fail closed without deleting a valid local session", async () => {
  const originalAuth = request().auth;
  const { middleware } = harness({
    fetchImpl: async () =>
      jsonResponse(
        { message: "upstream details" },
        503,
        { "x-request-id": "discord-request" },
      ),
  });
  const result = await run(middleware, { auth: originalAuth });

  assert.equal(result.nextCalls, 0);
  assert.equal(result.res.statusCode, 503);
  assert.deepEqual(result.res.body, {
    error: "membership_verification_unavailable",
  });
  assert.equal(result.res.headers.get("Cache-Control"), "no-store");
  assert.equal(result.res.headers.get("Retry-After"), "5");
  assert.equal(result.req.auth, originalAuth);
});

test("missing revalidation configuration fails closed", async () => {
  const { middleware } = harness({
    env: environment({ DISCORD_BOT_TOKEN: "" }),
  });
  const result = await run(middleware);

  assert.equal(result.nextCalls, 0);
  assert.equal(result.res.statusCode, 503);
  assert.deepEqual(result.res.body, {
    error: "membership_verification_unavailable",
  });
});

test("mismatched and malformed Discord member payloads are rejected", async () => {
  for (const payload of [
    { roles: [] },
    guildMember(USER_TWO),
    guildMember(USER_ONE, { roles: "not-an-array" }),
  ]) {
    const { middleware } = harness({
      fetchImpl: async () => jsonResponse(payload),
    });
    const result = await run(middleware);

    assert.equal(result.nextCalls, 0);
    assert.equal(result.res.statusCode, 503);
  }
});

test("malformed permission resolver output fails closed", async () => {
  const { middleware } = harness({
    permissionResolver: () => "site.admin",
  });
  const result = await run(middleware);

  assert.equal(result.nextCalls, 1);
  assert.deepEqual(result.req.auth.permissions, []);
});

test("successful verification is cached per member", async () => {
  let fetches = 0;
  const { middleware } = harness({
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse(guildMember());
    },
  });

  await run(middleware, request());
  await run(middleware, request());

  assert.equal(fetches, 1);
});

test("verification cache expires at the configured interval", async () => {
  let clock = FIXED_NOW;
  let fetches = 0;
  const { middleware } = harness({
    now: () => clock,
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse(guildMember());
    },
  });

  await run(middleware, request());
  clock += 59_000;
  await run(middleware, request());
  clock += 2_000;
  await run(middleware, request());

  assert.equal(fetches, 2);
});

test("concurrent verification requests for one member share one Discord call", async () => {
  let release;
  let fetches = 0;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { middleware } = harness({
    fetchImpl: async () => {
      fetches += 1;
      await pending;
      return jsonResponse(guildMember());
    },
  });

  const first = run(middleware, request());
  const second = run(middleware, request());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetches, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.nextCalls),
    [1, 1],
  );
});

test("bounded verification cache evicts the least-recently-used member", async () => {
  let fetches = 0;
  const { middleware } = harness({
    cacheMaxEntries: 1,
    fetchImpl: async (url) => {
      fetches += 1;
      const userId = new URL(url).pathname.split("/").at(-1);
      return jsonResponse(guildMember(userId));
    },
  });

  await run(middleware, request(USER_ONE));
  await run(middleware, request(USER_TWO));
  await run(middleware, request(USER_ONE));

  assert.equal(fetches, 3);
});

test("requests without an authenticated user continue without Discord", async () => {
  const { events, middleware } = harness();
  const result = await run(middleware, { auth: null });

  assert.equal(result.nextCalls, 1);
  assert.equal(events.fetches.length, 0);
});
