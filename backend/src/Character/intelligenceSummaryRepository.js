import { withGuildDatabase } from "../Data/database.js";
import {
  ensureTelemetryProjectionSchema,
  normalizeProfessions,
  normalizeRecipes,
} from "./telemetryProjection.js";
import { ensureTelemetryStateSchema } from "./Telemetry/telemetryStateRepository.js";

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function entityName(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.name ?? value?.displayName ?? "").trim();
}

function currentProjection(row) {
  const projected = Number(row.latest_snapshot_id);
  const durable = Number(row.snapshot_id);
  return Number.isFinite(projected) && Number.isFinite(durable) && projected === durable;
}

function preferredSnapshotValue(row, snapshot, projectionKey, snapshotValue) {
  if (currentProjection(row)) {
    const projected = row[projectionKey];
    if (projected !== null && projected !== undefined && projected !== "") return projected;
  }
  return snapshotValue ?? row[projectionKey] ?? "";
}

function distribution(characters, key) {
  const counts = new Map();
  for (const character of characters) {
    const name = String(character[key] || "").trim();
    if (!name) continue;
    const normalized = name.toLowerCase();
    const entry = counts.get(normalized) || { name, count: 0 };
    entry.count += 1;
    counts.set(normalized, entry);
  }
  return [...counts.values()].sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  );
}

function latestStatsPayloads(db) {
  ensureTelemetryStateSchema(db);
  const result = new Map();
  const rows = db.prepare(`
    SELECT canonical_character_id, raw_character_id, payload_json
    FROM guildweaver_telemetry_latest_state
    WHERE event_type = 'stats'
    ORDER BY captured_at DESC, received_at DESC
  `).all();

  for (const row of rows) {
    const payload = parseJson(row.payload_json, {});
    const rawCharacterId = String(row.raw_character_id || "").trim();
    // Stats can arrive before the character row and its alias exist, leaving
    // canonical_character_id empty. Website character ids for Guildweaver
    // characters are "guildweaver-id:<raw id>", so index that form too.
    const candidates = [
      row.canonical_character_id,
      rawCharacterId,
      rawCharacterId ? `guildweaver-id:${rawCharacterId}` : "",
    ];
    for (const characterId of candidates) {
      const key = String(characterId || "").trim();
      if (key && !result.has(key)) result.set(key, payload);
    }
  }

  return result;
}

function snapshotVitals(snapshot, statsPayload = null) {
  const resources = statsPayload?.stats?.resources ?? snapshot?.stats?.resources;
  if (!resources || typeof resources !== "object") return null;
  const healthCurrent = Number(resources.health?.current);
  const healthMax = Number(resources.health?.max ?? resources.health?.current);
  const powerCurrent = Number(resources.power?.current);
  const powerMax = Number(resources.power?.max ?? resources.power?.current);
  const powerToken = typeof resources.power?.token === "string" ? resources.power.token.slice(0, 24) : null;
  const normalizedHealthCurrent = Number.isFinite(healthCurrent) ? healthCurrent : null;
  const normalizedHealthMax = Number.isFinite(healthMax) && healthMax > 0 ? healthMax : null;
  const normalizedPowerCurrent = Number.isFinite(powerCurrent) ? powerCurrent : null;
  const normalizedPowerMax = Number.isFinite(powerMax) && powerMax > 0 ? powerMax : null;

  return normalizedHealthMax || normalizedPowerMax
    ? {
        healthCurrent: normalizedHealthCurrent,
        healthMax: normalizedHealthMax,
        powerCurrent: normalizedPowerCurrent,
        powerMax: normalizedPowerMax,
        powerToken,
      }
    : null;
}

