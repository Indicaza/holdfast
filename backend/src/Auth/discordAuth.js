import crypto from "node:crypto";
import { Router } from "express";

import { publicWebsiteUrl } from "../Config/environment.js";
import { upsertGuildMember } from "../Guild/memberRepository.js";
import { resolvePermissions } from "./permissionResolver.js";
import {
  clearOAuthState,
  clearSession,
  readOAuthState,
  secureEqual,
  setOAuthState,
  setSession,
  signWithSessionSecret,
} from "./session.js";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = `${DISCORD_API}/oauth2/token`;
const DEFAULT_RETURN_TO = "/";
const MEMBER_MODE = "member";
const RECRUIT_MODE = "recruit";
const DISCORD_ID = /^\d{17,20}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_STATE_FUTURE_SKEW_MS = 60 * 1000;
const MAX_OAUTH_STATE_LENGTH = 4096;
const MAX_RETURN_TO_LENGTH = 2048;
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;

function configuredValue(value) {
  return String(value || "").trim();
}

function config(env = process.env) {
  const frontendUrl = publicWebsiteUrl(env);

  return {
    clientId: configuredValue(env.DISCORD_CLIENT_ID),
    clientSecret: configuredValue(env.DISCORD_CLIENT_SECRET),
    guildId: configuredValue(env.DISCORD_GUILD_ID),
    botToken: configuredValue(env.DISCORD_BOT_TOKEN),
    recruitRoleId: configuredValue(env.DISCORD_RECRUIT_ROLE_ID),
    frontendUrl,
    redirectUri:
      configuredValue(env.DISCORD_REDIRECT_URI) ||
      `${frontendUrl}/api/auth/discord/callback`,
  };
}

export function discordAuthConfigurationProblems(env = process.env) {
  const current = config(env);
  const missing = [];

  if (!current.clientId) missing.push("DISCORD_CLIENT_ID");
  if (!current.clientSecret) missing.push("DISCORD_CLIENT_SECRET");
  if (!current.guildId) missing.push("DISCORD_GUILD_ID");
  if (!current.botToken) missing.push("DISCORD_BOT_TOKEN");
  if (!configuredValue(env.SESSION_SECRET)) missing.push("SESSION_SECRET");

  return missing;
}

function requireConfig(env = process.env) {
  const current = config(env);
  const missing = discordAuthConfigurationProblems(env);

  if (missing.length) {
    throw new Error(`Missing auth configuration: ${missing.join(", ")}`);
  }

  return current;
}

export function safeReturnTo(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_RETURN_TO_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const base = new URL("https://guild.local");
    const url = new URL(value, base);

    if (url.origin !== base.origin || url.username || url.password) {
      return DEFAULT_RETURN_TO;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

function safeMode(value) {
  return value === RECRUIT_MODE ? RECRUIT_MODE : MEMBER_MODE;
}

function stateSignature(payload, env) {
  return signWithSessionSecret(`oauth-state:${payload}`, env);
}

function encodeState(nonce, returnTo, mode, env, now) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      nonce,
      returnTo: safeReturnTo(returnTo),
      mode: safeMode(mode),
      issuedAt: now,
    }),
  ).toString("base64url");

  return `${payload}.${stateSignature(payload, env)}`;
}

function decodeState(value, env, now) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_OAUTH_STATE_LENGTH
  ) {
    return null;
  }

  try {
    const parts = value.split(".");

    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !BASE64URL.test(parts[0]) ||
      !BASE64URL.test(parts[1]) ||
      !secureEqual(stateSignature(parts[0], env), parts[1])
    ) {
      return null;
    }

    const decoded = Buffer.from(parts[0], "base64url");

    if (decoded.toString("base64url") !== parts[0]) {
      return null;
    }

    const state = JSON.parse(decoded.toString("utf8"));

    if (
      state?.version !== 1 ||
      typeof state.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(state.nonce) ||
      state.returnTo !== safeReturnTo(state.returnTo) ||
      ![MEMBER_MODE, RECRUIT_MODE].includes(state.mode) ||
      !Number.isSafeInteger(state.issuedAt) ||
      state.issuedAt > now + OAUTH_STATE_FUTURE_SKEW_MS ||
      now - state.issuedAt > OAUTH_STATE_MAX_AGE_MS
    ) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

function matchingNonce(expected, actual) {
  return secureEqual(expected, actual);
}

function destinationUrl(frontendUrl, returnTo, auth) {
  const url = new URL(safeReturnTo(returnTo), frontendUrl);

  if (auth) {
    url.searchParams.set("auth", auth);
  }

  return url.toString();
}

