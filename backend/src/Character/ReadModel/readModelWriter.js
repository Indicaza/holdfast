// Writes telemetry into the character read model.
//
// Every write path (the legacy character endpoint and the generic telemetry
// ingest) ends here, so there is one rule for what a character looks like:
// per section, the newest capture wins (ties go to the later arrival), and a
// weak section (partial or empty capture) only fills a gap. Derived rows (the
// character card, the characters table's display columns, and the craft
// finder's profession and recipe rows) are refreshed from the sections
// whenever one changes.

import {
  ensureGuildweaverCharacterIdentitySchema,
  readGuildweaverCharacterAliasInDatabase,
  recordGuildweaverCharacterAliasInDatabase,
  resolveGuildweaverCharacterIdentityInDatabase,
} from "../characterIdentityRepository.js";
import { preserveProfessionRecipes } from "../characterSnapshotIntegrity.js";
import { ensureTelemetryProjectionSchema, entityName, normalizeOrganization } from "../telemetryProjection.js";
import { ensureTelemetryStateSchema } from "../Telemetry/telemetryStateRepository.js";
import { parseTelemetryJson } from "../Telemetry/telemetryJson.js";
import { composeProfessions, composedSnapshot } from "./composeArmory.js";
import { identityFromTelemetry, sectionsFromTelemetry } from "./projectors.js";
import { ensureCharacterReadModelSchema } from "./readModelSchema.js";
import { applyTalentDefinitionInDatabase, readCharacterSectionsInDatabase } from "./sectionStore.js";

export { applyTalentDefinitionInDatabase };

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Capture times in one form: the addon sends server epoch seconds, the
// legacy path ISO strings.
export function captureTime(value, fallback = new Date().toISOString()) {
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value ?? ""))) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric < 100000000000 ? numeric * 1000 : numeric).toISOString();
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function isNewer(incoming, existing) {
  if (incoming.capturedAt !== existing.captured_at) return incoming.capturedAt > existing.captured_at;
  return incoming.receivedAt >= existing.received_at;
}

/**
 * Applies projected sections to a character. Returns the names of the
 * sections that changed.
 */
export function applySectionsInDatabase(db, { characterId, sections, capturedAt, receivedAt, source, sourceRecordId = null, sourceRevision = null }) {
  if (!characterId || !sections?.length) return [];
  ensureCharacterReadModelSchema(db);
  const read = db.prepare("SELECT captured_at, received_at, payload_json FROM character_sections WHERE character_id = ? AND section = ?");
  const write = db.prepare(`
    INSERT INTO character_sections (character_id, section, captured_at, received_at, source, source_record_id, source_revision, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(character_id, section) DO UPDATE SET
      captured_at = excluded.captured_at,
      received_at = excluded.received_at,
      source = excluded.source,
      source_record_id = excluded.source_record_id,
      source_revision = excluded.source_revision,
      payload_json = excluded.payload_json
  `);

  const changed = [];
  for (const entry of sections) {
    const existing = read.get(characterId, entry.section);
    if (existing && entry.weak) continue;
    if (existing && !isNewer({ capturedAt, receivedAt }, existing)) continue;

    // Identity merges field by field: a capture that could not read the
    // guild or specialization leaves the known ones in place.
    const previous = existing ? parseTelemetryJson(existing.payload_json, {}) : {};
    let payload = entry.payload;
    if (entry.section === "identity" && existing) payload = { ...previous, ...entry.payload };
    if (entry.keepRecipes && existing) {
      payload = { ...entry.payload, professions: preserveProfessionRecipes(previous.professions, entry.payload.professions) };
    }
    const json = JSON.stringify(payload ?? {});
    write.run(characterId, entry.section, capturedAt, receivedAt, text(source, 120), sourceRecordId, sourceRevision, json);
    if (!existing || existing.payload_json !== json) changed.push(entry.section);
  }

  if (changed.length) refreshCharacterDerivedInDatabase(db, characterId, changed);
  return changed;
}

function vitals(statsPayload) {
  const resources = statsPayload?.stats?.resources;
  if (!resources || typeof resources !== "object") return null;
  const value = (raw) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const healthMax = value(resources.health?.max ?? resources.health?.current);
  const powerMax = value(resources.power?.max ?? resources.power?.current);
  if (!(healthMax > 0) && !(powerMax > 0)) return null;
  return {
    healthCurrent: value(resources.health?.current),
    healthMax: healthMax > 0 ? healthMax : null,
    powerCurrent: value(resources.power?.current),
    powerMax: powerMax > 0 ? powerMax : null,
    powerToken: typeof resources.power?.token === "string" ? resources.power.token.slice(0, 24) : null,
  };
}

