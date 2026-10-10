// Reads the character read model: the character list (cards) and one
// character's armory. Each is a handful of indexed reads; nothing here parses
// raw telemetry history.

import { withGuildDatabase } from "../../Data/database.js";
import { parseTelemetryJson } from "../Telemetry/telemetryJson.js";
import { normalizeTalents } from "../telemetryProjection.js";
import { composeCharacterArmory, composedSnapshot } from "./composeArmory.js";
import { ensureCharacterReadModelSchema } from "./readModelSchema.js";
import { ensureCharacterReadModelCurrent } from "./rebuildReadModel.js";
import { readCharacterSectionsInDatabase, readTalentDefinitionsInDatabase } from "./sectionStore.js";

function distribution(characters, key) {
  const counts = new Map();
  for (const character of characters) {
    const name = String(character[key] || "").trim();
    if (!name) continue;
    const entry = counts.get(name.toLowerCase()) || { name, count: 0 };
    entry.count += 1;
    counts.set(name.toLowerCase(), entry);
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function readCharacterCards() {
  ensureCharacterReadModelCurrent();
  return withGuildDatabase((db) => {
    ensureCharacterReadModelSchema(db);
    const rows = db.prepare(`
      SELECT k.*, c.is_main, m.display_name AS member_name, m.rank AS member_rank
      FROM character_cards k
      JOIN characters c ON c.id = k.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      ORDER BY k.last_seen_at DESC, k.name COLLATE NOCASE
    `).all();

    const professionCharacters = new Map();
    let recipeCount = 0;
    const characters = rows.map((row) => {
      for (const name of parseTelemetryJson(row.professions_json, [])) {
        const key = String(name).toLowerCase();
        const entry = professionCharacters.get(key) || { name, characters: 0 };
        entry.characters += 1;
        professionCharacters.set(key, entry);
      }
      recipeCount += Number(row.known_recipe_count) || 0;
      return {
        id: row.character_id,
        name: row.name,
        firstName: row.first_name,
        lastName: row.last_name,
        race: row.race,
        className: row.class_name,
        spec: row.spec,
        level: Number(row.level) || 0,
        realm: row.realm,
        guildName: row.guild_name,
        organizationName: row.organization_name || row.guild_name,
        memberName: row.member_name,
        memberRank: row.member_rank,
        lastSeenAt: row.last_seen_at || null,
        isMain: Boolean(row.is_main),
        vitals: parseTelemetryJson(row.vitals_json, null),
      };
    });

    const professions = [...professionCharacters.values()].sort(
      (left, right) => right.characters - left.characters || left.name.localeCompare(right.name),
    );
    return {
      summary: { characterCount: characters.length, professionCount: professions.length, recipeCount },
      characters,
      professions,
      classDistribution: distribution(characters, "className"),
      specDistribution: distribution(characters, "spec"),
    };
  });
}

// One character's armory, or null when the website has no telemetry for it.
export function readCharacterArmoryFromReadModel(characterId) {
  ensureCharacterReadModelCurrent();
  return withGuildDatabase((db) => {
    const character = db.prepare(`
      SELECT c.id, c.member_id, c.name, c.race, c.class_name, c.spec, c.is_main,
        m.display_name AS member_name, m.rank AS member_rank
      FROM characters c
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE c.id = ?
    `).get(String(characterId || ""));
    if (!character) return null;

    const sections = readCharacterSectionsInDatabase(db, character.id);
    if (!Object.keys(sections).length) return null;
    // v3 allocations name their trees; legacy talents carry them inline.
    const state = sections.talents?.payload?.talents;
    const treeIds = [
      ...(Array.isArray(state?.treeIds) ? state.treeIds : []),
      ...normalizeTalents(composedSnapshot(sections)).treeIds,
    ];
    return composeCharacterArmory({
      character,
      sections,
      talentDefinitions: readTalentDefinitionsInDatabase(db, treeIds),
    });
  });
}
