// Tables the Guildweaver integration and the game data catalog used to create
// on first use. IF NOT EXISTS keeps this a no-op where they already exist.
export const guildweaverTablesMigration = {
  version: 8,
  name: "guildweaver_and_game_data_tables",
  up(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_pairings (
      id TEXT PRIMARY KEY,
      device_code_hash TEXT NOT NULL UNIQUE,
      user_code TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed')),
      member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT '',
      consumed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS guildweaver_pairings_expiry_idx
      ON guildweaver_pairings(status, expires_at);

    CREATE TABLE IF NOT EXISTS guildweaver_devices (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS guildweaver_devices_member_idx
      ON guildweaver_devices(member_id, revoked_at, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      stream_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('state', 'event')),
      revision INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      domain TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      character_id TEXT NOT NULL DEFAULT '',
      installation_id TEXT NOT NULL DEFAULT '',
      realm TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      UNIQUE(device_id, stream_key, revision),
      UNIQUE(idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_received_idx
      ON guildweaver_telemetry_records(received_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_domain_idx
      ON guildweaver_telemetry_records(domain, received_at DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_character_idx
      ON guildweaver_telemetry_records(character_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_device_idx
      ON guildweaver_telemetry_records(device_id, received_at DESC);

    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_stream_heads (
      device_id TEXT NOT NULL,
      stream_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(device_id, stream_key)
    );

    CREATE TABLE IF NOT EXISTS guildweaver_telemetry_latest_state (
      state_key TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      raw_character_id TEXT NOT NULL DEFAULT '',
      canonical_character_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      handler_name TEXT NOT NULL,
      stream_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      envelope_schema_version INTEGER NOT NULL,
      payload_schema_version INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      record_id INTEGER,
      envelope_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_latest_character_idx
      ON guildweaver_telemetry_latest_state(raw_character_id, event_type);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_latest_canonical_idx
      ON guildweaver_telemetry_latest_state(canonical_character_id, event_type);
    CREATE INDEX IF NOT EXISTS guildweaver_telemetry_latest_received_idx
      ON guildweaver_telemetry_latest_state(received_at DESC);

    CREATE TABLE IF NOT EXISTS guildweaver_character_aliases (
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL DEFAULT '',
      installation_id TEXT NOT NULL DEFAULT '',
      raw_character_id TEXT NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      character_name TEXT NOT NULL DEFAULT '',
      realm TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(member_id, device_id, raw_character_id)
    );

    CREATE INDEX IF NOT EXISTS guildweaver_character_aliases_character_idx
      ON guildweaver_character_aliases(character_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_character_aliases_raw_idx
      ON guildweaver_character_aliases(member_id, raw_character_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS game_data_catalog (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      game_build TEXT NOT NULL DEFAULT '',
      locale TEXT NOT NULL DEFAULT 'en_US',
      name TEXT NOT NULL DEFAULT '',
      icon_file_id INTEGER,
      quality_id INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'telemetry',
      source_priority INTEGER NOT NULL DEFAULT 20,
      observed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id, game_build, locale)
    );

    CREATE INDEX IF NOT EXISTS game_data_catalog_lookup_idx
      ON game_data_catalog(entity_type, entity_id, locale, game_build);
    CREATE INDEX IF NOT EXISTS game_data_catalog_source_idx
      ON game_data_catalog(source, updated_at DESC);
    `);
  },
};
