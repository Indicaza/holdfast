import {
  markGuildMemberDeparted,
  upsertGuildMember,
} from "../Guild/memberRepository.js";
import { resolvePermissions } from "./permissionResolver.js";
import { clearSession, setSession } from "./session.js";

const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_REVERIFY_SECONDS = 15 * 60;
const MIN_REVERIFY_SECONDS = 60;
const MAX_REVERIFY_SECONDS = 24 * 60 * 60;
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_MAX_ENTRIES = 1000;

function reverifyMilliseconds(env) {
  const configured = Number(env.DISCORD_SESSION_REVERIFY_SECONDS);
  const candidate =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_REVERIFY_SECONDS;
  const seconds = Math.min(
    MAX_REVERIFY_SECONDS,
    Math.max(MIN_REVERIFY_SECONDS, candidate),
  );

  return seconds * 1000;
}

function config(env) {
  return {
    guildId: String(env.DISCORD_GUILD_ID || "").trim(),
    botToken: String(env.DISCORD_BOT_TOKEN || "").trim(),
  };
}

function avatarUrl(user) {
  if (!user?.id || !user?.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=128`;
}

function sessionUserFromMember(member, fallbackUser) {
  const user = member.user;

  return {
    id: user.id,
    username:
      typeof user.username === "string" && user.username
        ? user.username
        : fallbackUser?.username || "member",
    globalName:
      typeof user.global_name === "string"
        ? user.global_name
        : fallbackUser?.globalName || null,
    avatarUrl: avatarUrl(user) || fallbackUser?.avatarUrl || null,
    guildNickname: typeof member.nick === "string" ? member.nick : null,
    guildJoinedAt:
      typeof member.joined_at === "string"
        ? member.joined_at
        : fallbackUser?.guildJoinedAt || null,
  };
}

async function drainResponse(response) {
  try {
    await response.text();
  } catch {
    return;
  }
}

async function discordGuildMember(userId, { env, fetchImpl }) {
  const current = config(env);

  if (!current.guildId || !current.botToken) {
    const error = new Error(
      "DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are required for session revalidation",
    );
    error.code = "discord_revalidation_not_configured";
    throw error;
  }

  const response = await fetchImpl(
    `${DISCORD_API}/guilds/${encodeURIComponent(current.guildId)}/members/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bot ${current.botToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
    },
  );

  if (response.status === 404) {
    await drainResponse(response);
    return null;
  }

  if (!response.ok) {
    await drainResponse(response);
    const error = new Error(
      `Discord membership verification failed with ${response.status}`,
    );
    error.code = "discord_revalidation_failed";
    error.status = response.status;
    error.discordRequestId =
      response.headers?.get?.("x-ratelimit-bucket") ||
      response.headers?.get?.("x-request-id") ||
      null;
    throw error;
  }

  const member = await response.json();

  if (
    !member ||
    typeof member !== "object" ||
    Array.isArray(member) ||
    !member.user ||
    typeof member.user !== "object" ||
    typeof member.user.id !== "string" ||
    member.user.id !== String(userId) ||
    !Array.isArray(member.roles)
  ) {
    const error = new Error("Discord membership response was invalid");
    error.code = "discord_revalidation_invalid_response";
    throw error;
  }

  return member;
}

export function createDiscordSessionRefresher({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  permissionResolver,
  markDeparted = markGuildMemberDeparted,
  upsertMember = upsertGuildMember,
  clearSessionImpl = clearSession,
  setSessionImpl = setSession,
  cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
  logger = console,
} = {}) {
  const verificationCache = new Map();
  const verificationInFlight = new Map();
  const resolveMemberPermissions =
    permissionResolver ||
    ((userId, roleIds) => resolvePermissions(userId, roleIds, env));
  const boundedCacheEntries = Math.max(1, Number(cacheMaxEntries) || 1);

  function cacheResult(userId, result) {
    verificationCache.delete(userId);
    verificationCache.set(userId, result);

    while (verificationCache.size > boundedCacheEntries) {
      const oldestKey = verificationCache.keys().next().value;
      verificationCache.delete(oldestKey);
    }
  }

  async function verifyMembership(userId, fallbackUser) {
    const cached = verificationCache.get(userId);
    const currentTime = now();

    if (
      cached &&
      currentTime - cached.verifiedAt < reverifyMilliseconds(env)
    ) {
      verificationCache.delete(userId);
      verificationCache.set(userId, cached);
      return cached;
    }

    verificationCache.delete(userId);

    if (verificationInFlight.has(userId)) {
      return verificationInFlight.get(userId);
    }

    const verification = (async () => {
      const member = await discordGuildMember(userId, { env, fetchImpl });
      const verifiedAt = now();

      if (!member) {
        const result = {
          member: null,
          permissions: [],
          sessionUser: fallbackUser,
          verifiedAt,
        };

        cacheResult(userId, result);
        return result;
      }

      const sessionUser = sessionUserFromMember(member, fallbackUser);
      const resolvedPermissions = resolveMemberPermissions(
        sessionUser.id,
        member.roles,
      );
      const permissions = Array.isArray(resolvedPermissions)
        ? [
            ...new Set(
              resolvedPermissions.filter(
                (permission) =>
                  typeof permission === "string" && Boolean(permission),
              ),
            ),
          ]
        : [];
      const result = {
        member,
        permissions,
        sessionUser,
        verifiedAt,
      };

      cacheResult(userId, result);
      return result;
    })();

    verificationInFlight.set(userId, verification);

    try {
      return await verification;
    } finally {
      verificationInFlight.delete(userId);
    }
  }

  function verificationIsFresh(auth) {
    const verifiedAt = Number(auth?.verifiedAt);
    const age = now() - verifiedAt;

    return (
      Number.isFinite(verifiedAt) &&
      verifiedAt > 0 &&
      age >= 0 &&
      age < reverifyMilliseconds(env)
    );
  }

  return async function refreshDiscordSessionIfNeeded(req, res, next) {
    const rawUserId = req.auth?.user?.id;

    if (
      typeof rawUserId !== "string" ||
      !rawUserId.trim() ||
      verificationIsFresh(req.auth)
    ) {
      next();
      return;
    }

    const userId = rawUserId.trim();

    try {
      const result = await verifyMembership(userId, req.auth.user);

      if (!result.member) {
        await markDeparted(userId);
        clearSessionImpl(res);
        req.auth = null;
        next();
        return;
      }

      req.auth = {
        user: result.sessionUser,
        permissions: result.permissions,
        verifiedAt: result.verifiedAt,
      };

      await upsertMember(result.sessionUser, result.permissions);

      setSessionImpl(res, req.auth);
      next();
    } catch (error) {
      logger.error("Discord session revalidation failed", error);
      res.set("Cache-Control", "no-store");
      res.set("Retry-After", "5");
      res.status(503).json({
        error: "membership_verification_unavailable",
      });
    }
  };
}

export const refreshDiscordSessionIfNeeded = createDiscordSessionRefresher();
