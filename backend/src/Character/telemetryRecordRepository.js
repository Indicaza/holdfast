import { withGuildDatabase } from "../Data/database.js";
import { applyTalentDefinitionInDatabase } from "./ReadModel/sectionStore.js";
import { decodeTelemetryJson, encodeTelemetryJson, parseTelemetryJson } from "./Telemetry/telemetryJson.js";

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

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function text(value, maxLength = 256) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
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

function payloadFromRow(row) {
  const envelope = parseTelemetryJson(row?.envelope_json);
  return envelope?.payload && typeof envelope.payload === "object" && !Array.isArray(envelope.payload)
    ? envelope.payload
    : {};
}

function rowSummary(row) {
  const payload = payloadFromRow(row);
  const characterName = text(row.character_name || payload.name, 96);
  const memberName = text(row.member_name, 96);
  const className = text(row.class_name || payload.class?.name || payload.class, 48);
  const spec = text(row.spec || payload.specialization?.name || payload.spec?.name || payload.spec, 64);

  return {
    id: Number(row.id),
    deviceId: row.device_id,
    memberId: row.member_id,
    memberName,
    characterName,
    className,
    spec,
    streamKey: row.stream_key,
    kind: row.kind,
    revision: Number(row.revision),
    eventType: row.event_type,
    domain: row.domain,
    schemaVersion: Number(row.schema_version),
    characterId: row.character_id || "",
    installationId: row.installation_id || "",
    realm: row.realm || payload.realm || "",
    region: row.region || payload.region || "",
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    payloadBytes: Buffer.byteLength(decodeTelemetryJson(row.envelope_json) || "", "utf8"),
  };
}

function rowDetail(row) {
  if (!row) return null;
  const envelope = parseTelemetryJson(row.envelope_json);
  return {
    ...rowSummary(row),
    envelope,
    payload: envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {},
  };
}

function telemetrySelect() {
  return `
    SELECT
      r.*,
      m.display_name AS member_name,
      COALESCE(c_direct.name, c_anonymous.name, '') AS character_name,
      COALESCE(c_direct.class_name, c_anonymous.class_name, '') AS class_name,
      COALESCE(c_direct.spec, c_anonymous.spec, '') AS spec
    FROM guildweaver_telemetry_records r
    LEFT JOIN members m ON m.id = r.member_id
    LEFT JOIN characters c_direct
      ON c_direct.id = r.character_id AND c_direct.member_id = r.member_id
    LEFT JOIN characters c_anonymous
      ON c_anonymous.id = ('guildweaver-id:' || r.character_id) AND c_anonymous.member_id = r.member_id
  `;
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
    const sanitizedEnvelope = sanitizeTelemetryValue(envelope);
    const eventType = text(sanitizedEnvelope?.eventType, 120);
    const normalizedKind = kind === "event" ? "event" : "state";
    const normalizedRevision = integer(revision, 0, 1, Number.MAX_SAFE_INTEGER);
    const normalizedStreamKey = text(streamKey, 240);
    const normalizedIdempotencyKey = text(idempotencyKey, 240);

    if (!eventType || !normalizedStreamKey || !normalizedRevision || !normalizedIdempotencyKey) {
      return { status: "invalid" };
    }

    // A device whose revision counter was reset (its SavedVariables were
    // wiped, or the stream was pruned and recreated) reuses revisions with
    // new content. The idempotency key covers the content, so a different key
    // at a taken revision is that reset: newer content replaces the old row
    // instead of being dropped as a duplicate.
    const reused = db.prepare(`
      SELECT id, captured_at FROM guildweaver_telemetry_records
      WHERE device_id = ? AND stream_key = ? AND revision = ? AND idempotency_key <> ?
    `).get(text(deviceId, 160), normalizedStreamKey, normalizedRevision, normalizedIdempotencyKey);
    if (reused && capturedAt(sanitizedEnvelope?.capturedAt) >= reused.captured_at) {
      db.prepare("DELETE FROM guildweaver_telemetry_records WHERE id = ?").run(reused.id);
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
      encodeTelemetryJson(sanitizedEnvelope),
    );

    if (result.changes && eventType === "talent_tree_definition") {
      applyTalentDefinitionInDatabase(db, {
        payload: sanitizedEnvelope.payload,
        capturedAt: capturedAt(sanitizedEnvelope?.capturedAt),
        receivedAt,
      });
    }

    const row = db.prepare(`
      SELECT * FROM guildweaver_telemetry_records
      WHERE idempotency_key = ? OR (device_id = ? AND stream_key = ? AND revision = ?)
      ORDER BY (idempotency_key = ?) DESC, id DESC LIMIT 1
    `).get(normalizedIdempotencyKey, text(deviceId, 160), normalizedStreamKey, normalizedRevision, normalizedIdempotencyKey);

    return {
      status: result.changes ? "created" : "duplicate",
      record: rowDetail(row),
    };
  });
}

