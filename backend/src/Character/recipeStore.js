// Known recipes, stored once per recipe instead of once per character.
//
//   telemetry_recipe_definitions  what a recipe is: name, profession, icon,
//                                 skill, requirements, product, reagents.
//                                 One row per recipe key, newest capture wins.
//   telemetry_character_recipes   who knows it: character, recipe, profession,
//                                 known flag, source snapshot.
//   telemetry_recipes (view)      the two joined, in the shape of the table
//                                 they replace, so readers are unchanged.
//
// Every character used to repeat each recipe's definition (7,616 rows for
// 1,959 recipes on the development copy; reagents alone were 1,890 duplicates
// of 2,748 large values).

const DEFINITION_COLUMNS = `recipe_key, recipe_id, name, profession_key, profession_id, profession_name, icon_file_id, required_skill,
  requirements_json, crafted_item_id, crafted_item_name, reagents_json`;

export function ensureRecipeStoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_recipe_definitions (
      recipe_key TEXT PRIMARY KEY,
      recipe_id INTEGER,
      name TEXT NOT NULL,
      profession_key TEXT NOT NULL DEFAULT '',
      profession_id INTEGER,
      profession_name TEXT NOT NULL DEFAULT '',
      icon_file_id INTEGER,
      required_skill INTEGER,
      requirements_json TEXT NOT NULL DEFAULT 'null',
      crafted_item_id INTEGER,
      crafted_item_name TEXT NOT NULL DEFAULT '',
      reagents_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telemetry_character_recipes (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      recipe_key TEXT NOT NULL,
      profession_key TEXT NOT NULL DEFAULT '',
      known INTEGER NOT NULL DEFAULT 1 CHECK (known IN (0, 1)),
      snapshot_id INTEGER REFERENCES character_snapshots(id) ON DELETE SET NULL,
      PRIMARY KEY(character_id, recipe_key)
    );
    CREATE INDEX IF NOT EXISTS telemetry_recipe_definitions_name_idx
      ON telemetry_recipe_definitions(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS telemetry_recipe_definitions_item_idx
      ON telemetry_recipe_definitions(crafted_item_id);
    CREATE INDEX IF NOT EXISTS telemetry_character_recipes_recipe_idx
      ON telemetry_character_recipes(recipe_key, known);
  `);
  const existing = db.prepare("SELECT type FROM sqlite_master WHERE name = 'telemetry_recipes'").get()?.type;
  if (existing === "table") {
    // A database from before the split: move every row, then replace the
    // table with the view. Lossless; definitions keep the newest row.
    db.exec("SAVEPOINT recipe_store_split");
    try {
      db.exec(`
        INSERT OR REPLACE INTO telemetry_recipe_definitions (${DEFINITION_COLUMNS}, updated_at)
          SELECT ${DEFINITION_COLUMNS}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM telemetry_recipes ORDER BY rowid;
        INSERT OR REPLACE INTO telemetry_character_recipes (character_id, recipe_key, profession_key, known, snapshot_id)
          SELECT character_id, recipe_key, profession_key, known, snapshot_id FROM telemetry_recipes;
        DROP TABLE telemetry_recipes;
      `);
      db.exec("RELEASE recipe_store_split");
    } catch (error) {
      db.exec("ROLLBACK TO recipe_store_split; RELEASE recipe_store_split");
      throw error;
    }
  }
  if (existing !== "view") {
    db.exec(`
      CREATE VIEW IF NOT EXISTS telemetry_recipes AS
        SELECT r.character_id, r.recipe_key, d.recipe_id, d.name, r.profession_key, d.profession_id, d.profession_name, d.icon_file_id,
          r.known, d.required_skill, d.requirements_json, d.crafted_item_id, d.crafted_item_name, d.reagents_json, r.snapshot_id
        FROM telemetry_character_recipes r JOIN telemetry_recipe_definitions d ON d.recipe_key = r.recipe_key
    `);
  }
}

// Replaces a character's recipes. `recipes` are rows in the old table's
// shape (camelCase), as both projectors produce them.
export function replaceCharacterRecipesInDatabase(db, characterId, recipes, { snapshotId = null } = {}) {
  db.prepare("DELETE FROM telemetry_character_recipes WHERE character_id = ?").run(characterId);
  const now = new Date().toISOString();
  const define = db.prepare(`INSERT INTO telemetry_recipe_definitions (${DEFINITION_COLUMNS}, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(recipe_key) DO UPDATE SET recipe_id = excluded.recipe_id, name = excluded.name, profession_key = excluded.profession_key,
      profession_id = excluded.profession_id, profession_name = excluded.profession_name, icon_file_id = excluded.icon_file_id,
      required_skill = excluded.required_skill, requirements_json = excluded.requirements_json, crafted_item_id = excluded.crafted_item_id,
      crafted_item_name = excluded.crafted_item_name, reagents_json = excluded.reagents_json, updated_at = excluded.updated_at
    WHERE (recipe_id, name, profession_key, profession_id, profession_name, icon_file_id, required_skill, requirements_json,
        crafted_item_id, crafted_item_name, reagents_json)
      IS NOT (excluded.recipe_id, excluded.name, excluded.profession_key, excluded.profession_id, excluded.profession_name, excluded.icon_file_id,
        excluded.required_skill, excluded.requirements_json, excluded.crafted_item_id, excluded.crafted_item_name, excluded.reagents_json)`);
  const own = db.prepare(`INSERT OR REPLACE INTO telemetry_character_recipes (character_id, recipe_key, profession_key, known, snapshot_id)
    VALUES (?, ?, ?, ?, ?)`);
  for (const recipe of recipes) {
    define.run(recipe.key, recipe.id, recipe.name, recipe.professionKey, recipe.professionId, recipe.professionName, recipe.iconFileId,
      recipe.requiredSkill, recipe.requirementsJson, recipe.craftedItemId, recipe.craftedItemName, recipe.reagentsJson, now);
    own.run(characterId, recipe.key, recipe.professionKey, recipe.known ? 1 : 0, snapshotId);
  }
}
