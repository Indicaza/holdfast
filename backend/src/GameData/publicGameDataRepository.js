import { withGuildDatabase } from "../Data/database.js";
import { gameInteger, gameText, publicItemDefinition } from "./publicGameDataModel.js";

function itemFromRow(row) {
  const detail = publicItemDefinition(JSON.parse(row.definition_json), { base: row.definition_json !== "{}" }) || {};
  return { ...detail, itemId: row.item_id, name: gameText(row.name), qualityId: row.quality_id,
    iconFileDataId: row.icon_file_id, gameBuild: row.game_build, locale: row.locale };
}

export function publicGameScopes() {
  return withGuildDatabase((db) => ({ schemaVersion: 1, scopes: db.prepare(`SELECT game_build AS gameBuild, locale,
    (SELECT COUNT(DISTINCT available.item_id) FROM public_game_items available
      WHERE available.game_build = item.game_build AND available.locale IN (item.locale, 'und')) AS itemCount
    FROM public_game_items item WHERE locale <> 'und' OR NOT EXISTS (
      SELECT 1 FROM public_game_items localized WHERE localized.game_build = item.game_build AND localized.locale <> 'und'
    ) GROUP BY game_build, locale ORDER BY MAX(captured_at) DESC, game_build DESC, locale LIMIT 100`).all() }));
}

export function searchPublicItems({ gameBuild, locale, q = "", after = 0, limit = 40 }) {
  return withGuildDatabase((db) => {
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db.prepare(`SELECT * FROM public_game_items WHERE game_build = ? AND locale IN (?, 'und') AND item_id > ?
      AND (locale = ? OR NOT EXISTS (SELECT 1 FROM public_game_items localized
        WHERE localized.game_build = public_game_items.game_build AND localized.item_id = public_game_items.item_id AND localized.locale = ?))
      AND (? = '' OR name LIKE ? ESCAPE '\\' OR CAST(item_id AS TEXT) = ?) ORDER BY item_id LIMIT ?`)
      .all(gameBuild, locale, after, locale, locale, q, pattern, q, limit + 1);
    return { schemaVersion: 1, gameBuild, locale, items: rows.slice(0, limit).map(itemFromRow),
      nextAfter: rows.length > limit ? rows[limit - 1].item_id : null };
  });
}

function recipeFromRow(row) {
  const raw = JSON.parse(row.definition_json);
  return { recipeId: gameInteger(raw.recipeId, 1), name: gameText(raw.name), professionId: gameInteger(raw.professionId, 1),
    professionName: gameText(raw.professionName), craftedItemId: gameInteger(raw.craftedItemId, 1),
    minQuantity: gameInteger(raw.minQuantity, 1), maxQuantity: gameInteger(raw.maxQuantity, 1), requiredLevel: gameInteger(raw.requiredLevel),
    reagents: (Array.isArray(raw.reagents) ? raw.reagents : []).slice(0, 16).map((entry) => ({ itemId: gameInteger(entry.itemId, 1),
      quantity: gameInteger(entry.quantity, 1), optional: entry.optional === true })).filter((entry) => entry.itemId && entry.quantity) };
}

function localizedSourceLabel(column) {
  return `COALESCE(MAX(CASE WHEN json_valid(o.${column}) THEN json_extract(o.${column}, '$.' || ?)
    WHEN o.locale = ? THEN o.${column} END), MAX(CASE WHEN NOT json_valid(o.${column}) THEN o.${column} END), '')`;
}

function sourcesForItem(db, itemId, gameBuild, locale) {
  return db.prepare(`SELECT o.activity, o.discipline, o.source_kind AS kind, o.source_id AS sourceId,
    ${localizedSourceLabel("source_name")} AS name, o.instance_id AS instanceId, ${localizedSourceLabel("instance_name")} AS instanceName, o.difficulty_id AS difficultyId,
    o.map_id AS mapId, ${localizedSourceLabel("zone")} AS zone, COUNT(*) AS observations, SUM(out.quantity) AS observedQuantity,
    MAX(out.is_quest_item) AS questLootObserved
    FROM game_loot_outputs out JOIN game_loot_observations o ON o.id = out.observation_id
    WHERE out.item_id = ? AND o.game_build = ? AND o.locale IN (?, 'und')
    GROUP BY o.activity, o.discipline, o.source_kind, o.source_id, CASE WHEN o.source_id IS NULL THEN o.source_name ELSE '' END,
      o.instance_id, o.difficulty_id, o.map_id
    ORDER BY observations DESC, sourceId, name LIMIT 51`).all(locale, locale, locale, locale, locale, locale, itemId, gameBuild, locale);
}

