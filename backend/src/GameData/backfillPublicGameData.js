import { withGuildTransaction } from "../Data/database.js";
import { parseTelemetryJson } from "../Character/Telemetry/telemetryJson.js";
import { projectPublicGameDataInDatabase, recordGatheringFactsInDatabase } from "./publicGameDataProjection.js";

export function backfillPublicGameData() {
  return withGuildTransaction((db) => {
    const key = "public_game_facts_backfill_v1";
    if (db.prepare("SELECT 1 FROM app_meta WHERE key = ?").get(key)) return { status: "already-complete" };
    let after = 0;
    let observations = 0;
    while (true) {
      const rows = db.prepare("SELECT id FROM economic_observations WHERE id > ? ORDER BY id LIMIT 250").all(after);
      if (!rows.length) break;
      for (const row of rows) recordGatheringFactsInDatabase(db, row.id);
      observations += rows.length;
      after = rows.at(-1).id;
    }
    after = 0;
    let states = 0;
    while (true) {
      const rows = db.prepare(`SELECT rowid AS cursor, event_type, envelope_json, payload_json FROM guildweaver_telemetry_latest_state
        WHERE rowid > ? AND event_type IN ('profession_snapshot', 'game_item_definition') ORDER BY rowid LIMIT 100`).all(after);
      if (!rows.length) break;
      for (const row of rows) projectPublicGameDataInDatabase(db, { eventType: row.event_type,
        envelope: parseTelemetryJson(row.envelope_json, {}), payload: parseTelemetryJson(row.payload_json, {}) });
      states += rows.length;
      after = rows.at(-1).cursor;
    }
    db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run(key, JSON.stringify({ observations, states }), new Date().toISOString());
    return { status: "complete", observations, states };
  });
}
