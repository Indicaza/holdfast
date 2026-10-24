import { createPublicGameDataRouter } from "./GameData/publicGameDataRouter.js";
import cors from "cors";
import express, { Router } from "express";
import { offsiteBackupHealth } from "./Data/offsiteBackup.js";
import { createGuildDirectoryRouter } from "./Guild/Directory/guildDirectoryRouter.js";

import { createDiscordAuthRouter } from "./Auth/discordAuth.js";
import { createAuditRouter } from "./Audit/auditRouter.js";
import { refreshDiscordSessionIfNeeded } from "./Auth/discordSession.js";
import {
  requireAuthenticated,
  requirePermission,
  resolveMemberAccess,
} from "./Auth/permissions.js";
import { attachSession, setSession } from "./Auth/session.js";
import { createCharacterRouter } from "./Character/characterRouter.js";
import { createGuildweaverAdminRouter } from "./Character/guildweaverAdminRouter.js";
import { createIntelligenceRouter } from "./Character/intelligenceRouter.js";
import { createFarmingRouter } from "./Economy/farmingRouter.js";
import {
  createDevelopmentAuthRouter,
  developmentAuthEnabled,
} from "./Development/developmentAuth.js";
import { createDevelopmentIconMediaResolver } from "./Development/developmentIconMedia.js";
import { createQuestCompletionRouter } from "./Quest/questCompletionRouter.js";
import { createQuestRouter } from "./Quest/questRouter.js";
import { createGuildweaverQuestRouter } from "./Quest/guildweaverQuestRouter.js";
import { readQuestsFromDatabase } from "./Quest/questRepository.js";
import { guildDatabaseFile, withGuildDatabase } from "./Data/database.js";
import { upsertGuildMember } from "./Guild/memberRepository.js";
import { createMemberRouter } from "./Guild/memberRouter.js";
import { createBilletRouter } from "./Guild/billetRouter.js";
import { createAuthorityRouter } from "./Guild/authorityRouter.js";
import {
  guildContextFromSlug,
  holdfastGuildContext,
} from "./Guild/guildContext.js";
import { HOLDFAST_GUILD_ID } from "./Guild/guildScope.js";
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
import { redirectLegacyPaths } from "./Production/legacyRedirects.js";

export function createApp({ discordAuthOptions, developmentAuthOptions, publicGameDataOptions } = {}) {
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
  // Guildweaver uploads carry whole recipe books: one crafting profession is
  // several hundred KB of JSON. Only the device-authenticated ingest routes
  // accept large bodies; everything else keeps the small default.
  app.use(["/api/bridge/telemetry", "/api/bridge/characters/snapshot"], express.json({ limit: "4mb" }));
  app.use(express.json({ limit: "256kb" }));
  app.use(attachSession);
  app.use("/api/bridge", createCharacterRouter());
  app.use("/api/bridge", createGuildweaverQuestRouter());
  app.use("/api", requireTrustedMutationOrigin);

  async function readiness(req, res) {
    res.set("Cache-Control", "no-store");

    try {
      withGuildDatabase((db) => {
        const settings = db.prepare("SELECT focused_quest_id FROM quest_settings WHERE guild_id = ?").get(HOLDFAST_GUILD_ID);
        if (!settings) throw new Error("Quest settings are missing");
        if (settings.focused_quest_id && !db.prepare("SELECT id FROM quests WHERE guild_id = ? AND id = ?").get(HOLDFAST_GUILD_ID, settings.focused_quest_id)) throw new Error("Featured quest is missing");
        if (!Number(db.prepare("SELECT COUNT(*) AS count FROM rank_authority WHERE guild_id = ?").get(HOLDFAST_GUILD_ID).count)) throw new Error("Rank authority is missing");
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
            readQuestsFromDatabase(db, HOLDFAST_GUILD_ID);
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
  const gameDataJsonLimit = createRateLimiter({ name: "public-game-data-json", windowMs: 60000, max: 120 });
  const gameDataIconLimit = createRateLimiter({ name: "public-game-data-icons", windowMs: 60000, max: 1200 });
  app.use("/api/game-data/v1", (req, res, next) => {
    const limiter = /^\/icons(?:\/|$)/.test(req.path) ? gameDataIconLimit : gameDataJsonLimit;
    limiter(req, res, next);
  }, createPublicGameDataRouter({ ...(developmentAuthEnabled(developmentEnv) ? { iconMediaResolver: createDevelopmentIconMediaResolver() } : {}), ...publicGameDataOptions }));
  app.use("/api/notifications", createNotificationRouter());
  app.use("/api/guilds", createGuildDirectoryRouter());

  // Each guild's quests, roster, billets, authority and audit. The same
  // router instances serve /api/g/:slug/... for any guild and the original
  // unscoped paths, which stay Holdfast's for the current frontend. Every
  // repository call inside them is scoped to req.guild.
  const questCompletionRouter = createQuestCompletionRouter();
  const questRouter = createQuestRouter();
  const memberRouter = createMemberRouter();
  const billetRouter = createBilletRouter();
  const authorityRouter = createAuthorityRouter();
  const auditRouter = createAuditRouter();

  app.use("/api/quests", holdfastGuildContext, questCompletionRouter, questRouter);
  app.use("/api/guild/members", holdfastGuildContext, memberRouter);
  app.use("/api/guild/billets", holdfastGuildContext, billetRouter);
  app.use("/api/guild/authority", holdfastGuildContext, authorityRouter);
  app.use("/api/admin/audit", holdfastGuildContext, auditRouter);

  const guildApi = Router({ mergeParams: true });
  guildApi.get("/me", requireAuthenticated, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      guild: req.guild,
      member: Boolean(req.auth.guildMember),
      role: req.auth.guildMember ? req.auth.guild?.role || null : null,
      rank: req.auth.guildMember ? req.auth.authority.memberRank : null,
      authority: req.auth.authority,
      permissions: req.auth.permissions,
    });
  });
  guildApi.use("/quests", questCompletionRouter, questRouter);
  guildApi.use("/members", memberRouter);
  guildApi.use("/billets", billetRouter);
  guildApi.use("/authority", authorityRouter);
  guildApi.use("/audit", auditRouter);
  app.use("/api/g/:slug", guildContextFromSlug, guildApi);

  app.use("/api/intelligence/farming", createFarmingRouter());
  app.use(
    "/api/intelligence",
    createIntelligenceRouter(
      developmentAuthEnabled(developmentEnv)
        ? { iconMediaResolver: createDevelopmentIconMediaResolver() }
        : {},
    ),
  );
  app.use("/api/admin/guildweaver", createGuildweaverAdminRouter());

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

    // Sessions from before open sign-in were all in Holdfast's server.
    const homeServer = req.auth.homeServer !== false;

    try {
      await upsertGuildMember(req.auth.user, req.auth.permissions, { homeServer });
    } catch (error) {
      console.error("Unable to update guild member directory", error);
    }

    const { authority, guild, holdfastMember } = resolveMemberAccess(req.auth.user.id);
    req.auth.permissions = authority.permissions;
    req.auth.authority = authority;

    setSession(res, {
      user: req.auth.user,
      permissions: authority.permissions,
      homeServer,
      verifiedAt: req.auth.verifiedAt,
    });

    res.json({
      authenticated: true,
      user: req.auth.user,
      permissions: authority.permissions,
      authority,
      guild,
      holdfastMember,
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

  // Old single-guild paths, before the SPA fallback answers them as pages.
  app.use(redirectLegacyPaths);
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

    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "payload_too_large" });
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
