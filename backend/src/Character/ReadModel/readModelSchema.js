// The character read model: what the website shows for a character, kept
// current as telemetry arrives instead of reassembled from raw history on
// every request.
//
//   character_sections    one row per character and section (identity, stats,
//                         equipment, talents, professions, profession_books,
//                         inventory). Every telemetry stream projects into
//                         the sections it describes; per section, the newest
//                         capture wins, whichever stream it came from.
//   character_cards       the character list's columns, materialized from the
//                         sections whenever one changes.
//   talent_tree_definitions
//                         talent tree layouts by tree, kept apart from the raw
//                         records (which are pruned) so talents never vanish.
//
// The model can always be rebuilt from stored telemetry (rebuildReadModel.js).
// Its tables are disposable: a rebuild drops and recreates them, so a change
// to their shape ships as a READ_MODEL_VERSION bump and rebuilds on the next
// start.

export const READ_MODEL_VERSION = 3;

const READ_MODEL_TABLES = ["character_sections", "character_cards", "talent_tree_definitions"];

export function dropCharacterReadModelTables(db) {
  for (const table of READ_MODEL_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
}

export const SECTIONS = Object.freeze([
  "identity",
  "stats",
  "equipment",
  "talents",
  "professions",
  "profession_books",
  "inventory",
]);

export function ensureCharacterReadModelSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_sections (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      source TEXT NOT NULL,
      source_record_id INTEGER,
      source_revision INTEGER,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(character_id, section)
    );

    CREATE TABLE IF NOT EXISTS character_cards (
      character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      race TEXT NOT NULL DEFAULT '',
      class_name TEXT NOT NULL DEFAULT '',
      spec TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 0,
      realm TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      guild_name TEXT NOT NULL DEFAULT '',
      organization_name TEXT NOT NULL DEFAULT '',
      professions_json TEXT NOT NULL DEFAULT '[]',
      known_recipe_count INTEGER NOT NULL DEFAULT 0,
      vitals_json TEXT NOT NULL DEFAULT 'null',
      last_seen_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS character_cards_seen_idx
      ON character_cards(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS character_cards_member_idx
      ON character_cards(member_id);

    CREATE TABLE IF NOT EXISTS talent_tree_definitions (
      tree_id INTEGER NOT NULL,
      class_token TEXT NOT NULL DEFAULT '',
      game_build TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(tree_id, class_token, game_build)
    );

    CREATE INDEX IF NOT EXISTS talent_tree_definitions_tree_idx
      ON talent_tree_definitions(tree_id, received_at DESC);

    CREATE TABLE IF NOT EXISTS character_read_model_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
