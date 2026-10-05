import crypto from "node:crypto";
import { Router } from "express";

import { createRateLimiter } from "../Security/httpSecurity.js";
import { syncGuildweaverCharacter } from "./characterSyncRepository.js";

function bearerToken(req) {
  const authorization = String(req.get("Authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));

  if (!a.length || a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function requireBridgeToken(req, res, next) {
  const expected = String(process.env.GUILDWEAVER_BRIDGE_TOKEN || "").trim();

  if (!expected) {
    res.status(503).json({ error: "guildweaver_bridge_not_configured" });
    return;
  }

  if (!sameSecret(bearerToken(req), expected)) {
    res.status(401).json({ error: "invalid_bridge_token" });
    return;
  }

  next();
}

export function createCharacterRouter() {
  const router = Router();
  const ingestRateLimit = createRateLimiter({
    name: "guildweaver-character-ingest",
    windowMs: 10 * 60 * 1000,
    max: 300,
  });

  router.post(
    "/characters/snapshot",
    ingestRateLimit,
    requireBridgeToken,
    async (req, res) => {
      try {
        const memberId = String(req.body?.memberId || "").trim();
        const snapshot = req.body?.snapshot;
        const revision = Number(req.body?.revision);

        if (!memberId || !snapshot || typeof snapshot !== "object") {
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
