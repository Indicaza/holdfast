import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { createDiscordAuthRouter } from "./Auth/discordAuth.js";
import { refreshDiscordSessionIfNeeded } from "./Auth/discordSession.js";
import { requirePermission } from "./Auth/permissions.js";
import { attachSession, setSession } from "./Auth/session.js";
import { createQuestRouter } from "./Quest/questRouter.js";
import {
  ensureRuntimeDataDirectory,
  runtimeDataDirectory,
} from "./Data/runtimeData.js";
import { upsertGuildMember } from "./Guild/memberRepository.js";
import { createMemberRouter } from "./Guild/memberRouter.js";
import {
  corsOrigin,
  createRateLimiter,
  parseTrustProxy,
  requireTrustedMutationOrigin,
  securityHeaders,
} from "./Security/httpSecurity.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

await ensureRuntimeDataDirectory();

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
app.use("/api", requireTrustedMutationOrigin);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use(
  "/api/auth",
  createRateLimiter({
    name: "auth",
    windowMs: 10 * 60 * 1000,
    max: 60,
  }),
  createDiscordAuthRouter(),
);
app.use("/api/quests", createQuestRouter());
app.use("/api/guild/members", createMemberRouter());

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

  setSession(res, {
    user: req.auth.user,
    permissions: req.auth.permissions,
    verifiedAt: req.auth.verifiedAt,
  });

  res.json({
    authenticated: true,
    user: req.auth.user,
    permissions: req.auth.permissions,
  });
});

app.get("/api/admin/ping", requirePermission("site.admin"), (req, res) => {
  res.json({
    status: "ok",
    user: req.auth.user,
  });
});

app.listen(PORT, () => {
  console.log(`Guild backend running on port ${PORT}`);
  console.log(`Guild runtime data: ${runtimeDataDirectory()}`);
});
