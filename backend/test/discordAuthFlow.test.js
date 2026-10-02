import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";

import express from "express";

import { createDiscordAuthRouter } from "../src/Auth/discordAuth.js";
import { attachSession } from "../src/Auth/session.js";

const CLIENT_ID = "123456789012345678";
const GUILD_ID = "223456789012345678";
const USER_ID = "323456789012345678";
const ROLE_ID = "423456789012345678";
const RECRUIT_ROLE_ID = "523456789012345678";
const FIXED_NOW = Date.now();
const TEST_SECRET = "test-session-secret-for-holdfast-ci";
const silentLogger = { error() {} };

const previousEnvironment = {
  secret: process.env.SESSION_SECRET,
  nodeEnv: process.env.NODE_ENV,
};

before(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "test";
});

after(() => {
  if (previousEnvironment.secret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = previousEnvironment.secret;
  }

  if (previousEnvironment.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousEnvironment.nodeEnv;
  }
});

function authEnvironment(overrides = {}) {
  return {
    FRONTEND_URL: "https://holdfast.example",
    SESSION_SECRET: TEST_SECRET,
    DISCORD_CLIENT_ID: CLIENT_ID,
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_GUILD_ID: GUILD_ID,
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_RECRUIT_ROLE_ID: RECRUIT_ROLE_ID,
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

function emptyResponse(status = 204, headers = {}) {
  return new Response(null, { status, headers });
}

function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const call = { url: String(url), options };
    calls.push(call);
    return handler(call, calls.length - 1);
  };

  return { calls, fetchImpl };
}

async function withAuthServer(routerOptions, run) {
  const app = express();
  app.use("/api/auth", createDiscordAuthRouter(routerOptions));
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function beginAuthorization(baseUrl, { mode = "member", returnTo = "/" } = {}) {
  const query = new URLSearchParams({ mode, returnTo });
  const response = await fetch(`${baseUrl}/api/auth/discord?${query}`, {
    redirect: "manual",
  });
  const authorizeUrl = new URL(response.headers.get("location"));
  const setCookie = response.headers.get("set-cookie");

  return {
    authorizeUrl,
    cookie: setCookie.split(";", 1)[0],
    response,
    state: authorizeUrl.searchParams.get("state"),
  };
}

async function finishAuthorization(
  baseUrl,
  { state, cookie, code = "oauth-code", error = "" },
) {
  const query = new URLSearchParams({ state });

  if (code) query.set("code", code);
  if (error) query.set("error", error);

  return fetch(`${baseUrl}/api/auth/discord/callback?${query}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
}

function standardDiscordFetch({ member = true } = {}) {
  return recordingFetch(({ url }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    if (parsed.pathname.endsWith("/users/@me")) {
      return jsonResponse({
        id: USER_ID,
        username: "rook",
        global_name: "Rook",
        avatar: "avatar_hash",
      });
    }

    if (parsed.pathname.includes(`/users/@me/guilds/${GUILD_ID}/member`)) {
      return member
        ? jsonResponse({
            roles: [ROLE_ID],
            nick: "Commander Rook",
            joined_at: "2026-09-27T00:00:00.000Z",
          })
        : jsonResponse({ message: "Unknown Member" }, 404);
    }

    throw new Error(`Unexpected Discord request: ${url}`);
  });
}

function sessionFromResponse(response) {
  const setCookies = response.headers.getSetCookie();
  const sessionCookie = setCookies.find((value) =>
    value.startsWith("guild_session="),
  );
  const req = {
    headers: { cookie: sessionCookie.split(";", 1)[0] },
  };

  attachSession(req, {}, () => {});
  return req.auth;
}

test("authorization start uses least-privilege scopes and signed state", async () => {
  await withAuthServer(
    {
      env: authEnvironment(),
      now: () => FIXED_NOW,
      randomBytes: () => Buffer.alloc(32, 7),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const member = await beginAuthorization(baseUrl, {
        mode: "member",
        returnTo: "/quests?signupQuest=q1#board",
      });

      assert.equal(member.response.status, 302);
      assert.equal(member.authorizeUrl.origin, "https://discord.com");
      assert.equal(member.authorizeUrl.searchParams.get("client_id"), CLIENT_ID);
      assert.equal(
        member.authorizeUrl.searchParams.get("scope"),
        "identify guilds.members.read",
      );
      assert.equal(member.state.split(".").length, 2);
      assert.match(member.cookie, /^guild_oauth_state=/);

      const recruit = await beginAuthorization(baseUrl, { mode: "recruit" });
      assert.equal(
        recruit.authorizeUrl.searchParams.get("scope"),
        "identify guilds.members.read guilds.join",
      );

      const unknown = await beginAuthorization(baseUrl, { mode: "surprise" });
      assert.equal(
        unknown.authorizeUrl.searchParams.get("scope"),
        "identify guilds.members.read",
      );
    },
  );
});

test("Discord server shortcut opens the configured guild", async () => {
  await withAuthServer(
    {
      env: authEnvironment(),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/discord/server`, {
        redirect: "manual",
      });

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("location"),
        `https://discord.com/channels/${GUILD_ID}`,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
    },
  );
});

