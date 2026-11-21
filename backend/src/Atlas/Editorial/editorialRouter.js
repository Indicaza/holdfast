// The Dungeon Content Studio's admin API, mounted at /api/admin/atlas-studio.
// Every route, reads included, requires the site.admin permission, checked
// on the server for each request (Auth/permissions.js requirePermission
// resolves it from the database, never from the session). Mutations also
// pass the app-wide trusted-origin check.

import express, { Router } from "express";

import { requirePermission } from "../../Auth/permissions.js";
import { withGuildDatabase, withGuildTransaction } from "../../Data/database.js";
import { atlasDungeon } from "../atlasRepository.js";
import { loadQuestCatalog } from "../atlasData.js";
import { atlasQuestPlanFromState } from "../atlasQuestPlanRepository.js";
import { editorialQuestPlanOf } from "../editorialQuestPlan.js";
import { exportableEditorialQuestPlan } from "../atlasQuestPlan.js";
import { createMediaInDatabase, deleteMediaInDatabase, listMediaInDatabase, MEDIA_ASPECTS, MEDIA_LIMITS, MEDIA_PURPOSES, mediaFileInDatabase, mediaUsageInDatabase, readMediaBytes, updateMediaInDatabase } from "./atlasMedia.js";
import { addonArtPlan, buildAddonArt } from "./addonArt.js";
import { previewInDatabase } from "./editorialPreview.js";
import { addonEditorialBundle, addonEditorialEntry, ADDON_LIMITS } from "./addonTransform.js";
import { bossKeyOf, resolveEditorial } from "./editorialResolve.js";
import {
  discardDraftInDatabase, publishDraftInDatabase, readActiveDocumentsInDatabase, readActiveInDatabase, readAuditInDatabase, readDraftInDatabase,
  readRevisionDocumentInDatabase, readRevisionsInDatabase, readStudioListInDatabase, rollbackInDatabase, saveDraftInDatabase, unpublishInDatabase,
  recordEditorialAudit, validateDocumentInDatabase, workingDocumentInDatabase,
} from "./editorialRepository.js";
import { BOSS_FIELDS, DUNGEON_FIELDS, EDITORIAL_SCHEMA_VERSION, MECHANIC_PRIORITIES, MECHANIC_TYPES, PROTECTED_KEYS, QUEST_RELEVANCE, QUEST_SECTIONS, QUEST_SHAREABLE, ROLES } from "./editorialSchema.js";

const STATUS = { invalid: 400, "not-found": 404, conflict: 409 };

export const studioSchema = () => ({
  schemaVersion: EDITORIAL_SCHEMA_VERSION, dungeonFields: DUNGEON_FIELDS, bossFields: BOSS_FIELDS, mechanicTypes: MECHANIC_TYPES,
  mechanicPriorities: MECHANIC_PRIORITIES, roles: ROLES, questSections: QUEST_SECTIONS, questRelevance: QUEST_RELEVANCE, questShareable: QUEST_SHAREABLE,
  protectedKeys: PROTECTED_KEYS, addonLimits: ADDON_LIMITS, media: { limits: MEDIA_LIMITS, purposes: MEDIA_PURPOSES, aspects: MEDIA_ASPECTS, types: ["image/png", "image/jpeg", "image/webp"] },
});

// The imported facts the editor shows beside each editable value.
export function importedView(dungeon) {
  const catalog = loadQuestCatalog().byId.get(dungeon.instanceId);
  return {
    instanceId: dungeon.instanceId, name: dungeon.name, kind: dungeon.kind, origin: dungeon.origin === "forever" ? "forever" : "classic",
    levelMin: dungeon.levelMin, levelMax: dungeon.levelMax, zoneName: dungeon.zoneName, zoneMapId: dungeon.zoneMapId, entrance: dungeon.entrance,
    artworkUrl: dungeon.artworkUrl, description: dungeon.description, coverage: dungeon.coverage || null, provenance: dungeon.provenance || [],
    bosses: dungeon.bosses.map((boss) => ({ key: bossKeyOf(boss), name: boss.name, npcId: boss.npcId, encounterId: boss.encounterId, portraitUrl: boss.portraitUrl,
      abilities: boss.abilities || [], strategy: boss.strategy, provenance: boss.provenance || [] })),
    quests: (catalog?.quests || dungeon.quests || []).map((quest) => ({ questId: quest.questId, name: quest.name, relevance: quest.relevance || "dungeon",
      level: quest.level ?? null, giver: quest.giver?.name || null })),
  };
}

