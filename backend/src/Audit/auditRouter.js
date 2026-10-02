import { Router } from "express";

import { requirePermission } from "../Auth/permissions.js";
import { readAuditEvents } from "./auditRepository.js";

export function createAuditRouter() {
  const router = Router();

  router.get("/", requirePermission("audit.view"), (req, res) => {
    try {
      const events = readAuditEvents(req.query.limit, {
        includeSnapshots: req.query.details === "true",
      });
      res.set("Cache-Control", "no-store");
      res.json({ events });
    } catch (error) {
      console.error("Unable to read audit history", error);
      res.status(500).json({ error: "audit_history_unavailable" });
    }
  });

  return router;
}
