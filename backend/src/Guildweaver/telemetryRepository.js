import { createHash } from "node:crypto";

import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);
const FORBIDDEN_KEYS = new Set([
  "battletag",
  "accountid",
  "whisper",
  "whispers",
  "chatlog",
  "chatlogs",
  "privatemessage",
  "privatemessages",
  "goldbalance",
  "playergold",
]);

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function optionalString(value, maxLength = 512) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return fallback;
  }
}

function capturedAtIso(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const numeric = Number(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(numeric)) {
    return capturedAtIso(numeric);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedPrivacyKey(value) {
  return String(value || "")
    .replace(/[_\-\s]/g, "")
    .toLowerCase();
}

function findPrivacyViolation(value, depth = 0) {
  if (depth > 24 || !value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const violation = findPrivacyViolation(item, depth + 1);
      if (violation) return violation;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizedPrivacyKey(key))) return key;
    const violation = findPrivacyViolation(child, depth + 1);
    if (violation) return violation;
  }

  return null;
}

function telemetryKind(streamKey) {
  return streamKey.startsWith("event:") ? "event" : "state";
}

function recordHash(streamKey, revision, envelope) {
  return createHash("sha256")
    .update(JSON.stringify({ streamKey, revision, envelope }))
    .digest("hex");
}

function fallbackIdempotencyKey(deviceId, streamKey, revision, eventType) {
  return `server-${createHash("sha256")
    .update(`${deviceId}:${streamKey}:${revision}:${eventType}`)
    .digest("hex")}`;
}

export function ensureGuildweaverTelemetrySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE,
      record_hash TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('state', 'event')),
      stream_key TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      schema_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      captured_at TEXT,
      received_at TEXT NOT NULL,
      realm TEXT,
      region TEXT,
      installation_id TEXT,
      character_id TEXT,
      guild_id TEXT,
      device_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      game_build_json TEXT NOT NULL DEFAULT '{}',
      envelope_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS guildweaver_telemetry_device_stream_revision_idx
      ON guildweaver_telemetry_records(device_id, stream_key, revision);

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_received_idx
      ON guildweaver_telemetry_records(received_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_event_type_idx
      ON guildweaver_telemetry_records(event_type, received_at DESC);

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_character_idx
      ON guildweaver_telemetry_records(character_id, received_at DESC);

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_installation_idx
      ON guildweaver_telemetry_records(installation_id, received_at DESC);
  `);
}

function detailFromRow(row) {
  if (!row) return null;
  const payload = parseJson(row.payload_json);
  const envelope = parseJson(row.envelope_json);

  return {
    id: Number(row.id),
    kind: row.kind,
    streamKey: row.stream_key,
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    eventType: row.event_type,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    realm: row.realm || "",
    region: row.region || "",
    installationId: row.installation_id || "",
    characterId: row.character_id || "",
    guildId: row.guild_id || "",
    deviceId: row.device_id || "",
    memberId: row.member_id || "",
    gameBuild: parseJson(row.game_build_json, null),
    payloadBytes: Buffer.byteLength(row.payload_json || "", "utf8"),
    envelope,
    payload,
  };
}

function summaryFromRow(row) {
  const detail = detailFromRow(row);
  if (!detail) return null;
  delete detail.envelope;
  delete detail.payload;
  return detail;
}

export function ingestGuildweaverTelemetry({
  deviceId,
  memberId,
  idempotencyKey,
  record,
  receivedAt = new Date().toISOString(),
}) {
  const streamKey = optionalString(record?.streamKey);
  const revision = Number(record?.revision);
  const envelope = record?.envelope;

  if (!streamKey || !Number.isInteger(revision) || revision < 1) {
    return { status: "invalid", error: "invalid_telemetry_record" };
  }

  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { status: "invalid", error: "invalid_telemetry_envelope" };
  }

  const schemaVersion = Number(envelope.schemaVersion);
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return { status: "invalid", error: "unsupported_telemetry_schema" };
  }

  const eventType = optionalString(envelope.eventType, 128);
  if (!eventType || !envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    return { status: "invalid", error: "invalid_telemetry_payload" };
  }

  const privacyViolation = findPrivacyViolation(envelope);
  if (privacyViolation) {
    return {
      status: "invalid",
      error: "telemetry_privacy_rejected",
      field: privacyViolation,
    };
  }

  const normalizedReceivedAt = capturedAtIso(receivedAt) || new Date().toISOString();
  const normalizedCapturedAt = capturedAtIso(envelope.capturedAt);
  const normalizedDeviceId = optionalString(deviceId, 256);
  const normalizedMemberId = optionalString(memberId, 256);

  if (!normalizedDeviceId || !normalizedMemberId) {
    return { status: "invalid", error: "telemetry_identity_required" };
  }

  const hash = recordHash(streamKey, revision, envelope);
  const normalizedIdempotencyKey =
    optionalString(idempotencyKey, 256) ||
    fallbackIdempotencyKey(normalizedDeviceId, streamKey, revision, eventType);
  const envelopeJson = JSON.stringify(envelope);
  const payloadJson = JSON.stringify(envelope.payload);
  const gameBuildJson = JSON.stringify(
    envelope.gameBuild && typeof envelope.gameBuild === "object"
      ? envelope.gameBuild
      : {},
  );

  return withGuildTransaction((db) => {
    ensureGuildweaverTelemetrySchema(db);

    const existing = db
      .prepare(`
        SELECT *
        FROM guildweaver_telemetry_records
        WHERE idempotency_key = ?
           OR (device_id = ? AND stream_key = ? AND revision = ?)
        ORDER BY id ASC
        LIMIT 1
      `)
      .get(
        normalizedIdempotencyKey,
        normalizedDeviceId,
        streamKey,
        revision,
      );

    if (existing) {
      if (existing.record_hash !== hash) {
        return { status: "conflict", record: detailFromRow(existing) };
      }
      return { status: "duplicate", record: detailFromRow(existing) };
    }

    const result = db
      .prepare(`
        INSERT INTO guildweaver_telemetry_records (
          idempotency_key,
          record_hash,
          kind,
          stream_key,
          revision,
          schema_version,
          event_type,
          captured_at,
          received_at,
          realm,
          region,
          installation_id,
          character_id,
          guild_id,
          device_id,
          member_id,
          game_build_json,
          envelope_json,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        normalizedIdempotencyKey,
        hash,
        telemetryKind(streamKey),
        streamKey,
        revision,
        schemaVersion,
        eventType,
        normalizedCapturedAt,
        normalizedReceivedAt,
        optionalString(envelope.realm, 256),
        optionalString(envelope.region, 64),
        optionalString(envelope.installationId, 256),
        optionalString(envelope.characterId, 256),
        optionalString(envelope.guildId, 256),
        normalizedDeviceId,
        normalizedMemberId,
        gameBuildJson,
        envelopeJson,
        payloadJson,
      );

    const inserted = db
      .prepare("SELECT * FROM guildweaver_telemetry_records WHERE id = ?")
      .get(Number(result.lastInsertRowid));

    return { status: "created", record: detailFromRow(inserted) };
  });
}

