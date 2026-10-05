import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { publicWebsiteUrl } from "../Config/environment.js";
import {
  createRateLimiter,
  requireTrustedMutationOrigin,
} from "../Security/httpSecurity.js";
import { syncGuildweaverCharacter } from "./characterSyncRepository.js";
import {
  approveGuildweaverPairing,
  authenticateGuildweaverDevice,
  exchangeGuildweaverPairing,
  startGuildweaverPairing,
} from "./guildweaverDeviceRepository.js";

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
    console.error("Unable to authenticate Guildweaver device", error);
    res.status(503).json({ error: "guildweaver_device_auth_unavailable" });
  }
}

export function createCharacterRouter() {
  const router = Router();
  const pairingStartRateLimit = createRateLimiter({
    name: "guildweaver-pairing-start",
    windowMs: 10 * 60 * 1000,
    max: 30,
  });
  const pairingExchangeRateLimit = createRateLimiter({
    name: "guildweaver-pairing-exchange",
    windowMs: 10 * 60 * 1000,
    max: 300,
  });
  const pairingApproveRateLimit = createRateLimiter({
    name: "guildweaver-pairing-approve",
    windowMs: 10 * 60 * 1000,
    max: 30,
  });
  const ingestRateLimit = createRateLimiter({
    name: "guildweaver-character-ingest",
    windowMs: 10 * 60 * 1000,
    max: 300,
  });

  router.post("/pairing/start", pairingStartRateLimit, (req, res) => {
    try {
      const pairing = startGuildweaverPairing({
        deviceName: req.body?.deviceName,
      });
      const baseUrl = publicWebsiteUrl().replace(/\/+$/, "");
      const verificationUri = `${baseUrl}/guildweaver/connect?code=${encodeURIComponent(pairing.userCode)}`;

      res.set("Cache-Control", "no-store");
      res.status(201).json({
        status: "pending",
        deviceCode: pairing.deviceCode,
        userCode: pairing.userCode,
        verificationUri,
        expiresAt: pairing.expiresAt,
        expiresIn: pairing.expiresIn,
        interval: pairing.interval,
      });
    } catch (error) {
      console.error("Unable to start Guildweaver pairing", error);
      res.status(500).json({ error: "guildweaver_pairing_start_failed" });
    }
  });

  router.post("/pairing/token", pairingExchangeRateLimit, (req, res) => {
    try {
      const deviceCode = String(req.body?.deviceCode || "").trim();

      if (!deviceCode) {
        res.status(400).json({ error: "device_code_required" });
        return;
      }

      const result = exchangeGuildweaverPairing(deviceCode);
      res.set("Cache-Control", "no-store");

      if (result.status === "pending") {
        res.status(202).json({ status: "pending" });
        return;
      }

      if (result.status === "expired") {
        res.status(410).json({ error: "pairing_expired" });
        return;
      }

      if (result.status === "consumed") {
        res.status(409).json({ error: "pairing_already_consumed" });
        return;
      }

      if (result.status !== "connected") {
        res.status(400).json({ error: "pairing_invalid" });
        return;
      }

      res.json({
        status: "connected",
        deviceId: result.deviceId,
        deviceToken: result.deviceToken,
        memberId: result.memberId,
        deviceName: result.deviceName,
      });
    } catch (error) {
      console.error("Unable to exchange Guildweaver pairing", error);
      res.status(500).json({ error: "guildweaver_pairing_exchange_failed" });
    }
  });

  router.post(
    "/pairing/approve",
    pairingApproveRateLimit,
    requireTrustedMutationOrigin,
    requireAuthenticated,
    (req, res) => {
      try {
        const userCode = String(req.body?.userCode || "").trim();

        if (!userCode) {
          res.status(400).json({ error: "user_code_required" });
          return;
        }

        const result = approveGuildweaverPairing({
          userCode,
          memberId: req.auth.user.id,
        });

        if (result.status === "not-found") {
          res.status(404).json({ error: "pairing_not_found_or_expired" });
          return;
        }

        if (result.status === "member-not-found") {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        if (result.status === "consumed") {
          res.status(409).json({ error: "pairing_already_consumed" });
          return;
        }

        if (result.status === "already-approved") {
          res.status(409).json({ error: "pairing_already_approved" });
          return;
        }

        res.set("Cache-Control", "no-store");
        res.json({
          status: "approved",
          deviceName: result.deviceName,
        });
      } catch (error) {
        console.error("Unable to approve Guildweaver pairing", error);
        res.status(500).json({ error: "guildweaver_pairing_approval_failed" });
      }
    },
  );

  router.post(
    "/characters/snapshot",
    ingestRateLimit,
    requireGuildweaverDevice,
    async (req, res) => {
      try {
        const memberId = req.guildweaverDevice.memberId;
        const snapshot = req.body?.snapshot;
        const revision = Number(req.body?.revision);

        if (!snapshot || typeof snapshot !== "object") {
          res.status(400).json({ error: "invalid_character_snapshot" });
          return;
        }

        if (Number(snapshot.schemaVersion) !== 1) {
          res.status(400).json({ error: "unsupported_snapshot_schema" });
          return;
        }

        const result = await syncGuildweaverCharacter({
          memberId,
          snapshot,
        });

        if (result.status === "invalid") {
          res.status(400).json({ error: "invalid_character_snapshot" });
          return;
        }

        if (result.status === "member-not-found") {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        res.set("Cache-Control", "no-store");
        res.status(result.status === "created" ? 201 : 200).json({
          status: result.status,
          memberId,
          deviceId: req.guildweaverDevice.id,
          character: result.character,
          snapshotId: result.snapshot.id,
          capturedAt: result.snapshot.capturedAt,
          revision: Number.isFinite(revision) ? revision : null,
        });
      } catch (error) {
        console.error("Unable to ingest Guildweaver character snapshot", error);
        res.status(500).json({ error: "character_snapshot_ingest_failed" });
      }
    },
  );

  return router;
}
