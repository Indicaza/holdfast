import express from "express";

import { setSession } from "../Auth/session.js";
import { resolveMemberAuthority } from "../Guild/authorityRepository.js";

const DEVELOPMENT_PERSONAS = Object.freeze({
  member: {
    rank: "Private",
    user: {
      id: "dev-member",
      username: "dev-member",
      globalName: "Mira Member",
      guildNickname: "Mira Member",
      avatarUrl: null,
      guildJoinedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  officer: {
    rank: "Lieutenant",
    user: {
      id: "dev-officer",
      username: "dev-officer",
      globalName: "Owen Officer",
      guildNickname: "Owen Officer",
      avatarUrl: null,
      guildJoinedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  commander: {
    rank: "Commander",
    user: {
      id: "dev-commander",
      username: "dev-commander",
      globalName: "Casey Commander",
      guildNickname: "Casey Commander",
      avatarUrl: null,
      guildJoinedAt: "2026-01-01T00:00:00.000Z",
    },
  },
});

function enabledValue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function developmentAuthEnabled(env = process.env) {
  return env.NODE_ENV !== "production" && enabledValue(env.HOLDFAST_DEV_AUTH);
}

export function developmentPersonas() {
  return Object.entries(DEVELOPMENT_PERSONAS).map(([key, persona]) => ({
    key,
    name: persona.user.guildNickname,
    rank: persona.rank,
    loginPath: `/api/dev/login/${key}`,
  }));
}

function safeReturnTo(value) {
  const target = String(value || "/").trim();

  if (!target.startsWith("/") || target.startsWith("//")) {
    return "/";
  }

  try {
    const url = new URL(target, "http://holdfast.local");
    if (url.origin !== "http://holdfast.local") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function createDevelopmentAuthRouter({
  env = process.env,
  resolveAuthority = resolveMemberAuthority,
  writeSession = setSession,
} = {}) {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");

    if (!developmentAuthEnabled(env)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({
      enabled: true,
      personas: developmentPersonas(),
    });
  });

  router.get("/login/:persona", (req, res) => {
    res.set("Cache-Control", "no-store");

    if (!developmentAuthEnabled(env)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const persona = DEVELOPMENT_PERSONAS[req.params.persona];

    if (!persona) {
      res.status(404).json({ error: "unknown_development_persona" });
      return;
    }

    const authority = resolveAuthority(persona.user.id, env);

    if (authority.memberRank !== persona.rank) {
      res.status(409).json({
        error: "development_seed_required",
        hint: "Run npm run dev:seed in backend before using development login.",
      });
      return;
    }

    writeSession(res, {
      user: persona.user,
      permissions: authority.permissions,
      verifiedAt: Date.now(),
    });

    res.redirect(302, safeReturnTo(req.query.returnTo));
  });

  return router;
}