function telemetryFilters({
  q = "",
  kind = "",
  eventType = "",
  characterId = "",
  installationId = "",
  deviceId = "",
} = {}) {
  const clauses = [];
  const params = [];
  const normalizedQuery = String(q || "").trim().toLowerCase();

  if (["state", "event"].includes(kind)) {
    clauses.push("kind = ?");
    params.push(kind);
  }

  if (eventType) {
    clauses.push("event_type = ?");
    params.push(String(eventType));
  }

  if (characterId) {
    clauses.push("character_id = ?");
    params.push(String(characterId));
  }

  if (installationId) {
    clauses.push("installation_id = ?");
    params.push(String(installationId));
  }

  if (deviceId) {
    clauses.push("device_id = ?");
    params.push(String(deviceId));
  }

  if (normalizedQuery) {
    const like = `%${normalizedQuery}%`;
    clauses.push(`(
      LOWER(event_type) LIKE ? OR
      LOWER(stream_key) LIKE ? OR
      LOWER(COALESCE(realm, '')) LIKE ? OR
      LOWER(COALESCE(character_id, '')) LIKE ? OR
      LOWER(COALESCE(installation_id, '')) LIKE ? OR
      LOWER(COALESCE(device_id, '')) LIKE ? OR
      LOWER(payload_json) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function readGuildweaverTelemetryHistory(options = {}) {
  return withGuildDatabase((db) => {
    ensureGuildweaverTelemetrySchema(db);
    const limit = integer(options.limit, 30, 1, 100);
    const offset = integer(options.offset, 0, 0, 1_000_000);
    const where = telemetryFilters(options);
    const rows = db
      .prepare(`
        SELECT *
        FROM guildweaver_telemetry_records
        ${where.sql}
        ORDER BY received_at DESC, id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...where.params, limit + 1, offset);
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      records: visibleRows.map(summaryFromRow),
      pagination: { limit, offset, hasMore },
    };
  });
}

export function readGuildweaverTelemetryRecord(id) {
  return withGuildDatabase((db) => {
    ensureGuildweaverTelemetrySchema(db);
    const row = db
      .prepare("SELECT * FROM guildweaver_telemetry_records WHERE id = ? LIMIT 1")
      .get(Number(id));
    return detailFromRow(row);
  });
}

export function readGuildweaverTelemetrySummary() {
  return withGuildDatabase((db) => {
    ensureGuildweaverTelemetrySchema(db);
    const totals = db
      .prepare(`
        SELECT
          COUNT(*) AS records,
          SUM(CASE WHEN kind = 'state' THEN 1 ELSE 0 END) AS states,
          SUM(CASE WHEN kind = 'event' THEN 1 ELSE 0 END) AS events,
          COUNT(DISTINCT event_type) AS domains,
          COUNT(DISTINCT NULLIF(installation_id, '')) AS installations,
          COUNT(DISTINCT NULLIF(character_id, '')) AS characters,
          MAX(received_at) AS last_received_at
        FROM guildweaver_telemetry_records
      `)
      .get();
    const eventTypes = db
      .prepare(`
        SELECT event_type, kind, COUNT(*) AS count, MAX(received_at) AS last_received_at
        FROM guildweaver_telemetry_records
        GROUP BY event_type, kind
        ORDER BY event_type, kind
      `)
      .all()
      .map((row) => ({
        eventType: row.event_type,
        kind: row.kind,
        count: Number(row.count),
        lastReceivedAt: row.last_received_at,
      }));

    return {
      records: Number(totals?.records || 0),
      states: Number(totals?.states || 0),
      events: Number(totals?.events || 0),
      domains: Number(totals?.domains || 0),
      installations: Number(totals?.installations || 0),
      characters: Number(totals?.characters || 0),
      lastReceivedAt: totals?.last_received_at || null,
      eventTypes,
    };
  });
}
