// Dungeon and raid runs from the Guildweaver addon, and which loot
// observations happened during one. Both are personal: every row names the
// account it belongs to, and nothing here is read by public views.
export const dungeonRunMigration = {
  version: 15,
  name: "dungeon_runs",
  up(db) {
    db.exec(`
      CREATE TABLE dungeon_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_key TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        installation_id TEXT NOT NULL,
        raw_character_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open', 'completed', 'interrupted', 'abandoned')),
        end_reason TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_active_at INTEGER,
        duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0),
        inside_seconds INTEGER,
        instance_name TEXT NOT NULL,
        instance_id INTEGER,
        instance_type TEXT NOT NULL,
        difficulty_id INTEGER,
        difficulty_name TEXT NOT NULL,
        max_players INTEGER,
        level_at_entry INTEGER,
        level_at_exit INTEGER,
        class_token TEXT NOT NULL,
        group_size INTEGER,
        group_max_size INTEGER,
        xp_available INTEGER NOT NULL,
        xp_at_level_cap INTEGER NOT NULL,
        xp_gained INTEGER,
        level_ups INTEGER NOT NULL DEFAULT 0,
        wallet_available INTEGER NOT NULL,
        net_copper INTEGER,
        deaths INTEGER NOT NULL,
        bosses_defeated INTEGER NOT NULL,
        bosses_total INTEGER,
        manual_splits INTEGER NOT NULL DEFAULT 0,
        encounter_events INTEGER NOT NULL,
        loot_observations INTEGER NOT NULL DEFAULT 0,
        timeline_json TEXT NOT NULL,
        timeline_truncated INTEGER NOT NULL DEFAULT 0,
        realm TEXT NOT NULL,
        region TEXT NOT NULL,
        game_build TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX dungeon_runs_member_idx ON dungeon_runs(member_id, started_at DESC);
      CREATE INDEX dungeon_runs_character_idx ON dungeon_runs(member_id, raw_character_id, started_at DESC);
      CREATE TABLE dungeon_run_loot (
        run_key TEXT NOT NULL,
        member_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('mob_loot', 'gathering')),
        observation_id INTEGER NOT NULL,
        PRIMARY KEY(run_key, source, observation_id)
      );
      CREATE INDEX dungeon_run_loot_member_idx ON dungeon_run_loot(member_id, run_key);
    `);
  },
};

// Dungeon V2: what payload schema 2 adds (checkpoints, what proved the
// clear, a multi-level XP jump), and a small per-character objective list.
// Adding nullable columns is a schema change only: no row is rewritten, so
// this is instant at startup however many runs exist.
export const dungeonRunV2Migration = {
  version: 21,
  name: "dungeon_runs_v2",
  up(db) {
    db.exec(`
      ALTER TABLE dungeon_runs ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE dungeon_runs ADD COLUMN checkpoints_json TEXT;
      ALTER TABLE dungeon_runs ADD COLUMN completion_basis TEXT;
      ALTER TABLE dungeon_runs ADD COLUMN xp_partial INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE dungeon_objectives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 140),
        position INTEGER NOT NULL,
        target_kind TEXT NOT NULL DEFAULT 'none' CHECK(target_kind IN ('none', 'boss')),
        target_name TEXT NOT NULL DEFAULT '',
        target_dungeon TEXT NOT NULL DEFAULT '',
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX dungeon_objectives_member_idx ON dungeon_objectives(member_id, character_id, position);
    `);
  },
};
