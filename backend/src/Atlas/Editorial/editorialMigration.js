// The Dungeon Content Studio's tables. Editorial content is an override layer:
// nothing here is read by the atlas importer, and nothing here changes
// data/atlas.json or the other generated files.
//   atlas_editorial_drafts     one working draft per dungeon (optimistic
//                              version for concurrent editors)
//   atlas_editorial_revisions  append-only: every published document; a
//                              rollback publishes an old one again as a new
//                              revision
//   atlas_editorial_active     the revision the site and the add-on export
//                              serve per dungeon
//   atlas_editorial_audit      append-only: who did what, when
//   atlas_media                the media library's records; the image files
//                              live on disk (atlasMediaStore.js), never here
export const atlasEditorialMigration = {
  version: 26,
  name: "dungeon_content_studio",
  up(db) {
    db.exec(`
      CREATE TABLE atlas_editorial_drafts (
        instance_id INTEGER PRIMARY KEY,
        document_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        base_revision_id INTEGER,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE atlas_editorial_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('publish', 'rollback')),
        document_json TEXT NOT NULL,
        source_revision_id INTEGER,
        note TEXT NOT NULL DEFAULT '',
        lua_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        UNIQUE (instance_id, number)
      );
      CREATE TABLE atlas_editorial_active (
        instance_id INTEGER PRIMARY KEY,
        revision_id INTEGER NOT NULL REFERENCES atlas_editorial_revisions(id),
        published_at TEXT NOT NULL,
        published_by TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE atlas_editorial_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER,
        action TEXT NOT NULL,
        actor_id TEXT NOT NULL DEFAULT '',
        actor_name TEXT NOT NULL DEFAULT '',
        at TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX atlas_editorial_audit_instance_idx ON atlas_editorial_audit(instance_id, id DESC);
      CREATE TABLE atlas_media (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        original_name TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL DEFAULT 'general',
        crop_json TEXT NOT NULL DEFAULT '{}',
        variants_json TEXT NOT NULL DEFAULT '{}',
        attribution TEXT NOT NULL DEFAULT '',
        license TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        provenance TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX atlas_media_sha_idx ON atlas_media(sha256);
    `);
  },
};
