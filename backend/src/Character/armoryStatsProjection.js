import { withGuildDatabase } from "../Data/database.js";

const STAT_GROUPS = ["resources", "attributes", "offense", "defense", "ratings", "utility"];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function structuredStats(value) {
  const source = object(value);
  const result = {};

  for (const key of STAT_GROUPS) {
    const group = object(source[key]);
    if (Object.keys(group).length) result[key] = group;
  }

  if (Object.keys(result).length) {
    const schemaVersion = Number(source.schemaVersion);
    if (Number.isFinite(schemaVersion)) result.schemaVersion = schemaVersion;
  }

  return result;
}

export function readStructuredCharacterStats(characterId) {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) return {};

  return withGuildDatabase((db) => {
    const projected = db.prepare(`
      SELECT s.payload_json
      FROM telemetry_characters t
      LEFT JOIN character_snapshots s ON s.id = t.latest_snapshot_id
      WHERE t.character_id = ?
      LIMIT 1
    `).get(normalizedId)?.payload_json;

    const fallback = projected || db.prepare(`
      SELECT payload_json
      FROM character_snapshots
      WHERE character_id = ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `).get(normalizedId)?.payload_json;

    return structuredStats(parseJson(fallback).stats);
  });
}
