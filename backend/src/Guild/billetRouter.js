import { Router } from "express";

import { requireAuthenticated, requirePermission } from "../Auth/permissions.js";
import {
  createBillet,
  readBillets,
  updateBillet,
} from "./billetRepository.js";
import { ensureDiscordBilletRoles } from "../Discord/billetSync.js";
import { createRateLimiter } from "../Security/httpSecurity.js";

function billetErrorResponse(res, status) {
  if (
    status === "invalid_name" ||
    status === "invalid_responsibility" ||
    status === "reserved_name"
  ) {
    res.status(400).json({ error: status });
    return true;
  }

  if (status === "duplicate_name" || status === "name_locked") {
    res.status(409).json({ error: status });
    return true;
  }

  if (status === "not-found") {
    res.status(404).json({ error: "billet_not_found" });
    return true;
  }

  return false;
}

export function createBilletRouter() {
  const router = Router();
  const writeRateLimit = createRateLimiter({
    name: "billet-write",
    windowMs: 10 * 60 * 1000,
    max: 60,
  });

  router.get("/", requireAuthenticated, async (req, res) => {
    try {
      const billets = await readBillets();
      res.set("Cache-Control", "no-store");
      res.json({ billets });
    } catch (error) {
      console.error("Unable to read billets", error);
      res.status(500).json({ error: "billets_unavailable" });
    }
  });

  router.post(
    "/",
    requirePermission("authority.manage"),
    writeRateLimit,
    async (req, res) => {
      try {
        const result = await createBillet(req.body, {
          actorMemberId: req.auth.user.id,
        });

        if (billetErrorResponse(res, result.status)) return;

        let discordSync = { status: "pending" };

        try {
          await ensureDiscordBilletRoles({
            billets: [result.billet],
          });
          discordSync = { status: "synced" };
        } catch (error) {
          console.error(
            `Unable to create Discord role for billet ${result.billet.id}`,
            error,
          );
        }

        const billets = await readBillets();
        const billet =
          billets.find((item) => item.id === result.billet.id) ||
          result.billet;

        res.status(201).json({ billet, discordSync });
      } catch (error) {
        console.error("Unable to create billet", error);
        res.status(500).json({ error: "billet_create_failed" });
      }
    },
  );

  router.patch(
    "/:billetId",
    requirePermission("authority.manage"),
    writeRateLimit,
    async (req, res) => {
      try {
        const result = await updateBillet(req.params.billetId, req.body, {
          actorMemberId: req.auth.user.id,
        });

        if (billetErrorResponse(res, result.status)) return;

        let discordSync = { status: "pending" };

        try {
          await ensureDiscordBilletRoles({
            billets: [result.billet],
          });
          discordSync = { status: "synced" };
        } catch (error) {
          console.error(
            `Unable to update Discord role for billet ${result.billet.id}`,
            error,
          );
        }

        const billets = await readBillets();
        const billet =
          billets.find((item) => item.id === result.billet.id) ||
          result.billet;

        res.json({ billet, status: result.status, discordSync });
      } catch (error) {
        console.error("Unable to update billet", error);
        res.status(500).json({ error: "billet_update_failed" });
      }
    },
  );



  return router;
}
