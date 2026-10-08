import { withGuildDatabase } from "../Data/database.js";

const KINDS = new Set(["character", "telemetry"]);

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function revision(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function ensureGuildweaverIngestAcknowledgementSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_ingest_acknowledgements (
      device_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('character', 'telemetry')),
      stream_key TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(device_id, kind, stream_key)
    );

    CREATE INDEX IF NOT EXISTS guildweaver_ingest_ack_member_idx
      ON guildweaver_ingest_acknowledgements(member_id, updated_at DESC);
  `);
}

export function acknowledgeGuildweaverIngestInDatabase({
  db,
  deviceId,
  memberId,
  kind,
  streamKey,
  revision: incomingRevision,
  updatedAt = new Date().toISOString(),
}) {
  const normalizedKind = text(kind, 32);
  const normalizedStreamKey = text(streamKey);
  const normalizedRevision = revision(incomingRevision);
  const normalizedDeviceId = text(deviceId, 160);
  const normalizedMemberId = text(memberId, 160);

  if (
    !db ||
    !KINDS.has(normalizedKind) ||
    !normalizedDeviceId ||
    !normalizedMemberId ||
    !normalizedStreamKey ||
    !normalizedRevision
  ) {
    return false;
  }

  ensureGuildweaverIngestAcknowledgementSchema(db);
  db.prepare(`
    INSERT INTO guildweaver_ingest_acknowledgements (
      device_id, member_id, kind, stream_key, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, kind, stream_key) DO UPDATE SET
      member_id = excluded.member_id,
      revision = MAX(guildweaver_ingest_acknowledgements.revision, excluded.revision),
      updated_at = excluded.updated_at
  `).run(
    normalizedDeviceId,
    normalizedMemberId,
    normalizedKind,
    normalizedStreamKey,
    normalizedRevision,
    String(updatedAt),
  );
  return true;
}

export function acknowledgeGuildweaverIngest(options) {
  return withGuildDatabase((db) =>
    acknowledgeGuildweaverIngestInDatabase({ db, ...options }),
  );
}

function normalizeManifest(values, limit) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const streamKey = text(value?.streamKey);
    const incomingRevision = revision(value?.revision);
    if (!streamKey || !incomingRevision || seen.has(streamKey)) continue;
    seen.add(streamKey);
    result.push({ streamKey, revision: incomingRevision });
    if (result.length >= limit) break;
  }

  return result;
}

export function readGuildweaverIngestReconciliation({
  deviceId,
  memberId,
  characters = [],
  telemetry = [],
}) {
  return withGuildDatabase((db) => {
    ensureGuildweaverIngestAcknowledgementSchema(db);
    const normalizedDeviceId = text(deviceId, 160);
    const normalizedMemberId = text(memberId, 160);
    const manifests = {
      character: normalizeManifest(characters, 128),
      telemetry: normalizeManifest(telemetry, 2000),
    };
    const select = db.prepare(`
      SELECT revision
      FROM guildweaver_ingest_acknowledgements
      WHERE device_id = ? AND member_id = ? AND kind = ? AND stream_key = ?
      LIMIT 1
    `);

    function reconcile(kind) {
      return manifests[kind].map((entry) => {
        const serverRevision = Number(
          select.get(normalizedDeviceId, normalizedMemberId, kind, entry.streamKey)?.revision || 0,
        );
        return {
          ...entry,
          serverRevision,
          needsUpload: serverRevision < entry.revision,
        };
      });
    }

    return {
      schemaVersion: 1,
      characters: reconcile("character"),
      telemetry: reconcile("telemetry"),
    };
  });
}
