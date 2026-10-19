import { Router } from "express";

import { requireAuthenticated } from "../../Auth/permissions.js";
import { createRateLimiter } from "../../Security/httpSecurity.js";
import {
  CLASSES,
  ROLES,
  guildDirectoryVocabulary,
  normalizeGuildListing,
  normalizeGuildSearch,
} from "./guildDirectoryModel.js";
import {
  applyToGuild,
  leaveCurrentGuild,
  readGuildBySlug,
  readMemberGuild,
  registerGuild,
  requestSisterGuild,
  respondToSisterGuild,
  searchGuildDirectory,
  updateGuildListing,
} from "./guildDirectoryRepository.js";

const STATUS_BY_ERROR = {
  guild_not_found: 404,
  sister_request_not_found: 404,
  guild_manager_required: 403,
  member_not_found: 403,
  already_in_guild: 409,
  guild_slug_taken: 409,
  application_pending: 409,
  guild_not_recruiting: 409,
  sister_guild_self: 400,
  not_in_guild: 409,
  owner_must_transfer: 409,
};

function sendResult(res, result, successStatus = 200) {
  if (result.ok) {
    const { ok, ...body } = result;
    res.status(successStatus).json(body);
    return;
  }
  res.status(STATUS_BY_ERROR[result.error] || 400).json({ error: result.error });
}

function slugParam(req) {
  return String(req.params.slug || "").toLowerCase().slice(0, 40);
}

function application(body = {}) {
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const classToken = text(body.classToken, 16).toLowerCase();
  const role = text(body.role, 8).toLowerCase();
  return {
    characterName: text(body.characterName, 48),
    classToken: CLASSES.includes(classToken) ? classToken : "",
    role: ROLES.includes(role) ? role : "",
    message: text(body.message, 1000),
  };
}

export function createGuildDirectoryRouter() {
  const router = Router();
  const writes = createRateLimiter({ name: "guild-directory-writes", windowMs: 10 * 60 * 1000, max: 30 });

  router.get("/", (req, res) => {
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json(searchGuildDirectory(normalizeGuildSearch(req.query)));
  });

  router.get("/vocabulary", (req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json(guildDirectoryVocabulary());
  });

  router.get("/mine", requireAuthenticated, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ guild: readMemberGuild(req.auth.user.id) });
  });

  router.post("/mine/leave", writes, requireAuthenticated, (req, res) => {
    sendResult(res, leaveCurrentGuild({ memberId: req.auth.user.id }));
  });

  router.get("/:slug", (req, res) => {
    const guild = readGuildBySlug(slugParam(req));
    if (!guild) {
      res.status(404).json({ error: "guild_not_found" });
      return;
    }
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ guild });
  });

  router.post("/", writes, requireAuthenticated, (req, res) => {
    const validation = normalizeGuildListing(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: "invalid_guild_listing", fields: validation.errors });
      return;
    }
    sendResult(res, registerGuild({ memberId: req.auth.user.id, listing: validation.listing }), 201);
  });

  router.put("/:slug", writes, requireAuthenticated, (req, res) => {
    const validation = normalizeGuildListing(req.body, { requireIdentity: false });
    if (!validation.ok) {
      res.status(400).json({ error: "invalid_guild_listing", fields: validation.errors });
      return;
    }
    sendResult(res, updateGuildListing({
      slug: slugParam(req),
      memberId: req.auth.user.id,
      listing: validation.listing,
      siteAdmin: req.auth.permissions.includes("site.admin"),
    }));
  });

  router.post("/:slug/applications", writes, requireAuthenticated, (req, res) => {
    sendResult(res, applyToGuild({ slug: slugParam(req), memberId: req.auth.user.id, application: application(req.body) }), 201);
  });

  router.post("/:slug/sisters", writes, requireAuthenticated, (req, res) => {
    sendResult(res, requestSisterGuild({
      slug: slugParam(req),
      targetSlug: String(req.body?.guild || "").toLowerCase().slice(0, 40),
      memberId: req.auth.user.id,
    }));
  });

  router.post("/:slug/sisters/:fromSlug/:decision", writes, requireAuthenticated, (req, res) => {
    const decision = req.params.decision;
    if (decision !== "accept" && decision !== "decline") {
      res.status(400).json({ error: "invalid_sister_decision" });
      return;
    }
    sendResult(res, respondToSisterGuild({
      slug: slugParam(req),
      fromSlug: String(req.params.fromSlug || "").toLowerCase().slice(0, 40),
      memberId: req.auth.user.id,
      accept: decision === "accept",
    }));
  });

  return router;
}