const actorOf = (req) => ({ id: req.auth?.user?.id || "", name: req.auth?.user?.username || req.auth?.user?.id || "" });

function instanceIdOf(req) {
  const id = Number(req.params.instanceId);
  return Number.isSafeInteger(id) && id > 0 && atlasDungeon(id) ? id : null;
}

function respond(res, result, ok = (value) => value) {
  const code = STATUS[result.status];
  if (code) {
    res.status(code).json({ error: `editorial_${result.status.replace("-", "_")}`, ...result, status: undefined });
    return;
  }
  res.json(ok(result));
}

export function readStudioDungeon(db, instanceId) {
  const dungeon = atlasDungeon(instanceId);
  const draft = readDraftInDatabase(db, instanceId);
  const active = readActiveInDatabase(db, instanceId);
  const working = workingDocumentInDatabase(db, instanceId);
  const validation = validateDocumentInDatabase(db, instanceId, working);
  return {
    imported: importedView(dungeon), draft, active, working,
    resolution: validation.resolution,
    validation: { errors: validation.errors, warnings: validation.warnings, luaBytes: validation.luaBytes },
    addon: validation.resolution ? addonEditorialEntry(instanceId, validation.resolution, active?.revision.id ?? null) : null,
    revisions: readRevisionsInDatabase(db, instanceId),
    audit: readAuditInDatabase(db, instanceId, 30),
  };
}

// The add-on export bundle: every dungeon's active published revision, in
// the shape scripts/exportDungeonAtlas.lua --editorial reads.
export function readAddonBundle(db, { generatedFrom = null, withFiles = false } = {}) {
  const entries = [];
  const active = readActiveDocumentsInDatabase(db);
  for (const [id, doc] of active) {
    const dungeon = atlasDungeon(id);
    if (!dungeon) continue;
    entries.push(addonEditorialEntry(id, resolveEditorial(dungeon, doc.document), doc.revisionId));
  }
  const built = buildAddonArt(db, addonArtPlan([...active].filter(([id]) => atlasDungeon(id)), atlasDungeon));
  // Published quest edits for the add-on's quest planner (contract schema 1,
  // as the planner checked them). A part the checks dropped is listed in
  // questPlanProblems: the add-on exporter refuses a bundle with any.
  const questPlans = [];
  const questPlanProblems = [];
  for (const [id, doc] of [...active].sort(([a], [b]) => a - b)) {
    if (!atlasDungeon(id)) continue;
    const { document, problems } = exportableEditorialQuestPlan(editorialQuestPlanOf(id, doc.document, doc.revisionId), id);
    if (document) questPlans.push(document);
    for (const problem of problems) questPlanProblems.push({ instanceId: id, ...problem });
  }
  const bundle = { ...addonEditorialBundle(entries, { generatedFrom }), art: built.art, artSkipped: built.skipped.map(({ instanceId, kind, key, mediaId, reason }) => ({ instanceId, kind, key, mediaId, reason })),
    questPlans, questPlanProblems };
  return withFiles ? { bundle, files: built.files } : bundle;
}

