import { Router } from "express";

import { requireAuthenticated, requirePermission } from "../Auth/permissions.js";
import { readFarmingIngestStatus, readFarmingSource, searchFarmingSources } from "./farmingRepository.js";

// Mounted at /api/intelligence/farming.
export function createFarmingRouter() {
  const router = Router();

  router.get("/sources", requireAuthenticated, (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(searchFarmingSources({ q: req.query?.q, discipline: req.query?.discipline }));
    } catch (error) {
      console.error("Unable to search farming sources", error);
      res.status(500).json({ error: "farming_sources_unavailable" });
    }
  });

  // Whether gathering telemetry is reaching Farming. Admins only: it names
  // raw record ids.
  router.get("/status", requirePermission("site.admin"), (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readFarmingIngestStatus());
    } catch (error) {
      console.error("Unable to read farming ingest status", error);
      res.status(500).json({ error: "farming_status_unavailable" });
    }
  });

  router.get("/sources/:sourceKey", requireAuthenticated, (req, res) => {
    try {
      const { item, ...filters } = req.query || {};
      const source = readFarmingSource(req.params.sourceKey, { filters, item });
      if (!source) {
        res.status(404).json({ error: "farming_source_not_found" });
        return;
      }
      res.set("Cache-Control", "no-store");
      res.json(source);
    } catch (error) {
      console.error("Unable to read farming source", error);
      res.status(500).json({ error: "farming_source_unavailable" });
    }
  });

  return router;
}
