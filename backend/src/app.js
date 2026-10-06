import cors from "cors";
import express from "express";
import { offsiteBackupHealth } from "./Data/offsiteBackup.js";

import { createDiscordAuthRouter } from "./Auth/discordAuth.js";
import { createAuditRouter } from "./Audit/auditRouter.js";
import { refreshDiscordSessionIfNeeded } from "./Auth/discordSession.js";
import { requirePermission } from "./Auth/permissions.js";
import { attachSession, setSession } from "./Auth/session.js";
import { createCharacterRouter } from "./Character/characterRouter.js";
import { createGuildweaverAdminRouter } from "./Character/guildweaverAdminRouter.js";
import {
  createDevelopmentAuthRouter,
  developmentAuthEnabled,
} from "./Development/developmentAuth.js";
import { createQuestCompletionRouter } from "./Quest/questCompletionRouter.js";
import { createQuestRouter } from "./Quest/questRouter.js";
import { createGuildweaverQuestRouter } from "./Quest/guildweaverQuestRouter.js";
import { readQuestsFromDatabase } from "./Quest/questRepository.js";
import { guildDatabaseFile, withGuildDatabase } from "./Data/database.js";
import { upsertGuildMember } from "./Guild/memberRepository.js";
import { createMemberRouter } from "./Guild/memberRouter.js";
import { createBilletRouter } from "./Guild/billetRouter.js";
import { resolveMemberAuthority } from "./Guild/authorityRepository.js";
import { createAuthorityRouter } from "./Guild/authorityRouter.js";
import { createGuildweaverMemberStatusRouter } from "./Guildweaver/memberStatusRouter.js";
import {
  guildweaverDownloadUrl,
  guildweaverReleaseMetadata,
} from "./Guildweaver/releaseConfig.js";
import { createNotificationRouter } from "./Notification/notificationRouter.js";
import {
  corsOrigin,
  createRateLimiter,
  parseTrustProxy,
  requireTrustedMutationOrigin,
  securityHeaders,
} from "./Security/httpSecurity.js";
import { mountProductionFrontend } from "./Production/frontend.js";