export function readSyncedIntelligenceSummary() {
  return withGuildDatabase((db) => {
    ensureTelemetryProjectionSchema(db);
    const statsPayloads = latestStatsPayloads(db);

    const rows = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.race,
        c.class_name,
        c.spec,
        c.professions_json,
        c.is_main,
        m.display_name AS member_name,
        m.rank AS member_rank,
        s.id AS snapshot_id,
        s.captured_at AS snapshot_captured_at,
        s.payload_json,
        t.latest_snapshot_id,
        t.realm AS projected_realm,
        t.guild_name AS projected_guild_name,
        t.level AS projected_level,
        t.last_seen_at AS projected_last_seen_at,
        o.name AS projected_organization_name
      FROM characters c
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      JOIN character_snapshots s ON s.id = (
        SELECT latest.id
        FROM character_snapshots latest
        WHERE latest.character_id = c.id
        ORDER BY latest.captured_at DESC, latest.id DESC
        LIMIT 1
      )
      LEFT JOIN telemetry_characters t ON t.character_id = c.id
      LEFT JOIN telemetry_organizations o ON o.id = t.organization_id
      ORDER BY s.captured_at DESC, s.id DESC, c.name COLLATE NOCASE
    `).all();

    const snapshots = new Map();
    const characters = rows.map((row) => {
      const snapshot = parseJson(row.payload_json, {});
      snapshots.set(row.id, snapshot);

      const guildName = entityName(snapshot.guild);
      const organizationName = entityName(snapshot.organization) || guildName;
      const specialization = entityName(snapshot.specialization ?? snapshot.spec);
      const race = row.race || entityName(snapshot.race);
      const className = row.class_name || entityName(snapshot.class);
      const spec = row.spec || specialization;
      const level = Number(
        preferredSnapshotValue(row, snapshot, "projected_level", snapshot.level),
      ) || 0;
      const realm = String(
        preferredSnapshotValue(
          row,
          snapshot,
          "projected_realm",
          snapshot.realm ?? snapshot.realmName,
        ) || "",
      );
      const projectedGuild = preferredSnapshotValue(
        row,
        snapshot,
        "projected_guild_name",
        guildName,
      );
      const projectedOrganization = preferredSnapshotValue(
        row,
        snapshot,
        "projected_organization_name",
        organizationName,
      );
      const lastSeenAt = String(
        preferredSnapshotValue(
          row,
          snapshot,
          "projected_last_seen_at",
          snapshot.lastSeen ?? snapshot.lastSeenAt ?? row.snapshot_captured_at,
        ) || row.snapshot_captured_at || "",
      );

      return {
        id: row.id,
        name: row.name,
        firstName: typeof snapshot.firstName === "string" ? snapshot.firstName.slice(0, 40) : "",
        lastName: typeof snapshot.lastName === "string" ? snapshot.lastName.slice(0, 40) : "",
        race,
        className,
        spec,
        level,
        realm,
        guildName: String(projectedGuild || ""),
        organizationName: String(projectedOrganization || ""),
        memberName: row.member_name,
        memberRank: row.member_rank,
        lastSeenAt: lastSeenAt || null,
        isMain: Boolean(row.is_main),
        vitals: snapshotVitals(snapshot, statsPayloads.get(row.id)),
      };
    });

    const professionCharacters = new Map();
    let recipeCount = 0;

    for (const row of rows) {
      const snapshot = snapshots.get(row.id) || {};
      let characterProfessions = normalizeProfessions(snapshot);

      if (!characterProfessions.length) {
        const legacy = parseJson(row.professions_json, []);
        if (Array.isArray(legacy)) {
          characterProfessions = legacy
            .map((value) => ({ name: entityName(value) || String(value || "").trim(), recipes: [] }))
            .filter((profession) => profession.name);
        }
      }

      for (const profession of characterProfessions) {
        const name = String(profession.name || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const entry = professionCharacters.get(key) || { name, characterIds: new Set() };
        entry.characterIds.add(row.id);
        professionCharacters.set(key, entry);
      }

      const seenRecipes = new Set();
      for (const recipe of normalizeRecipes(snapshot, characterProfessions)) {
        if (recipe.known === false) continue;
        const key = String(recipe.key || recipe.id || recipe.name || "").toLowerCase();
        if (!key || seenRecipes.has(key)) continue;
        seenRecipes.add(key);
        recipeCount += 1;
      }
    }

    const professions = [...professionCharacters.values()]
      .map((entry) => ({ name: entry.name, characters: entry.characterIds.size }))
      .sort(
        (left, right) =>
          right.characters - left.characters || left.name.localeCompare(right.name),
      );

    return {
      summary: {
        characterCount: characters.length,
        professionCount: professions.length,
        recipeCount,
      },
      characters,
      professions,
      classDistribution: distribution(characters, "className"),
      specDistribution: distribution(characters, "spec"),
    };
  });
}
