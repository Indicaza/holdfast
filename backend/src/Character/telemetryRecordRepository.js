import { withGuildDatabase } from "../Data/database.js";

const FORBIDDEN_KEYS = new Set([
  "accountid",
  "accountids",
  "battletag",
  "battletags",
  "whisper",
  "whispers",
  "chatlog",
  "chatlogs",
  "privatemessage",
  "privatemessages",
]);

const PLAYER_GUID_PATTERN = /Player-\d+-[A-F0-9]+/gi;

function normalizedKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function sanitizeTelemetryValue(value, depth = 0) {
  if (depth > 32) return null;
  if (typeof value === "string") return value.replace(PLAYER_GUID_PATTERN, "Player-REDACTED");
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTelemetryValue(entry, depth + 1));
  }
  if (!value || typeof value !== "object") return value;

  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizedKey(key))) continue;
    clean[key] = sanitizeTelemetryValue(entry, depth + 1);
  }
  return clean;
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function text(value, maxLength = 256) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function capturedAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 100000000000 ? value * 1000 : value;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function telemetryDomain(eventType) {
  const normalized = text(eventType, 120).toLowerCase();
  return (
    normalized
      .replace(/_(snapshot|observation|completed|learned|entered|killed|definition)$/, "") ||
    "unknown"
  );
}