function locationsForItem(db, itemId, gameBuild, locale) {
  return db.prepare(`SELECT o.activity, o.discipline, o.source_kind AS kind, o.source_id AS sourceId,
    o.map_id AS mapId, o.instance_id AS instanceId, o.difficulty_id AS difficultyId, o.position_kind AS positionKind,
    MIN(49, CAST(o.x * 50 AS INTEGER)) AS cellX, MIN(49, CAST(o.y * 50 AS INTEGER)) AS cellY
    FROM game_loot_outputs out JOIN game_loot_observations o ON o.id = out.observation_id
    WHERE out.item_id = ? AND o.game_build = ? AND o.locale IN (?, 'und') AND o.map_id IS NOT NULL AND o.x IS NOT NULL AND o.y IS NOT NULL
    GROUP BY o.activity, o.discipline, o.source_kind, o.source_id, o.instance_id, o.difficulty_id, o.map_id, o.position_kind, cellX, cellY
    HAVING COUNT(DISTINCT o.contributor_key) >= 3
    ORDER BY COUNT(*) DESC, mapId, cellX, cellY LIMIT 100`).all(itemId, gameBuild, locale)
    .map(({ cellX, cellY, ...row }) => ({ ...row, x: (cellX + 0.5) / 50, y: (cellY + 0.5) / 50, cellSize: 0.02, coordinateSystem: "ui_map_normalized" }));
}

export function readPublicItem(itemId, { gameBuild, locale }) {
  return withGuildDatabase((db) => {
    const row = db.prepare("SELECT * FROM public_game_items WHERE item_id = ? AND game_build = ? AND locale IN (?, 'und') ORDER BY locale = ? DESC LIMIT 1")
      .get(itemId, gameBuild, locale, locale);
    if (!row) return null;
    const createdBy = db.prepare(`SELECT r.* FROM public_game_recipes r WHERE crafted_item_id = ? AND game_build = ? AND locale IN (?, 'und')
      AND (r.locale = ? OR NOT EXISTS (SELECT 1 FROM public_game_recipes localized
        WHERE localized.recipe_id = r.recipe_id AND localized.game_build = r.game_build AND localized.locale = ?))
      ORDER BY recipe_id LIMIT 51`).all(itemId, gameBuild, locale, locale, locale);
    const usedBy = db.prepare(`SELECT DISTINCT r.* FROM public_game_recipes r JOIN public_game_recipe_reagents reagent
      ON reagent.recipe_id = r.recipe_id AND reagent.game_build = r.game_build AND reagent.locale = r.locale
      WHERE reagent.item_id = ? AND r.game_build = ? AND r.locale IN (?, 'und')
      AND (r.locale = ? OR NOT EXISTS (SELECT 1 FROM public_game_recipes localized
        WHERE localized.recipe_id = r.recipe_id AND localized.game_build = r.game_build AND localized.locale = ?))
      ORDER BY r.recipe_id LIMIT 51`).all(itemId, gameBuild, locale, locale, locale);
    const sourceRows = sourcesForItem(db, itemId, gameBuild, locale);
    const sources = sourceRows.slice(0, 50).map((source) => ({ ...source, name: gameText(source.name), zone: gameText(source.zone),
      instanceName: gameText(source.instanceName), questLootObserved: Boolean(source.questLootObserved) }));
    const recipes = [...createdBy, ...usedBy].map(recipeFromRow);
    const referencedIds = [...new Set(recipes.flatMap((recipe) => [recipe.craftedItemId, ...recipe.reagents.map((entry) => entry.itemId)]))];
    const names = new Map(referencedIds.length ? db.prepare(`SELECT item_id, name FROM public_game_items
      WHERE game_build = ? AND locale IN (?, 'und') AND item_id IN (${referencedIds.map(() => "?").join(",")}) ORDER BY locale = ?`)
      .all(gameBuild, locale, ...referencedIds, locale).map((entry) => [entry.item_id, gameText(entry.name)]) : []);
    const references = referencedIds.map((id) => ({ itemId: id, name: names.get(id) || `Item ${id}` }));
    return { schemaVersion: 1, item: itemFromRow(row), sources, locations: locationsForItem(db, itemId, gameBuild, locale),
      createdBy: createdBy.slice(0, 50).map(recipeFromRow), usedBy: usedBy.slice(0, 50).map(recipeFromRow), references,
      truncated: { sources: sourceRows.length > 50, createdBy: createdBy.length > 50, usedBy: usedBy.length > 50 },
      evidence: { basis: "observed_loot_windows", dropRatesAvailable: false, verified: false,
        note: "These are client-reported sightings, not a complete drop table. Loot visibility and quest eligibility vary; missing items are not zero drops. Quantities describe loot offered, not items acquired." } };
  });
}
