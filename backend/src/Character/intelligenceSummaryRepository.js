import { withGuildDatabase } from "../Data/database.js";
import { ensureTelemetryProjectionSchema } from "./telemetryProjection.js";

export function readSyncedIntelligenceSummary() {
  return withGuildDatabase((db) => {
    ensureTelemetryProjectionSchema(db);

    const characters = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.race,
        c.class_name,
        c.spec,
        c.is_main,
        m.display_name AS member_name,
        m.rank AS member_rank,
        t.realm,
        t.guild_name,
        t.level,
        t.last_seen_at,
        o.name AS organization_name
      FROM telemetry_characters t
      JOIN characters c ON c.id = t.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      LEFT JOIN telemetry_organizations o ON o.id = t.organization_id
      WHERE t.latest_snapshot_id IS NOT NULL
      ORDER BY t.last_seen_at DESC, c.name COLLATE NOCASE
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      race: row.race,
      className: row.class_name,
      spec: row.spec,
      level: Number(row.level) || 0,
      realm: row.realm || "",
      guildName: row.guild_name || "",
      organizationName: row.organization_name || "",
      memberName: row.member_name,
      memberRank: row.member_rank,
      lastSeenAt: row.last_seen_at || null,
      isMain: Boolean(row.is_main),
    }));

    const professions = db.prepare(`
      SELECT p.name, COUNT(DISTINCT p.character_id) AS characters
      FROM telemetry_professions p
      JOIN telemetry_characters t ON t.character_id = p.character_id AND t.latest_snapshot_id IS NOT NULL
      JOIN characters c ON c.id = p.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      GROUP BY p.name COLLATE NOCASE
      ORDER BY characters DESC, p.name COLLATE NOCASE
    `).all().map((row) => ({
      name: row.name,
      characters: Number(row.characters) || 0,
    }));

    const recipeCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM telemetry_recipes r
      JOIN telemetry_characters t ON t.character_id = r.character_id AND t.latest_snapshot_id IS NOT NULL
      JOIN characters c ON c.id = r.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE r.known = 1
    `).get()?.count || 0);

    const classDistribution = db.prepare(`
      SELECT c.class_name AS name, COUNT(*) AS count
      FROM telemetry_characters t
      JOIN characters c ON c.id = t.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE t.latest_snapshot_id IS NOT NULL AND c.class_name <> ''
      GROUP BY c.class_name COLLATE NOCASE
      ORDER BY count DESC, name COLLATE NOCASE
    `).all().map((row) => ({ name: row.name, count: Number(row.count) || 0 }));

    const specDistribution = db.prepare(`
      SELECT c.spec AS name, COUNT(*) AS count
      FROM telemetry_characters t
      JOIN characters c ON c.id = t.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE t.latest_snapshot_id IS NOT NULL AND c.spec <> ''
      GROUP BY c.spec COLLATE NOCASE
      ORDER BY count DESC, name COLLATE NOCASE
    `).all().map((row) => ({ name: row.name, count: Number(row.count) || 0 }));

    return {
      summary: {
        characterCount: characters.length,
        professionCount: professions.length,
        recipeCount,
      },
      characters,
      professions,
      classDistribution,
      specDistribution,
    };
  });
}
