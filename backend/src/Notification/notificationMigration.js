export const notificationMigration = {
  version: 7,
  name: "member_notifications",
  up(db) {
    db.exec(`
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        recipient_member_id TEXT NOT NULL
          REFERENCES members(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('action', 'update')),
        title TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        href TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        dedupe_key TEXT,
        read_at TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX notifications_recipient_created_idx
        ON notifications(recipient_member_id, created_at DESC);

      CREATE INDEX notifications_recipient_attention_idx
        ON notifications(recipient_member_id, resolved_at, read_at, created_at DESC);

      CREATE UNIQUE INDEX notifications_open_dedupe_idx
        ON notifications(recipient_member_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;
    `);
  },
};
