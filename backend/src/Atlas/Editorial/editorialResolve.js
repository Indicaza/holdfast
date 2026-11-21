// Resolves an editorial document against the imported atlas dungeon. Pure:
// both inputs are plain data, nothing is read or written here, so a fresh
// import (scripts/importDungeonAtlas.mjs) changes the imported side and
// every editorial override still applies on top of it.
//
// Precedence, highest first:
//   1. published, verified editorial
//   2. verified Forever client data (the client's own tables)
//   3. unverified editorial
//   4. Forever external references (community guides, unverified)
//   5. Classic fallbacks (Classic Era client data, AzerothCore)
// When an editorial value loses (unverified against client data) the field
// says so: a conflict, kept with both values, never silently dropped.

import { BOSS_FIELDS, DUNGEON_FIELDS } from "./editorialSchema.js";

export const TIERS = Object.freeze({
  "editorial-verified": 1,
  "forever-client": 2,
  "editorial-unverified": 3,
  "forever-external": 4,
  "classic-fallback": 5,
});

export function bossKeyOf(boss) {
  return String(boss?.encounterId || boss?.npcId || boss?.name || "");
}

// The tier of the imported dungeon's facts, from its provenance.
export function importedTier(provenance = [], origin = "classic") {
  const lines = Array.isArray(provenance) ? provenance : [];
  if (lines.some((line) => line?.tier === "official-client" || (line?.tier === "forever-reference" && line?.confidence === "high"))) return "forever-client";
  if (origin === "forever") return "forever-external";
  return "classic-fallback";
}

const present = (value) => value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);

// Identity facts (name, level band, entrance, boss order and names) carry the
// dungeon's provenance tier. Text the importer never had (descriptions,
// strategy) is a Classic fallback when it exists at all.
const IDENTITY = new Set(["name", "levelMin", "levelMax", "entrance", "bossOrder"]);

function importedDungeonValues(dungeon) {
  return {
    name: dungeon.name ?? null,
    subtitle: null,
    description: dungeon.description ?? null,
    levelMin: dungeon.levelMin ?? null,
    levelMax: dungeon.levelMax ?? null,
    entrance: dungeon.entrance ?? null,
    cardArt: dungeon.artworkUrl ?? null,
    overviewArt: null,
    mapArt: (dungeon.maps || []).find((map) => map?.imageUrl)?.imageUrl ?? null,
    bossOrder: (dungeon.bosses || []).map(bossKeyOf),
    tips: null, preparation: null, groupComposition: null, warnings: null, questNotes: null, routeNotes: null, attribution: null, verification: null,
  };
}

function importedBossValues(boss) {
  return {
    name: boss.name ?? null,
    description: null,
    portrait: boss.portraitUrl ?? null,
    strategy: boss.strategy?.summary ?? null,
    tank: boss.strategy?.tank ?? null,
    healer: boss.strategy?.healer ?? null,
    dps: boss.strategy?.dps ?? null,
    positioning: null, interrupts: null, dispels: null,
    mechanics: null,
    lootNotes: null,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One field: who wins and why.
function resolveField(key, imported, override, tier) {
  const importedValue = present(imported) ? imported : null;
  if (!override) {
    return { key, imported: importedValue, importedTier: importedValue === null ? null : tier, override: null, effective: importedValue,
      winner: importedValue === null ? "none" : "imported", conflict: false };
  }
  const editorialTier = override.verified ? "editorial-verified" : "editorial-unverified";
  if (importedValue === null || TIERS[editorialTier] < TIERS[tier] || same(importedValue, override.value)) {
    return { key, imported: importedValue, importedTier: importedValue === null ? null : tier, override, effective: override.value, winner: "editorial",
      conflict: false, editorialTier };
  }
  return { key, imported: importedValue, importedTier: tier, override, effective: importedValue, winner: "imported", conflict: true, editorialTier,
    reason: "Verified Forever client data outranks an unverified edit. Mark the edit verified to publish it over the client value." };
}

function resolveFields(defs, importedValues, overrides, tierOf) {
  return Object.fromEntries(defs.map((field) => [field.key, resolveField(field.key, importedValues[field.key], overrides?.[field.key] || null, tierOf(field.key))]));
}

// { dungeon: fields, bosses: [{ key, imported, fields, orphan }], conflicts, orphans }
export function resolveEditorial(importedDungeon, document) {
  const dungeon = importedDungeon || {};
  const tier = importedTier(dungeon.provenance, dungeon.origin);
  const doc = document || {};
  const dungeonFields = resolveFields(DUNGEON_FIELDS, importedDungeonValues(dungeon), doc.dungeon, (key) => (IDENTITY.has(key) ? tier : "classic-fallback"));
  const importedBosses = dungeon.bosses || [];
  const byKey = new Map(importedBosses.map((boss) => [bossKeyOf(boss), boss]));
  const bosses = importedBosses.map((boss) => {
    const key = bossKeyOf(boss);
    const bossTier = importedTier(boss.provenance?.length ? boss.provenance : dungeon.provenance, dungeon.origin);
    return { key, imported: boss, orphan: false,
      fields: resolveFields(BOSS_FIELDS, importedBossValues(boss), doc.bosses?.[key], (field) => (field === "name" ? bossTier : "classic-fallback")) };
  });
  // Overrides for bosses a later import no longer lists are kept, never
  // dropped: they are orphans until an editor removes them.
  const orphans = Object.keys(doc.bosses || {}).filter((key) => !byKey.has(key));
  const conflicts = [
    ...Object.values(dungeonFields).filter((field) => field.conflict).map((field) => ({ scope: "dungeon", key: field.key, reason: field.reason })),
    ...bosses.flatMap((boss) => Object.values(boss.fields).filter((field) => field.conflict).map((field) => ({ scope: `boss:${boss.key}`, key: field.key, reason: field.reason }))),
  ];
  // Boss order: the effective order lists every imported boss once; keys the
  // order names that the import lacks are skipped, unnamed bosses follow.
  const order = dungeonFields.bossOrder.effective || [];
  const rank = new Map(order.map((key, index) => [key, index]));
  const ordered = bosses.map((boss, index) => ({ boss, index }))
    .sort((a, b) => (rank.get(a.boss.key) ?? order.length + a.index) - (rank.get(b.boss.key) ?? order.length + b.index))
    .map(({ boss }) => boss);
  return { tier, dungeon: dungeonFields, bosses: ordered, conflicts, orphans };
}

// The effective editorial values, flat: what the website and the add-on
// exporter render. Media values stay media ids; resolveMedia turns them into
// URLs (or null when the image is gone).
export function effectiveEditorial(resolution, { resolveMedia = () => null } = {}) {
  const media = (value) => (typeof value === "string" && value.startsWith("m_") ? resolveMedia(value) : value);
  const pick = (fields) => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.effective]));
  const dungeon = pick(resolution.dungeon);
  for (const key of ["cardArt", "overviewArt", "mapArt"]) dungeon[key] = media(dungeon[key]);
  return {
    dungeon,
    bosses: resolution.bosses.map((boss) => {
      const fields = pick(boss.fields);
      fields.portrait = media(fields.portrait);
      return { key: boss.key, ...fields, editorialVerified: Object.values(boss.fields).filter((field) => field.winner === "editorial").every((field) => field.override?.verified) };
    }),
  };
}
