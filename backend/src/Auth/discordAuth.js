import crypto from "node:crypto";
import { Router } from "express";

import { resolvePermissions } from "./permissions.js";
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

function config() {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    guildId: process.env.DISCORD_GUILD_ID,
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

function encodeState(nonce, returnTo) {
  return Buffer.from(
    JSON.stringify({ nonce, returnTo: safeReturnTo(returnTo) }),
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

async function discordRequest(path, accessToken) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = new Error(`Discord request failed with ${response.status}`);
    error.status = response.status;
    throw error;
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
    throw new Error(`Discord token exchange failed with ${response.status}`);
  }

  return response.json();
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
    let current;

    try {
      current = requireConfig();
    } catch (error) {
      console.error(error.message);
      res.status(503).json({ error: "auth_not_configured" });
      return;
    }

    const nonce = crypto.randomBytes(32).toString("base64url");
    const state = encodeState(nonce, req.query.returnTo);
    const params = new URLSearchParams({
      client_id: current.clientId,
      response_type: "code",
      redirect_uri: current.redirectUri,
      scope: "identify guilds.members.read",
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
    const code = typeof req.query.code === "string" ? req.query.code : "";

    clearOAuthState(res);

    if (req.query.error) {
      res.redirect(destinationUrl(current.frontendUrl, returnTo, "cancelled"));
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
      const user = await discordRequest("/users/@me", token.access_token);

      let member;

      try {
        member = await discordRequest(
          `/users/@me/guilds/${ready.guildId}/member`,
          token.access_token,
        );
      } catch (error) {
        if (error.status === 404) {
          res.redirect(destinationUrl(ready.frontendUrl, returnTo, "not-member"));
          return;
        }

        throw error;
      }

      const permissions = resolvePermissions(user.id, member.roles || []);

      setSession(res, {
        user: {
          id: user.id,
          username: user.username,
          globalName: user.global_name || null,
          avatarUrl: avatarUrl(user),
          guildNickname: member.nick || null,
        },
        permissions,
      });

      res.redirect(destinationUrl(ready.frontendUrl, returnTo));
    } catch (error) {
      console.error("Discord authentication failed", error);
      res.redirect(destinationUrl(current.frontendUrl, returnTo, "failed"));
    }
  });

  router.post("/logout", (req, res) => {
    clearSession(res);
    res.status(204).end();
  });

  return router;
}
