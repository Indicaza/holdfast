import { createHash } from "node:crypto";
import { array } from "../Character/Telemetry/luaList.js";
import { gameContext, gameInteger, gameText, publicItemDefinition, validGameItem } from "./publicGameDataModel.js";

function hash(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function timestamp(value) {
  const parsed = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? "1970-01-01T00:00:00.000Z" : parsed.toISOString();
}

export function learnPublicItemInDatabase(db, raw, context, { base = false, capturedAt = "" } = {}) {
  const item = publicItemDefinition(raw, { base });
  if (!item || !context.gameBuild) return;
  db.prepare(`INSERT INTO public_game_items
    (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id, game_build, locale) DO UPDATE SET
      name = CASE WHEN excluded.name NOT LIKE 'Item %' AND (public_game_items.definition_json = '{}' OR (excluded.definition_json <> '{}' AND excluded.captured_at >= public_game_items.captured_at)) THEN excluded.name ELSE public_game_items.name END,
      quality_id = CASE WHEN public_game_items.definition_json = '{}' OR (excluded.definition_json <> '{}' AND excluded.captured_at >= public_game_items.captured_at)
        THEN COALESCE(excluded.quality_id, public_game_items.quality_id) ELSE public_game_items.quality_id END,
      icon_file_id = CASE WHEN public_game_items.definition_json = '{}' OR (excluded.definition_json <> '{}' AND excluded.captured_at >= public_game_items.captured_at)
        THEN COALESCE(excluded.icon_file_id, public_game_items.icon_file_id) ELSE public_game_items.icon_file_id END,
      definition_json = CASE WHEN excluded.definition_json <> '{}' AND (public_game_items.definition_json = '{}' OR excluded.captured_at >= public_game_items.captured_at) THEN excluded.definition_json ELSE public_game_items.definition_json END,
      captured_at = CASE WHEN public_game_items.definition_json <> '{}' AND excluded.definition_json = '{}' THEN public_game_items.captured_at ELSE MAX(excluded.captured_at, public_game_items.captured_at) END
  `).run(item.itemId, context.gameBuild, context.locale, item.name, item.qualityId, item.iconFileDataId,
    base ? JSON.stringify(item) : "{}", capturedAt);
}

function position(location) {
  if (location?.coordinateSystem !== "ui_map_normalized") return { x: null, y: null };
  const valid = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  return valid(location.x) && valid(location.y) ? { x: location.x, y: location.y } : { x: null, y: null };
}

function insertLoot(db, observation, outputs) {
  const point = position(observation.location);
  const source = observation.source;
  const instance = observation.instance || {};
  db.prepare(`INSERT INTO game_loot_observations
    (observation_key, contributor_key, game_build, locale, activity, discipline, source_kind, source_id,
      source_name, instance_id, instance_name, difficulty_id, map_id, zone, x, y, position_kind, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(observation_key) DO UPDATE SET
      source_name = CASE WHEN game_loot_observations.source_name = '' THEN excluded.source_name ELSE game_loot_observations.source_name END
  `).run(observation.key, observation.contributor, observation.gameBuild, observation.locale, observation.activity,
    observation.discipline, source.kind, gameInteger(source.id, 1), gameText(source.name),
    gameInteger(instance.instanceId, 1), gameText(instance.name), gameInteger(instance.difficultyId),
    gameInteger(observation.location?.mapId, 1), gameText(observation.location?.zone), point.x, point.y,
    observation.location?.positionKind === "player_at_loot" ? "player_at_loot" : "player_at_cast", observation.capturedAt);
  const row = db.prepare("SELECT id FROM game_loot_observations WHERE observation_key = ?").get(observation.key);
  for (const output of outputs) {
    const itemId = gameInteger(output?.itemId, 1);
    const quantity = gameInteger(output?.quantity, 1, 100000);
    if (!itemId || !quantity) continue;
    learnPublicItemInDatabase(db, output, observation, { capturedAt: observation.capturedAt });
    db.prepare(`INSERT INTO game_loot_outputs (observation_id, item_id, quantity, is_quest_item) VALUES (?, ?, ?, ?)
      ON CONFLICT(observation_id, item_id) DO UPDATE SET quantity = MAX(game_loot_outputs.quantity, excluded.quantity),
        is_quest_item = MAX(game_loot_outputs.is_quest_item, excluded.is_quest_item)
    `).run(row.id, itemId, quantity, output.isQuestItem === true ? 1 : 0);
  }
  return { status: "recorded", observationId: row.id };
}

export function recordMobLootInDatabase(db, { envelope, memberId }) {
  const payload = envelope.payload;
  const context = gameContext(envelope);
  return insertLoot(db, { ...context,
    key: hash(["corpse", context.gameBuild, context.locale, envelope.region, envelope.realm, payload.source.guid]),
    contributor: hash([memberId]), activity: "corpse_loot", discipline: "loot",
    source: { kind: "creature", id: payload.source.npcId, name: payload.source.name },
    location: payload.context?.location, instance: payload.context?.instance, capturedAt: timestamp(envelope.capturedAt),
  }, payload.outputs);
}

export function recordGatheringFactsInDatabase(db, observationId, locale = "und") {
  const row = db.prepare("SELECT * FROM economic_observations WHERE id = ?").get(observationId);
  if (!row?.game_build) return;
  const outputs = db.prepare("SELECT item_id AS itemId, item_name AS name, quantity, quality_id AS qualityId, icon_file_data_id AS iconFileDataId FROM economic_observation_outputs WHERE observation_id = ?").all(row.id);
  return insertLoot(db, { gameBuild: row.game_build, locale, key: hash(["gathering", row.observation_key]),
    contributor: hash([row.member_id]), activity: row.activity, discipline: row.discipline,
    source: { kind: row.source_kind, id: row.source_object_id, name: row.source_name },
    location: { mapId: row.map_id, zone: row.zone, x: row.x, y: row.y, positionKind: row.position_kind, coordinateSystem: "ui_map_normalized" },
    capturedAt: row.captured_at,
  }, outputs);
}

function learnRecipes(db, payload, context, capturedAt) {
  for (const profession of array(payload.professions).slice(0, 12)) {
    for (const raw of array(profession?.recipes).slice(0, 800)) {
      const recipeId = gameInteger(raw?.recipeId, 1);
      const craftedItemId = gameInteger(raw?.crafted?.itemId, 1);
      if (!recipeId || !craftedItemId) continue;
      const reagents = array(raw.reagents).slice(0, 16)
        .map((entry) => ({ itemId: gameInteger(entry?.itemId, 1), quantity: gameInteger(entry?.quantity, 1, 100000), optional: entry?.required === false }))
        .filter((entry) => entry.itemId && entry.quantity);
      const previous = db.prepare("SELECT definition_json FROM public_game_recipes WHERE recipe_id = ? AND game_build = ? AND locale = ?")
        .get(recipeId, context.gameBuild, context.locale);
      if (reagents.length === 0 && previous) reagents.push(...JSON.parse(previous.definition_json).reagents);
      const recipe = { recipeId, name: gameText(raw.name) || `Recipe ${recipeId}`,
        professionId: gameInteger(profession.skillLineId, 1), professionName: gameText(profession.name, 80),
        craftedItemId, minQuantity: gameInteger(raw.crafted.minQuantity, 1, 100000), maxQuantity: gameInteger(raw.crafted.maxQuantity, 1, 100000),
        requiredLevel: gameInteger(raw.requiredLevel), reagents };
      const result = db.prepare(`INSERT INTO public_game_recipes
        (recipe_id, game_build, locale, crafted_item_id, name, definition_json, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(recipe_id, game_build, locale) DO UPDATE SET crafted_item_id = excluded.crafted_item_id,
          name = excluded.name, definition_json = excluded.definition_json, captured_at = excluded.captured_at
        WHERE excluded.captured_at >= public_game_recipes.captured_at
      `).run(recipeId, context.gameBuild, context.locale, craftedItemId, recipe.name, JSON.stringify(recipe), capturedAt);
      if (!result.changes) continue;
      db.prepare("DELETE FROM public_game_recipe_reagents WHERE recipe_id = ? AND game_build = ? AND locale = ?").run(recipeId, context.gameBuild, context.locale);
      for (const [slot, entry] of reagents.entries()) db.prepare(`INSERT INTO public_game_recipe_reagents
        (recipe_id, game_build, locale, slot, item_id, quantity) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(recipeId, context.gameBuild, context.locale, slot, entry.itemId, entry.quantity);
      for (const item of [raw.crafted, ...(raw.reagents || [])]) learnPublicItemInDatabase(db, item, context, { capturedAt });
    }
  }
}

export function projectPublicGameDataInDatabase(db, { eventType, envelope, payload = envelope.payload }) {
  const context = gameContext(envelope);
  if (!context.gameBuild) return;
  const capturedAt = timestamp(envelope.capturedAt);
  if (eventType === "game_item_definition" && validGameItem({ kind: "state", envelope: { ...envelope, payload },
    payloadSchemaVersion: envelope.payloadSchemaVersion ?? payload.schemaVersion })) {
    learnPublicItemInDatabase(db, payload.item, context, { base: true, capturedAt });
  }
  if (eventType === "profession_snapshot") learnRecipes(db, payload, context, capturedAt);
}
