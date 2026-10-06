import { withGuildTransaction } from "../Data/database.js";
import {
  ensureCharacterSnapshotObservabilitySchema,
  recordCharacterSnapshotInDatabase,
} from "./characterSnapshotRepository.js";
import { projectTelemetrySnapshotInDatabase } from "./telemetryProjection.js";

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function professionNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const names = [];
  const seen = new Set();

  for (const profession of value) {
    const name = text(profession?.name, 40);

    if (!name || seen.has(name.toLowerCase())) {
      continue;
    }

    seen.add(name.toLowerCase());
    names.push(name);

    if (names.length >= 6) {
      break;
    }
  }

  return names;
}

function capturedAt(snapshot) {
  const numericTimestamp = Number(snapshot?.capturedAt);

  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return new Date(numericTimestamp * 1000).toISOString();
  }

  if (typeof snapshot?.capturedAt === "string") {
    const parsed = new Date(snapshot.capturedAt);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function preferredCharacterId(snapshot) {
  const anonymousCharacterId = text(snapshot?.characterId, 128);

  if (anonymousCharacterId) {
    return `guildweaver-id:${anonymousCharacterId}`;
  }

  const guid = text(snapshot?.guid, 96);

  if (guid) {
    return guid;
  }

  const key = text(snapshot?.characterKey, 160);

  if (key) {
    return `guildweaver:${key}`;
  }

  return "";
}

export async function syncGuildweaverCharacter({
  memberId,
  snapshot,
  source = "guildweaver",
  deviceId = "",
  bridgeRevision = null,
  receivedAt = new Date().toISOString(),
}) {
  const normalizedMemberId = text(memberId, 96);
  const name = text(snapshot?.name, 32);
  const race = text(snapshot?.race?.name ?? snapshot?.race, 32);
  const className = text(snapshot?.class?.name ?? snapshot?.class, 32);
  const spec = text(
    snapshot?.specialization?.name ?? snapshot?.spec?.name ?? snapshot?.spec,
    48,
  );
  const professions = professionNames(snapshot?.professions);

  if (!normalizedMemberId || !name) {
    return { status: "invalid", character: null, snapshot: null };
  }

  return withGuildTransaction((db) => {
    const member = db
      .prepare("SELECT id FROM members WHERE id = ? AND status = 'active'")
      .get(normalizedMemberId);

    if (!member) {
      return { status: "member-not-found", character: null, snapshot: null };
    }

    const existing = db
      .prepare(
        `
          SELECT id, is_main, sort_order
          FROM characters
          WHERE member_id = ? AND name = ? COLLATE NOCASE
          ORDER BY sort_order, id
          LIMIT 1
        `,
      )
      .get(normalizedMemberId, name);

    const existingCount = Number(
      db
        .prepare("SELECT COUNT(*) AS count FROM characters WHERE member_id = ?")
        .get(normalizedMemberId)?.count || 0,
    );
    const nextSortOrder = Number(
      db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM characters WHERE member_id = ?",
        )
        .get(normalizedMemberId)?.sort_order || 0,
    );
    const characterId = existing?.id || preferredCharacterId(snapshot);

    if (!characterId) {
      return { status: "invalid", character: null, snapshot: null };
    }

    const isMain = existing ? Boolean(existing.is_main) : existingCount === 0;
    const sortOrder = existing ? Number(existing.sort_order) : nextSortOrder;

    db.prepare(
      `
        INSERT INTO characters (
          id,
          member_id,
          name,
          race,
          class_name,
          spec,
          professions_json,
          is_main,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          member_id = excluded.member_id,
          name = excluded.name,
          race = excluded.race,
          class_name = excluded.class_name,
          spec = excluded.spec,
          professions_json = excluded.professions_json,
          is_main = excluded.is_main,
          sort_order = excluded.sort_order
      `,
    ).run(
      characterId,
      normalizedMemberId,
      name,
      race,
      className,
      spec,
      JSON.stringify(professions),
      isMain ? 1 : 0,
      sortOrder,
    );

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE members
        SET profile_updated_at = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(now, now, normalizedMemberId);

    const captured = capturedAt(snapshot);
    const payloadJson = JSON.stringify(snapshot ?? {});
    ensureCharacterSnapshotObservabilitySchema(db);
    const duplicate = db
      .prepare(`
      SELECT s.id, s.captured_at, i.received_at, i.bridge_revision
      FROM character_snapshots s
      LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
      WHERE s.character_id = ? AND s.captured_at = ? AND s.payload_json = ?
      ORDER BY s.id DESC
      LIMIT 1
    `)
      .get(characterId, captured, payloadJson);

    let storedSnapshot;
    let status = existing ? "updated" : "created";

    if (duplicate) {
      storedSnapshot = {
        id: Number(duplicate.id),
        characterId,
        source,
        capturedAt: duplicate.captured_at,
        receivedAt: duplicate.received_at || duplicate.captured_at,
        bridgeRevision:
          duplicate.bridge_revision === null
            ? null
            : Number(duplicate.bridge_revision),
        payload: snapshot,
      };
      status = "unchanged";
    } else {
      storedSnapshot = recordCharacterSnapshotInDatabase({
        db,
        characterId,
        source,
        capturedAt: captured,
        receivedAt,
        deviceId,
        bridgeRevision,
        payload: snapshot,
      });
    }

    projectTelemetrySnapshotInDatabase({
      db,
      characterId,
      snapshotId: storedSnapshot.id,
      snapshot,
      capturedAt: storedSnapshot.capturedAt,
    });

    return {
      status,
      character: {
        id: characterId,
        name,
        race,
        className,
        spec,
        professions,
        isMain,
      },
      snapshot: storedSnapshot,
    };
  });
}
