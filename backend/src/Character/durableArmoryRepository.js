import { withGuildDatabase } from "../Data/database.js";
import {
  normalizeEquipment,
  normalizeProfessions,
  normalizeRecipes,
  normalizeTalents,
} from "./telemetryProjection.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function entityName(value) {
  if (typeof value === "string") return text(value, 96);
  return text(value?.name ?? value?.displayName, 96);
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function latestDurableSnapshot(characterId) {
  return withGuildDatabase((db) => {
    const row = db.prepare(`
      SELECT id, captured_at, payload_json
      FROM character_snapshots
      WHERE character_id = ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `).get(characterId);

    if (!row) return null;
    return {
      id: Number(row.id),
      capturedAt: row.captured_at || null,
      payload: parseJson(row.payload_json),
    };
  });
}

function richerStats(payload, fallback) {
  const stats = object(payload?.stats);
  return Object.keys(stats).length ? stats : fallback;
}

function richerTalents(payload, fallback) {
  const normalized = normalizeTalents(payload);
  const hasState =
    normalized.configId !== null ||
    normalized.treeId !== null ||
    normalized.treeIds.length > 0 ||
    normalized.nodes.length > 0 ||
    normalized.edges.length > 0 ||
    normalized.pointsSpent !== null ||
    normalized.pointsAvailable !== null;

  if (!hasState) return fallback;
  return {
    ...fallback,
    ...normalized,
    nodes: normalized.nodes.length ? normalized.nodes : fallback?.nodes || [],
    edges: normalized.edges.length ? normalized.edges : fallback?.edges || [],
  };
}

export function hydrateArmoryFromLatestSnapshot(armory) {
  const characterId = armory?.character?.id;
  if (!characterId) return armory;

  const latest = latestDurableSnapshot(characterId);
  if (!latest) return armory;

  const payload = latest.payload;
  const professions = normalizeProfessions(payload);
  const recipes = normalizeRecipes(payload, professions);
  const equipment = normalizeEquipment(payload);
  const firstName = text(payload?.firstName, 40);
  const lastName = text(payload?.lastName, 40);
  const fullName =
    text(payload?.fullName ?? payload?.name, 96) ||
    [firstName, lastName].filter(Boolean).join(" ");

  return {
    ...armory,
    character: {
      ...armory.character,
      name: fullName || armory.character.name,
      firstName: firstName || armory.character.firstName || "",
      lastName: lastName || armory.character.lastName || "",
      fullName: fullName || armory.character.fullName || armory.character.name,
      race: entityName(payload?.race) || armory.character.race,
      className: entityName(payload?.class) || armory.character.className,
      spec:
        entityName(payload?.specialization ?? payload?.spec) ||
        armory.character.spec,
      level: number(payload?.level, armory.character.level) ?? 0,
      realm:
        text(payload?.realm ?? payload?.realmName, 96) || armory.character.realm,
      region: text(payload?.region, 24) || armory.character.region,
      guildName: entityName(payload?.guild) || armory.character.guildName,
      lastSeenAt:
        text(payload?.lastSeen ?? payload?.lastSeenAt, 64) ||
        latest.capturedAt ||
        armory.character.lastSeenAt,
      schemaVersion:
        number(payload?.schemaVersion, armory.character.schemaVersion) ?? 0,
    },
    stats: richerStats(payload, armory.stats),
    equipment: equipment.length ? equipment : armory.equipment,
    talents: richerTalents(payload, armory.talents),
    professions: professions.length ? professions : armory.professions,
    recipes: recipes.length ? recipes : armory.recipes,
    capturedAt: latest.capturedAt || armory.capturedAt,
    snapshotId: latest.id,
  };
}