export function createAtlasStudioRouter() {
  const router = Router();
  router.use(requirePermission("site.admin"));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const handle = (name, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (error) {
      console.error(`Atlas studio: unable to ${name}`, error);
      res.status(500).json({ error: "editorial_failed" });
    }
  };
  const withDungeon = (name, fn) => handle(name, (req, res) => {
    const instanceId = instanceIdOf(req);
    if (!instanceId) {
      res.status(404).json({ error: "dungeon_not_found" });
      return;
    }
    fn(req, res, instanceId);
  });

  router.get("/schema", (req, res) => res.json(studioSchema()));
  router.get("/dungeons", handle("list dungeons", (req, res) => res.json({ dungeons: withGuildDatabase((db) => readStudioListInDatabase(db)) })));
  router.get("/dungeons/:instanceId", withDungeon("read a dungeon", (req, res, id) => res.json(withGuildDatabase((db) => readStudioDungeon(db, id)))));
  router.get("/dungeons/:instanceId/revisions/:revisionId", withDungeon("read a revision", (req, res, id) => {
    const revision = withGuildDatabase((db) => readRevisionDocumentInDatabase(db, id, Number(req.params.revisionId)));
    if (!revision) res.status(404).json({ error: "revision_not_found" });
    else res.json(revision);
  }));
  router.get("/dungeons/:instanceId/audit", withDungeon("read the audit", (req, res, id) => res.json({ audit: withGuildDatabase((db) => readAuditInDatabase(db, id, 200)) })));

  router.post("/dungeons/:instanceId/validate", withDungeon("validate", (req, res, id) => {
    const result = withGuildDatabase((db) => validateDocumentInDatabase(db, id, req.body?.document));
    res.json({ document: result.document, errors: result.errors, warnings: result.warnings, luaBytes: result.luaBytes, resolution: result.resolution,
      addon: result.resolution ? addonEditorialEntry(id, result.resolution) : null });
  }));
  router.put("/dungeons/:instanceId/draft", withDungeon("save a draft", (req, res, id) => {
    const result = withGuildTransaction((db) => saveDraftInDatabase(db, id, req.body?.document, { expectedVersion: req.body?.expectedVersion, actor: actorOf(req) }));
    respond(res, result);
  }));
  router.delete("/dungeons/:instanceId/draft", withDungeon("discard a draft", (req, res, id) => {
    respond(res, withGuildTransaction((db) => discardDraftInDatabase(db, id, { actor: actorOf(req) })));
  }));
  router.post("/dungeons/:instanceId/publish", withDungeon("publish", (req, res, id) => {
    respond(res, withGuildTransaction((db) => publishDraftInDatabase(db, id, { expectedVersion: req.body?.expectedVersion, note: req.body?.note, actor: actorOf(req) })));
  }));
  router.post("/dungeons/:instanceId/rollback", withDungeon("roll back", (req, res, id) => {
    respond(res, withGuildTransaction((db) => rollbackInDatabase(db, id, req.body?.revisionId, { note: req.body?.note, actor: actorOf(req) })));
  }));
  router.post("/dungeons/:instanceId/unpublish", withDungeon("unpublish", (req, res, id) => {
    respond(res, withGuildTransaction((db) => unpublishInDatabase(db, id, { actor: actorOf(req) })));
  }));
  // Previews of a draft (nothing stored): the website detail and the add-on
  // journal simulation.
  router.post("/dungeons/:instanceId/preview", withDungeon("preview", (req, res, id) => {
    res.json(withGuildDatabase((db) => {
      const validation = validateDocumentInDatabase(db, id, req.body?.document);
      const preview = previewInDatabase(db, id, validation.document);
      return { ...preview, errors: validation.errors, warnings: validation.warnings, luaBytes: validation.luaBytes };
    }));
  }));

  // The quest planner over a draft (nothing stored): the document sent, else
  // the saved draft, else the published revision. Only here, behind
  // site.admin, does unpublished quest data reach a plan. `state` is a quest
  // state (docs/dungeon-quest-readiness.md); without one, a character that
  // reported nothing.
  router.post("/dungeons/:instanceId/plan-preview", withDungeon("preview a plan", (req, res, id) => {
    const editorial = withGuildDatabase((db) => {
      const document = req.body?.document ? validateDocumentInDatabase(db, id, req.body.document).document : workingDocumentInDatabase(db, id);
      return editorialQuestPlanOf(id, document, null);
    });
    const state = req.body?.state ?? { schemaVersion: 1, completed: { coverage: "none" }, questLog: { coverage: "none" } };
    const outcome = atlasQuestPlanFromState(String(id), { state, editorial, party: req.body?.party ?? null });
    if (!outcome) { res.status(404).json({ error: "dungeon_quests_not_found" }); return; }
    if (outcome.status === "invalid") { res.status(400).json({ error: "invalid_quest_state", problems: outcome.problems }); return; }
    res.json({ ...outcome.result, draft: true });
  }));

  // The media library. Uploads are the raw image bytes (Content-Type
  // image/png, image/jpeg or image/webp); the type is checked from the bytes.
  router.get("/media", handle("list media", (req, res) => res.json(withGuildDatabase((db) => {
    const usage = mediaUsageInDatabase(db);
    return { media: listMediaInDatabase(db).map((media) => ({ ...media, usedBy: usage.get(media.id) || [] })) };
  }))));
  router.post("/media", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MEDIA_LIMITS.maxBytes + 1 }), handle("upload media", (req, res) => {
    const query = req.query || {};
    const result = withGuildTransaction((db) => createMediaInDatabase(db, Buffer.isBuffer(req.body) ? req.body : null, {
      name: String(query.name || ""), purpose: String(query.purpose || "general"), attribution: String(query.attribution || ""), license: String(query.license || ""),
      sourceUrl: String(query.sourceUrl || ""), provenance: String(query.provenance || ""), actor: actorOf(req),
    }));
    if (result.status === "ok") withGuildTransaction((db) => recordEditorialAudit(db, { action: "media.upload", actor: actorOf(req), detail: { id: result.media.id } }));
    respond(res, result);
  }));
  router.patch("/media/:id", handle("update media", (req, res) => {
    respond(res, withGuildTransaction((db) => updateMediaInDatabase(db, String(req.params.id), req.body || {})));
  }));
  router.delete("/media/:id", handle("remove media", (req, res) => {
    const result = withGuildTransaction((db) => {
      const removed = deleteMediaInDatabase(db, String(req.params.id));
      if (removed.status === "ok") recordEditorialAudit(db, { action: "media.remove", actor: actorOf(req), detail: { id: String(req.params.id) } });
      return removed;
    });
    respond(res, result);
  }));
  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "editorial_invalid", problems: [{ code: "too-large", message: `Images are at most ${MEDIA_LIMITS.maxBytes / 1024 / 1024} MB.` }] });
      return;
    }
    next(error);
  });
  router.get("/export/addon", handle("export", (req, res) => res.json(withGuildDatabase((db) => readAddonBundle(db, {
    generatedFrom: process.env.RENDER_GIT_COMMIT || process.env.HOLDFAST_RELEASE_SHA || null,
  })))));
  return router;
}

// The library's image files, public by their unguessable id (pages that use
// them are public once published). Immutable: an id's bytes never change.
export function createAtlasMediaRouter() {
  const router = Router();
  router.get("/:id/:variant", (req, res) => {
    const variant = ["original", "thumb", "web"].includes(req.params.variant) ? req.params.variant : null;
    const id = /^m_[a-z0-9]{8,40}$/.test(req.params.id) ? req.params.id : null;
    try {
      const file = variant && id ? withGuildDatabase((db) => mediaFileInDatabase(db, id, variant)) : null;
      if (!file) {
        res.status(404).json({ error: "media_not_found" });
        return;
      }
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.set("X-Content-Type-Options", "nosniff");
      res.type(file.mime).send(readMediaBytes(file.file));
    } catch (error) {
      console.error("Unable to serve atlas media", error);
      res.status(500).json({ error: "media_unavailable" });
    }
  });
  return router;
}
