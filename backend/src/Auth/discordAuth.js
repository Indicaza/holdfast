import crypto from "node:crypto";
import { Router } from "express";

import { upsertGuildMember } from "../Guild/memberRepository.js";
import { resolvePermissions } from "./permissionResolver.js";
import {
  clearOAuthState,
  clearSession,
  readOAuthState,
  setOAuthState,
  setSession,
} from "./session.js";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = `${DISCORD_API}/oauth2/token`;
const DEFAULT_RETURN_TO = "/guildos";
const MEMBER_MODE = "member";
const RECRUIT_MODE = "recruit";

function config() {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    guildId: process.env.DISCORD_GUILD_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
    frontendUrl,
    redirectUri:
      process.env.DISCORD_REDIRECT_URI ||
      `${frontendUrl}/api/auth/discord/callback`,
  };
}

function requireConfig() {
  const current = config();
  const missing = [];

  if (!current.clientId) missing.push("DISCORD_CLIENT_ID");
  if (!current.clientSecret) missing.push("DISCORD_CLIENT_SECRET");
  if (!current.guildId) missing.push("DISCORD_GUILD_ID");
  if (!current.botToken) missing.push("DISCORD_BOT_TOKEN");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");

  if (missing.length) {
    throw new Error(`Missing auth configuration: ${missing.join(", ")}`);
  }

  return current;
}

function safeReturnTo(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const url = new URL(value, "https://guild.local");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

function safeMode(value) {
  return value === RECRUIT_MODE ? RECRUIT_MODE : MEMBER_MODE;
}

function encodeState(nonce, returnTo, mode) {
  return Buffer.from(
    JSON.stringify({
      nonce,
      returnTo: safeReturnTo(returnTo),
      mode: safeMode(mode),
    }),
  ).toString("base64url");
}

function decodeState(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function destinationUrl(frontendUrl, returnTo, auth) {
  const url = new URL(safeReturnTo(returnTo), frontendUrl);

  if (auth) {
    url.searchParams.set("auth", auth);
  }

  return url.toString();
}

function onboardingUrl(frontendUrl, auth) {
  return destinationUrl(frontendUrl, "/join", auth);
}

async function responseError(response, prefix) {
  let details = "";

  try {
    details = await response.text();
  } catch {
    details = "";
  }

  const error = new Error(
    `${prefix} with ${response.status}${details ? `: ${details}` : ""}`,
  );
  error.status = response.status;
  error.details = details;
  return error;
}

async function discordUserRequest(path, accessToken, { allowNotFound = false } = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await responseError(response, "Discord user request failed");
  }

  return response.json();
}

async function discordBotRequest(path, botToken, options = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw await responseError(response, "Discord bot request failed");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function exchangeCode(code, current) {
  const body = new URLSearchParams({
    client_id: current.clientId,
    client_secret: current.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: current.redirectUri,
  });

  const response = await fetch(DISCORD_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw await responseError(response, "Discord token exchange failed");
  }

  return response.json();
}

async function currentGuildMember(guildId, accessToken) {
  return discordUserRequest(
    `/users/@me/guilds/${guildId}/member`,
    accessToken,
    { allowNotFound: true },
  );
}

async function addGuildMember(userId, accessToken, current) {
  const addedMember = await discordBotRequest(
    `/guilds/${current.guildId}/members/${userId}`,
    current.botToken,
    {
      method: "PUT",
      body: JSON.stringify({ access_token: accessToken }),
    },
  );

  if (addedMember) {
    return addedMember;
  }

  return currentGuildMember(current.guildId, accessToken);
}

function avatarUrl(user) {
  if (!user.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

export function createDiscordAuthRouter() {
  const router = Router();

  router.get("/discord", (req, res) => {
    const mode = safeMode(req.query.mode);
    let current;

    try {
      current = requireConfig();
    } catch (error) {
      console.error(error.message);
      res.status(503).json({ error: "auth_not_configured" });
      return;
    }

    const nonce = crypto.randomBytes(32).toString("base64url");
    const state = encodeState(nonce, req.query.returnTo, mode);
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
    const current = config();
    const expectedState = readOAuthState(req);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const parsedState = decodeState(state);
    const returnTo = safeReturnTo(parsedState?.returnTo);
    const mode = safeMode(parsedState?.mode);
    const code = typeof req.query.code === "string" ? req.query.code : "";

    clearOAuthState(res);

    if (req.query.error) {
      const destination =
        mode === RECRUIT_MODE
          ? onboardingUrl(current.frontendUrl, "cancelled")
          : destinationUrl(current.frontendUrl, returnTo, "cancelled");
      res.redirect(destination);
      return;
    }

    if (!expectedState || !parsedState?.nonce || expectedState !== parsedState.nonce) {
      res.redirect(
        destinationUrl(current.frontendUrl, DEFAULT_RETURN_TO, "invalid-state"),
      );
      return;
    }

    if (!code) {
      res.redirect(destinationUrl(current.frontendUrl, returnTo, "missing-code"));
      return;
    }

    try {
      const ready = requireConfig();
      const token = await exchangeCode(code, ready);
      const user = await discordUserRequest("/users/@me", token.access_token);
      let member = await currentGuildMember(ready.guildId, token.access_token);

      if (!member && mode === MEMBER_MODE) {
        res.redirect(onboardingUrl(ready.frontendUrl, "not-member"));
        return;
      }

      if (!member) {
        try {
          member = await addGuildMember(user.id, token.access_token, ready);
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

      const permissions = resolvePermissions(user.id, member.roles || []);
      const sessionUser = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || null,
        avatarUrl: avatarUrl(user),
        guildNickname: member.nick || null,
        guildJoinedAt: member.joined_at || null,
      };

      await upsertGuildMember(sessionUser, permissions);

      setSession(res, {
        user: sessionUser,
        permissions,
        verifiedAt: Date.now(),
      });

      res.redirect(destinationUrl(ready.frontendUrl, returnTo));
    } catch (error) {
      console.error("Discord authentication failed", error);
      const authCode = error.authCode || "failed";
      const destination =
        mode === RECRUIT_MODE
          ? onboardingUrl(current.frontendUrl, authCode)
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
