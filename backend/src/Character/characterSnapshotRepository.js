import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";

function snapshotFromRow(row) {
  if (!row) {
    return null;
  }

  let payload = {};

  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    payload = {};
  }

  return {
    id: Number(row.id),
    characterId: row.character_id,
    source: row.source,
    capturedAt: row.captured_at,
    payload,
  };
}

export async function recordCharacterSnapshot({
  characterId,
  source,
  payload,
  capturedAt = new Date().toISOString(),
}) {
  if (!characterId || !source) {
    throw new Error("characterId and source are required");
  }

  return withGuildTransaction((db) => {
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

    return snapshotFromRow(
      db
        .prepare("SELECT * FROM character_snapshots WHERE id = ?")
        .get(result.lastInsertRowid),
    );
  });
}

export async function readLatestCharacterSnapshot(characterId) {
  return withGuildDatabase((db) =>
    snapshotFromRow(
      db
        .prepare(
          `
            SELECT *
            FROM character_snapshots
            WHERE character_id = ?
            ORDER BY captured_at DESC, id DESC
            LIMIT 1
          `,
        )
        .get(String(characterId)),
    ),
  );
}