test("authorization uses Render's generated URL on the first deploy", async () => {
  await withAuthServer(
    {
      env: authEnvironment({
        FRONTEND_URL: "",
        RENDER_EXTERNAL_URL: "https://holdfast.onrender.com",
      }),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const authorization = await beginAuthorization(baseUrl);

      assert.equal(
        authorization.authorizeUrl.searchParams.get("redirect_uri"),
        "https://holdfast.onrender.com/api/auth/discord/callback",
      );
    },
  );
});

test("authorization start fails closed without exposing missing configuration", async () => {
  await withAuthServer(
    {
      env: authEnvironment({ DISCORD_CLIENT_SECRET: "   " }),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/discord`, {
        redirect: "manual",
      });

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "auth_not_configured" });
      assert.equal(response.headers.get("location"), null);
    },
  );
});

test("logout is POST-only and expires the session cookie", async () => {
  await withAuthServer(
    { env: authEnvironment(), logger: silentLogger },
    async (baseUrl) => {
      const post = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
      });
      assert.equal(post.status, 204);
      assert.match(post.headers.get("set-cookie"), /^guild_session=/);
      assert.match(post.headers.get("set-cookie"), /Max-Age=0/);

      const get = await fetch(`${baseUrl}/api/auth/logout`);
      assert.equal(get.status, 404);
    },
  );
});

test("tampered OAuth state is rejected before cancellation or Discord calls", async () => {
  const discord = recordingFetch(() => {
    throw new Error("Discord must not be called for invalid state");
  });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      randomBytes: () => Buffer.alloc(32, 8),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, { mode: "member" });
      const [payload, signature] = started.state.split(".");
      const decoded = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      decoded.mode = "recruit";
      const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString(
        "base64url",
      );
      const response = await finishAuthorization(baseUrl, {
        state: `${tamperedPayload}.${signature}`,
        cookie: started.cookie,
        code: "",
        error: "access_denied",
      });

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/?auth=invalid-state",
      );
      assert.equal(discord.calls.length, 0);
      assert.match(response.headers.get("set-cookie"), /guild_oauth_state=/);
      assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
    },
  );
});

test("expired and cookie-mismatched OAuth states are rejected", async () => {
  let clock = FIXED_NOW;

  await withAuthServer(
    {
      env: authEnvironment(),
      now: () => clock,
      randomBytes: () => Buffer.alloc(32, 9),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const expired = await beginAuthorization(baseUrl);
      clock += 11 * 60 * 1000;
      const expiredResponse = await finishAuthorization(baseUrl, expired);
      assert.equal(
        expiredResponse.headers.get("location"),
        "https://holdfast.example/?auth=invalid-state",
      );

      clock = FIXED_NOW;
      const mismatched = await beginAuthorization(baseUrl);
      const mismatchResponse = await finishAuthorization(baseUrl, {
        ...mismatched,
        cookie: "guild_oauth_state=wrong-nonce",
      });
      assert.equal(
        mismatchResponse.headers.get("location"),
        "https://holdfast.example/?auth=invalid-state",
      );
    },
  );
});

test("valid cancellation and missing-code callbacks remain intentional", async () => {
  await withAuthServer(
    {
      env: authEnvironment(),
      now: () => FIXED_NOW,
      logger: silentLogger,
    },
    async (baseUrl) => {
      const cancelled = await beginAuthorization(baseUrl, {
        mode: "recruit",
        returnTo: "/quests?q=linen",
      });
      const cancelledResponse = await finishAuthorization(baseUrl, {
        ...cancelled,
        code: "",
        error: "access_denied",
      });
      assert.equal(
        cancelledResponse.headers.get("location"),
        "https://holdfast.example/join?returnTo=%2Fquests%3Fq%3Dlinen&auth=cancelled",
      );

      const missing = await beginAuthorization(baseUrl, {
        returnTo: "/members",
      });
      const missingResponse = await finishAuthorization(baseUrl, {
        ...missing,
        code: "",
      });
      assert.equal(
        missingResponse.headers.get("location"),
        "https://holdfast.example/members?auth=missing-code",
      );
    },
  );
});

test("existing-member login creates a constrained signed session", async () => {
  const discord = standardDiscordFetch();
  const persisted = [];

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      permissionResolver(userId, roles) {
        assert.equal(userId, USER_ID);
        assert.deepEqual(roles, [ROLE_ID]);
        return ["quests.edit"];
      },
      upsertMember: async (...args) => persisted.push(args),
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, {
        returnTo: "/quests?signupQuest=q1",
      });
      const response = await finishAuthorization(baseUrl, started);

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/quests?signupQuest=q1&auth=connected",
      );
      assert.equal(discord.calls.length, 3);
      assert.ok(
        discord.calls.every(
          (call) => call.options.signal instanceof AbortSignal,
        ),
      );
      assert.equal(persisted.length, 1);

      const session = sessionFromResponse(response);
      assert.equal(session.user.id, USER_ID);
      assert.equal(session.user.guildNickname, "Commander Rook");
      assert.deepEqual(session.permissions, ["quests.edit"]);
      assert.ok(session.verifiedAt > 0);
    },
  );
});

test("member login never joins a Discord user who is not already present", async () => {
  const discord = standardDiscordFetch({ member: false });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, {
        mode: "member",
        returnTo: "/members/me",
      });
      const response = await finishAuthorization(baseUrl, started);

      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/join?returnTo=%2Fmembers%2Fme&auth=not-member",
      );
      assert.equal(discord.calls.length, 3);
      assert.equal(
        discord.calls.some((call) => call.options.method === "PUT"),
        false,
      );
    },
  );
});

test("recruit flow joins once and applies the configured Recruit role", async () => {
  const discord = recordingFetch(({ url, options }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    if (parsed.pathname.endsWith("/users/@me")) {
      return jsonResponse({ id: USER_ID, username: "rook" });
    }

    if (parsed.pathname.includes("/users/@me/guilds/")) {
      return jsonResponse({ message: "Unknown Member" }, 404);
    }

    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      assert.equal(body.access_token, "access-token");
      assert.deepEqual(body.roles, [RECRUIT_ROLE_ID]);
      return jsonResponse({ roles: [RECRUIT_ROLE_ID], nick: null });
    }

    throw new Error(`Unexpected Discord request: ${url}`);
  });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      upsertMember: async () => {},
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, { mode: "recruit" });
      const response = await finishAuthorization(baseUrl, started);

      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/join?auth=connected",
      );
      assert.equal(
        discord.calls.filter((call) => call.options.method === "PUT").length,
        1,
      );
    },
  );
});

test("recruit flow remains valid without an optional role ID", async () => {
  const discord = recordingFetch(({ url, options }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    if (parsed.pathname.endsWith("/users/@me")) {
      return jsonResponse({ id: USER_ID, username: "rook" });
    }

    if (parsed.pathname.includes("/users/@me/guilds/")) {
      return jsonResponse({}, 404);
    }

    if (options.method === "PUT") {
      assert.deepEqual(JSON.parse(options.body), {
        access_token: "access-token",
      });
      return jsonResponse({ roles: [] });
    }

    throw new Error(`Unexpected Discord request: ${url}`);
  });

  await withAuthServer(
    {
      env: authEnvironment({ DISCORD_RECRUIT_ROLE_ID: "" }),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      upsertMember: async () => {},
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, { mode: "recruit" });
      const response = await finishAuthorization(baseUrl, started);
      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/join?auth=connected",
      );
    },
  );
});

test("a 204 Discord join is confirmed before a session is created", async () => {
  let membershipChecks = 0;
  const discord = recordingFetch(({ url, options }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    if (parsed.pathname.endsWith("/users/@me")) {
      return jsonResponse({ id: USER_ID, username: "rook" });
    }

    if (parsed.pathname.includes("/users/@me/guilds/")) {
      membershipChecks += 1;
      return membershipChecks === 1
        ? jsonResponse({}, 404)
        : jsonResponse({ roles: [] });
    }

    if (options.method === "PUT") {
      return emptyResponse();
    }

    throw new Error(`Unexpected Discord request: ${url}`);
  });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      upsertMember: async () => {},
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, { mode: "recruit" });
      const response = await finishAuthorization(baseUrl, started);
      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/join?auth=connected",
      );
      assert.equal(membershipChecks, 2);
    },
  );
});

test("malformed Discord payloads and upstream details fail closed", async () => {
  const discord = recordingFetch(({ url }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    return jsonResponse(
      { message: "sensitive upstream detail" },
      502,
      { "x-request-id": "discord-request-id" },
    );
  });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, {
        returnTo: "/members",
      });
      const response = await finishAuthorization(baseUrl, started);
      const location = response.headers.get("location");

      assert.equal(location, "https://holdfast.example/members?auth=failed");
      assert.doesNotMatch(location, /sensitive|discord-request-id/);
      assert.equal(
        response.headers.getSetCookie().some((value) =>
          value.startsWith("guild_session="),
        ),
        false,
      );
    },
  );
});

test("OAuth rejects missing tokens and malformed Discord identities", async () => {
  const scenarios = [
    recordingFetch(() => jsonResponse({ token_type: "Bearer" })),
    recordingFetch(({ url }) => {
      const parsed = new URL(url);

      if (parsed.pathname.endsWith("/oauth2/token")) {
        return jsonResponse({ access_token: "access-token" });
      }

      return jsonResponse({ id: "not-a-discord-id", username: "rook" });
    }),
  ];

  for (const discord of scenarios) {
    await withAuthServer(
      {
        env: authEnvironment(),
        fetchImpl: discord.fetchImpl,
        now: () => FIXED_NOW,
        logger: silentLogger,
      },
      async (baseUrl) => {
        const started = await beginAuthorization(baseUrl);
        const response = await finishAuthorization(baseUrl, started);

        assert.equal(
          response.headers.get("location"),
          "https://holdfast.example/?auth=failed",
        );
        assert.equal(
          response.headers.getSetCookie().some((value) =>
            value.startsWith("guild_session="),
          ),
          false,
        );
      },
    );
  }
});

test("recruit flow rejects a malformed member returned by Discord", async () => {
  const discord = recordingFetch(({ url, options }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    if (parsed.pathname.endsWith("/users/@me")) {
      return jsonResponse({ id: USER_ID, username: "rook" });
    }

    if (parsed.pathname.includes("/users/@me/guilds/")) {
      return jsonResponse({}, 404);
    }

    if (options.method === "PUT") {
      return jsonResponse({ roles: "not-an-array" });
    }

    throw new Error(`Unexpected Discord request: ${url}`);
  });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, { mode: "recruit" });
      const response = await finishAuthorization(baseUrl, started);

      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/join?auth=join-failed",
      );
    },
  );
});

test("bot join failures use the specific recruit failure result", async () => {
  const discord = recordingFetch(({ url, options }) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: "access-token" });
    }

    if (parsed.pathname.endsWith("/users/@me")) {
      return jsonResponse({ id: USER_ID, username: "rook" });
    }

    if (parsed.pathname.includes("/users/@me/guilds/")) {
      return jsonResponse({}, 404);
    }

    if (options.method === "PUT") {
      return jsonResponse({ message: "Missing Permissions" }, 403);
    }

    throw new Error(`Unexpected Discord request: ${url}`);
  });

  await withAuthServer(
    {
      env: authEnvironment(),
      fetchImpl: discord.fetchImpl,
      now: () => FIXED_NOW,
      logger: silentLogger,
    },
    async (baseUrl) => {
      const started = await beginAuthorization(baseUrl, {
        mode: "recruit",
        returnTo: "/quests",
      });
      const response = await finishAuthorization(baseUrl, started);

      assert.equal(
        response.headers.get("location"),
        "https://holdfast.example/join?returnTo=%2Fquests&auth=join-failed",
      );
    },
  );
});
