// Turns the telemetry_recipes view back into the table that releases from
// before November 13, 2026 (before PR #284) expect. Run it only when rolling
// the application back past that release: old code fails on the view
// ("views may not be indexed" / "cannot modify ... because it is a view").
//
// Self-contained (node:sqlite only) so it runs in any release's image:
//
//   ssh <service> 'node --input-type=module - /data/holdfast.sqlite' < backend/scripts/restoreRecipeTable.js
//
// Reads the view and writes the table in one transaction; nothing is
// deleted (the split tables stay, unused by old releases). Running it twice,
// or on a database that was never split, changes nothing.
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2] || `${process.env.GUILD_DATA_DIR || "/data"}/holdfast.sqlite`;
const db = new DatabaseSync(file);
try {
  db.exec("PRAGMA busy_timeout = 5000");
  const type = db.prepare("SELECT type FROM sqlite_master WHERE name = 'telemetry_recipes'").get()?.type;
  if (type !== "view") {
    console.log(JSON.stringify({ status: type === "table" ? "already_table" : "nothing_to_restore" }));
  } else {
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = db.prepare("SELECT COUNT(*) AS n FROM telemetry_recipes").get().n;
      db.exec(`
        CREATE TABLE telemetry_recipes_legacy (
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          recipe_key TEXT NOT NULL,
          recipe_id INTEGER,
          name TEXT NOT NULL,
          profession_key TEXT NOT NULL DEFAULT '',
          profession_id INTEGER,
          profession_name TEXT NOT NULL DEFAULT '',
          icon_file_id INTEGER,
          known INTEGER NOT NULL DEFAULT 1 CHECK (known IN (0, 1)),
          required_skill INTEGER,
          requirements_json TEXT NOT NULL DEFAULT 'null',
          crafted_item_id INTEGER,
          crafted_item_name TEXT NOT NULL DEFAULT '',
          reagents_json TEXT NOT NULL DEFAULT '[]',
          snapshot_id INTEGER REFERENCES character_snapshots(id) ON DELETE SET NULL,
          PRIMARY KEY(character_id, recipe_key)
        );
        INSERT INTO telemetry_recipes_legacy (character_id, recipe_key, recipe_id, name, profession_key, profession_id, profession_name,
            icon_file_id, known, required_skill, requirements_json, crafted_item_id, crafted_item_name, reagents_json, snapshot_id)
          SELECT character_id, recipe_key, recipe_id, name, profession_key, profession_id, profession_name,
            icon_file_id, known, required_skill, requirements_json, crafted_item_id, crafted_item_name, reagents_json, snapshot_id
          FROM telemetry_recipes;
        DROP VIEW telemetry_recipes;
        ALTER TABLE telemetry_recipes_legacy RENAME TO telemetry_recipes;
        CREATE INDEX telemetry_recipes_name_idx ON telemetry_recipes(name COLLATE NOCASE, known, profession_name COLLATE NOCASE);
        CREATE INDEX telemetry_recipes_item_idx ON telemetry_recipes(crafted_item_id, known);
        CREATE INDEX telemetry_recipes_profession_idx ON telemetry_recipes(profession_key, known, name COLLATE NOCASE);
      `);
      const restored = db.prepare("SELECT COUNT(*) AS n FROM telemetry_recipes").get().n;
      if (restored !== rows) throw new Error(`restored ${restored} of ${rows} rows`);
      db.exec("COMMIT");
      console.log(JSON.stringify({ status: "restored", rows }));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error(`Recipe table restore failed, nothing changed: ${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
