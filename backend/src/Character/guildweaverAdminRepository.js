import { withGuildDatabase } from "../Data/database.js";
import { ensureCharacterSnapshotObservabilitySchema } from "./characterSnapshotRepository.js";

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parsePayload(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function snapshotSummary(row) {
  const payload = parsePayload(row.payload_json);
  const receivedAt = row.received_at || row.captured_at;
  const captured = Date.parse(row.captured_at);
  const received = Date.parse(receivedAt);

  return {
    id: Number(row.id),
    characterId: row.character_id,
    characterName: row.character_name || payload.name || "Unknown",
    memberId: row.member_id || "",
    memberName: row.member_name || "Unknown member",
    className: row.class_name || payload.class?.name || "",
    race: row.race || payload.race?.name || "",
    spec: row.spec || payload.specialization?.name || "",
    source: row.source,
    capturedAt: row.captured_at,
    receivedAt,
    deviceId: row.device_id || "",
    bridgeRevision:
      row.bridge_revision === null || row.bridge_revision === undefined
        ? null
        : Number(row.bridge_revision),
    level: Number(payload.level) || null,
    addonVersion: String(payload.addonVersion || ""),
    schemaVersion: Number(payload.schemaVersion) || null,
    reason: String(payload.reason || ""),
    payloadBytes: Buffer.byteLength(row.payload_json || "", "utf8"),
    lagMs:
      Number.isFinite(captured) && Number.isFinite(received)
        ? Math.max(0, received - captured)
        : null,
  };
}

function snapshotDetail(row) {
  if (!row) return null;
  return {
    ...snapshotSummary(row),
    payload: parsePayload(row.payload_json),
  };
}

function snapshotSelect() {
  return `
    SELECT
      s.*,
      i.device_id,
      i.bridge_revision,
      i.received_at,
      c.member_id,
      c.name AS character_name,
      c.race,
      c.class_name,
      c.spec,
      m.display_name AS member_name
    FROM character_snapshots s
    JOIN characters c ON c.id = s.character_id
    LEFT JOIN members m ON m.id = c.member_id
    LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
  `;
}

function filters({ q = "", characterId = "", memberId = "", source = "" } = {}) {
  const clauses = [];
  const params = [];
  const normalizedQuery = String(q || "").trim().toLowerCase();

  if (characterId) {
    clauses.push("s.character_id = ?");
    params.push(String(characterId));
  }

  if (memberId) {
    clauses.push("c.member_id = ?");
    params.push(String(memberId));
  }

  if (source) {
    clauses.push("s.source = ?");
    params.push(String(source));
  }

  if (normalizedQuery) {
    const like = `%${normalizedQuery}%`;
    clauses.push(`(
      LOWER(c.name) LIKE ? OR
      LOWER(COALESCE(m.display_name, '')) LIKE ? OR
      LOWER(s.source) LIKE ? OR
      LOWER(COALESCE(i.device_id, '')) LIKE ? OR
      LOWER(s.payload_json) LIKE ?
    )`);
    params.push(like, like, like, like, like);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function readGuildweaverSnapshotHistory(options = {}) {
  return withGuildDatabase((db) => {
    ensureCharacterSnapshotObservabilitySchema(db);
    const limit = integer(options.limit, 30, 1, 100);
    const offset = integer(options.offset, 0, 0, 1000000);
    const where = filters(options);
    const rows = db
      .prepare(
        `${snapshotSelect()}
         ${where.sql}
         ORDER BY COALESCE(i.received_at, s.captured_at) DESC, s.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, limit + 1, offset);

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      snapshots: visibleRows.map(snapshotSummary),
      pagination: {
        limit,
        offset,
        hasMore,
      },
    };
  });
}

export function readGuildweaverSnapshot(id) {
  return withGuildDatabase((db) => {
    ensureCharacterSnapshotObservabilitySchema(db);
    const row = db
      .prepare(`${snapshotSelect()} WHERE s.id = ? LIMIT 1`)
      .get(Number(id));
    return snapshotDetail(row);
  });
}

export function readGuildweaverAdminSummary() {
  return withGuildDatabase((db) => {
    ensureCharacterSnapshotObservabilitySchema(db);
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const totals = db
      .prepare(
        `
          SELECT
            COUNT(*) AS snapshots,
            COUNT(DISTINCT s.character_id) AS characters,
            COUNT(DISTINCT NULLIF(i.device_id, '')) AS devices,
            MAX(s.captured_at) AS last_captured_at,
            MAX(COALESCE(i.received_at, s.captured_at)) AS last_received_at,
            SUM(CASE WHEN COALESCE(i.received_at, s.captured_at) >= ? THEN 1 ELSE 0 END) AS last_24h
          FROM character_snapshots s
          LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
        `,
      )
      .get(dayAgo);
    const sources = db
      .prepare(
        `
          SELECT source, COUNT(*) AS count
          FROM character_snapshots
          GROUP BY source
          ORDER BY count DESC, source
        `,
      )
      .all()
      .map((row) => ({ source: row.source, count: Number(row.count) }));

    return {
      snapshots: Number(totals?.snapshots || 0),
      characters: Number(totals?.characters || 0),
      devices: Number(totals?.devices || 0),
      last24h: Number(totals?.last_24h || 0),
      lastCapturedAt: totals?.last_captured_at || null,
      lastReceivedAt: totals?.last_received_at || null,
      sources,
    };
  });
}
