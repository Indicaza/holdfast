export const farmingSessionMigration = {
  version: 10,
  name: "farming_sessions_and_map_context",
  up(db) {
    db.exec(`
      ALTER TABLE economic_observations ADD COLUMN farming_session_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE economic_observations ADD COLUMN realm TEXT NOT NULL DEFAULT '';
      ALTER TABLE economic_observations ADD COLUMN region TEXT NOT NULL DEFAULT '';
      ALTER TABLE economic_observations ADD COLUMN position_kind TEXT NOT NULL DEFAULT 'player_at_cast';
      CREATE INDEX economic_observations_session_idx ON economic_observations(farming_session_key);
      CREATE INDEX economic_observations_map_idx ON economic_observations(source_key, map_id, realm, game_build);
      CREATE TABLE farming_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        installation_id TEXT NOT NULL,
        raw_character_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('automatic', 'manual')),
        status TEXT NOT NULL CHECK(status IN ('open', 'complete')),
        end_reason TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_seconds REAL NOT NULL CHECK(duration_seconds >= 0),
        afk_seconds REAL,
        gathering_count INTEGER NOT NULL,
        zone TEXT NOT NULL,
        map_id INTEGER,
        realm TEXT NOT NULL,
        region TEXT NOT NULL,
        game_build TEXT NOT NULL,
        class_token TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX farming_sessions_recent_idx ON farming_sessions(started_at DESC);
      CREATE INDEX farming_sessions_context_idx ON farming_sessions(realm, game_build, mode, started_at DESC);
    `);
  },
};
