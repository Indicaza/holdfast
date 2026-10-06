import { Router } from "express";

import { authenticateGuildweaverDevice } from "../Character/guildweaverDeviceRepository.js";
import { publishLiveUpdate } from "../Live/liveUpdateBus.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import {
  applyGuildweaverQuestActions,
  readGuildweaverQuestSnapshot,
} from "./guildweaverQuestBridge.js";

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
    console.error("Unable to authenticate Guildweaver quest device", error);
    res.status(503).json({ error: "guildweaver_device_auth_unavailable" });
  }
}

export function createGuildweaverQuestRouter() {
  const router = Router();
  const readRateLimit = createRateLimiter({
    name: "guildweaver-quest-read",
    windowMs: 10 * 60 * 1000,
    max: 600,
  });
  const actionRateLimit = createRateLimiter({
    name: "guildweaver-quest-actions",
    windowMs: 10 * 60 * 1000,
    max: 300,
  });

  router.get(
    "/quests/snapshot",
    readRateLimit,
    requireGuildweaverDevice,
    async (req, res) => {
      try {
        const snapshot = await readGuildweaverQuestSnapshot(
          req.guildweaverDevice.memberId,
        );
        res.set("Cache-Control", "no-store");
        res.json(snapshot);
      } catch (error) {
        console.error("Unable to build Guildweaver quest snapshot", error);
        res.status(500).json({ error: "guildweaver_quests_unavailable" });
      }
    },
  );

  router.post(
    "/quests/actions",
    actionRateLimit,
    requireGuildweaverDevice,
    async (req, res) => {
      try {
        const result = await applyGuildweaverQuestActions({
          memberId: req.guildweaverDevice.memberId,
          actions: req.body?.actions,
        });

        if (result.status === "invalid") {
          res.status(400).json({ error: "invalid_quest_actions" });
          return;
        }

        if (result.status === "member-not-found") {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        publishLiveUpdate({ topics: ["quests", "notifications"], source: "guildweaver.quests" });
        publishLiveUpdate({ topics: ["guildweaver"], source: "guildweaver.quests", permission: "site.admin" });
        publishLiveUpdate({ topics: ["audit"], source: "guildweaver.quests", permission: "audit.view" });

        res.set("Cache-Control", "no-store");
        res.json(result);
      } catch (error) {
        console.error("Unable to apply Guildweaver quest actions", error);
        res.status(500).json({ error: "guildweaver_quest_actions_failed" });
      }
    },
  );

  return router;
}
