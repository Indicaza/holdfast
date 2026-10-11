import { parseTelemetryJson } from "../Character/Telemetry/telemetryJson.js";
import { ECONOMIC_EVENT_TYPES, economicObservationFromTelemetry } from "./economicObservationModel.js";

// A source the client could not name joins the named source that shares its
// object id, so an unnamed Peacebloom gather still counts as Peacebloom.
function resolvedSourceKey(db, observation) {
  if (observation.sourceName || !observation.sourceObjectId) return observation.sourceKey;
  const named = db.prepare(`
    SELECT source_key FROM economic_observations
    WHERE discipline = ? AND source_kind = ? AND source_object_id = ? AND source_name <> ''
    ORDER BY id DESC LIMIT 1
  `).get(observation.discipline, observation.sourceKind, observation.sourceObjectId);
  return named?.source_key || observation.sourceKey;
}

function insertObservation(db, { observation, outputs }) {
  const resolvedKey = resolvedSourceKey(db, observation);
  const result = db.prepare(`
    INSERT OR IGNORE INTO economic_observations (
      observation_key, record_id, event_type, activity, discipline,
      source_key, source_kind, source_name, source_object_id,
      member_id, device_id, character_key, character_level,
      skill_line_id, skill_level, max_skill_level, skill_modifier,
      bountiful_harvest_rank, bountiful_harvest_max_ranks,
      map_id, zone, subzone, x, y, game_build, game_version, captured_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    observation.observationKey,
    observation.recordId,
    observation.eventType,
    observation.activity,
    observation.discipline,
    resolvedKey,
    observation.sourceKind,
    observation.sourceName,
    observation.sourceObjectId,
    observation.memberId,
    observation.deviceId,
    observation.characterKey,
    observation.characterLevel,
    observation.skillLineId,
    observation.skillLevel,
    observation.maxSkillLevel,
    observation.skillModifier,
    observation.bountifulHarvestRank,
    observation.bountifulHarvestMaxRanks,
    observation.mapId,
    observation.zone,
    observation.subzone,
    observation.x,
    observation.y,
    observation.gameBuild,
    observation.gameVersion,
    observation.capturedAt,
    observation.receivedAt,
  );
  if (!result.changes) {
    // Already counted. A resent copy replaces its raw record, so point the
    // observation at the copy that is still kept.
    if (observation.recordId) {
      db.prepare("UPDATE economic_observations SET record_id = ? WHERE observation_key = ?")
        .run(observation.recordId, observation.observationKey);
    }
    return { status: "duplicate" };
  }

  const observationId = Number(result.lastInsertRowid);
  const insertOutput = db.prepare(`
    INSERT INTO economic_observation_outputs (
      observation_id, item_key, item_id, item_name, quantity, quality_id, icon_file_data_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const output of outputs) {
    insertOutput.run(
      observationId,
      output.itemKey,
      output.itemId,
      output.itemName,
      output.quantity,
      output.qualityId,
      output.iconFileDataId,
    );
  }
  return { status: "created", observationId, sourceKey: resolvedKey, discipline: observation.discipline };
}

// The character an observation belongs to: the website's character when the
// telemetry is associated with one, otherwise the addon's id for it.
function characterKey({ canonicalCharacterId, memberId, rawCharacterId }) {
  if (canonicalCharacterId) return canonicalCharacterId;
  return rawCharacterId ? `${memberId}:${rawCharacterId}` : "";
}

export function recordEconomicObservationInDatabase(db, {
  eventType,
  envelope,
  memberId,
  deviceId,
  rawCharacterId = "",
  canonicalCharacterId = "",
  recordId = null,
  streamKey = "",
  receivedAt,
}) {
  const normalized = economicObservationFromTelemetry({
    eventType,
    envelope,
    memberId,
    deviceId,
    characterKey: characterKey({ canonicalCharacterId, memberId, rawCharacterId }),
    recordId,
    streamKey,
    receivedAt,
  });
  if (!normalized) return { status: "skipped" };
  return insertObservation(db, normalized);
}

// Records economic events whose raw telemetry arrived before this table
// existed (or before a collector was recognised). Idempotent: observations
// already recorded are skipped by their key.
export function backfillEconomicObservationsInDatabase(db) {
  const placeholders = ECONOMIC_EVENT_TYPES.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT r.id, r.device_id, r.member_id, r.stream_key, r.event_type, r.character_id, r.received_at, r.envelope_json
    FROM guildweaver_telemetry_records r
    WHERE r.kind = 'event' AND r.event_type IN (${placeholders})
      AND NOT EXISTS (SELECT 1 FROM economic_observations o WHERE o.record_id = r.id)
    ORDER BY r.id
  `).all(...ECONOMIC_EVENT_TYPES);

  const counts = { created: 0, duplicate: 0, skipped: 0 };
  for (const row of rows) {
    const envelope = parseTelemetryJson(row.envelope_json, {});
    const rawCharacterId = String(envelope?.characterId || "").trim();
    const canonical = row.character_id && row.character_id !== rawCharacterId ? row.character_id : "";
    const result = recordEconomicObservationInDatabase(db, {
      eventType: row.event_type,
      envelope,
      memberId: row.member_id,
      deviceId: row.device_id,
      rawCharacterId,
      canonicalCharacterId: canonical,
      recordId: row.id,
      streamKey: row.stream_key,
      receivedAt: row.received_at,
    });
    counts[result.status] += 1;
  }
  return counts;
}