function listFilters({
  q = "",
  domain = "",
  kind = "",
  eventType = "",
  characterId = "",
  character = "",
  payloadType = "",
  since = "",
} = {}) {
  const clauses = [];
  const params = [];

  if (domain) {
    clauses.push("r.domain = ?");
    params.push(text(domain, 120).toLowerCase());
  }
  if (kind === "state" || kind === "event") {
    clauses.push("r.kind = ?");
    params.push(kind);
  }
  if (eventType) {
    clauses.push("r.event_type = ?");
    params.push(text(eventType, 120));
  }
  if (characterId) {
    clauses.push("r.character_id = ?");
    params.push(text(characterId, 200));
  }

  const characterQuery = text(character, 120).toLowerCase();
  if (characterQuery) {
    const like = `%${characterQuery}%`;
    clauses.push(`(
      LOWER(r.character_id) LIKE ? OR
      LOWER(COALESCE(c_direct.name, c_anonymous.name, '')) LIKE ? OR
      LOWER(COALESCE(m.display_name, '')) LIKE ? OR
      LOWER(r.envelope_json) LIKE ?
    )`);
    params.push(like, like, like, like);
  }

  const payloadQuery = text(payloadType, 120).toLowerCase();
  if (payloadQuery) {
    const like = `%${payloadQuery}%`;
    clauses.push(`(
      LOWER(r.event_type) LIKE ? OR
      LOWER(r.domain) LIKE ? OR
      LOWER(r.stream_key) LIKE ?
    )`);
    params.push(like, like, like);
  }

  const sinceDate = isoDate(since);
  if (sinceDate) {
    clauses.push("r.received_at >= ?");
    params.push(sinceDate);
  }

  const query = text(q, 200).toLowerCase();
  if (query) {
    const like = `%${query}%`;
    clauses.push(`(
      LOWER(r.stream_key) LIKE ? OR LOWER(r.event_type) LIKE ? OR LOWER(r.domain) LIKE ? OR
      LOWER(r.character_id) LIKE ? OR LOWER(r.device_id) LIKE ? OR LOWER(r.realm) LIKE ? OR
      LOWER(r.envelope_json) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function readTelemetryHistory(options = {}) {
  return withGuildDatabase((db) => {
    const limit = integer(options.limit, 40, 1, 100);
    const offset = integer(options.offset, 0, 0, 1000000);
    const where = listFilters(options);
    const rows = db.prepare(`
      ${telemetrySelect()}
      ${where.sql}
      ORDER BY r.received_at DESC, r.id DESC
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
    return rowDetail(
      db.prepare(`${telemetrySelect()} WHERE r.id = ? LIMIT 1`).get(Number(id)),
    );
  });
}

export function readTelemetryCharacters(options = {}) {
  return withGuildDatabase((db) => {
    const limit = integer(options.limit, 12, 1, 30);
    const query = text(options.q, 120).toLowerCase();
    const rows = db.prepare(`
      ${telemetrySelect()}
      INNER JOIN (
        SELECT character_id, MAX(id) AS latest_id
        FROM guildweaver_telemetry_records
        WHERE character_id <> ''
        GROUP BY character_id
      ) latest ON latest.latest_id = r.id
      ORDER BY r.received_at DESC, r.id DESC
      LIMIT 1000
    `).all();

    const characters = rows
      .map((row) => {
        const summary = rowSummary(row);
        return {
          characterId: summary.characterId,
          characterName: summary.characterName || summary.characterId,
          memberName: summary.memberName,
          className: summary.className,
          spec: summary.spec,
          realm: summary.realm,
          lastReceivedAt: summary.receivedAt,
        };
      })
      .filter((character) => {
        if (!query) return true;
        return [
          character.characterName,
          character.memberName,
          character.characterId,
          character.className,
          character.spec,
          character.realm,
        ].some((value) => String(value || "").toLowerCase().includes(query));
      })
      .slice(0, limit);

    return { characters };
  });
}

export function readTelemetrySummary() {
  return withGuildDatabase((db) => {
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
    const eventTypes = db.prepare(`
      SELECT event_type, domain, COUNT(*) AS count, MAX(received_at) AS last_received_at
      FROM guildweaver_telemetry_records
      GROUP BY event_type, domain
      ORDER BY MAX(received_at) DESC, event_type
    `).all().map((row) => ({
      eventType: row.event_type,
      domain: row.domain,
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
      eventTypes,
    };
  });
}