export function createApp({ discordAuthOptions, developmentAuthOptions } = {}) {
  const app = express();
  const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);
  if (TRUST_PROXY !== false) {
    app.set("trust proxy", TRUST_PROXY);
  }

  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(attachSession);
  app.use("/api/bridge", createCharacterRouter());
  app.use("/api/bridge", createGuildweaverQuestRouter());
  app.use("/api", requireTrustedMutationOrigin);

  async function readiness(req, res) {
    res.set("Cache-Control", "no-store");

    try {
      withGuildDatabase((db) => {
        const settings = db.prepare("SELECT focused_quest_id FROM quest_settings WHERE id = 1").get();
        if (!settings) throw new Error("Quest settings are missing");
        if (settings.focused_quest_id && !db.prepare("SELECT id FROM quests WHERE id = ?").get(settings.focused_quest_id)) throw new Error("Featured quest is missing");
        if (!Number(db.prepare("SELECT COUNT(*) AS count FROM rank_authority").get().count)) throw new Error("Rank authority is missing");
        db.prepare("SELECT COUNT(*) FROM members").get();
        db.prepare("SELECT COUNT(*) FROM contribution_transactions").get();
        db.prepare("SELECT COUNT(*) FROM notifications").get();
      });
      res.json({ status: "ok", offsiteBackup: await offsiteBackupHealth() });
    } catch (error) {
      console.error("Readiness check failed", error);
      res.status(503).json({ status: "unavailable" });
    }
  }

  app.get("/api/health", readiness);
  app.get("/api/health/live", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ status: "ok", release: process.env.RENDER_GIT_COMMIT || process.env.HOLDFAST_RELEASE_SHA || null });
  });
  app.get("/api/health/ready", readiness);

  app.get(
    "/api/health/data",
    requirePermission("site.admin"),
    (req, res) => {
      res.set("Cache-Control", "no-store");

      try {
        const data = withGuildDatabase((db) => {
          const count = (table) =>
            Number(
              db
                .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
                .get()?.count || 0,
            );

          let questDocument = { readable: true, error: null };

          try {
            readQuestsFromDatabase(db);
          } catch (error) {
            questDocument = {
              readable: false,
              error: error?.message || "Unknown quest data error.",
            };
          }

          return {
            databaseFile: guildDatabaseFile(),
            members: count("members"),
            quests: count("quests"),
            objectives: count("objectives"),
            assignments: count("assignments"),
            contributions: count("contribution_transactions"),
            notifications: count("notifications"),
            auditEvents: count("audit_events"),
            migrations: db
              .prepare(
                "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
              )
              .all(),
            questDocument,
          };
        });

        res.json({ status: "ok", data });
      } catch (error) {
        console.error("Data health check failed", error);
        res.status(503).json({
          status: "unavailable",
          error: error?.message || "data_health_failed",
        });
      }
    },
  );

  const developmentEnv = developmentAuthOptions?.env || process.env;
  if (developmentAuthEnabled(developmentEnv)) {
    app.use(
      "/api/dev",
      createDevelopmentAuthRouter({
        ...developmentAuthOptions,
        env: developmentEnv,
      }),
    );
  }

  app.use(
    "/api/auth",
    createRateLimiter({
      name: "auth",
      windowMs: 10 * 60 * 1000,
      max: 60,
    }),
    createDiscordAuthRouter(discordAuthOptions),
  );
  app.use("/api/notifications", createNotificationRouter());
  app.use("/api/quests", createQuestCompletionRouter());
  app.use("/api/quests", createQuestRouter());
  app.use("/api/guild/members", createMemberRouter());
  app.use("/api/guild/billets", createBilletRouter());
  app.use("/api/guild/authority", createAuthorityRouter());
  app.use("/api/admin/audit", createAuditRouter());
  app.use("/api/admin/guildweaver", createGuildweaverAdminRouter());
  app.use("/api/guildweaver", createGuildweaverMemberStatusRouter());

  app.get("/api/guildweaver/release", (req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json(guildweaverReleaseMetadata(process.env));
  });

  app.get("/api/me", refreshDiscordSessionIfNeeded, async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (!req.auth) {
      res.json({ authenticated: false });
      return;
    }

    try {
      await upsertGuildMember(req.auth.user, req.auth.permissions);
    } catch (error) {
      console.error("Unable to update guild member directory", error);
    }

    const authority = resolveMemberAuthority(req.auth.user.id);
    req.auth.permissions = authority.permissions;
    req.auth.authority = authority;

    setSession(res, {
      user: req.auth.user,
      permissions: authority.permissions,
      verifiedAt: req.auth.verifiedAt,
    });

    res.json({
      authenticated: true,
      user: req.auth.user,
      permissions: authority.permissions,
      authority,
    });
  });

  app.get("/api/admin/ping", requirePermission("site.admin"), (req, res) => {
    res.json({
      status: "ok",
      user: req.auth.user,
    });
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.get("/guildweaver/download/:platform/sha256", (req, res) => {
    const target = guildweaverDownloadUrl(req.params.platform, {
      env: process.env,
      checksum: true,
    });

    if (!target) {
      res.status(404).json({ error: "unsupported_platform" });
      return;
    }

    res.redirect(302, target);
  });

  app.get("/guildweaver/download/:platform", (req, res) => {
    const target = guildweaverDownloadUrl(req.params.platform, {
      env: process.env,
    });

    if (!target) {
      res.status(404).json({ error: "unsupported_platform" });
      return;
    }

    res.redirect(302, target);
  });

  mountProductionFrontend(app);

  app.use((error, req, res, next) => {
    if (error?.code === "cors_origin_rejected") {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }

    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    console.error("Unhandled request error", error);

    if (res.headersSent) {
      next(error);
      return;
    }

    res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}
