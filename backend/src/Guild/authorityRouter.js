import { Router } from "express";

import {
  requireAuthenticated,
  requirePermission,
} from "../Auth/permissions.js";
import {
  readAuthorityCatalog,
  updateBilletAuthority,
  updateRankAuthority,
} from "./authorityRepository.js";
import { createRateLimiter } from "../Security/httpSecurity.js";

function sendAuthorityError(res, result) {
  if (
    result.status === "invalid_permissions" ||
    result.status === "invalid_rank_ceiling" ||
    result.status === "invalid_quest_scope" ||
    result.status === "invalid_reward_limits" ||
    result.status === "ceiling_requires_member_management"
  ) {
    res.status(400).json({ error: result.status });
    return true;
  }

  if (result.status === "not-found") {
    res.status(404).json({ error: "authority_scope_not_found" });
    return true;
  }

  if (
    result.status === "forbidden" ||
    result.status === "scope_above_actor"
  ) {
    res.status(403).json({ error: result.status });
    return true;
  }

  return false;
}

export function createAuthorityRouter() {
  const router = Router();
  const writeRateLimit = createRateLimiter({
    name: "authority-write",
    windowMs: 10 * 60 * 1000,
    max: 60,
  });

  router.get("/", requireAuthenticated, (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readAuthorityCatalog());
    } catch (error) {
      console.error("Unable to read authority catalog", error);
      res.status(500).json({ error: "authority_catalog_unavailable" });
    }
  });

  router.patch(
    "/ranks/:rank",
    requirePermission("authority.manage"),
    writeRateLimit,
    async (req, res) => {
      try {
        const result = await updateRankAuthority(
          req.params.rank,
          req.body,
          { actorMemberId: req.auth.user.id },
        );

        if (sendAuthorityError(res, result)) return;

        res.set("Cache-Control", "no-store");
        res.json({
          scope: result.scope,
          authority: req.auth.authority,
        });
      } catch (error) {
        console.error("Unable to update rank authority", error);
        res.status(500).json({ error: "rank_authority_update_failed" });
      }
    },
  );

  router.patch(
    "/billets/:billetId",
    requirePermission("authority.manage"),
    writeRateLimit,
    async (req, res) => {
      try {
        const result = await updateBilletAuthority(
          req.params.billetId,
          req.body,
          { actorMemberId: req.auth.user.id },
        );

        if (sendAuthorityError(res, result)) return;

        res.set("Cache-Control", "no-store");
        res.json({
          scope: result.scope,
          authority: req.auth.authority,
        });
      } catch (error) {
        console.error("Unable to update billet authority", error);
        res.status(500).json({ error: "billet_authority_update_failed" });
      }
    },
  );

  return router;
}
