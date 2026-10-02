import { Router } from "express";

import { requireAuthenticated, requirePermission } from "../Auth/permissions.js";
import {
  createBillet,
  deleteBillet,
  readBillet,
  readBillets,
  updateBillet,
} from "./billetRepository.js";
import {
  deleteDiscordBilletRole,
  ensureDiscordBilletRoles,
} from "../Discord/billetSync.js";
import { authorityCanGrantBillet } from "./authorityRepository.js";
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

  if (
    status === "duplicate_name" ||
    status === "name_locked" ||
    status === "protected"
  ) {
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
    requirePermission("billets.create"),
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
    requirePermission("billets.edit"),
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


  router.delete(
    "/:billetId",
    requirePermission("billets.delete"),
    writeRateLimit,
    async (req, res) => {
      try {
        const billet = await readBillet(req.params.billetId);

        if (!billet) {
          res.status(404).json({ error: "billet_not_found" });
          return;
        }

        if (billet.discordManaged) {
          res.status(409).json({ error: "protected" });
          return;
        }

        if (!authorityCanGrantBillet(req.auth.authority, billet)) {
          res.status(403).json({ error: "authority_scope_exceeded" });
          return;
        }

        try {
          await deleteDiscordBilletRole(billet);
        } catch (error) {
          console.error(
            `Unable to delete Discord role for billet ${billet.id}`,
            error,
          );
          res.status(503).json({ error: "discord_billet_delete_failed" });
          return;
        }

        const result = await deleteBillet(req.params.billetId, {
          actorMemberId: req.auth.user.id,
        });

        if (billetErrorResponse(res, result.status)) return;

        res.json({
          status: result.status,
          billetId: req.params.billetId,
          assignmentCount: result.assignmentCount,
        });
      } catch (error) {
        console.error("Unable to delete billet", error);
        res.status(500).json({ error: "billet_delete_failed" });
      }
    },
  );



  return router;
}
