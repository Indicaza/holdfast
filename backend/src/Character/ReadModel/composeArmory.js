// Builds the armory (the character modal's data) from a character's sections.
//
// The sections hold snapshot-shaped pieces from whichever stream last
// described them, so they are reassembled into one snapshot and run through
// the same normalizers the website has always used: the generic ones, then the
// v3 snapshot adapter, talent art, profession books and inventory.

import { adaptArmoryV3Snapshot } from "../armoryV3Adapter.js";
import { applyInventoryTelemetry } from "../inventoryArmory.js";
import { applyProfessionTelemetry } from "../professionArmory.js";
import { applyTalentArt, normalizeTalentDefinitionArt } from "../talentArmoryArt.js";
import {
  entityName,
  gameBuildLabel,
  normalizeEquipment,
  normalizeOrganization,
  normalizeProfessions,
  normalizeRecipes,
  normalizeTalents,
  stats,
} from "../telemetryProjection.js";

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Enrichment stages are optional: one malformed section must never take the
// whole character modal down with it.
function stage(armory, label, transform) {
  try {
    return transform(armory) || armory;
  } catch (error) {
    console.warn(`Unable to ${label} for ${armory?.character?.id}`, error?.message || error);
    return armory;
  }
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

// One snapshot from the character's sections.
export function composedSnapshot(sections) {
  const payload = (name) => sections[name]?.payload || {};
  return {
    ...payload("identity"),
    ...payload("stats"),
    ...payload("equipment"),
    ...payload("talents"),
    ...payload("professions"),
  };
}

export function sectionFreshness(sections) {
  return Object.fromEntries(Object.entries(sections).map(([name, entry]) => [name, entry.capturedAt]));
}

function telemetryState(entry) {
  return entry ? { revision: entry.sourceRevision ?? entry.sourceRecordId, capturedAt: entry.capturedAt, receivedAt: entry.receivedAt, payload: entry.payload } : null;
}

// The character's final professions and recipes: the snapshot's, replaced by
// recipe books wherever a profession window has been captured.
export function composeProfessions(sections) {
  const snapshot = composedSnapshot(sections);
  const professions = normalizeProfessions(snapshot);
  const base = { character: {}, professions, recipes: normalizeRecipes(snapshot, professions) };
  const withBooks = applyProfessionTelemetry(base, telemetryState(sections.profession_books));
  return { professions: withBooks.professions, recipes: withBooks.recipes };
}

/**
 * @param character  the character row with its member (id, member_id, name,
 *                   race, class_name, spec, is_main, member_name, member_rank)
 * @param sections   { [section]: { capturedAt, receivedAt, source, sourceRecordId, payload } }
 * @param talentDefinitions  Map of tree id to talent_tree_definition payload
 */
export function composeCharacterArmory({ character, sections, talentDefinitions = new Map() }) {
  const snapshot = composedSnapshot(sections);
  const organization = normalizeOrganization(snapshot);
  const professions = normalizeProfessions(snapshot);
  const firstName = text(snapshot.firstName, 40);
  const lastName = text(snapshot.lastName, 40);
  const fullName = text(snapshot.fullName ?? snapshot.name, 96) || [firstName, lastName].filter(Boolean).join(" ");
  const lastSeenAt = latest(Object.values(sections).map((entry) => entry.capturedAt));

  let armory = {
    character: {
      id: character.id,
      memberId: character.member_id,
      memberName: character.member_name,
      memberRank: character.member_rank,
      name: fullName || character.name,
      firstName,
      lastName,
      fullName: fullName || character.name,
      race: entityName(snapshot.race) || character.race,
      className: entityName(snapshot.class) || character.class_name,
      spec: entityName(snapshot.specialization ?? snapshot.spec) || character.spec,
      level: integer(snapshot.level, 0),
      realm: text(snapshot.realm ?? snapshot.realmName, 96),
      region: text(snapshot.region, 24),
      guildName: entityName(snapshot.guild),
      organization: organization.guildName ? { id: organization.id, name: organization.name } : null,
      lastSeenAt,
      gameBuild: gameBuildLabel(snapshot),
      schemaVersion: integer(snapshot.schemaVersion, 0),
      isMain: Boolean(character.is_main),
    },
    stats: stats(snapshot),
    equipment: normalizeEquipment(snapshot),
    talents: normalizeTalents(snapshot),
    professions,
    recipes: normalizeRecipes(snapshot, professions),
    capturedAt: lastSeenAt,
  };

  const definitionsFor = (treeIds) => treeIds.map((treeId) => talentDefinitions.get(Number(treeId))).filter(Boolean);
  armory = stage(armory, "adapt the v3 snapshot", (value) => adaptArmoryV3Snapshot(value, snapshot, definitionsFor));
  armory = stage(armory, "add talent art", (value) => applyTalentArt(
    value,
    definitionsFor(Array.isArray(value.talents?.treeIds) ? value.talents.treeIds : []).map(normalizeTalentDefinitionArt).filter(Boolean),
  ));
  armory = stage(armory, "add profession books", (value) => applyProfessionTelemetry(value, telemetryState(sections.profession_books)));
  armory = stage(armory, "add inventory", (value) => applyInventoryTelemetry(value, telemetryState(sections.inventory)));
  return { ...armory, freshness: sectionFreshness(sections) };
}
