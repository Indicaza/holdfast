// Drafts, published revisions, rollback and audit of the Dungeon Content
// Studio (tables: editorialMigration.js). Every function takes the database
// handle; the router opens the transaction.

import { atlasDungeon, loadAtlas } from "../atlasRepository.js";
import { loadQuestCatalog } from "../atlasData.js";
import { addonEditorialEntry, luaEntryBytes } from "./addonTransform.js";
import { resolveEditorial } from "./editorialResolve.js";
import { emptyEditorialDocument, parseEditorialDocument } from "./editorialSchema.js";
import { validateEditorial } from "./editorialValidate.js";

const now = () => new Date().toISOString();
const parse = (text) => JSON.parse(text);

export function recordEditorialAudit(db, { instanceId = null, action, actor = {}, detail = {} }) {
  db.prepare("INSERT INTO atlas_editorial_audit (instance_id, action, actor_id, actor_name, at, detail_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(instanceId, action, actor.id || "", actor.name || "", now(), JSON.stringify(detail));
}

function revisionRow(row) {
  if (!row) return null;
  return { id: row.id, instanceId: row.instance_id, number: row.number, kind: row.kind, sourceRevisionId: row.source_revision_id ?? null,
    note: row.note, luaBytes: row.lua_bytes, createdAt: row.created_at, createdBy: row.created_by };
}

export function readDraftInDatabase(db, instanceId) {
  const row = db.prepare("SELECT * FROM atlas_editorial_drafts WHERE instance_id = ?").get(instanceId);
  return row ? { document: parse(row.document_json), version: row.version, baseRevisionId: row.base_revision_id ?? null, updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
}

export function readActiveInDatabase(db, instanceId) {
  const row = db.prepare(`SELECT r.*, a.published_at, a.published_by FROM atlas_editorial_active a
    JOIN atlas_editorial_revisions r ON r.id = a.revision_id WHERE a.instance_id = ?`).get(instanceId);
  return row ? { revision: revisionRow(row), document: parse(row.document_json), publishedAt: row.published_at, publishedBy: row.published_by } : null;
}

// Every dungeon's active published document: Map instanceId → { revisionId, document, publishedAt }.
export function readActiveDocumentsInDatabase(db) {
  const rows = db.prepare(`SELECT a.instance_id, a.revision_id, a.published_at, r.document_json, r.number FROM atlas_editorial_active a
    JOIN atlas_editorial_revisions r ON r.id = a.revision_id ORDER BY a.instance_id`).all();
  return new Map(rows.map((row) => [Number(row.instance_id), { revisionId: row.revision_id, number: row.number, publishedAt: row.published_at, document: parse(row.document_json) }]));
}

export function readRevisionsInDatabase(db, instanceId) {
  return db.prepare("SELECT * FROM atlas_editorial_revisions WHERE instance_id = ? ORDER BY number DESC").all(instanceId).map(revisionRow);
}

export function readRevisionDocumentInDatabase(db, instanceId, revisionId) {
  const row = db.prepare("SELECT * FROM atlas_editorial_revisions WHERE instance_id = ? AND id = ?").get(instanceId, revisionId);
  return row ? { revision: revisionRow(row), document: parse(row.document_json) } : null;
}

export function readAuditInDatabase(db, instanceId, limit = 100) {
  return db.prepare("SELECT * FROM atlas_editorial_audit WHERE instance_id IS ? ORDER BY id DESC LIMIT ?").all(instanceId, limit).map((row) => ({
    id: row.id, instanceId: row.instance_id, action: row.action, actorId: row.actor_id, actorName: row.actor_name, at: row.at, detail: parse(row.detail_json),
  }));
}

let knownQuests = null;
// Every quest id the atlas and the quest catalog know (for chain checks).
export function knownQuestIds() {
  if (!knownQuests) {
    knownQuests = new Set();
    for (const dungeon of loadAtlas().atlas.dungeons) for (const quest of dungeon.quests || []) knownQuests.add(quest.questId);
    for (const dungeon of loadQuestCatalog().catalog.dungeons) {
      for (const quest of dungeon.quests || []) {
        knownQuests.add(quest.questId);
        for (const prerequisite of quest.prerequisites || []) knownQuests.add(Math.abs(prerequisite.questId));
      }
    }
  }
  return knownQuests;
}

export function mediaExistsInDatabase(db, id) {
  return Boolean(db.prepare("SELECT 1 FROM atlas_media WHERE id = ?").get(id));
}

// The add-on bytes every other dungeon's published content uses.
function otherPublishedBytes(db, instanceId) {
  let total = 0;
  for (const [id, active] of readActiveDocumentsInDatabase(db)) {
    if (id === instanceId) continue;
    total += luaEntryBytes(addonEditorialEntry(id, resolveEditorial(atlasDungeon(id), active.document), active.revisionId));
  }
  return total;
}

export function validateDocumentInDatabase(db, instanceId, rawDocument, { revision = null } = {}) {
  const { document, problems } = parseEditorialDocument(rawDocument, instanceId);
  const result = validateEditorial({
    document, problems, imported: atlasDungeon(instanceId), catalogEntry: loadQuestCatalog().byId.get(instanceId) || null,
    knownQuestIds: knownQuestIds(), mediaExists: (id) => mediaExistsInDatabase(db, id), otherPublishedBytes: otherPublishedBytes(db, instanceId), revision,
  });
  return { document, ...result };
}

// Saves the draft when `expectedVersion` is the stored one (0 for none yet).
// Shape problems refuse the save; other validation is for publishing.
export function saveDraftInDatabase(db, instanceId, rawDocument, { expectedVersion = 0, actor = {} } = {}) {
  const { document, problems } = parseEditorialDocument(rawDocument, instanceId);
  if (problems.length) return { status: "invalid", problems };
  const current = readDraftInDatabase(db, instanceId);
  if ((current?.version || 0) !== Number(expectedVersion || 0)) return { status: "conflict", draft: current };
  const active = readActiveInDatabase(db, instanceId);
  const version = (current?.version || 0) + 1;
  db.prepare(`INSERT INTO atlas_editorial_drafts (instance_id, document_json, version, base_revision_id, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET document_json = excluded.document_json, version = excluded.version,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(instanceId, JSON.stringify(document), version, current?.baseRevisionId ?? active?.revision.id ?? null, now(), actor.name || actor.id || "");
  recordEditorialAudit(db, { instanceId, action: "draft.save", actor, detail: { version } });
  return { status: "ok", draft: readDraftInDatabase(db, instanceId) };
}

export function discardDraftInDatabase(db, instanceId, { actor = {} } = {}) {
  const result = db.prepare("DELETE FROM atlas_editorial_drafts WHERE instance_id = ?").run(instanceId);
  if (result.changes) recordEditorialAudit(db, { instanceId, action: "draft.discard", actor });
  return { status: result.changes ? "ok" : "not-found" };
}

function activate(db, instanceId, revisionId, actor) {
  db.prepare(`INSERT INTO atlas_editorial_active (instance_id, revision_id, published_at, published_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET revision_id = excluded.revision_id, published_at = excluded.published_at, published_by = excluded.published_by`)
    .run(instanceId, revisionId, now(), actor.name || actor.id || "");
}

function insertRevision(db, instanceId, { kind, document, note, sourceRevisionId = null, luaBytes, actor }) {
  const number = Number(db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS next FROM atlas_editorial_revisions WHERE instance_id = ?").get(instanceId).next);
  const result = db.prepare(`INSERT INTO atlas_editorial_revisions (instance_id, number, kind, document_json, source_revision_id, note, lua_bytes, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(instanceId, number, kind, JSON.stringify(document), sourceRevisionId, String(note || "").slice(0, 500), luaBytes, now(), actor.name || actor.id || "");
  return Number(result.lastInsertRowid);
}

// Publishes the draft (validated again here, never trusted from the client).
// The draft is removed: the published revision is the new base.
export function publishDraftInDatabase(db, instanceId, { expectedVersion, note = "", actor = {} } = {}) {
  const draft = readDraftInDatabase(db, instanceId);
  if (!draft) return { status: "not-found" };
  if (expectedVersion !== undefined && Number(expectedVersion) !== draft.version) return { status: "conflict", draft };
  const validation = validateDocumentInDatabase(db, instanceId, draft.document);
  if (validation.errors.length) return { status: "invalid", errors: validation.errors, warnings: validation.warnings };
  const revisionId = insertRevision(db, instanceId, { kind: "publish", document: validation.document, note, luaBytes: validation.luaBytes, actor });
  activate(db, instanceId, revisionId, actor);
  db.prepare("DELETE FROM atlas_editorial_drafts WHERE instance_id = ?").run(instanceId);
  recordEditorialAudit(db, { instanceId, action: "publish", actor, detail: { revisionId, note, warnings: validation.warnings.length } });
  return { status: "ok", active: readActiveInDatabase(db, instanceId), warnings: validation.warnings };
}

// Publishes an earlier revision again, as a new revision. Validated against
// today's atlas and media library: an image removed since is an error.
export function rollbackInDatabase(db, instanceId, revisionId, { note = "", actor = {} } = {}) {
  const target = readRevisionDocumentInDatabase(db, instanceId, Number(revisionId));
  if (!target) return { status: "not-found" };
  const validation = validateDocumentInDatabase(db, instanceId, target.document);
  if (validation.errors.length) return { status: "invalid", errors: validation.errors, warnings: validation.warnings };
  const id = insertRevision(db, instanceId, { kind: "rollback", document: validation.document, note: note || `Rollback to revision ${target.revision.number}`,
    sourceRevisionId: target.revision.id, luaBytes: validation.luaBytes, actor });
  activate(db, instanceId, id, actor);
  recordEditorialAudit(db, { instanceId, action: "rollback", actor, detail: { revisionId: id, from: target.revision.id } });
  return { status: "ok", active: readActiveInDatabase(db, instanceId) };
}

// Takes the dungeon's editorial content off the site and out of the next
// add-on export. Revisions stay; publishing or a rollback brings it back.
export function unpublishInDatabase(db, instanceId, { actor = {} } = {}) {
  const result = db.prepare("DELETE FROM atlas_editorial_active WHERE instance_id = ?").run(instanceId);
  if (result.changes) recordEditorialAudit(db, { instanceId, action: "unpublish", actor });
  return { status: result.changes ? "ok" : "not-found" };
}

// The editor's starting point: the draft, else the active document, else empty.
export function workingDocumentInDatabase(db, instanceId) {
  return readDraftInDatabase(db, instanceId)?.document || readActiveInDatabase(db, instanceId)?.document || emptyEditorialDocument(instanceId);
}

// One row per atlas dungeon for the studio's list.
export function readStudioListInDatabase(db) {
  const drafts = new Map(db.prepare("SELECT instance_id, version, updated_at, updated_by FROM atlas_editorial_drafts").all().map((row) => [Number(row.instance_id), row]));
  const active = readActiveDocumentsInDatabase(db);
  return loadAtlas().atlas.dungeons.map((dungeon) => ({
    instanceId: dungeon.instanceId, name: dungeon.name, origin: dungeon.origin === "forever" ? "forever" : "classic", kind: dungeon.kind,
    levelMin: dungeon.levelMin, levelMax: dungeon.levelMax, bossCount: dungeon.bosses.length,
    draft: drafts.get(dungeon.instanceId) ? { version: drafts.get(dungeon.instanceId).version, updatedAt: drafts.get(dungeon.instanceId).updated_at, updatedBy: drafts.get(dungeon.instanceId).updated_by } : null,
    published: active.get(dungeon.instanceId) ? { revisionId: active.get(dungeon.instanceId).revisionId, number: active.get(dungeon.instanceId).number, publishedAt: active.get(dungeon.instanceId).publishedAt } : null,
  })).sort((a, b) => a.name.localeCompare(b.name));
}
