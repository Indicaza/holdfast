import { Router } from "express";

import { authenticateGuildweaverDevice } from "./guildweaverDeviceRepository.js";
import { syncGuildweaverCharacter } from "./characterSyncRepository.js";
import { recordTelemetry } from "./telemetryRecordRepository.js";

const SUPPORTED_TELEMETRY_SCHEMAS = new Set([1]);
const SUPPORTED_CHARACTER_PAYLOAD_SCHEMAS = new Set([1, 2, 3]);
const CHARACTER_EVENT_TYPES = new Set([
  "character_snapshot",
  "character_session_checkpoint",
]);

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

async function projectCharacterTelemetry(record, device) {
  if (!record || !CHARACTER_EVENT_TYPES.has(record.eventType)) return null;
  const snapshot = record.payload;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  if (!SUPPORTED_CHARACTER_PAYLOAD_SCHEMAS.has(Number(snapshot.schemaVersion))) return null;

  return syncGuildweaverCharacter({
    memberId: device.memberId,
    snapshot,
    deviceId: device.id,
    bridgeRevision: record.revision,
    receivedAt: record.receivedAt,
  });
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
      if (!String(envelope.eventType || "").trim()) {
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

      const projection = await projectCharacterTelemetry(
        result.record,
        req.guildweaverDevice,
      );

      res.set("Cache-Control", "no-store");
      res.status(result.status === "created" ? 201 : 200).json({
        status: result.status,
        recordId: result.record?.id || null,
        streamKey: result.record?.streamKey || streamKey,
        revision: result.record?.revision || revision,
        characterStatus: projection?.status || null,
      });
    } catch (error) {
      console.error("Unable to ingest Guildweaver telemetry", error);
      res.status(500).json({ error: "telemetry_ingest_failed" });
    }
  });

  return router;
}
