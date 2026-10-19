import { refreshDiscordSessionIfNeeded } from "./discordSession.js";
import { withGuildDatabase } from "../Data/database.js";
import {
  isHoldfastOwner,
  resolveMemberAuthorityFromDatabase,
} from "../Guild/authorityRepository.js";
import { HOLDFAST_GUILD_ID } from "../Guild/Directory/guildDirectoryMigration.js";
import { readMemberGuildAuthorityFromDatabase } from "../Guild/Directory/guildRoles.js";

export { resolvePermissions } from "./permissionResolver.js";

function validAuthentication(auth) {
  return (
    auth &&
    typeof auth === "object" &&
    auth.user &&
    typeof auth.user === "object" &&
    typeof auth.user.id === "string" &&
    Boolean(auth.user.id.trim())
  );
}

// The guild a request acts on: the one its /api/g/:slug path named, or
// Holdfast for the original unscoped routes.
function requestGuildId(req) {
  return req.guild?.id || HOLDFAST_GUILD_ID;
}

// The member's authority (ranks, billets, owners) in one guild, and the
// player's own guild with the permissions its role grants there.
export function resolveMemberAccess(memberId, guildId = HOLDFAST_GUILD_ID) {
  return withGuildDatabase((db) => {
    const authority = resolveMemberAuthorityFromDatabase(db, guildId, memberId);
    const guild = readMemberGuildAuthorityFromDatabase(db, memberId);
    const holdfastOwner = isHoldfastOwner(memberId);
    return {
      authority,
      guild,
      holdfastMember: Boolean(holdfastOwner || guild?.id === HOLDFAST_GUILD_ID),
      guildMember: Boolean(
        guild?.id === guildId || (guildId === HOLDFAST_GUILD_ID && holdfastOwner),
      ),
    };
  });
}

function hydrateAuthority(req) {
  const access = resolveMemberAccess(req.auth.user.id, requestGuildId(req));
  req.auth.authority = access.authority;
  req.auth.permissions = access.authority.permissions;
  req.auth.guild = access.guild;
  req.auth.holdfastMember = access.holdfastMember;
  req.auth.guildMember = access.guildMember;
  return access.authority;
}

export async function requireAuthenticated(req, res, next) {
  await refreshDiscordSessionIfNeeded(req, res, () => {
    if (!validAuthentication(req.auth)) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    try {
      hydrateAuthority(req);
      next();
    } catch (error) {
      console.error("Unable to resolve member authority", error);
      res.status(503).json({ error: "authority_unavailable" });
    }
  });
}

// A guild's own pages (quests, roster, ranks and billets) are for its
// members. Players from other guilds can sign in but get 403 here.
export async function requireGuildMember(req, res, next) {
  await refreshDiscordSessionIfNeeded(req, res, () => {
    if (!validAuthentication(req.auth)) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    try {
      hydrateAuthority(req);

      if (!req.auth.guildMember) {
        res.status(403).json({
          error:
            requestGuildId(req) === HOLDFAST_GUILD_ID
              ? "holdfast_membership_required"
              : "guild_membership_required",
        });
        return;
      }

      next();
    } catch (error) {
      console.error("Unable to resolve member authority", error);
      res.status(503).json({ error: "authority_unavailable" });
    }
  });
}

export const requireHoldfastMember = requireGuildMember;

// Permissions are the member's authority in the request's guild.
export function requirePermission(permission) {
  return async (req, res, next) => {
    await refreshDiscordSessionIfNeeded(req, res, () => {
      if (!validAuthentication(req.auth)) {
        res.status(401).json({ error: "authentication_required" });
        return;
      }

      try {
        const authority = hydrateAuthority(req);

        if (!authority.permissions.includes(permission)) {
          res.status(403).json({ error: "permission_required" });
          return;
        }

        next();
      } catch (error) {
        console.error("Unable to resolve member authority", error);
        res.status(503).json({ error: "authority_unavailable" });
      }
    });
  };
}


export function requireAnyPermission(permissions) {
  const required = Array.isArray(permissions) ? permissions : [];

  return async (req, res, next) => {
    await refreshDiscordSessionIfNeeded(req, res, () => {
      if (!validAuthentication(req.auth)) {
        res.status(401).json({ error: "authentication_required" });
        return;
      }

      try {
        const authority = hydrateAuthority(req);

        if (
          !required.some((permission) =>
            authority.permissions.includes(permission),
          )
        ) {
          res.status(403).json({ error: "permission_required" });
          return;
        }

        next();
      } catch (error) {
        console.error("Unable to resolve member authority", error);
        res.status(503).json({ error: "authority_unavailable" });
      }
    });
  };
}
