import { Router } from "express";

import { requirePermission } from "../Auth/permissions.js";
import {
  readGuildweaverTelemetryHistory,
  readGuildweaverTelemetryRecord,
  readGuildweaverTelemetrySummary,
} from "../Guildweaver/telemetryRepository.js";
import {
  readGuildweaverAdminSummary,
  readGuildweaverSnapshot,
  readGuildweaverSnapshotHistory,
} from "./guildweaverAdminRepository.js";

export function createGuildweaverAdminRouter() {
  const router = Router();

  router.use(requirePermission("site.admin"));

  router.get("/summary", (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json({
        summary: {
          ...readGuildweaverAdminSummary(),
          telemetry: readGuildweaverTelemetrySummary(),
        },
      });
    } catch (error) {
      console.error("Unable to read Guildweaver admin summary", error);
      res.status(500).json({ error: "guildweaver_admin_summary_unavailable" });
    }
  });

  router.get("/telemetry", (req, res) => {
    try {
      const result = readGuildweaverTelemetryHistory({
        q: req.query.q,
        kind: req.query.kind,
        eventType: req.query.eventType,
        characterId: req.query.characterId,
        installationId: req.query.installationId,
        deviceId: req.query.deviceId,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("Unable to read Guildweaver telemetry history", error);
      res.status(500).json({ error: "guildweaver_telemetry_history_unavailable" });
    }
  });

  router.get("/telemetry/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "invalid_telemetry_id" });
        return;
      }

      const record = readGuildweaverTelemetryRecord(id);
      if (!record) {
        res.status(404).json({ error: "telemetry_record_not_found" });
        return;
      }

      res.set("Cache-Control", "no-store");
      res.json({ record });
    } catch (error) {
      console.error("Unable to read Guildweaver telemetry record", error);
      res.status(500).json({ error: "guildweaver_telemetry_record_unavailable" });
    }
  });

  router.get("/snapshots", (req, res) => {
    try {
      const result = readGuildweaverSnapshotHistory({
        q: req.query.q,
        characterId: req.query.characterId,
        memberId: req.query.memberId,
        source: req.query.source,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("Unable to read Guildweaver snapshot history", error);
      res.status(500).json({ error: "guildweaver_snapshot_history_unavailable" });
    }
  });

  router.get("/snapshots/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "invalid_snapshot_id" });
        return;
      }

      const snapshot = readGuildweaverSnapshot(id);
      if (!snapshot) {
        res.status(404).json({ error: "snapshot_not_found" });
        return;
      }

      res.set("Cache-Control", "no-store");
      res.json({ snapshot });
    } catch (error) {
      console.error("Unable to read Guildweaver snapshot", error);
      res.status(500).json({ error: "guildweaver_snapshot_unavailable" });
    }
  });

  return router;
}
