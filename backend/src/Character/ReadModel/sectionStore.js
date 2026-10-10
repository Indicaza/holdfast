import { parseTelemetryJson } from "../Telemetry/telemetryJson.js";
import { ensureCharacterReadModelSchema } from "./readModelSchema.js";

// A character's sections: { [section]: { capturedAt, receivedAt, source, sourceRecordId, sourceRevision, payload } }.
export function readCharacterSectionsInDatabase(db, characterId) {
  ensureCharacterReadModelSchema(db);
  const rows = db.prepare(`
    SELECT section, captured_at, received_at, source, source_record_id, source_revision, payload_json
    FROM character_sections WHERE character_id = ?
  `).all(characterId);
  return Object.fromEntries(rows.map((row) => [row.section, {
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    source: row.source,
    sourceRecordId: row.source_record_id === null ? null : Number(row.source_record_id),
    sourceRevision: row.source_revision === null ? null : Number(row.source_revision),
    payload: parseTelemetryJson(row.payload_json, {}),
  }]));
}

// Talent tree definitions by tree id, newest arrival per tree.
export function readTalentDefinitionsInDatabase(db, treeIds) {
  ensureCharacterReadModelSchema(db);
  const wanted = [...new Set((Array.isArray(treeIds) ? treeIds : []).map(Number).filter(Number.isInteger))];
  const result = new Map();
  if (!wanted.length) return result;
  const rows = db.prepare(`
    SELECT tree_id, payload_json FROM talent_tree_definitions
    WHERE tree_id IN (${wanted.map(() => "?").join(", ")})
    ORDER BY received_at DESC
  `).all(...wanted);
  for (const row of rows) {
    const treeId = Number(row.tree_id);
    if (!result.has(treeId)) result.set(treeId, parseTelemetryJson(row.payload_json, {}));
  }
  return result;
}

// Talent tree definitions are game reference data: kept from every
// talent_tree_definition record, whoever stored it.
export function applyTalentDefinitionInDatabase(db, { payload, capturedAt, receivedAt }) {
  const treeId = Number(payload?.treeId);
  if (!Number.isInteger(treeId)) return false;
  ensureCharacterReadModelSchema(db);
  const text = (value, maxLength) => String(value ?? "").trim().slice(0, maxLength);
  const classToken = text(payload?.class?.token ?? payload?.class?.name, 40).toUpperCase();
  const build = text(payload?.gameBuild?.build ?? payload?.gameBuild, 40);
  db.prepare(`
    INSERT INTO talent_tree_definitions (tree_id, class_token, game_build, captured_at, received_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tree_id, class_token, game_build) DO UPDATE SET
      captured_at = excluded.captured_at, received_at = excluded.received_at, payload_json = excluded.payload_json
    WHERE excluded.received_at >= talent_tree_definitions.received_at
  `).run(treeId, classToken, build, capturedAt, receivedAt, JSON.stringify(payload));
  return true;
}

