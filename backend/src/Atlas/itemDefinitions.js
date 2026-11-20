// Canonical item definitions (docs/loot-sources.md): one record per item,
// each field taken from the most trusted source that knows it, with the
// source named per field and every disagreement kept.
//
// Precedence, per field:
//   1. "wago-forever"       the WoW Forever client's own tables
//   2. "foreverdb"          ForeverDB (Forever beta/live client datamine and
//                           its players' add-on records)
//   3. "wago-classic-era"   the Classic Era client (Classic reference)
// A lower source never overwrites a higher one, but where two know a field
// and disagree, both values stay in `conflicts`. A field no source knows is
// left out (null), never filled with a guess. Quality, icon and name stay
// unknown for an item the Forever client hides unless a source states them.

export const ITEM_DEFINITIONS_SCHEMA = 1;
export const SOURCES = Object.freeze(["wago-forever", "foreverdb", "wago-classic-era"]);

// Item classes (ItemClass.ClassID) as loot categories.
const CATEGORY = Object.freeze({ 0: "consumable", 1: "container", 2: "equipment", 4: "equipment", 5: "material", 7: "material",
  9: "recipe", 11: "container", 12: "quest", 15: "other" });
export const CATEGORIES = Object.freeze(["equipment", "quest", "recipe", "material", "consumable", "container", "other"]);

