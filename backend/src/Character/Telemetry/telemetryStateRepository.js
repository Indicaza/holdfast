import { withGuildDatabase } from "../../Data/database.js";
import { ensureTelemetryRecordSchema } from "../telemetryRecordRepository.js";

const RAW_RECORDS_PER_STREAM = 20;
const RAW_RECORDS_GLOBAL = 5000;
// Recipe books make some states close to a megabyte, so a stream's raw history
// is also capped by size. The newest record is always kept.
const RAW_BYTES_PER_STREAM = 2 * 1024 * 1024;

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function capturedAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 100000000000 ? value * 1000 : value;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function ensureTelemetryStateSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_stream_heads (
      device_id TEXT NOT NULL,
      stream_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(device_id, stream_key)
    );

    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_latest_state (
      state_key TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      raw_character_id TEXT NOT NULL DEFAULT '',
      canonical_character_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      handler_name TEXT NOT NULL,
      stream_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      envelope_schema_version INTEGER NOT NULL,
      payload_schema_version INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      record_id INTEGER,
      envelope_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_latest_character_idx
      ON guildweaver_telemetry_latest_state(raw_character_id, event_type);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_latest_canonical_idx
      ON guildweaver_telemetry_latest_state(canonical_character_id, event_type);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_latest_received_idx
      ON guildweaver_telemetry_latest_state(received_at DESC);
  `);
}

function stateKey({ memberId, deviceId, rawCharacterId, eventType, streamKey }) {
  if (rawCharacterId) {
    return `character:${text(memberId, 160)}:${text(rawCharacterId, 200)}:${text(eventType, 120)}`;
  }
  return `stream:${text(deviceId, 160)}:${text(streamKey, 240)}`;
}

function rowToState(row) {
  if (!row) return null;
  return {
    stateKey: row.state_key,
    memberId: row.member_id,
    deviceId: row.device_id,
    rawCharacterId: row.raw_character_id,
    canonicalCharacterId: row.canonical_character_id,
    eventType: row.event_type,
    handlerName: row.handler_name,
    streamKey: row.stream_key,
    revision: Number(row.revision),
    envelopeSchemaVersion: Number(row.envelope_schema_version),
    payloadSchemaVersion: Number(row.payload_schema_version),
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    recordId: row.record_id === null ? null : Number(row.record_id),
    envelope: parseJson(row.envelope_json),
    payload: parseJson(row.payload_json),
  };
}

export function telemetryStreamAlreadyProcessed({ deviceId, streamKey, revision, idempotencyKey }) {
  return withGuildDatabase((db) => {
    ensureTelemetryStateSchema(db);
    const row = db.prepare(`
      SELECT revision, idempotency_key
      FROM guildweaver_telemetry_stream_heads
      WHERE device_id = ? AND stream_key = ?
      LIMIT 1
    `).get(text(deviceId, 160), text(streamKey, 240));

    if (!row) return false;
    const currentRevision = Number(row.revision) || 0;
    if (currentRevision > Number(revision)) return true;
    return currentRevision === Number(revision) && row.idempotency_key === text(idempotencyKey, 240);
  });
}

export function advanceTelemetryStreamHead({
  deviceId,
  streamKey,
  revision,
  idempotencyKey,
  receivedAt,
}) {
  return withGuildDatabase((db) => {
    ensureTelemetryStateSchema(db);
    db.prepare(`
      INSERT INTO guildweaver_telemetry_stream_heads (
        device_id, stream_key, revision, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, stream_key) DO UPDATE SET
        revision = excluded.revision,
        idempotency_key = excluded.idempotency_key,
        updated_at = excluded.updated_at
      WHERE excluded.revision >= guildweaver_telemetry_stream_heads.revision
    `).run(
      text(deviceId, 160),
      text(streamKey, 240),
      Number(revision),
      text(idempotencyKey, 240),
      receivedAt,
    );
  });
}

export function storeLatestTelemetryState({
  memberId,
  deviceId,
  rawCharacterId,
  canonicalCharacterId,
  eventType,
  handlerName,
  streamKey,
  revision,
  envelopeSchemaVersion,
  payloadSchemaVersion,
  capturedAt: captured,
  receivedAt,
  recordId,
  envelope,
  payload,
}) {
  return withGuildDatabase((db) => {
    ensureTelemetryStateSchema(db);
    const key = stateKey({ memberId, deviceId, rawCharacterId, eventType, streamKey });
    const normalizedCapturedAt = capturedAt(captured);

    db.prepare(`
      INSERT INTO guildweaver_telemetry_latest_state (
        state_key, member_id, device_id, raw_character_id, canonical_character_id,
        event_type, handler_name, stream_key, revision, envelope_schema_version,
        payload_schema_version, captured_at, received_at, record_id, envelope_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        canonical_character_id = excluded.canonical_character_id,
        handler_name = excluded.handler_name,
        stream_key = excluded.stream_key,
        revision = excluded.revision,
        envelope_schema_version = excluded.envelope_schema_version,
        payload_schema_version = excluded.payload_schema_version,
        captured_at = excluded.captured_at,
        received_at = excluded.received_at,
        record_id = excluded.record_id,
        envelope_json = excluded.envelope_json,
        payload_json = excluded.payload_json
      WHERE
        excluded.captured_at > guildweaver_telemetry_latest_state.captured_at OR
        (
          excluded.captured_at = guildweaver_telemetry_latest_state.captured_at AND
          excluded.received_at >= guildweaver_telemetry_latest_state.received_at
        )
    `).run(
      key,
      text(memberId, 160),
      text(deviceId, 160),
      text(rawCharacterId, 200),
      text(canonicalCharacterId, 200),
      text(eventType, 120),
      text(handlerName || "opaque", 120),
      text(streamKey, 240),
      Number(revision),
      Number(envelopeSchemaVersion) || 0,
      Number(payloadSchemaVersion) || 1,
      normalizedCapturedAt,
      receivedAt,
      recordId || null,
      JSON.stringify(envelope ?? {}),
      JSON.stringify(payload ?? {}),
    );

    return rowToState(
      db.prepare("SELECT * FROM guildweaver_telemetry_latest_state WHERE state_key = ? LIMIT 1").get(key),
    );
  });
}

export function readLatestTelemetryState({ memberId = "", characterId = "", eventType = "" } = {}) {
  return withGuildDatabase((db) => {
    ensureTelemetryStateSchema(db);
    const clauses = [];
    const params = [];
    if (memberId) {
      clauses.push("member_id = ?");
      params.push(text(memberId, 160));
    }
    if (characterId) {
      clauses.push("(raw_character_id = ? OR canonical_character_id = ?)");
      params.push(text(characterId, 200), text(characterId, 200));
    }
    if (eventType) {
      clauses.push("event_type = ?");
      params.push(text(eventType, 120));
    }

    const rows = db.prepare(`
      SELECT * FROM guildweaver_telemetry_latest_state
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY received_at DESC, event_type ASC
    `).all(...params);
    return rows.map(rowToState);
  });
}

export function pruneRawTelemetryHistory({ deviceId, streamKey }) {
  return withGuildDatabase((db) => {
    ensureTelemetryRecordSchema(db);
    db.prepare(`
      DELETE FROM guildweaver_telemetry_records
      WHERE device_id = ? AND stream_key = ? AND id NOT IN (
        SELECT id FROM guildweaver_telemetry_records
        WHERE device_id = ? AND stream_key = ?
        ORDER BY received_at DESC, id DESC
        LIMIT ?
      )
    `).run(
      text(deviceId, 160),
      text(streamKey, 240),
      text(deviceId, 160),
      text(streamKey, 240),
      RAW_RECORDS_PER_STREAM,
    );

    db.prepare(`
      DELETE FROM guildweaver_telemetry_records
      WHERE id IN (
        SELECT id FROM (
          SELECT
            id,
            ROW_NUMBER() OVER newest AS position,
            SUM(length(envelope_json)) OVER newest AS retained_bytes
          FROM guildweaver_telemetry_records
          WHERE device_id = ? AND stream_key = ?
          WINDOW newest AS (ORDER BY received_at DESC, id DESC)
        )
        WHERE position > 1 AND retained_bytes > ?
      )
    `).run(text(deviceId, 160), text(streamKey, 240), RAW_BYTES_PER_STREAM);

    db.prepare(`
      DELETE FROM guildweaver_telemetry_records
      WHERE id NOT IN (
        SELECT id FROM guildweaver_telemetry_records
        ORDER BY received_at DESC, id DESC
        LIMIT ?
      )
    `).run(RAW_RECORDS_GLOBAL);
  });
}

export const telemetryRetention = Object.freeze({
  rawRecordsPerStream: RAW_RECORDS_PER_STREAM,
  rawRecordsGlobal: RAW_RECORDS_GLOBAL,
  rawBytesPerStream: RAW_BYTES_PER_STREAM,
});
