import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { readGuildweaverDevices } from "../Character/guildweaverDeviceRepository.js";

export function createGuildweaverMemberStatusRouter({
  readDevices = readGuildweaverDevices,
} = {}) {
  const router = Router();

  router.get("/status", requireAuthenticated, (req, res) => {
    try {
      const devices = readDevices(req.auth.user.id).filter(
        (device) => !device.revokedAt,
      );
      const lastSeenAt = devices.reduce((latest, device) => {
        if (!device.lastSeenAt) return latest;
        if (!latest || device.lastSeenAt > latest) return device.lastSeenAt;
        return latest;
      }, null);

      res.set("Cache-Control", "no-store");
      res.json({
        connected: devices.length > 0,
        deviceCount: devices.length,
        lastSeenAt,
      });
    } catch (error) {
      console.error("Unable to read Guildweaver member status", error);
      res.status(500).json({ error: "guildweaver_status_unavailable" });
    }
  });

  return router;
}
