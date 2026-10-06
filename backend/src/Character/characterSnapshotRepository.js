import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";

export function ensureCharacterSnapshotObservabilitySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_snapshot_ingests (
      snapshot_id INTEGER PRIMARY KEY
        REFERENCES character_snapshots(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL DEFAULT '',
      bridge_revision INTEGER,
      received_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS character_snapshot_ingests_received_idx
      ON character_snapshot_ingests(received_at DESC, snapshot_id DESC);

    CREATE INDEX IF NOT EXISTS character_snapshot_ingests_device_idx
      ON character_snapshot_ingests(device_id, received_at DESC)
      WHERE device_id <> '';
  `);
}

function parsePayload(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function snapshotFromRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    characterId: row.character_id,
    source: row.source,
    capturedAt: row.captured_at,
    receivedAt: row.received_at || row.captured_at,
    deviceId: row.device_id || "",
    bridgeRevision:
      row.bridge_revision === null || row.bridge_revision === undefined
        ? null
        : Number(row.bridge_revision),
    payload: parsePayload(row.payload_json),
  };
}

export function recordCharacterSnapshotInDatabase({
  db,
  characterId,
  source,
  payload,
  capturedAt = new Date().toISOString(),
  receivedAt = new Date().toISOString(),
  deviceId = "",
  bridgeRevision = null,
}) {
  if (!db || !characterId || !source) {
    throw new Error("db, characterId, and source are required");
  }

  ensureCharacterSnapshotObservabilitySchema(db);

  const result = db.prepare(
    `
      INSERT INTO character_snapshots (
        character_id,
        source,
        captured_at,
        payload_json
      ) VALUES (?, ?, ?, ?)
    `,
  ).run(
    String(characterId),
    String(source),
    String(capturedAt),
    JSON.stringify(payload ?? {}),
  );

  const snapshotId = Number(result.lastInsertRowid);
  const normalizedRevision = Number(bridgeRevision);

  db.prepare(
    `
      INSERT INTO character_snapshot_ingests (
        snapshot_id,
        device_id,
        bridge_revision,
        received_at
      ) VALUES (?, ?, ?, ?)
    `,
  ).run(
    snapshotId,
    String(deviceId || ""),
    Number.isFinite(normalizedRevision) ? normalizedRevision : null,
    String(receivedAt),
  );

  return snapshotFromRow(
    db
      .prepare(
        `
          SELECT s.*, i.device_id, i.bridge_revision, i.received_at
          FROM character_snapshots s
          LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
          WHERE s.id = ?
        `,
      )
      .get(snapshotId),
  );
}

export async function recordCharacterSnapshot({
  characterId,
  source,
  payload,
  capturedAt = new Date().toISOString(),
  receivedAt = new Date().toISOString(),
  deviceId = "",
  bridgeRevision = null,
}) {
  return withGuildTransaction((db) =>
    recordCharacterSnapshotInDatabase({
      db,
      characterId,
      source,
      payload,
      capturedAt,
      receivedAt,
      deviceId,
      bridgeRevision,
    }),
  );
}

export async function readLatestCharacterSnapshot(characterId) {
  return withGuildDatabase((db) => {
    ensureCharacterSnapshotObservabilitySchema(db);
    return snapshotFromRow(
      db
        .prepare(
          `
            SELECT s.*, i.device_id, i.bridge_revision, i.received_at
            FROM character_snapshots s
            LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
            WHERE s.character_id = ?
            ORDER BY s.captured_at DESC, s.id DESC
            LIMIT 1
          `,
        )
        .get(String(characterId)),
    );
  });
}
