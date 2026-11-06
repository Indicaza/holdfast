import { withGuildDatabase } from "../Data/database.js";
import { ensureTelemetryProjectionSchema } from "./telemetryProjection.js";

function text(value, maxLength = 120) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Recipes and the characters who know them. Without characterIds: every
// active Holdfast member's characters (the guild Craft Finder). With
// characterIds: only those characters, whoever owns them; the caller has
// already narrowed them to one player's own (Player/playerRepository.js).
export function searchCraftFinderWithSkill(query = "", { characterIds = null } = {}) {
  const normalized = text(query).toLowerCase();
  const scoped = Array.isArray(characterIds);
  if (scoped && !characterIds.length) return [];
  const ids = scoped ? characterIds.map((id) => String(id)) : [];
  const memberJoin = scoped
    ? "JOIN members m ON m.id = c.member_id"
    : "JOIN members m ON m.id = c.member_id AND m.status = 'active'";
  const characterFilter = scoped ? `AND c.id IN (${ids.map(() => "?").join(", ")})` : "";

  return withGuildDatabase((db) => {
    ensureTelemetryProjectionSchema(db);
    const rows = db.prepare(`
      SELECT
        r.recipe_key,
        r.recipe_id,
        r.name AS recipe_name,
        r.icon_file_id,
        r.profession_name,
        r.required_skill,
        r.crafted_item_id,
        r.crafted_item_name,
        c.id AS character_id,
        c.name AS character_name,
        c.class_name,
        t.realm,
        t.last_seen_at,
        m.display_name AS member_name,
        p.skill_current,
        p.skill_max,
        p.skill_modifier
      FROM telemetry_recipes r
      JOIN characters c ON c.id = r.character_id
      ${memberJoin}
      LEFT JOIN telemetry_characters t ON t.character_id = c.id
      LEFT JOIN telemetry_professions p
        ON p.character_id = r.character_id
        AND p.profession_key = r.profession_key
      WHERE r.known = 1 ${characterFilter}
        AND (
          ? = ''
          OR lower(r.name) LIKE ?
          OR lower(r.crafted_item_name) LIKE ?
          OR CAST(r.recipe_id AS TEXT) = ?
          OR CAST(r.crafted_item_id AS TEXT) = ?
        )
      ORDER BY r.name COLLATE NOCASE, p.skill_current DESC, c.name COLLATE NOCASE
      LIMIT 250
    `).all(
      ...ids,
      normalized,
      `%${normalized}%`,
      `%${normalized}%`,
      normalized,
      normalized,
    );

    const grouped = new Map();

    for (const row of rows) {
      const key = row.recipe_id ? `id:${row.recipe_id}` : `${row.profession_name}:${row.recipe_name}`.toLowerCase();
      if (!grouped.has(key)) {
        grouped.set(key, {
          recipe: {
            id: numberOrNull(row.recipe_id),
            name: row.recipe_name,
            iconFileId: numberOrNull(row.icon_file_id),
            professionName: row.profession_name || "",
            requiredSkill: numberOrNull(row.required_skill),
            craftedItemId: numberOrNull(row.crafted_item_id),
            craftedItemName: row.crafted_item_name || "",
          },
          crafters: [],
        });
      }

      grouped.get(key).crafters.push({
        id: row.character_id,
        name: row.character_name,
        className: row.class_name || "",
        realm: row.realm || "",
        memberName: row.member_name || "",
        professionSkill: Number(row.skill_current) || 0,
        professionMaxSkill: Number(row.skill_max) || 0,
        professionModifier: Number(row.skill_modifier) || 0,
        lastSeenAt: row.last_seen_at || null,
      });
    }

    return [...grouped.values()].slice(0, 80);
  });
}