function replaceProfessionRowsInDatabase(db, characterId, { professions, recipes }) {
  ensureTelemetryProjectionSchema(db);
  db.prepare("DELETE FROM telemetry_professions WHERE character_id = ?").run(characterId);
  db.prepare("DELETE FROM telemetry_recipes WHERE character_id = ?").run(characterId);
  const insertProfession = db.prepare(`
    INSERT OR REPLACE INTO telemetry_professions (
      character_id, profession_key, profession_id, name, icon_file_id,
      skill_current, skill_max, skill_modifier, specialization_json, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  for (const profession of professions) {
    if (!profession?.key || !profession?.name) continue;
    insertProfession.run(
      characterId,
      String(profession.key),
      Number.isFinite(Number(profession.id)) ? Number(profession.id) : null,
      String(profession.name),
      Number.isFinite(Number(profession.iconFileId)) ? Number(profession.iconFileId) : null,
      integer(profession.current),
      integer(profession.max),
      integer(profession.modifier),
      JSON.stringify(profession.specialization ?? null),
    );
  }
  const insertRecipe = db.prepare(`
    INSERT OR REPLACE INTO telemetry_recipes (
      character_id, recipe_key, recipe_id, name, profession_key, profession_id,
      profession_name, icon_file_id, known, required_skill, requirements_json,
      crafted_item_id, crafted_item_name, reagents_json, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  for (const recipe of recipes) {
    if (!recipe?.key || !recipe?.name) continue;
    const number = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);
    insertRecipe.run(
      characterId,
      String(recipe.key),
      number(recipe.id),
      String(recipe.name),
      String(recipe.professionKey || ""),
      number(recipe.professionId),
      String(recipe.professionName || ""),
      number(recipe.iconFileId),
      recipe.known === false ? 0 : 1,
      number(recipe.requiredSkill),
      JSON.stringify(recipe.requirements ?? null),
      number(recipe.craftedItemId),
      String(recipe.craftedItemName || ""),
      JSON.stringify(Array.isArray(recipe.reagents) ? recipe.reagents : []),
    );
  }
}

// Rebuilds everything derived from a character's sections.
export function refreshCharacterDerivedInDatabase(db, characterId, changed = null) {
  const character = db.prepare("SELECT id, member_id, name, race, class_name, spec FROM characters WHERE id = ?").get(characterId);
  if (!character) return;
  const sections = readCharacterSectionsInDatabase(db, characterId);
  const snapshot = composedSnapshot(sections);
  const identity = sections.identity?.payload || {};
  const names = {
    first: text(identity.firstName, 40),
    last: text(identity.lastName, 40),
  };
  const fullName = text(identity.fullName ?? identity.name, 96) || [names.first, names.last].filter(Boolean).join(" ") || character.name;
  const race = text(entityName(snapshot.race), 32) || character.race;
  const className = text(entityName(snapshot.class), 32) || character.class_name;
  const spec = text(entityName(snapshot.specialization ?? snapshot.spec), 48) || character.spec;
  const { professions, recipes } = composeProfessions(sections);
  const professionNames = [...new Set(professions.map((profession) => text(profession.name, 40)).filter(Boolean))].slice(0, 6);
  const lastSeenAt = Object.values(sections).map((entry) => entry.capturedAt).filter(Boolean).sort().at(-1) || "";
  const organization = normalizeOrganization(snapshot);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE characters SET name = ?, race = ?, class_name = ?, spec = ?, professions_json = ? WHERE id = ?
  `).run(fullName, race, className, spec, JSON.stringify(professionNames), characterId);

  db.prepare(`
    INSERT INTO character_cards (
      character_id, member_id, name, first_name, last_name, race, class_name, spec, level,
      realm, region, guild_name, organization_name, professions_json, known_recipe_count, vitals_json, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET
      member_id = excluded.member_id, name = excluded.name, first_name = excluded.first_name,
      last_name = excluded.last_name, race = excluded.race, class_name = excluded.class_name,
      spec = excluded.spec, level = excluded.level, realm = excluded.realm, region = excluded.region,
      guild_name = excluded.guild_name, organization_name = excluded.organization_name,
      professions_json = excluded.professions_json,
      known_recipe_count = excluded.known_recipe_count, vitals_json = excluded.vitals_json,
      last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
  `).run(
    characterId,
    character.member_id,
    fullName,
    names.first,
    names.last,
    race,
    className,
    spec,
    integer(snapshot.level),
    text(snapshot.realm ?? snapshot.realmName, 96),
    text(snapshot.region, 24),
    organization.guildName,
    entityName(snapshot.organization) || organization.guildName,
    JSON.stringify(professionNames),
    new Set(recipes.filter((recipe) => recipe.known !== false).map((recipe) => recipe.key)).size,
    JSON.stringify(vitals(sections.stats?.payload)),
    lastSeenAt,
    now,
  );

  // Realm and level for the craft finder and the identity resolver.
  ensureTelemetryProjectionSchema(db);
  db.prepare(`
    INSERT INTO telemetry_organizations (id, name, guild_name, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, guild_name = excluded.guild_name, updated_at = excluded.updated_at
  `).run(organization.id, organization.name, organization.guildName, now);
  db.prepare(`
    INSERT INTO telemetry_characters (
      character_id, organization_id, realm, region, guild_name, level, schema_version, game_build, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET
      organization_id = excluded.organization_id, realm = excluded.realm, region = excluded.region,
      guild_name = excluded.guild_name, level = excluded.level, schema_version = excluded.schema_version,
      last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
  `).run(
    characterId,
    organization.id,
    text(snapshot.realm ?? snapshot.realmName, 96),
    text(snapshot.region, 24),
    organization.guildName,
    integer(snapshot.level),
    integer(snapshot.schemaVersion),
    lastSeenAt,
    now,
  );

  if (!changed || changed.includes("professions") || changed.includes("profession_books")) {
    replaceProfessionRowsInDatabase(db, characterId, { professions, recipes });
  }
}

// The character a raw (addon) character id belongs to, creating it from its
// own identity telemetry when this is the first the website hears of it.
function resolveCharacterInDatabase(db, { memberId, deviceId, rawCharacterId, identity, installationId, observedAt }) {
  ensureGuildweaverCharacterIdentitySchema(db);
  ensureTelemetryProjectionSchema(db);
  const aliased = readGuildweaverCharacterAliasInDatabase({ db, memberId, deviceId, rawCharacterId });
  if (aliased) return { characterId: aliased, associated: false };
  if (!identity) return { characterId: null, associated: false };

  const member = db.prepare("SELECT id FROM members WHERE id = ? AND status = 'active'").get(memberId);
  if (!member) return { characterId: null, associated: false };

  const preferredId = rawCharacterId ? `guildweaver-id:${rawCharacterId}` : "";
  const existing = resolveGuildweaverCharacterIdentityInDatabase({
    db,
    memberId,
    deviceId,
    rawCharacterId,
    preferredCharacterId: preferredId,
    characterName: identity.name,
    realm: identity.realm,
    region: identity.region,
  });
  let characterId = existing?.id || "";
  if (!characterId) {
    if (!preferredId) return { characterId: null, associated: false };
    const counts = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM characters WHERE member_id = ?
    `).get(memberId);
    db.prepare(`
      INSERT INTO characters (id, member_id, name, race, class_name, spec, professions_json, is_main, sort_order)
      VALUES (?, ?, ?, '', '', '', '[]', ?, ?)
    `).run(preferredId, memberId, text(identity.name, 96), Number(counts.count) === 0 ? 1 : 0, Number(counts.next_sort) || 0);
    characterId = preferredId;
  }

  recordGuildweaverCharacterAliasInDatabase({
    db,
    memberId,
    deviceId,
    installationId,
    rawCharacterId,
    characterId,
    characterName: identity.name,
    realm: identity.realm,
    region: identity.region,
    observedAt,
  });
  return { characterId, associated: true };
}

// Telemetry that arrived before its character existed: its latest states are
// waiting under the raw id. Associate and project them now.
export function replayPendingTelemetryInDatabase(db, { memberId, rawCharacterId, characterId }) {
  if (!rawCharacterId || !characterId) return;
  ensureTelemetryStateSchema(db);
  db.prepare(`
    UPDATE guildweaver_telemetry_latest_state SET canonical_character_id = ?
    WHERE member_id = ? AND raw_character_id = ? AND canonical_character_id <> ?
  `).run(characterId, memberId, rawCharacterId, characterId);
  const rows = db.prepare(`
    SELECT event_type, captured_at, received_at, record_id, revision, payload_json
    FROM guildweaver_telemetry_latest_state
    WHERE member_id = ? AND raw_character_id = ?
    ORDER BY captured_at ASC, received_at ASC
  `).all(memberId, rawCharacterId);
  for (const row of rows) {
    applySectionsInDatabase(db, {
      characterId,
      sections: sectionsFromTelemetry(row.event_type, parseTelemetryJson(row.payload_json, {})),
      capturedAt: row.captured_at,
      receivedAt: row.received_at,
      source: row.event_type,
      sourceRecordId: row.record_id,
      sourceRevision: row.revision,
    });
  }
}

/**
 * Projects one telemetry state into the read model. Returns the character it
 * belongs to (null while the website does not know the character yet; the
 * state is replayed once it does).
 */
export function projectTelemetryStateInDatabase(db, {
  memberId,
  deviceId = "",
  rawCharacterId = "",
  eventType,
  payload,
  capturedAt,
  receivedAt,
  recordId = null,
  revision = null,
  installationId = "",
}) {
  const captured = captureTime(capturedAt, receivedAt);
  if (eventType === "talent_tree_definition") {
    applyTalentDefinitionInDatabase(db, { payload, capturedAt: captured, receivedAt });
    return { characterId: null, changed: [] };
  }

  const sections = sectionsFromTelemetry(eventType, payload);
  if (!sections.length || !rawCharacterId) return { characterId: null, changed: [] };

  const { characterId, associated } = resolveCharacterInDatabase(db, {
    memberId,
    deviceId,
    rawCharacterId,
    identity: identityFromTelemetry(eventType, payload),
    installationId,
    observedAt: receivedAt,
  });
  if (!characterId) return { characterId: null, changed: [] };

  const changed = applySectionsInDatabase(db, {
    characterId,
    sections,
    capturedAt: captured,
    receivedAt,
    source: eventType,
    sourceRecordId: recordId,
    sourceRevision: revision,
  });
  // States that arrived before this raw id had a character.
  if (associated) replayPendingTelemetryInDatabase(db, { memberId, rawCharacterId, characterId });
  return { characterId, changed };
}
