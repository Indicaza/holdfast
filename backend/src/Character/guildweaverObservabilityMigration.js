export const guildweaverObservabilityMigration = {
  version: 8,
  name: "guildweaver_snapshot_observability",
  up(db) {
    db.exec(`
      ALTER TABLE character_snapshots
        ADD COLUMN received_at TEXT NOT NULL DEFAULT '';

      ALTER TABLE character_snapshots
        ADD COLUMN bridge_revision INTEGER;

      ALTER TABLE character_snapshots
        ADD COLUMN device_id TEXT NOT NULL DEFAULT '';

      UPDATE character_snapshots
      SET received_at = captured_at
      WHERE received_at = '';

      CREATE INDEX character_snapshots_received_idx
        ON character_snapshots(received_at DESC, id DESC);

      CREATE INDEX character_snapshots_device_received_idx
        ON character_snapshots(device_id, received_at DESC)
        WHERE device_id <> '';
    `);
  },
};