function onboardingUrl(frontendUrl, auth, returnTo = DEFAULT_RETURN_TO) {
  const url = new URL("/join", frontendUrl);
  const safeDestination = safeReturnTo(returnTo);

  if (safeDestination !== DEFAULT_RETURN_TO) {
    url.searchParams.set("returnTo", safeDestination);
  }

  if (auth) {
    url.searchParams.set("auth", auth);
  }

  return url.toString();
}

async function responseError(response, prefix) {
  // Consume the body so the connection can be reused, but never copy an
  // upstream Discord response body into application errors or client output.
  try {
    await response.text();
  } catch {
    // Best-effort drain only.
  }

  const error = new Error(`${prefix} with ${response.status}`);
  error.status = response.status;
  error.discordRequestId =
    response.headers?.get?.("x-ratelimit-bucket") ||
    response.headers?.get?.("x-request-id") ||
    null;
  return error;
}

function withDiscordDeadline(options = {}) {
  if (options.signal) {
    return options;
  }

  return {
    ...options,
    signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
  };
}

async function discordUserRequest(
  fetchImpl,
  path,
  accessToken,
  { allowNotFound = false } = {},
) {
  const response = await fetchImpl(`${DISCORD_API}${path}`, withDiscordDeadline({
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  }));

  if (allowNotFound && response.status === 404) {
    try {
      await response.text();
    } catch {
      // Best-effort drain so the underlying connection can be reused.
    }
    return null;
  }

  if (!response.ok) {
    throw await responseError(response, "Discord user request failed");
  }

  return response.json();
}

