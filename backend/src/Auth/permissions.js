import { refreshDiscordSessionIfNeeded } from "./discordSession.js";
import { withGuildDatabase } from "../Data/database.js";
import { resolveMemberAuthorityFromDatabase } from "../Guild/authorityRepository.js";
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

// Holdfast authority (ranks, billets, env-configured owners) and the
// player's own guild with the permissions its role grants there.
export function resolveMemberAccess(memberId) {
  return withGuildDatabase((db) => {
    const authority = resolveMemberAuthorityFromDatabase(db, memberId);
    const guild = readMemberGuildAuthorityFromDatabase(db, memberId);
    return {
      authority,
      guild,
      holdfastMember: Boolean(authority.isOwner || guild?.id === HOLDFAST_GUILD_ID),
    };
  });
}

function hydrateAuthority(req) {
  const access = resolveMemberAccess(req.auth.user.id);
  req.auth.authority = access.authority;
  req.auth.permissions = access.authority.permissions;
  req.auth.guild = access.guild;
  req.auth.holdfastMember = access.holdfastMember;
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

// Holdfast's own pages (quests, roster, ranks and billets) are for Holdfast
// members. Players from other guilds can sign in but get 403 here.
export async function requireHoldfastMember(req, res, next) {
  await refreshDiscordSessionIfNeeded(req, res, () => {
    if (!validAuthentication(req.auth)) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    try {
      hydrateAuthority(req);

      if (!req.auth.holdfastMember) {
        res.status(403).json({ error: "holdfast_membership_required" });
        return;
      }

      next();
    } catch (error) {
      console.error("Unable to resolve member authority", error);
      res.status(503).json({ error: "authority_unavailable" });
    }
  });
}

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
