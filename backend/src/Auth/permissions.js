import { refreshDiscordSessionIfNeeded } from "./discordSession.js";

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

export async function requireAuthenticated(req, res, next) {
  await refreshDiscordSessionIfNeeded(req, res, () => {
    if (!validAuthentication(req.auth)) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    next();
  });
}

export function requirePermission(permission) {
  return async (req, res, next) => {
    await refreshDiscordSessionIfNeeded(req, res, () => {
      if (!validAuthentication(req.auth)) {
        res.status(401).json({ error: "authentication_required" });
        return;
      }

      if (
        !Array.isArray(req.auth.permissions) ||
        !req.auth.permissions.includes(permission)
      ) {
        res.status(403).json({ error: "permission_required" });
        return;
      }

      next();
    });
  };
}