async function discordBotRequest(fetchImpl, path, botToken, options = {}) {
  const response = await fetchImpl(`${DISCORD_API}${path}`, withDiscordDeadline({
    ...options,
    headers: {
      Authorization: `Bot ${botToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  }));

  if (!response.ok) {
    throw await responseError(response, "Discord bot request failed");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function exchangeCode(fetchImpl, code, current) {
  const body = new URLSearchParams({
    client_id: current.clientId,
    client_secret: current.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: current.redirectUri,
  });

  const response = await fetchImpl(DISCORD_TOKEN, withDiscordDeadline({
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }));

  if (!response.ok) {
    throw await responseError(response, "Discord token exchange failed");
  }

  const token = await response.json();

  if (
    !token ||
    typeof token !== "object" ||
    typeof token.access_token !== "string" ||
    !token.access_token
  ) {
    throw new Error("Discord token response was invalid");
  }

  return token;
}

async function currentGuildMember(fetchImpl, guildId, accessToken) {
  const member = await discordUserRequest(
    fetchImpl,
    `/users/@me/guilds/${guildId}/member`,
    accessToken,
    { allowNotFound: true },
  );

  return validatedGuildMember(member);
}

async function addGuildMember(fetchImpl, userId, accessToken, current) {
  const addedMember = await discordBotRequest(
    fetchImpl,
    `/guilds/${current.guildId}/members/${userId}`,
    current.botToken,
    {
      method: "PUT",
      body: JSON.stringify({
        access_token: accessToken,
        ...(current.recruitRoleId
          ? { roles: [current.recruitRoleId] }
          : {}),
      }),
    },
  );

  if (addedMember) {
    return validatedGuildMember(addedMember);
  }

  return currentGuildMember(fetchImpl, current.guildId, accessToken);
}

function avatarUrl(user) {
  if (!user?.id || !user?.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=128`;
}

function validDiscordUser(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    DISCORD_ID.test(value.id) &&
    typeof value.username === "string" &&
    value.username.length > 0 &&
    value.username.length <= 100
  );
}

function memberRoles(member) {
  if (!Array.isArray(member?.roles)) {
    return [];
  }

  return [...new Set(member.roles.filter((role) => DISCORD_ID.test(role)))];
}

function validatedGuildMember(member) {
  if (member === null) {
    return null;
  }

  if (
    !member ||
    typeof member !== "object" ||
    Array.isArray(member) ||
    !Array.isArray(member.roles)
  ) {
    throw new Error("Discord guild member response was invalid");
  }

  return member;
}

export function createDiscordAuthRouter({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  upsertMember = upsertGuildMember,
  permissionResolver = resolvePermissions,
  setSessionImpl = setSession,
  logger = console,
} = {}) {
  const router = Router();

  router.get("/discord/server", (req, res) => {
    const guildId = config(env).guildId;

    res.set("Cache-Control", "no-store");

    if (!DISCORD_ID.test(guildId)) {
      res.status(503).json({ error: "discord_not_configured" });
      return;
    }

    res.json({
      appUrl: `discord://-/channels/${guildId}`,
      webUrl: `https://discord.com/channels/${guildId}`,
    });
  });

  router.get("/discord", (req, res) => {
    const mode = safeMode(req.query.mode);
    let current;

    try {
      current = requireConfig(env);
    } catch (error) {
      logger.error(error.message);
      res.status(503).json({ error: "auth_not_configured" });
      return;
    }

    const nonce = randomBytes(32).toString("base64url");
    const state = encodeState(nonce, req.query.returnTo, mode, env, now());
    const scopes =
      mode === RECRUIT_MODE
        ? "identify guilds.members.read guilds.join"
        : "identify guilds.members.read";
    const params = new URLSearchParams({
      client_id: current.clientId,
      response_type: "code",
      redirect_uri: current.redirectUri,
      scope: scopes,
      state,
    });

    setOAuthState(res, nonce);
    res.redirect(`${DISCORD_AUTHORIZE}?${params.toString()}`);
  });

  router.get("/discord/callback", async (req, res) => {
    const current = config(env);
    const expectedState = readOAuthState(req);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const parsedState = decodeState(state, env, now());
    const returnTo = safeReturnTo(parsedState?.returnTo);
    const mode = safeMode(parsedState?.mode);
    const code = typeof req.query.code === "string" ? req.query.code : "";

    clearOAuthState(res);

    if (
      !expectedState ||
      !parsedState?.nonce ||
      !matchingNonce(expectedState, parsedState.nonce)
    ) {
      res.redirect(
        destinationUrl(current.frontendUrl, DEFAULT_RETURN_TO, "invalid-state"),
      );
      return;
    }

    if (typeof req.query.error === "string" && req.query.error) {
      const destination =
        mode === RECRUIT_MODE
          ? onboardingUrl(current.frontendUrl, "cancelled", returnTo)
          : destinationUrl(current.frontendUrl, returnTo, "cancelled");
      res.redirect(destination);
      return;
    }

    if (!code) {
      res.redirect(destinationUrl(current.frontendUrl, returnTo, "missing-code"));
      return;
    }

    try {
      const ready = requireConfig(env);
      const token = await exchangeCode(fetchImpl, code, ready);
      const user = await discordUserRequest(
        fetchImpl,
        "/users/@me",
        token.access_token,
      );

      if (!validDiscordUser(user)) {
        throw new Error("Discord user response was invalid");
      }

      let member = await currentGuildMember(
        fetchImpl,
        ready.guildId,
        token.access_token,
      );

      if (!member && mode === MEMBER_MODE) {
        res.redirect(onboardingUrl(ready.frontendUrl, "not-member", returnTo));
        return;
      }

      if (!member) {
        try {
          member = await addGuildMember(
            fetchImpl,
            user.id,
            token.access_token,
            ready,
          );
        } catch (error) {
          error.authCode = "join-failed";
          throw error;
        }
      }

      if (!member) {
        const error = new Error("Discord member join completed but member lookup failed");
        error.authCode = "join-failed";
        throw error;
      }

      const permissions = permissionResolver(user.id, memberRoles(member));
      const sessionUser = {
        id: user.id,
        username: user.username,
        globalName:
          typeof user.global_name === "string" ? user.global_name : null,
        avatarUrl: avatarUrl(user),
        guildNickname: typeof member.nick === "string" ? member.nick : null,
        guildJoinedAt:
          typeof member.joined_at === "string" ? member.joined_at : null,
      };

      await upsertMember(sessionUser, permissions);

      setSessionImpl(res, {
        user: sessionUser,
        permissions,
        verifiedAt: now(),
      });

      const destination =
        mode === RECRUIT_MODE
          ? onboardingUrl(ready.frontendUrl, "connected", returnTo)
          : destinationUrl(ready.frontendUrl, returnTo, "connected");

      res.redirect(destination);
    } catch (error) {
      logger.error("Discord authentication failed", error);
      const authCode = error.authCode || "failed";
      const destination =
        mode === RECRUIT_MODE
          ? onboardingUrl(current.frontendUrl, authCode, returnTo)
          : destinationUrl(current.frontendUrl, returnTo, authCode);
      res.redirect(destination);
    }
  });

  router.post("/logout", (req, res) => {
    clearSession(res);
    res.status(204).end();
  });

  return router;
}
