import { refreshDiscordSessionIfNeeded } from "./discordSession.js";
import { resolveMemberAuthority } from "../Guild/authorityRepository.js";

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

function hydrateAuthority(req) {
  const authority = resolveMemberAuthority(req.auth.user.id);
  req.auth.authority = authority;
  req.auth.permissions = authority.permissions;
  return authority;
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
