import { withGuildTransaction } from "../Data/database.js";
import { learnGameDataFromSnapshotInDatabase } from "../GameData/gameDataCatalog.js";
import { publishCharacterChanged } from "../Live/characterChangeEvents.js";
import { publishLiveUpdate } from "../Live/liveUpdateBus.js";
import {
  ensureCharacterSnapshotObservabilitySchema,
  recordCharacterSnapshotInDatabase,
} from "./characterSnapshotRepository.js";
import {
  recordGuildweaverCharacterAliasInDatabase,
  resolveGuildweaverCharacterIdentityInDatabase,
} from "./characterIdentityRepository.js";
import {
  isOlderSnapshot,
  mergeCharacterSnapshot,
  snapshotCapturedAt,
} from "./characterSnapshotIntegrity.js";
import { sectionsFromCharacterSnapshot } from "./ReadModel/projectors.js";
import { applySectionsInDatabase, replayPendingTelemetryInDatabase } from "./ReadModel/readModelWriter.js";
import { ensureCharacterReadModelCurrent } from "./ReadModel/rebuildReadModel.js";
import { projectionSnapshot } from "./schemaV3Projection.js";
import {
  ensureTelemetryProjectionSchema,
  projectTelemetrySnapshotInDatabase,
} from "./telemetryProjection.js";

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function characterNames(snapshot) {
  const firstName = text(snapshot?.firstName ?? snapshot?.name, 40);
  const lastName = text(snapshot?.lastName, 40);
  const reportedFullName = text(snapshot?.fullName, 96);
  const fullName = reportedFullName || [firstName, lastName].filter(Boolean).join(" ");
  return {
    firstName,
    lastName,
    fullName: fullName || firstName,
  };
}