const FIELDS = Object.freeze(["name", "quality", "icon", "classId", "subclassId", "inventoryType", "itemLevel", "requiredLevel", "allowableClass",
  "bonding", "delay", "itemSet", "setName", "startQuestId", "sellPrice", "stats", "armor", "resistances", "minDamage", "maxDamage", "dps", "randomStats"]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const known = (value) => value !== null && value !== undefined && !(typeof value === "number" && Number.isNaN(value));

// What each source says, field by field (null: it does not say).
function claimsOf(source, row) {
  if (!row) return {};
  if (source === "wago-forever") {
    // A hidden item: only the Item table's class, slot and (non-zero) icon.
    const keys = row.hidden ? ["classId", "subclassId", "inventoryType", "icon"]
      : ["name", "quality", "icon", "classId", "subclassId", "inventoryType", "itemLevel", "requiredLevel", "allowableClass", "bonding", "delay",
        "itemSet", "setName", "startQuestId", "sellPrice"];
    return Object.fromEntries(keys.map((key) => [key, row[key]]).filter(([key, value]) => known(value) && !(key === "icon" && !value)));
  }
  if (source === "foreverdb") {
    return Object.fromEntries([["name", row.name], ["classId", row.classId], ["subclassId", row.subclassId], ["inventoryType", row.inventoryType],
      ["requiredLevel", row.requiredLevel], ["stats", row.stats], ["armor", row.armor], ["dps", row.dps]].filter(([, value]) => known(value)));
  }
  // The Classic Era client (atlasLoot.js extractItemFacts rows).
  const claims = {};
  for (const key of ["name", "quality", "icon", "classId", "subclassId", "inventoryType", "itemLevel", "requiredLevel", "allowableClass", "bonding",
    "delay", "itemSet", "setName", "startQuestId", "stats", "armor", "resistances", "minDamage", "maxDamage", "randomStats"]) {
    if (known(row[key])) claims[key] = row[key];
  }
  if (row.maxDamage > 0 && row.delay > 0) claims.dps = Math.round((row.minDamage + row.maxDamage) / 2 / (row.delay / 1000) * 10) / 10;
  return claims;
}

// Values that mean the same thing written differently are not conflicts:
// ForeverDB's dps and the Classic client's both round to a tenth, and an
// unnamed (zero) icon is no claim at all.
function agrees(field, a, b) {
  if (field === "dps") return Math.abs(Number(a) - Number(b)) <= 0.15;
  if (field === "stats") return same([...a].sort((x, y) => x[0] - y[0]), [...b].sort((x, y) => x[0] - y[0]));
  return same(a, b);
}

export function categoryOf(definition) {
  return CATEGORY[definition.classId] ?? (definition.classId === null || definition.classId === undefined ? null : "other");
}

// rows: { "wago-forever": [...], "foreverdb": [...], "wago-classic-era": [...] }
// itemIds: the items to define (every item any row names, when null).
export function buildItemDefinitions({ rows, itemIds = null }) {
  const bySource = Object.fromEntries(SOURCES.map((source) => [source, new Map((rows[source] || []).map((row) => [row.id, row]))]));
  const ids = itemIds ? [...new Set(itemIds)] : [...new Set(SOURCES.flatMap((source) => [...bySource[source].keys()]))];
  const items = [];
  // Only the sources given (a set built without ForeverDB names nothing of it).
  const report = { items: 0, bySource: Object.fromEntries(SOURCES.filter((source) => rows[source]).map((source) => [source, 0])), foreverClient: 0, hiddenInClient: 0,
    unknownName: 0, unknownQuality: 0, conflicts: 0, conflictFields: {} };
  for (const itemId of ids.sort((a, b) => a - b)) {
    const claims = Object.fromEntries(SOURCES.map((source) => [source, claimsOf(source, bySource[source].get(itemId))]));
    const definition = { itemId };
    const provenance = {};
    const conflicts = [];
    for (const field of FIELDS) {
      const holders = SOURCES.filter((source) => known(claims[source][field]));
      if (!holders.length) continue;
      definition[field] = claims[holders[0]][field];
      provenance[field] = holders[0];
      const differing = holders.filter((source) => !agrees(field, claims[source][field], definition[field]));
      if (differing.length) {
        conflicts.push({ field, values: Object.fromEntries(holders.map((source) => [source, claims[source][field]])) });
        report.conflictFields[field] = (report.conflictFields[field] || 0) + 1;
      }
    }
    const sources = SOURCES.filter((source) => bySource[source].has(itemId));
    if (!sources.length) continue;
    const forever = bySource["wago-forever"].get(itemId);
    definition.category = categoryOf(definition);
    // In the Forever client and named by it, or kept from elsewhere.
    definition.foreverClient = forever ? (forever.hidden ? "hidden" : "visible") : "absent";
    definition.sources = sources;
    // Per source, the fields it supplied (smaller than one entry per field).
    definition.provenance = Object.fromEntries(SOURCES.map((source) => [source, FIELDS.filter((field) => provenance[field] === source)])
      .filter(([, fields]) => fields.length));
    if (conflicts.length) definition.conflicts = conflicts;
    items.push(definition);
    report.items += 1;
    for (const source of sources) report.bySource[source] += 1;
    if (definition.foreverClient === "visible") report.foreverClient += 1;
    if (definition.foreverClient === "hidden") report.hiddenInClient += 1;
    if (!known(definition.name)) report.unknownName += 1;
    if (!known(definition.quality)) report.unknownQuality += 1;
    if (conflicts.length) report.conflicts += 1;
  }
  return { schemaVersion: ITEM_DEFINITIONS_SCHEMA, items, report };
}

// A definition as an item-facts row (atlasLoot.js extractItemFacts' shape),
// for the reference-loot pipeline: unknown values stay null (stats null:
// not known, which referenceItemOf shows as unknown, not as "no stats").
export function definitionAsFacts(definition) {
  const statsKnown = Array.isArray(definition.stats);
  return {
    id: definition.itemId, name: definition.name ?? null, quality: definition.quality ?? null, icon: definition.icon ?? null,
    classId: definition.classId ?? null, subclassId: definition.subclassId ?? null, inventoryType: definition.inventoryType ?? 0,
    itemLevel: definition.itemLevel ?? null, requiredLevel: definition.requiredLevel ?? null, allowableClass: definition.allowableClass ?? null,
    bonding: definition.bonding ?? 0, armor: definition.armor ?? 0, resistances: definition.resistances ?? [0, 0, 0, 0, 0, 0],
    minDamage: definition.minDamage ?? 0, maxDamage: definition.maxDamage ?? 0, delay: definition.delay ?? 0,
    stats: statsKnown ? definition.stats : [], statsKnown, randomStats: definition.randomStats === true, dps: definition.dps ?? null,
    itemSet: definition.itemSet ?? 0, setName: definition.setName ?? null, startQuestId: definition.startQuestId ?? 0,
    category: definition.category ?? null, foreverClient: definition.foreverClient, factSources: definition.sources,
  };
}

// The reference loot's item inputs from the extracts: the definitions, the
// Classic extract with its items replaced by the merged facts (its class and
// subclass names kept), and the item sources named for provenance. One
// function, so the importer and the tests build the same thing.
//   classic   wago-classic-era-items.json; forever wago-forever-items.json;
//   foreverdb foreverdb-items.json (either may be null)
export function referenceItemInputs({ classic, forever = null, foreverdb = null }) {
  const definitions = buildItemDefinitions({ rows: { "wago-forever": forever?.tables?.items, foreverdb: foreverdb?.tables?.items,
    "wago-classic-era": classic?.tables?.items } });
  const sources = [forever, foreverdb, classic].filter(Boolean)
    .map(({ source, url, revision, retrievedAt, license, attribution }) => ({ source, url, revision, retrievedAt, license, ...(attribution ? { attribution } : {}) }));
  const factItems = classic ? { ...classic, tables: { ...classic.tables, items: definitions.items.map(definitionAsFacts) } } : classic;
  return { definitions, factItems, sources };
}
