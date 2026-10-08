import { Router } from "express";

import { publishLiveUpdate } from "../Live/liveUpdateBus.js";
import { authenticateGuildweaverDevice } from "./guildweaverDeviceRepository.js";
import { acknowledgeGuildweaverIngest } from "./guildweaverIngestAcknowledgementRepository.js";
import { associateTelemetryRecordCharacter } from "./telemetryCharacterAssociation.js";
import { recordTelemetry } from "./telemetryRecordRepository.js";

const SUPPORTED_TELEMETRY_SCHEMAS = new Set([1]);

function bearerToken(req) {
  const authorization = String(req.get("Authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireGuildweaverDevice(req, res, next) {
  try {
    const device = authenticateGuildweaverDevice(bearerToken(req));
    if (!device) {
      res.status(401).json({ error: "invalid_device_token" });
      return;
    }
    req.guildweaverDevice = device;
    next();
  } catch (error) {
    console.error("Unable to authenticate Guildweaver telemetry device", error);
    res.status(503).json({ error: "guildweaver_device_auth_unavailable" });
  }
}

export function createTelemetryRouter() {
  const router = Router();

  router.post("/telemetry", requireGuildweaverDevice, async (req, res) => {
    try {
      const streamKey = String(req.body?.streamKey || "").trim();
      const kind = req.body?.kind === "event" ? "event" : "state";
      const revision = Number(req.body?.revision);
      const envelope = req.body?.envelope;
      const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();

      if (!streamKey || !Number.isInteger(revision) || revision < 1 || !idempotencyKey) {
        res.status(400).json({ error: "invalid_telemetry_record" });
        return;
      }
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
        res.status(400).json({ error: "invalid_telemetry_envelope" });
        return;
      }
      if (!SUPPORTED_TELEMETRY_SCHEMAS.has(Number(envelope.schemaVersion))) {
        res.status(400).json({ error: "unsupported_telemetry_schema" });
        return;
      }
      const eventType = String(envelope.eventType || "").trim();
      if (!eventType) {
        res.status(400).json({ error: "telemetry_event_type_required" });
        return;
      }
      if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
        res.status(400).json({ error: "invalid_telemetry_payload" });
        return;
      }

      const result = recordTelemetry({
        deviceId: req.guildweaverDevice.id,
        memberId: req.guildweaverDevice.memberId,
        idempotencyKey,
        streamKey,
        kind,
        revision,
        envelope,
        receivedAt: new Date().toISOString(),
      });

      if (result.status === "invalid") {
        res.status(400).json({ error: "invalid_telemetry_record" });
        return;
      }

      const canonicalCharacterId = associateTelemetryRecordCharacter({
        recordId: result.record?.id,
        memberId: req.guildweaverDevice.memberId,
        deviceId: req.guildweaverDevice.id,
        rawCharacterId: result.record?.characterId,
      });

      // The acknowledgement is deliberately written only after the telemetry
      // record is durable. If this process dies between these two operations,
      // reconciliation causes a harmless replay instead of data loss.
      acknowledgeGuildweaverIngest({
        deviceId: req.guildweaverDevice.id,
        memberId: req.guildweaverDevice.memberId,
        kind: "telemetry",
        streamKey,
        revision,
      });

      if (result.status === "created") {
        publishLiveUpdate({
          topics: ["guildweaver"],
          source: "guildweaver.telemetry",
          entityId: canonicalCharacterId || result.record?.characterId || result.record?.id,
          permission: "site.admin",
        });

        if (eventType === "talent_tree_definition") {
          publishLiveUpdate({
            topics: ["intelligence", "armory"],
            source: "guildweaver.telemetry",
            entityId: canonicalCharacterId || result.record?.characterId || null,
          });
        }
      }

      res.set("Cache-Control", "no-store");
      res.status(result.status === "created" ? 201 : 200).json({
        status: result.status,
        recordId: result.record?.id || null,
        streamKey: result.record?.streamKey || streamKey,
        revision: result.record?.revision || revision,
        characterStatus: canonicalCharacterId ? "associated" : null,
        characterId: canonicalCharacterId || result.record?.characterId || null,
      });
    } catch (error) {
      console.error("Unable to ingest Guildweaver telemetry", error);
      res.status(500).json({ error: "telemetry_ingest_failed" });
    }
  });

  return router;
}