export function ensureTelemetryRecordSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      stream_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('state', 'event')),
      revision INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      domain TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      character_id TEXT NOT NULL DEFAULT '',
      installation_id TEXT NOT NULL DEFAULT '',
      realm TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      UNIQUE(device_id, stream_key, revision),
      UNIQUE(idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_received_idx
      ON guildweaver_telemetry_records(received_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_domain_idx
      ON guildweaver_telemetry_records(domain, received_at DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_character_idx
      ON guildweaver_telemetry_records(character_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_device_idx
      ON guildweaver_telemetry_records(device_id, received_at DESC);
  `);
}

function rowSummary(row) {
  return {
    id: Number(row.id),
    deviceId: row.device_id,
    memberId: row.member_id,
    streamKey: row.stream_key,
    kind: row.kind,
    revision: Number(row.revision),
    eventType: row.event_type,
    domain: row.domain,
    schemaVersion: Number(row.schema_version),
    characterId: row.character_id || "",
    installationId: row.installation_id || "",
    realm: row.realm || "",
    region: row.region || "",
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    payloadBytes: Buffer.byteLength(row.envelope_json || "", "utf8"),
  };
}

function rowDetail(row) {
  if (!row) return null;
  const envelope = parseJson(row.envelope_json);
  return {
    ...rowSummary(row),
    envelope,
    payload: envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {},
  };
}

export function recordTelemetry({
  deviceId,
  memberId,
  idempotencyKey,
  streamKey,
  kind,
  revision,
  envelope,
  receivedAt = new Date().toISOString(),
}) {
  return withGuildDatabase((db) => {
    ensureTelemetryRecordSchema(db);
    const sanitizedEnvelope = sanitizeTelemetryValue(envelope);
    const eventType = text(sanitizedEnvelope?.eventType, 120);
    const normalizedKind = kind === "event" ? "event" : "state";
    const normalizedRevision = integer(revision, 0, 1, Number.MAX_SAFE_INTEGER);
    const normalizedStreamKey = text(streamKey, 240);
    const normalizedIdempotencyKey = text(idempotencyKey, 240);

    if (!eventType || !normalizedStreamKey || !normalizedRevision || !normalizedIdempotencyKey) {
      return { status: "invalid" };
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO guildweaver_telemetry_records (
        device_id, member_id, stream_key, kind, revision, event_type, domain,
        schema_version, character_id, installation_id, realm, region,
        captured_at, received_at, idempotency_key, envelope_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      text(deviceId, 160),
      text(memberId, 160),
      normalizedStreamKey,
      normalizedKind,
      normalizedRevision,
      eventType,
      telemetryDomain(eventType),
      integer(sanitizedEnvelope?.schemaVersion, 0, 0, 100000) || 0,
      text(sanitizedEnvelope?.characterId, 200),
      text(sanitizedEnvelope?.installationId, 200),
      text(sanitizedEnvelope?.realm, 120),
      text(sanitizedEnvelope?.region, 32),
      capturedAt(sanitizedEnvelope?.capturedAt),
      receivedAt,
      normalizedIdempotencyKey,
      JSON.stringify(sanitizedEnvelope),
    );

    const row = db.prepare(`
      SELECT * FROM guildweaver_telemetry_records
      WHERE idempotency_key = ? OR (device_id = ? AND stream_key = ? AND revision = ?)
      ORDER BY id DESC LIMIT 1
    `).get(normalizedIdempotencyKey, text(deviceId, 160), normalizedStreamKey, normalizedRevision);

    return {
      status: result.changes ? "created" : "duplicate",
      record: rowDetail(row),
    };
  });
}

function listFilters({ q = "", domain = "", kind = "", eventType = "", characterId = "" } = {}) {
  const clauses = [];
  const params = [];

  if (domain) {
    clauses.push("domain = ?");
    params.push(text(domain, 120).toLowerCase());
  }
  if (kind === "state" || kind === "event") {
    clauses.push("kind = ?");
    params.push(kind);
  }
  if (eventType) {
    clauses.push("event_type = ?");
    params.push(text(eventType, 120));
  }
  if (characterId) {
    clauses.push("character_id = ?");
    params.push(text(characterId, 200));
  }
  const query = text(q, 200).toLowerCase();
  if (query) {
    const like = `%${query}%`;
    clauses.push(`(
      LOWER(stream_key) LIKE ? OR LOWER(event_type) LIKE ? OR LOWER(domain) LIKE ? OR
      LOWER(character_id) LIKE ? OR LOWER(device_id) LIKE ? OR LOWER(realm) LIKE ? OR
      LOWER(envelope_json) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function readTelemetryHistory(options = {}) {
  return withGuildDatabase((db) => {
    ensureTelemetryRecordSchema(db);
    const limit = integer(options.limit, 40, 1, 100);
    const offset = integer(options.offset, 0, 0, 1000000);
    const where = listFilters(options);
    const rows = db.prepare(`
      SELECT * FROM guildweaver_telemetry_records
      ${where.sql}
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...where.params, limit + 1, offset);
    const hasMore = rows.length > limit;
    return {
      records: (hasMore ? rows.slice(0, limit) : rows).map(rowSummary),
      pagination: { limit, offset, hasMore },
    };
  });
}

export function readTelemetryRecord(id) {
  return withGuildDatabase((db) => {
    ensureTelemetryRecordSchema(db);
    return rowDetail(
      db.prepare("SELECT * FROM guildweaver_telemetry_records WHERE id = ? LIMIT 1").get(Number(id)),
    );
  });
}

export function readTelemetrySummary() {
  return withGuildDatabase((db) => {
    ensureTelemetryRecordSchema(db);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS records,
        COUNT(DISTINCT stream_key) AS streams,
        COUNT(DISTINCT device_id) AS devices,
        COUNT(DISTINCT NULLIF(character_id, '')) AS characters,
        SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS last_24h,
        MAX(received_at) AS last_received_at
      FROM guildweaver_telemetry_records
    `).get(dayAgo);
    const domains = db.prepare(`
      SELECT domain, kind, COUNT(*) AS count, MAX(received_at) AS last_received_at
      FROM guildweaver_telemetry_records
      GROUP BY domain, kind
      ORDER BY domain, kind
    `).all().map((row) => ({
      domain: row.domain,
      kind: row.kind,
      count: Number(row.count),
      lastReceivedAt: row.last_received_at,
    }));

    return {
      records: Number(totals?.records || 0),
      streams: Number(totals?.streams || 0),
      devices: Number(totals?.devices || 0),
      characters: Number(totals?.characters || 0),
      last24h: Number(totals?.last_24h || 0),
      lastReceivedAt: totals?.last_received_at || null,
      domains,
    };
  });
}
