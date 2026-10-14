export const publicGameDataMigration = {
  version: 11,
  name: "public_game_facts_and_mob_loot",
  up(db) {
    db.exec(`
      CREATE TABLE public_game_items (
        item_id INTEGER NOT NULL,
        game_build TEXT NOT NULL,
        locale TEXT NOT NULL,
        name TEXT NOT NULL,
        quality_id INTEGER,
        icon_file_id INTEGER,
        definition_json TEXT NOT NULL DEFAULT '{}',
        captured_at TEXT NOT NULL,
        PRIMARY KEY(item_id, game_build, locale)
      );
      CREATE INDEX public_game_items_search_idx ON public_game_items(game_build, locale, name COLLATE NOCASE, item_id);
      CREATE INDEX public_game_items_icon_idx ON public_game_items(icon_file_id);
      CREATE TABLE public_game_recipes (
        recipe_id INTEGER NOT NULL,
        game_build TEXT NOT NULL,
        locale TEXT NOT NULL,
        crafted_item_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY(recipe_id, game_build, locale)
      );
      CREATE INDEX public_game_recipes_output_idx ON public_game_recipes(crafted_item_id, game_build, locale);
      CREATE TABLE public_game_recipe_reagents (
        recipe_id INTEGER NOT NULL,
        game_build TEXT NOT NULL,
        locale TEXT NOT NULL,
        slot INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY(recipe_id, game_build, locale, slot),
        FOREIGN KEY(recipe_id, game_build, locale) REFERENCES public_game_recipes(recipe_id, game_build, locale) ON DELETE CASCADE
      );
      CREATE INDEX public_game_reagents_item_idx ON public_game_recipe_reagents(item_id, game_build, locale);
      CREATE TABLE game_loot_observations (
        id INTEGER PRIMARY KEY,
        observation_key TEXT NOT NULL UNIQUE,
        contributor_key TEXT NOT NULL,
        game_build TEXT NOT NULL,
        locale TEXT NOT NULL,
        activity TEXT NOT NULL,
        discipline TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id INTEGER,
        source_name TEXT NOT NULL,
        instance_id INTEGER,
        instance_name TEXT NOT NULL,
        difficulty_id INTEGER,
        map_id INTEGER,
        zone TEXT NOT NULL,
        x REAL,
        y REAL,
        position_kind TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE game_loot_outputs (
        observation_id INTEGER NOT NULL REFERENCES game_loot_observations(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        is_quest_item INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(observation_id, item_id)
      );
      CREATE INDEX game_loot_outputs_item_idx ON game_loot_outputs(item_id, observation_id);
    `);
  },
};
