import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ensureRecipeStoreSchema, replaceCharacterRecipesInDatabase } from "../src/Character/recipeStore.js";

function legacyDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE characters (id TEXT PRIMARY KEY);
    CREATE TABLE character_snapshots (id INTEGER PRIMARY KEY);
    INSERT INTO characters VALUES ('a'), ('b');
    CREATE TABLE telemetry_recipes (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE, recipe_key TEXT NOT NULL, recipe_id INTEGER, name TEXT NOT NULL,
      profession_key TEXT NOT NULL DEFAULT '', profession_id INTEGER, profession_name TEXT NOT NULL DEFAULT '', icon_file_id INTEGER,
      known INTEGER NOT NULL DEFAULT 1, required_skill INTEGER, requirements_json TEXT NOT NULL DEFAULT 'null', crafted_item_id INTEGER,
      crafted_item_name TEXT NOT NULL DEFAULT '', reagents_json TEXT NOT NULL DEFAULT '[]', snapshot_id INTEGER, PRIMARY KEY(character_id, recipe_key));
    CREATE INDEX telemetry_recipes_name_idx ON telemetry_recipes(name);
  `);
  const insert = db.prepare("INSERT INTO telemetry_recipes VALUES (?, ?, ?, ?, 'id:197', 197, 'Tailoring', 1, ?, 50, 'null', ?, ?, ?, NULL)");
  insert.run("a", "id:2963", 2963, "Bolt of Linen Cloth", 1, 2996, "Bolt of Linen Cloth", '[{"itemId":2589,"quantity":2}]');
  insert.run("b", "id:2963", 2963, "Bolt of Linen Cloth", 1, 2996, "Bolt of Linen Cloth", '[{"itemId":2589,"quantity":2}]');
  insert.run("b", "id:3915", 3915, "Brown Linen Shirt", 0, 4344, "Brown Linen Shirt", '[{"itemId":2996,"quantity":1}]');
  return db;
}

const all = (db) => db.prepare("SELECT * FROM telemetry_recipes ORDER BY character_id, recipe_key").all();

test("a database from before the split converts losslessly and the view reads the same rows", () => {
  const db = legacyDatabase();
  const before = all(db);
  ensureRecipeStoreSchema(db);
  assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name = 'telemetry_recipes'").get().type, "view");
  assert.deepEqual(all(db), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM telemetry_recipe_definitions").get().n, 2, "one definition per recipe");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM telemetry_character_recipes").get().n, 3);
  ensureRecipeStoreSchema(db);
  assert.deepEqual(all(db), before, "running it again changes nothing");
});

test("replacing a character's recipes shares definitions and keeps ownership per character", () => {
  const db = legacyDatabase();
  ensureRecipeStoreSchema(db);
  const recipe = { key: "id:2963", id: 2963, name: "Bolt of Linen Cloth", professionKey: "id:197", professionId: 197, professionName: "Tailoring",
    iconFileId: 1, known: true, requiredSkill: 50, requirementsJson: "null", craftedItemId: 2996, craftedItemName: "Bolt of Linen Cloth",
    reagentsJson: '[{"itemId":2589,"quantity":3}]' };
  replaceCharacterRecipesInDatabase(db, "a", [recipe]);
  const rows = all(db);
  assert.deepEqual(rows.map((row) => [row.character_id, row.recipe_key, row.known]), [["a", "id:2963", 1], ["b", "id:2963", 1], ["b", "id:3915", 0]]);
  assert.ok(rows.every((row) => row.recipe_key !== "id:2963" || row.reagents_json.includes('"quantity":3')), "the newest definition is shared");
  replaceCharacterRecipesInDatabase(db, "b", []);
  assert.deepEqual(all(db).map((row) => row.character_id), ["a"], "a character's recipes are replaced, others untouched");
  db.prepare("DELETE FROM characters WHERE id = 'a'").run();
  db.exec("PRAGMA foreign_keys = ON");
});
