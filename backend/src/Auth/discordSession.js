import {
  markGuildMemberDeparted,
  upsertGuildMember,
} from "../Guild/memberRepository.js";
import { resolvePermissions } from "./permissions.js";
import { clearSession, setSession } from "./session.js";

const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_REVERIFY_SECONDS = 15 * 60;
const verificationCache = new Map();
const verificationInFlight = new Map();

function reverifyMilliseconds() {
  const configured = Number(process.env.DISCORD_SESSION_REVERIFY_SECONDS);
  const seconds =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_REVERIFY_SECONDS;

  return Math.max(60, seconds) * 1000;
}

function config() {
  return {
    guildId: String(process.env.DISCORD_GUILD_ID || "").trim(),
    botToken: String(process.env.DISCORD_BOT_TOKEN || "").trim(),
  };
}

function avatarUrl(user) {
  if (!user?.id || !user?.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function sessionUserFromMember(member, fallbackUser) {
  const user = member?.user || {};

  return {
    id: String(user.id || fallbackUser?.id || ""),
    username: user.username || fallbackUser?.username || "member",
    globalName: user.global_name || fallbackUser?.globalName || null,
    avatarUrl: avatarUrl(user) || fallbackUser?.avatarUrl || null,
    guildNickname: member?.nick || null,
    guildJoinedAt: member?.joined_at || fallbackUser?.guildJoinedAt || null,
  };
}

async function discordGuildMember(userId) {
  const current = config();

  if (!current.guildId || !current.botToken) {
    const error = new Error(
      "DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are required for session revalidation",
    );
    error.code = "discord_revalidation_not_configured";
    throw error;
  }

  const response = await fetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(current.guildId)}/members/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bot ${current.botToken}`,
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      `Discord membership verification failed with ${response.status}`,
    );
    error.code = "discord_revalidation_failed";
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function verifyMembership(userId, fallbackUser) {
  const cached = verificationCache.get(userId);
  const now = Date.now();

  if (cached && now - cached.verifiedAt < reverifyMilliseconds()) {
    return cached;
  }

  if (verificationInFlight.has(userId)) {
    return verificationInFlight.get(userId);
  }

  const verification = (async () => {
    const member = await discordGuildMember(userId);
    const verifiedAt = Date.now();

    if (!member) {
      const result = {
        member: null,
        permissions: [],
        sessionUser: fallbackUser,
        verifiedAt,
      };

      verificationCache.set(userId, result);
      return result;
    }

    const sessionUser = sessionUserFromMember(member, fallbackUser);
    const permissions = resolvePermissions(
      sessionUser.id,
      Array.isArray(member.roles) ? member.roles : [],
    );
    const result = {
      member,
      permissions,
      sessionUser,
      verifiedAt,
    };

    verificationCache.set(userId, result);
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

  return (
    Number.isFinite(verifiedAt) &&
    verifiedAt > 0 &&
    Date.now() - verifiedAt < reverifyMilliseconds()
  );
}

export async function refreshDiscordSessionIfNeeded(req, res, next) {
  if (!req.auth?.user?.id || verificationIsFresh(req.auth)) {
    next();
    return;
  }

  try {
    const result = await verifyMembership(req.auth.user.id, req.auth.user);

    if (!result.member) {
      await markGuildMemberDeparted(req.auth.user.id);
      clearSession(res);
      req.auth = null;
      next();
      return;
    }

    req.auth = {
      user: result.sessionUser,
      permissions: result.permissions,
      verifiedAt: result.verifiedAt,
    };

    await upsertGuildMember(result.sessionUser, result.permissions);

    setSession(res, req.auth);
    next();
  } catch (error) {
    console.error("Discord session revalidation failed", error);
    res.set("Cache-Control", "no-store");
    res.set("Retry-After", "5");
    res.status(503).json({
      error: "membership_verification_unavailable",
    });
  }
}
