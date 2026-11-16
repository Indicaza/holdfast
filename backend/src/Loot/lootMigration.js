// Dungeon loot catalog, character wishlists and group-roll evidence.
//
// The catalog is a projection of evidence that is stored elsewhere or in
// the snapshot table here, and it never forgets:
//   dungeon_loot_entries    one row per dungeon, difficulty, source, item
//                           and provenance (where the claim comes from),
//                           with first and last sighting, the game builds,
//                           an evidence count and the catalog revision of
//                           its last status change. Rows are marked removed,
//                           never deleted.
//   dungeon_loot_changes    append-only: what each catalog revision changed.
//   dungeon_loot_snapshots  every loot table a client enumerated (Encounter
//                           Journal), kept whole, so a later snapshot can be
//                           compared with the one it replaces.
//   loot_roll_events        a group roll one player saw: private (it names
//                           the account), and never counted as a drop from
//                           a creature or as an item the player received.
// Wishlists are personal: every row names its account and character.
export const dungeonLootMigration = {
  version: 23,
  name: "dungeon_loot_catalog_and_wishlists",
  up(db) {
    db.exec(`
      CREATE TABLE dungeon_loot_instances (
        instance_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        instance_type TEXT NOT NULL DEFAULT '',
        journal_instance_id INTEGER,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE dungeon_loot_entries (
        id INTEGER PRIMARY KEY,
        instance_id INTEGER NOT NULL,
        difficulty_id INTEGER NOT NULL DEFAULT 0,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('creature', 'encounter', 'instance')),
        source_id INTEGER NOT NULL DEFAULT 0,
        source_name TEXT NOT NULL DEFAULT '',
        item_id INTEGER NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN ('loot_window', 'group_roll', 'encounter_journal', 'external')),
        evidence_count INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        first_build TEXT NOT NULL DEFAULT '',
        last_build TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'removed')),
        removed_at TEXT,
        revision INTEGER NOT NULL,
        UNIQUE(instance_id, difficulty_id, source_kind, source_id, item_id, provenance)
      );
      CREATE INDEX dungeon_loot_entries_item_idx ON dungeon_loot_entries(item_id, instance_id);
      CREATE INDEX dungeon_loot_entries_source_idx ON dungeon_loot_entries(instance_id, source_kind, source_id);
      CREATE TABLE dungeon_loot_changes (
        id INTEGER PRIMARY KEY,
        revision INTEGER NOT NULL,
        changed_at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('new_item', 'new_source', 'observed', 'advertised_added', 'potentially_removed', 'restored', 'conflict')),
        instance_id INTEGER NOT NULL,
        difficulty_id INTEGER NOT NULL DEFAULT 0,
        source_kind TEXT NOT NULL,
        source_id INTEGER NOT NULL DEFAULT 0,
        source_name TEXT NOT NULL DEFAULT '',
        item_id INTEGER,
        provenance TEXT NOT NULL,
        game_build TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX dungeon_loot_changes_instance_idx ON dungeon_loot_changes(instance_id, id DESC);
      CREATE INDEX dungeon_loot_changes_revision_idx ON dungeon_loot_changes(revision);
      CREATE TABLE dungeon_loot_snapshots (
        id INTEGER PRIMARY KEY,
        snapshot_key TEXT NOT NULL UNIQUE,
        contributor_key TEXT NOT NULL,
        instance_id INTEGER NOT NULL,
        journal_instance_id INTEGER,
        difficulty_id INTEGER NOT NULL DEFAULT 0,
        encounter_id INTEGER NOT NULL,
        encounter_name TEXT NOT NULL DEFAULT '',
        game_build TEXT NOT NULL,
        source_api TEXT NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0, 1)),
        item_count INTEGER NOT NULL,
        items_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX dungeon_loot_snapshots_scope_idx ON dungeon_loot_snapshots(instance_id, difficulty_id, encounter_id, captured_at DESC);
      CREATE TABLE loot_roll_events (
        id INTEGER PRIMARY KEY,
        roll_key TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        raw_character_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        instance_id INTEGER,
        difficulty_id INTEGER,
        source_npc_id INTEGER,
        encounter_id INTEGER,
        game_build TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL DEFAULT 'offered' CHECK(outcome IN ('offered', 'won', 'not_won')),
        acquired_basis TEXT NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX loot_roll_events_member_idx ON loot_roll_events(member_id, raw_character_id, item_id, started_at DESC);
      CREATE TABLE character_wishlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        variant_key TEXT NOT NULL DEFAULT '',
        item_key TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('high', 'normal', 'low')),
        note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 140),
        source_dungeon TEXT NOT NULL DEFAULT '',
        source_instance_id INTEGER,
        origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'ai_import')),
        state TEXT NOT NULL DEFAULT 'wanted' CHECK(state IN ('wanted', 'acquired')),
        acquired_at INTEGER,
        acquired_basis TEXT NOT NULL DEFAULT '',
        owned_baseline INTEGER NOT NULL DEFAULT 0,
        wanted_since INTEGER NOT NULL,
        position INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(member_id, character_id, item_key)
      );
      CREATE INDEX character_wishlist_items_character_idx ON character_wishlist_items(member_id, character_id, position);
      -- character_id '' is the account's own counter: it moves whenever any
      -- of the account's wishlists does, so the bridge can tell from one
      -- number that something changed.
      CREATE TABLE character_wishlist_revisions (
        member_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(member_id, character_id)
      );
    `);

    // What is already known: dungeons players ran, and creature loot seen
    // inside them. Open-world loot carries a continent as its instance id,
    // so only instances that a recorded dungeon or raid run names count.
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO dungeon_loot_instances (instance_id, name, instance_type, first_seen_at, last_seen_at)
      SELECT instance_id, MAX(instance_name), MAX(instance_type), ?, ? FROM dungeon_runs
      WHERE instance_id IS NOT NULL AND instance_id > 0 AND instance_type IN ('party', 'raid') GROUP BY instance_id`).run(now, now);
    const backfilled = db.prepare(`INSERT OR IGNORE INTO dungeon_loot_entries
      (instance_id, difficulty_id, source_kind, source_id, source_name, item_id, provenance, evidence_count,
        first_seen_at, last_seen_at, first_build, last_build, status, revision)
      SELECT o.instance_id, COALESCE(o.difficulty_id, 0), 'creature', o.source_id, MAX(o.source_name), out.item_id, 'loot_window', COUNT(*),
        MIN(o.captured_at), MAX(o.captured_at), MIN(o.game_build), MAX(o.game_build), 'active', 1
      FROM game_loot_outputs out JOIN game_loot_observations o ON o.id = out.observation_id
      WHERE o.activity = 'corpse_loot' AND o.source_kind = 'creature' AND o.source_id IS NOT NULL
        AND o.instance_id IN (SELECT instance_id FROM dungeon_loot_instances)
      GROUP BY o.instance_id, COALESCE(o.difficulty_id, 0), o.source_id, out.item_id`).run();
    // The catalog's revision counter starts with the first thing it holds;
    // a database with no dungeon loot is left exactly as it was.
    if (backfilled.changes > 0) {
      db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('dungeon_loot_revision', '1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(now);
    }
  },
};
