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

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nullableNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// The generic equipment normalizer predates rich item telemetry and intentionally
// kept only the fields needed to draw paper-doll slots. Guildweaver now sends the
// actual rendered Blizzard GameTooltip, so overlay the raw item telemetry back
// onto every normalized item for all supported snapshot schemas. Schema v3 gets
// its richer adapter later as well; this closes the same loss for v1/v2 and for
// modular equipment streams.
function normalizeRichEquipment(snapshot) {
  const rawItems = Array.isArray(snapshot?.equipment)
    ? snapshot.equipment
    : array(snapshot?.equipment?.slots ?? snapshot?.gear);
  const normalized = normalizeEquipment(snapshot);

  return normalized.map((item, index) => {
    const raw = object(
      rawItems.find((candidate) => {
        const candidateSlot = nullableNumber(candidate?.slotId);
        const itemSlot = nullableNumber(item?.slotId);
        if (candidateSlot !== null && itemSlot !== null) return candidateSlot === itemSlot;
        const candidateId = nullableNumber(candidate?.itemId ?? candidate?.itemID ?? candidate?.id);
        return candidateId !== null && candidateId === nullableNumber(item?.itemId);
      }) ?? rawItems[index],
    );
    const tooltip = object(raw.tooltip);
    const itemClass = object(raw.itemClass);
    const itemSubclass = object(raw.itemSubclass);

    return {
      ...raw,
      ...item,
      itemLink: item.itemLink || text(raw.itemLink ?? raw.link, 2000),
      itemString: item.itemString || text(raw.itemString ?? raw.rawItemString, 2000),
      rawItemString: text(raw.rawItemString ?? raw.itemString, 2000),
      quality: nullableNumber(raw.qualityId ?? raw.quality, item.quality),
      qualityId: nullableNumber(raw.qualityId ?? raw.quality, item.quality),
      itemLevel: nullableNumber(raw.itemLevel ?? raw.ilevel ?? raw.level, item.itemLevel),
      requiredLevel: nullableNumber(raw.requiredLevel),
      iconFileId: nullableNumber(raw.iconFileDataId ?? raw.iconFileId ?? raw.icon, item.iconFileId),
      iconFileDataId: nullableNumber(raw.iconFileDataId ?? raw.iconFileId ?? raw.icon, item.iconFileId),
      bindType: nullableNumber(raw.bindType),
      equipLocation: text(raw.equipLocation, 96),
      expansionId: nullableNumber(raw.expansionId),
      setId: nullableNumber(raw.setId),
      stackCount: nullableNumber(raw.stackCount),
      sellPrice: nullableNumber(raw.sellPrice),
      isCraftingReagent: raw.isCraftingReagent === undefined ? null : Boolean(raw.isCraftingReagent),
      itemClass,
      itemClassId: nullableNumber(itemClass.id),
      itemClassName: text(itemClass.name, 120),
      classId: nullableNumber(itemClass.id),
      class: text(itemClass.name, 120),
      itemSubclass,
      itemSubclassId: nullableNumber(itemSubclass.id),
      itemSubclassName: text(itemSubclass.name, 120),
      subclassId: nullableNumber(itemSubclass.id),
      subclass: text(itemSubclass.name, 120),
      stats: object(raw.stats),
      durability: object(raw.durability),
      spell: object(raw.spell),
      tooltip,
      tooltipLines: array(tooltip.lines).map((line) => ({ ...object(line) })),
    };
  });
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

// The per-type streams (character, stats, equipment, talents) replaced the
// whole snapshot at schema v3 and keep its v3 field names. The schemaVersion
// on a `character` payload numbers that stream's payload, not the snapshot,
// so identity from that stream is still a v3 snapshot.
const DOMAIN_STREAM_SNAPSHOT_SCHEMA = 3;

// One snapshot from the character's sections.
export function composedSnapshot(sections) {
  const payload = (name) => sections[name]?.payload || {};
  const snapshot = {
    ...payload("identity"),
    ...payload("stats"),
    ...payload("equipment"),
    ...payload("talents"),
    ...payload("professions"),
  };
  if (sections.identity?.source === "character") {
    snapshot.schemaVersion = Math.max(integer(snapshot.schemaVersion, 0), DOMAIN_STREAM_SNAPSHOT_SCHEMA);
  }
  return snapshot;
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
    equipment: normalizeRichEquipment(snapshot),
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
