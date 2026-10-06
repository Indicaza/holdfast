import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { createLiveUpdateRouter } from "../Live/liveUpdateRouter.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import {
  markAllNotificationsRead,
  markNotificationRead,
  readMemberNotifications,
} from "./notificationRepository.js";

export function createNotificationRouter() {
  const router = Router();
  const writeRateLimit = createRateLimiter({
    name: "notification-write",
    windowMs: 10 * 60 * 1000,
    max: 180,
  });

  router.use("/live", createLiveUpdateRouter());

  router.get("/", requireAuthenticated, (req, res) => {
    try {
      const inbox = readMemberNotifications(req.auth.user.id);
      res.set("Cache-Control", "no-store");
      res.json(inbox);
    } catch (error) {
      console.error("Unable to read member notifications", error);
      res.status(500).json({
        error: "notifications_unavailable",
        message: "Holdfast could not load notifications.",
      });
    }
  });

  router.post(
    "/read-all",
    requireAuthenticated,
    writeRateLimit,
    (req, res) => {
      try {
        const updated = markAllNotificationsRead(req.auth.user.id);
        res.set("Cache-Control", "no-store");
        res.json({ updated });
      } catch (error) {
        console.error("Unable to mark notifications read", error);
        res.status(500).json({ error: "notification_update_failed" });
      }
    },
  );

  router.post(
    "/:notificationId/read",
    requireAuthenticated,
    writeRateLimit,
    (req, res) => {
      try {
        const notification = markNotificationRead(
          req.auth.user.id,
          req.params.notificationId,
        );

        if (!notification) {
          res.status(404).json({ error: "notification_not_found" });
          return;
        }

        res.set("Cache-Control", "no-store");
        res.json({ notification });
      } catch (error) {
        console.error("Unable to mark notification read", error);
        res.status(500).json({ error: "notification_update_failed" });
      }
    },
  );

  return router;
}
