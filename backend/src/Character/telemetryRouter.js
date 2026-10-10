import { Router } from "express";

import { publishCharacterChanged } from "../Live/characterChangeEvents.js";
import { publishLiveUpdate } from "../Live/liveUpdateBus.js";
import { authenticateGuildweaverDevice } from "./guildweaverDeviceRepository.js";
import { ingestTelemetry } from "./Telemetry/ingestTelemetry.js";

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
      const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
      const result = ingestTelemetry({
        deviceId: req.guildweaverDevice.id,
        memberId: req.guildweaverDevice.memberId,
        body: req.body,
        idempotencyKey,
        receivedAt: new Date().toISOString(),
      });

      if (result.status === "invalid") {
        res.status(400).json({ error: result.error || "invalid_telemetry_record" });
        return;
      }

      const kind = req.body?.kind === "event" ? "event" : "state";
      const canonicalCharacterId = result.canonicalCharacterId;

      if (result.status === "created") {
        publishLiveUpdate({
          topics: ["guildweaver"],
          source: "guildweaver.telemetry.persisted",
          entityId: result.record?.id,
          permission: "site.admin",
        });
      }
      if (kind === "state") {
        publishCharacterChanged({ characterId: canonicalCharacterId, sections: result.changedSections });
      }

      res.set("Cache-Control", "no-store");
      res.status(result.status === "created" ? 201 : 200).json({
        status: result.status,
        recordId: result.record?.id || null,
        streamKey: result.record?.streamKey || String(req.body?.streamKey || "").trim(),
        revision: result.record?.revision || Number(req.body?.revision) || null,
        telemetryHandler: result.handlerName,
        characterStatus: canonicalCharacterId ? "associated" : null,
        characterId: canonicalCharacterId || result.rawCharacterId || null,
      });
    } catch (error) {
      console.error("Unable to ingest Guildweaver telemetry", error);
      res.status(500).json({ error: "telemetry_ingest_failed" });
    }
  });

  return router;
}