function professionNames(value) {
  if (!Array.isArray(value)) return [];
  const names = [];
  const seen = new Set();

  for (const profession of value) {
    const name = text(profession?.name, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
    if (names.length >= 6) break;
  }

  return names;
}

function preferredCharacterId(snapshot) {
  const anonymousCharacterId = text(snapshot?.characterId, 128);
  if (anonymousCharacterId) return `guildweaver-id:${anonymousCharacterId}`;

  const guid = text(snapshot?.guid, 96);
  if (guid) return guid;

  const key = text(snapshot?.characterKey, 160);
  if (key) return `guildweaver:${key}`;

  return "";
}

// The character read model takes the snapshot as captured (not merged): per
// section, the newest capture wins and partial sections only fill gaps.
function projectReadModel(db, { characterId, memberId, rawCharacterId, snapshot, capturedAt, receivedAt }) {
  const changed = applySectionsInDatabase(db, {
    characterId,
    sections: sectionsFromCharacterSnapshot(snapshot),
    capturedAt,
    receivedAt,
    source: "character_snapshot",
  });
  replayPendingTelemetryInDatabase(db, { memberId, rawCharacterId, characterId });
  return changed;
}

function parsePayload(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function projectionState(db, characterId) {
  return db
    .prepare(`
      SELECT t.latest_snapshot_id, t.last_seen_at, s.payload_json
      FROM telemetry_characters t
      LEFT JOIN character_snapshots s ON s.id = t.latest_snapshot_id
      WHERE t.character_id = ?
      LIMIT 1
    `)
    .get(characterId);
}

function duplicateSnapshot(db, characterId, capturedAt, payload) {
  return db
    .prepare(`
      SELECT s.id, s.captured_at, i.received_at, i.bridge_revision
      FROM character_snapshots s
      LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
      WHERE s.character_id = ? AND s.captured_at = ? AND s.payload_json = ?
      ORDER BY s.id DESC
      LIMIT 1
    `)
    .get(characterId, capturedAt, JSON.stringify(payload ?? {}));
}

function storedDuplicate(duplicate, characterId, source, payload) {
  return {
    id: Number(duplicate.id),
    characterId,
    source,
    capturedAt: duplicate.captured_at,
    receivedAt: duplicate.received_at || duplicate.captured_at,
    bridgeRevision:
      duplicate.bridge_revision === null || duplicate.bridge_revision === undefined
        ? null
        : Number(duplicate.bridge_revision),
    payload,
  };
}

function currentCharacterResult(db, characterId, incomingNames) {
  const row = db
    .prepare(`
      SELECT name, race, class_name, spec, professions_json, is_main
      FROM characters
      WHERE id = ?
      LIMIT 1
    `)
    .get(characterId);
  if (!row) return null;

  let professions = [];
  try {
    professions = JSON.parse(row.professions_json || "[]");
  } catch {
    professions = [];
  }

  return {
    id: characterId,
    name: row.name,
    firstName: incomingNames.firstName,
    lastName: incomingNames.lastName,
    fullName: row.name,
    race: row.race,
    className: row.class_name,
    spec: row.spec,
    professions: Array.isArray(professions) ? professions : [],
    isMain: Boolean(row.is_main),
  };
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
  const incomingNames = characterNames(snapshot);
  const incomingName = incomingNames.fullName;

  if (!normalizedMemberId || !incomingName) {
    return { status: "invalid", character: null, snapshot: null };
  }

  ensureCharacterReadModelCurrent();
  const result = withGuildTransaction((db) => {
    const member = db
      .prepare("SELECT id FROM members WHERE id = ? AND status = 'active'")
      .get(normalizedMemberId);
    if (!member) {
      return { status: "member-not-found", character: null, snapshot: null };
    }

    ensureTelemetryProjectionSchema(db);
    ensureCharacterSnapshotObservabilitySchema(db);

    const preferredId = preferredCharacterId(snapshot);
    const rawCharacterId = text(snapshot?.characterId, 200);
    const realm = text(snapshot?.realm ?? snapshot?.realmName, 120);
    const region = text(snapshot?.region, 32);
    let existing = resolveGuildweaverCharacterIdentityInDatabase({
      db,
      memberId: normalizedMemberId,
      deviceId,
      rawCharacterId,
      preferredCharacterId: preferredId,
      characterName: incomingName,
      realm,
      region,
    });

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
    const characterId = existing?.id || preferredId;
    if (!characterId) {
      return { status: "invalid", character: null, snapshot: null };
    }

    const isMain = existing ? Boolean(existing.is_main) : existingCount === 0;
    const sortOrder = existing ? Number(existing.sort_order) : nextSortOrder;
    const captured = snapshotCapturedAt(snapshot);
    const currentProjection = existing ? projectionState(db, characterId) : null;

    if (existing && currentProjection?.last_seen_at && isOlderSnapshot(captured, currentProjection.last_seen_at)) {
      const staleSnapshot = recordCharacterSnapshotInDatabase({
        db,
        characterId,
        source,
        capturedAt: captured,
        receivedAt,
        deviceId,
        bridgeRevision,
        payload: snapshot,
      });

      recordGuildweaverCharacterAliasInDatabase({
        db,
        memberId: normalizedMemberId,
        deviceId,
        installationId: snapshot?.installationId,
        rawCharacterId,
        characterId,
        characterName: incomingName,
        realm,
        region,
        observedAt: receivedAt,
      });
      const changedSections = projectReadModel(db, { characterId, memberId: normalizedMemberId, rawCharacterId, snapshot, capturedAt: captured, receivedAt });

      return {
        status: "stale",
        changedSections,
        character: currentCharacterResult(db, characterId, incomingNames),
        snapshot: staleSnapshot,
        preservedSections: [],
      };
    }

    const previousPayload = parsePayload(currentProjection?.payload_json);
    const merged = mergeCharacterSnapshot(previousPayload, snapshot);
    const materializedSnapshot = merged.snapshot;
    const names = characterNames(materializedSnapshot);
    const name = names.fullName || incomingName;
    const race = text(materializedSnapshot?.race?.name ?? materializedSnapshot?.race, 32);
    const className = text(materializedSnapshot?.class?.name ?? materializedSnapshot?.class, 32);
    const spec = text(
      materializedSnapshot?.specialization?.name ??
        materializedSnapshot?.spec?.name ??
        materializedSnapshot?.spec,
      48,
    );
    const professions = professionNames(materializedSnapshot?.professions);

    db.prepare(`
      INSERT INTO characters (
        id, member_id, name, race, class_name, spec, professions_json, is_main, sort_order
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
    `).run(
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

    recordGuildweaverCharacterAliasInDatabase({
      db,
      memberId: normalizedMemberId,
      deviceId,
      installationId: materializedSnapshot?.installationId,
      rawCharacterId,
      characterId,
      characterName: name,
      realm: text(materializedSnapshot?.realm ?? materializedSnapshot?.realmName, 120),
      region: text(materializedSnapshot?.region, 32),
      observedAt: receivedAt,
    });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE members
      SET profile_updated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, normalizedMemberId);

    const duplicate = duplicateSnapshot(db, characterId, captured, materializedSnapshot);
    let storedSnapshot;
    let status = existing ? "updated" : "created";

    if (duplicate) {
      storedSnapshot = storedDuplicate(duplicate, characterId, source, materializedSnapshot);
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
        payload: materializedSnapshot,
      });
    }

    const projectedSnapshot = projectionSnapshot(materializedSnapshot);
    projectTelemetrySnapshotInDatabase({
      db,
      characterId,
      snapshotId: storedSnapshot.id,
      snapshot: projectedSnapshot,
      capturedAt: storedSnapshot.capturedAt,
    });

    learnGameDataFromSnapshotInDatabase(db, projectedSnapshot, {
      source: "telemetry",
      observedAt: storedSnapshot.capturedAt,
    });
    const changedSections = projectReadModel(db, { characterId, memberId: normalizedMemberId, rawCharacterId, snapshot, capturedAt: captured, receivedAt });

    return {
      status,
      character: {
        id: characterId,
        name,
        firstName: names.firstName,
        lastName: names.lastName,
        fullName: names.fullName,
        race,
        className,
        spec,
        professions,
        isMain,
      },
      snapshot: storedSnapshot,
      preservedSections: merged.preservedSections,
      changedSections,
    };
  });

  if (result.character?.id) {
    publishCharacterChanged({ characterId: result.character.id, sections: result.changedSections || [] });
  }
  if (result.status === "created" || result.status === "updated") {
    publishLiveUpdate({
      topics: ["members"],
      source: "guildweaver.character",
      entityId: result.character.id,
    });
    publishLiveUpdate({
      topics: ["guildweaver"],
      source: "guildweaver.character",
      entityId: result.character.id,
      permission: "site.admin",
    });
  }

  return result;
}
