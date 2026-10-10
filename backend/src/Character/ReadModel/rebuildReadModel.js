// Rebuilds the character read model from stored telemetry, through the same
// writer live ingest uses: each character's latest legacy snapshot, then the
// talent tree definitions, then every stream's latest state in capture order.
// Runs once per READ_MODEL_VERSION (and on demand), inside one transaction.

import { guildDatabaseFile, withGuildTransaction } from "../../Data/database.js";
import { ensureCharacterSnapshotObservabilitySchema } from "../characterSnapshotRepository.js";
import { ensureTelemetryRecordSchema } from "../telemetryRecordRepository.js";
import { ensureTelemetryStateSchema } from "../Telemetry/telemetryStateRepository.js";
import { parseTelemetryJson } from "../Telemetry/telemetryJson.js";
import { sectionsFromCharacterSnapshot } from "./projectors.js";
import { READ_MODEL_VERSION, dropCharacterReadModelTables, ensureCharacterReadModelSchema } from "./readModelSchema.js";
import {
  applySectionsInDatabase,
  applyTalentDefinitionInDatabase,
  captureTime,
  projectTelemetryStateInDatabase,
} from "./readModelWriter.js";

export function rebuildCharacterReadModelInDatabase(db) {
  dropCharacterReadModelTables(db);
  ensureCharacterReadModelSchema(db);
  ensureCharacterSnapshotObservabilitySchema(db);
  ensureTelemetryRecordSchema(db);
  ensureTelemetryStateSchema(db);

  const snapshots = db.prepare(`
    SELECT s.character_id, s.id, s.captured_at, s.payload_json, MAX(i.received_at) AS received_at
    FROM character_snapshots s
    JOIN characters c ON c.id = s.character_id
    LEFT JOIN character_snapshot_ingests i ON i.snapshot_id = s.id
    WHERE s.id = (
      SELECT latest.id FROM character_snapshots latest
      WHERE latest.character_id = s.character_id
      ORDER BY latest.captured_at DESC, latest.id DESC LIMIT 1
    )
    GROUP BY s.id
  `).all();
  for (const row of snapshots) {
    const capturedAt = captureTime(row.captured_at);
    applySectionsInDatabase(db, {
      characterId: row.character_id,
      sections: sectionsFromCharacterSnapshot(parseTelemetryJson(row.payload_json, {})),
      capturedAt,
      receivedAt: row.received_at || capturedAt,
      source: "character_snapshot",
    });
  }

  const definitions = db.prepare(`
    SELECT envelope_json, captured_at, received_at FROM guildweaver_telemetry_records
    WHERE event_type = 'talent_tree_definition' ORDER BY received_at ASC, id ASC
  `).all();
  for (const row of definitions) {
    applyTalentDefinitionInDatabase(db, {
      payload: parseTelemetryJson(row.envelope_json, {})?.payload,
      capturedAt: captureTime(row.captured_at),
      receivedAt: row.received_at,
    });
  }

  const states = db.prepare(`
    SELECT member_id, device_id, raw_character_id, event_type, captured_at, received_at, record_id, revision, envelope_json, payload_json
    FROM guildweaver_telemetry_latest_state
    ORDER BY captured_at ASC, received_at ASC
  `).all();
  for (const row of states) {
    projectTelemetryStateInDatabase(db, {
      memberId: row.member_id,
      deviceId: row.device_id,
      rawCharacterId: row.raw_character_id,
      eventType: row.event_type,
      payload: parseTelemetryJson(row.payload_json, {}),
      capturedAt: row.captured_at,
      receivedAt: row.received_at,
      recordId: row.record_id,
      revision: row.revision,
      installationId: parseTelemetryJson(row.envelope_json, {})?.installationId || "",
    });
  }

  db.prepare(`
    INSERT INTO character_read_model_meta (key, value) VALUES ('version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(READ_MODEL_VERSION));
  return { characters: snapshots.length, definitions: definitions.length, states: states.length };
}

export function readModelIsCurrentInDatabase(db) {
  ensureCharacterReadModelSchema(db);
  const row = db.prepare("SELECT value FROM character_read_model_meta WHERE key = 'version'").get();
  return Number(row?.value) === READ_MODEL_VERSION;
}

// Databases already checked in this process; the version only changes with a
// deploy, which restarts it.
const current = new Set();

export function ensureCharacterReadModelCurrent() {
  const file = guildDatabaseFile();
  if (current.has(file)) return null;
  const result = withGuildTransaction((db) => (readModelIsCurrentInDatabase(db) ? null : rebuildCharacterReadModelInDatabase(db)));
  current.add(file);
  return result;
}

export function rebuildCharacterReadModel() {
  const result = withGuildTransaction((db) => rebuildCharacterReadModelInDatabase(db));
  current.add(guildDatabaseFile());
  return result;
}
