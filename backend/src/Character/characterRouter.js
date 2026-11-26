import { Router } from "express";
import { readMarketArchiveHold } from "../Market/marketArchiveHold.js";

import { requireAuthenticated } from "../Auth/permissions.js";
import { publicWebsiteUrl } from "../Config/environment.js";
import { publishLiveUpdate } from "../Live/liveUpdateBus.js";
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
import { createTelemetryRouter } from "./telemetryRouter.js";
import { archiveEnabled, archiveStatus, normalizeArchiveQuery } from "./archiveRepository.js";
import { createArchiveQueue } from "./archiveQueue.js";
import { guildDatabaseFile } from "../Data/database.js";
import { setTimeout as sleep } from "node:timers/promises";

const SUPPORTED_CHARACTER_SNAPSHOT_SCHEMAS = new Set([1, 2, 3]);

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

  router.use(createTelemetryRouter());

  const archiveQueue = createArchiveQueue();
  const archiveLimit = createRateLimiter({ name: "guildweaver-archive", windowMs: 60_000, max: 30 });
  const archivePollLimit = createRateLimiter({ name: "guildweaver-archive-poll", windowMs: 60_000, max: 60 });
  const noStore = (req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
  function archiveAccess(req, res, next) {
    try {
      if (!archiveEnabled(req.guildweaverDevice)) return res.status(403).json({ error: "archive_device_not_enabled" });
      next();
    } catch {
      res.status(503).json({ error: "archive_unavailable" });
    }
  }
  function submitArchive(req, res, input) {
    const query = normalizeArchiveQuery(input);
    if (!query) { res.status(400).json({ error: "invalid_archive_query" }); return null; }
    if (query.holdId && readMarketArchiveHold()?.id !== query.holdId) { res.status(409).json({ error: "archive_hold_changed" }); return null; }
    const device = req.guildweaverDevice;
    const job = archiveQueue.submit({ owner: device.id, query, authorized: () => archiveEnabled(device), databaseFile: guildDatabaseFile() });
    if (["full", "busy"].includes(job.status)) {
      res.set("Retry-After", String(job.retryAfterSeconds));
      res.status(503).json({ error: "archive_queue_" + job.status, retryAfterSeconds: job.retryAfterSeconds });
      return null;
    }
    return job;
  }
  function replyJob(res, job) {
    if (!job) return res.status(404).json({ error: "archive_ticket_expired" });
    if (job.status === "failed") return res.status(job.error === "invalid_archive_query" ? 400 : 503).json({ error: job.error });
    if (job.result?.batch?.holdId && readMarketArchiveHold()?.id !== job.result.batch.holdId) return res.status(409).json({ error: "archive_hold_changed" });
    res.set("Retry-After", String(job.retryAfterSeconds));
    return res.status(job.status === "ready" ? 200 : 202).json(job);
  }
  router.get("/archive/status", archiveLimit, requireGuildweaverDevice, noStore, (req, res) => {
    try {
      res.json({ ...archiveStatus(req.guildweaverDevice), queueProtocol: 1 });
    } catch {
      res.status(503).json({ error: "archive_unavailable" });
    }
  });
  router.post("/archive/jobs", archiveLimit, requireGuildweaverDevice, noStore, archiveAccess, (req, res) => {
    const job = submitArchive(req, res, req.body || {});
    if (job) replyJob(res, job);
  });
  router.get("/archive/jobs/:ticket", archivePollLimit, requireGuildweaverDevice, noStore, archiveAccess, (req, res) => {
    replyJob(res, archiveQueue.poll(req.guildweaverDevice.id, req.params.ticket));
  });
  router.delete("/archive/jobs/:ticket", archivePollLimit, requireGuildweaverDevice, noStore, archiveAccess, (req, res) => {
    res.status(archiveQueue.cancel(req.guildweaverDevice.id, req.params.ticket) ? 204 : 409).end();
  });
  // Older bridges use the same queue, with a bounded wait and explicit backpressure.
  router.get("/archive/batch", archiveLimit, requireGuildweaverDevice, noStore, archiveAccess, async (req, res) => {
    const job = submitArchive(req, res, req.query);
    if (!job) return;
    const owner = req.guildweaverDevice.id;
    const deadline = Date.now() + 9000;
    let current = job;
    while (["queued", "running"].includes(current?.status) && Date.now() < deadline && !res.destroyed) {
      await sleep(100);
      current = archiveQueue.poll(owner, job.ticket);
    }
    if (res.destroyed) return;
    if (current?.status === "ready") {
      if (!archiveEnabled(req.guildweaverDevice)) return res.status(403).json({ error: "archive_device_not_enabled" });
      if (current.result?.batch?.holdId && readMarketArchiveHold()?.id !== current.result.batch.holdId) return res.status(409).json({ error: "archive_hold_changed" });
      return res.json(current.result);
    }
    if (current?.status === "failed") return replyJob(res, current);
    res.set("Retry-After", "3");
    return res.status(503).json({ error: "archive_busy", retryAfterSeconds: 3 });
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

      // The device's owner sees it appear on their dashboard; admins see it
      // in the sync console. Nobody else learns the device id.
      publishLiveUpdate({
        topics: ["guildweaver"],
        source: "guildweaver.connected",
        entityId: result.deviceId,
        permission: "site.admin",
      });
      publishLiveUpdate({ topics: ["player"], source: "player.device.connected", memberId: result.memberId });

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

        const snapshotSchemaVersion = Number(snapshot.schemaVersion);
        if (!SUPPORTED_CHARACTER_SNAPSHOT_SCHEMAS.has(snapshotSchemaVersion)) {
          res.status(400).json({ error: "unsupported_snapshot_schema" });
          return;
        }

        const result = await syncGuildweaverCharacter({
          memberId,
          snapshot,
          deviceId: req.guildweaverDevice.id,
          bridgeRevision: Number.isFinite(revision) ? revision : null,
          receivedAt: new Date().toISOString(),
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
          receivedAt: result.snapshot.receivedAt,
          revision: result.snapshot.bridgeRevision,
        });
      } catch (error) {
        console.error("Unable to ingest Guildweaver character snapshot", error);
        res.status(500).json({ error: "character_snapshot_ingest_failed" });
      }
    },
  );

  return router;
}
