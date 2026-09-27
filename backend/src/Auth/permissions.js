import { refreshDiscordSessionIfNeeded } from "./discordSession.js";

export { resolvePermissions } from "./permissionResolver.js";

export async function requireAuthenticated(req, res, next) {
  await refreshDiscordSessionIfNeeded(req, res, () => {
    if (!req.auth) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    next();
  });
}

export function requirePermission(permission) {
  return async (req, res, next) => {
    await refreshDiscordSessionIfNeeded(req, res, () => {
      if (!req.auth) {
        res.status(401).json({ error: "authentication_required" });
        return;
      }

      if (!req.auth.permissions.includes(permission)) {
        res.status(403).json({ error: "permission_required" });
        return;
      }

      next();
    });
  };
}
