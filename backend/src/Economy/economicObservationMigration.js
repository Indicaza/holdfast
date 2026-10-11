// Economic observations: one row per thing a character gathered, looted,
// fished, disenchanted or crafted, and one row per item that came out of it.
//
// They are analytics facts, not character state, so they live apart from the
// character read model. Raw telemetry records are pruned; these rows are the
// durable record. Each keeps its source record's id for debugging while the
// raw record is still retained.
export const economicObservationMigration = {
  version: 9,
  name: "economic_observations",
  up(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS economic_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_key TEXT NOT NULL UNIQUE,
      record_id INTEGER,
      event_type TEXT NOT NULL,
      activity TEXT NOT NULL DEFAULT '',
      discipline TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      source_object_id INTEGER,
      member_id TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL DEFAULT '',
      character_key TEXT NOT NULL DEFAULT '',
      character_level INTEGER,
      skill_line_id INTEGER,
      skill_level INTEGER,
      max_skill_level INTEGER,
      skill_modifier INTEGER,
      bountiful_harvest_rank INTEGER,
      bountiful_harvest_max_ranks INTEGER,
      map_id INTEGER,
      zone TEXT NOT NULL DEFAULT '',
      subzone TEXT NOT NULL DEFAULT '',
      x REAL,
      y REAL,
      game_build TEXT NOT NULL DEFAULT '',
      game_version TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS economic_observations_source_idx
      ON economic_observations(source_key, captured_at);
    CREATE INDEX IF NOT EXISTS economic_observations_discipline_idx
      ON economic_observations(discipline, source_key);
    CREATE INDEX IF NOT EXISTS economic_observations_object_idx
      ON economic_observations(discipline, source_kind, source_object_id);
    CREATE INDEX IF NOT EXISTS economic_observations_context_idx
      ON economic_observations(source_key, zone, game_build, skill_level);
    CREATE INDEX IF NOT EXISTS economic_observations_character_idx
      ON economic_observations(character_key, captured_at);
    CREATE INDEX IF NOT EXISTS economic_observations_record_idx
      ON economic_observations(record_id);

    CREATE TABLE IF NOT EXISTS economic_observation_outputs (
      observation_id INTEGER NOT NULL REFERENCES economic_observations(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL,
      quality_id INTEGER,
      icon_file_data_id INTEGER,
      PRIMARY KEY(observation_id, item_key)
    );

    CREATE INDEX IF NOT EXISTS economic_observation_outputs_item_idx
      ON economic_observation_outputs(item_key, observation_id);
    `);
  },
};
