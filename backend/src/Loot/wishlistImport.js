// Importing a wishlist an AI (or a person) wrote as JSON.
//
// The text is never trusted. It is parsed, checked field by field against
// the import schema, and every item id is checked against what the website
// actually knows: an id nobody has seen is refused, and an id whose known
// name is not the name the text gives is refused too (that is what an
// invented id looks like). Nothing here creates an item record.
//
// Every problem is reported with a code, the JSON path, what was received,
// what was expected and how to fix it, so the same list can be handed back
// to the AI (wishlistPrompt.js builds that repair prompt).
//
// validateWishlistImport is pure: its lookups are passed in.

import { referenceItemsByName } from "../Atlas/referenceLoot.js";
import { withGuildTransaction } from "../Data/database.js";
import { lootItemFactsInDatabase, lootSourcesForItemsInDatabase } from "./lootCatalogRepository.js";
import { MAX_NOTE, MAX_SOURCE_DUNGEON, MAX_WISHLIST_ITEMS, PRIORITIES, isObject, normalizedName, wishlistItemKey } from "./lootModel.js";
import { buildRepairPrompt } from "./wishlistPrompt.js";
import { cleanWishlistFields, ownedCharacterInDatabase, readWishlistInDatabase, upsertWishlistItemInDatabase } from "./wishlistRepository.js";

export const IMPORT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 100_000;
export const MAX_IMPORT_ITEMS = MAX_WISHLIST_ITEMS;
export const MAX_ITEM_ID = 2_147_483_647;

const DOCUMENT_FIELDS = ["schemaVersion", "character", "items", "catalogRevision"];
const ITEM_FIELDS = ["itemId", "variant", "name", "priority", "note", "sourceDungeon"];

// A value as it may be shown back: short, and never a nested structure.
function shown(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  return Array.isArray(value) ? "[array]" : "[object]";
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ```json … ``` around the whole answer is how chat assistants reply.
function withoutCodeFence(text) {
  const match = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return match ? { text: match[1], fenced: true } : { text, fenced: false };
}

function jsonErrorPlace(error, text) {
  const position = Number(/position (\d+)/.exec(String(error?.message || ""))?.[1]);
  if (!Number.isInteger(position)) return {};
  const before = text.slice(0, position);
  return { position, line: before.split("\n").length, column: position - before.lastIndexOf("\n"), near: text.slice(Math.max(0, position - 30), position + 30) };
}

// { ok, errors, warnings, entries, summary }. `existing` is the character's
// current wishlist rows ({ itemKey, priority, note, sourceDungeon, state }).
// `lookups`: item(itemId) → facts with nameKnown, itemsByName(name) →
// [{ itemId, name }], sources(itemId) → catalog sources.
export function validateWishlistImport({ text, character, existing = [], lookups }) {
  const errors = [];
  const warnings = [];
  const fail = (scope, code, category, path, detail) => { errors.push({ code, category, scope, path, ...detail }); };
  const done = (entries = []) => {
    const invalid = new Set(errors.filter((error) => error.scope === "item").map((error) => error.index));
    const count = (action) => entries.filter((entry) => entry.action === action).length;
    return { ok: errors.length === 0, schemaVersion: IMPORT_SCHEMA_VERSION, errors, warnings, entries,
      // Whether leaving the bad items out would leave something to import.
      partialPossible: errors.length > 0 && errors.every((error) => error.scope === "item") && entries.length > 0,
      summary: { total: entries.length + invalid.size, add: count("add"), update: count("update"), unchanged: count("unchanged"), invalid: invalid.size } };
  };

  const source = String(text ?? "");
  if (!source.trim()) {
    fail("document", "empty", "json", "$", { expected: "a JSON object", message: "Nothing was pasted.", suggestion: "Paste the JSON the AI returned." });
    return done();
  }
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > MAX_IMPORT_BYTES) {
    fail("document", "too_large", "limit", "$", { received: `${bytes} bytes`, expected: `at most ${MAX_IMPORT_BYTES} bytes`,
      message: "The import is too large to read.", suggestion: `Return at most ${MAX_IMPORT_ITEMS} items with short notes, and nothing but the JSON.` });
    return done();
  }
  const unfenced = withoutCodeFence(source);
  if (unfenced.fenced) warnings.push({ code: "code_fence_removed", path: "$", message: "The JSON was wrapped in a Markdown code block; the wrapper was ignored." });
  let document;
  try {
    document = JSON.parse(unfenced.text);
  } catch (error) {
    const place = jsonErrorPlace(error, unfenced.text);
    fail("document", "invalid_json", "json", "$", { ...place, received: shown(place.near), expected: "one valid JSON object",
      message: `This is not valid JSON${place.line ? ` (line ${place.line}, column ${place.column})` : ""}: ${String(error.message).slice(0, 160)}`,
      suggestion: "Return only the JSON object: double-quoted keys and strings, no comments, no trailing commas, no text before or after it." });
    return done();
  }
  if (!isObject(document)) {
    fail("document", "wrong_type", "schema", "$", { received: typeName(document), expected: "object",
      message: "The top level must be a JSON object.", suggestion: 'Wrap the list: { "schemaVersion": 1, "character": "...", "items": [ ... ] }.' });
    return done();
  }

  for (const key of Object.keys(document)) {
    if (!DOCUMENT_FIELDS.includes(key)) {
      fail("document", "unknown_field", "schema", `$.${key}`, { received: shown(document[key]), expected: `one of ${DOCUMENT_FIELDS.join(", ")}`,
        message: `"${key}" is not a field of the import format.`, suggestion: `Remove "${key}".` });
    }
  }
  if (document.schemaVersion === undefined) {
    fail("document", "missing_field", "schema", "$.schemaVersion", { expected: IMPORT_SCHEMA_VERSION, message: "schemaVersion is missing.", suggestion: `Add "schemaVersion": ${IMPORT_SCHEMA_VERSION}.` });
  } else if (document.schemaVersion !== IMPORT_SCHEMA_VERSION) {
    fail("document", "unsupported_schema_version", "schema", "$.schemaVersion", { received: shown(document.schemaVersion), expected: IMPORT_SCHEMA_VERSION,
      message: `Only schemaVersion ${IMPORT_SCHEMA_VERSION} is supported.`, suggestion: `Set "schemaVersion": ${IMPORT_SCHEMA_VERSION} (a number) and follow that format.` });
  }
  if (typeof document.character !== "string" || !document.character.trim()) {
    fail("document", document.character === undefined ? "missing_field" : "wrong_type", "schema", "$.character", { received: shown(document.character), expected: character.name,
      message: "character must be the name of the character this list is for.", suggestion: `Set "character": ${JSON.stringify(character.name)}.` });
  } else if (normalizedName(document.character) !== normalizedName(character.name)) {
    fail("document", "character_mismatch", "schema", "$.character", { received: shown(document.character), expected: character.name,
      message: `This list is for "${shown(document.character)}", but the selected character is ${character.name}.`,
      suggestion: `Select that character, or plan the list for ${character.name} and set "character": ${JSON.stringify(character.name)}.` });
  }
  if (document.catalogRevision !== undefined && !(Number.isSafeInteger(document.catalogRevision) && document.catalogRevision >= 0)) {
    fail("document", "wrong_type", "schema", "$.catalogRevision", { received: shown(document.catalogRevision), expected: "a whole number",
      message: "catalogRevision must be the number from the planning prompt.", suggestion: "Copy catalogRevision from the prompt, or remove it." });
  }
  if (!Array.isArray(document.items)) {
    fail("document", document.items === undefined ? "missing_field" : "wrong_type", "schema", "$.items", { received: typeName(document.items), expected: "array",
      message: "items must be a list of wishlist items.", suggestion: 'Add "items": [ { "itemId": ..., "priority": "normal" } ].' });
    return done();
  }
  if (!document.items.length) {
    fail("document", "no_items", "schema", "$.items", { received: "[]", expected: "at least one item", message: "The list has no items.", suggestion: "Add the recommended items." });
    return done();
  }
  if (document.items.length > MAX_IMPORT_ITEMS) {
    fail("document", "too_many_items", "limit", "$.items", { received: `${document.items.length} items`, expected: `at most ${MAX_IMPORT_ITEMS} items`,
      message: `A wishlist holds at most ${MAX_IMPORT_ITEMS} items.`, suggestion: `Keep the ${MAX_IMPORT_ITEMS} most useful items.` });
    return done();
  }

  const current = new Map(existing.map((row) => [row.itemKey, row]));
  const firstPath = new Map();
  const entries = [];
  document.items.forEach((raw, index) => {
    const path = `$.items[${index}]`;
    const before = errors.length;
    const bad = (code, category, field, detail) => fail("item", code, category, field ? `${path}.${field}` : path, { index, ...detail });
    if (!isObject(raw)) {
      bad("wrong_type", "schema", "", { received: typeName(raw), expected: "object", message: "Each item must be an object.", suggestion: 'Use { "itemId": 12345, "priority": "normal" }.' });
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!ITEM_FIELDS.includes(key)) {
        bad("unknown_field", "schema", key, { received: shown(raw[key]), expected: `one of ${ITEM_FIELDS.join(", ")}`,
          message: `"${key}" is not a field of a wishlist item.`, suggestion: `Remove "${key}"${typeof raw[key] === "string" ? ' (put any explanation in "note")' : ""}.` });
      }
    }
    const nameGiven = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
    if (raw.name !== undefined && typeof raw.name !== "string") {
      bad("wrong_type", "schema", "name", { received: typeName(raw.name), expected: "string", message: "name must be text.", suggestion: "Give the item's name as a string, or remove it." });
    }
    const candidatesFor = (name) => (name ? lookups.itemsByName(name).slice(0, 8) : []);

    let itemId = null;
    if (raw.itemId === undefined) {
      const candidates = candidatesFor(nameGiven);
      bad(candidates.length > 1 ? "item_name_ambiguous" : "item_id_missing", candidates.length ? "catalog" : "schema", "itemId", {
        expected: "a whole number: the item's id", candidates,
        message: !nameGiven ? "itemId is missing." : candidates.length > 1 ? `"${shown(nameGiven)}" is the name of ${candidates.length} different items; the id says which.`
          : candidates.length ? `itemId is missing. An item named "${shown(nameGiven)}" is known.` : `itemId is missing, and no item named "${shown(nameGiven)}" is known.`,
        suggestion: candidates.length ? "Use the itemId of the candidate that is meant." : "Use an itemId from the catalog in the planning prompt, or drop this item." });
    } else if (typeof raw.itemId !== "number" || !Number.isInteger(raw.itemId) || raw.itemId < 1 || raw.itemId > MAX_ITEM_ID) {
      bad("invalid_item_id", "schema", "itemId", { received: shown(raw.itemId), expected: `a whole number from 1 to ${MAX_ITEM_ID}`,
        message: "itemId must be a whole number (not a string, not a decimal).",
        suggestion: typeof raw.itemId === "string" && /^\d+$/.test(raw.itemId.trim()) ? `Write it without quotes: ${Number(raw.itemId)}.` : "Use the numeric item id from the catalog." });
    } else {
      itemId = raw.itemId;
    }

    let itemKey = itemId ? `i:${itemId}` : null;
    if (raw.variant !== undefined) {
      const key = typeof raw.variant === "string" && itemId ? wishlistItemKey(itemId, raw.variant) : null;
      if (itemId && !key) {
        bad("invalid_variant", "schema", "variant", { received: shown(raw.variant), expected: `"i:${itemId}" or a variant of it such as "i:${itemId}:s-1081"`,
          message: "variant is not a variant key of this itemId.", suggestion: "Remove variant unless the catalog lists that exact key." });
        itemKey = null;
      } else if (key) {
        itemKey = key;
      }
    }

    const fields = cleanWishlistFields({ priority: raw.priority, note: raw.note, sourceDungeon: raw.sourceDungeon }, { partial: true });
    if (raw.priority !== undefined && !PRIORITIES.includes(raw.priority)) {
      bad("invalid_priority", "schema", "priority", { received: shown(raw.priority), expected: PRIORITIES.join(" | "),
        message: "priority must be high, normal or low.", suggestion: 'Use "high", "normal" or "low" (lower case), or leave it out for normal.' });
    }
    for (const [field, max] of [["note", MAX_NOTE], ["sourceDungeon", MAX_SOURCE_DUNGEON]]) {
      if (raw[field] === undefined) continue;
      if (typeof raw[field] !== "string") {
        bad("wrong_type", "schema", field, { received: typeName(raw[field]), expected: "string", message: `${field} must be text.`, suggestion: `Give ${field} as a string, or remove it.` });
      } else if (raw[field].trim().length > max) {
        bad("text_too_long", "schema", field, { received: `${raw[field].trim().length} characters`, expected: `at most ${max} characters`,
          message: `${field} is too long.`, suggestion: `Shorten it to ${max} characters or fewer.` });
      }
    }

    // The catalog checks: only once the id itself is well formed.
    let facts = null;
    if (itemId) {
      facts = lookups.item(itemId);
      if (!facts?.nameKnown) {
        const candidates = candidatesFor(nameGiven);
        bad("unknown_item", "catalog", "itemId", { received: itemId, expected: "the id of an item Guildweaver knows", candidates,
          message: `Guildweaver has no record of item ${itemId}. The JSON is well formed: this is missing catalog knowledge, or an id that does not exist.`,
          suggestion: candidates.length ? `If "${shown(nameGiven)}" was meant, use one of the candidate ids.`
            : "Use only item ids listed in the planning prompt. Do not make up an id; drop the item if it is not listed." });
      } else if (nameGiven && normalizedName(nameGiven) !== normalizedName(facts.name)) {
        const candidates = candidatesFor(nameGiven);
        bad("item_name_mismatch", "catalog", "itemId", { received: itemId, expected: `the id of "${shown(nameGiven)}"`, candidates,
          message: `Item ${itemId} is "${facts.name}", not "${shown(nameGiven)}". An id that does not match its name is usually an invented id.`,
          suggestion: candidates.length ? `Use the candidate id for "${shown(nameGiven)}", or correct the name if ${facts.name} was meant.`
            : `No item named "${shown(nameGiven)}" is known. Drop it, or use the catalog's id and name.` });
      }
    }

    if (itemKey && firstPath.has(itemKey)) {
      bad("duplicate_item", "schema", "", { received: itemKey, expected: "each item once",
        message: `This is the same item as ${firstPath.get(itemKey)}.`, suggestion: "Keep one entry for the item and merge the notes." });
    } else if (itemKey) {
      firstPath.set(itemKey, path);
    }
    if (errors.length > before || !itemKey) return;

    const had = current.get(itemKey);
    const wanted = { priority: fields.fields?.priority, note: fields.fields?.note, sourceDungeon: fields.fields?.sourceDungeon };
    const changes = {};
    if (had) {
      // Only what the import says is compared: a field it leaves out keeps
      // the wishlist's value.
      for (const key of ["priority", "note", "sourceDungeon"]) {
        if (wanted[key] !== undefined && wanted[key] !== (had[key] ?? "")) changes[key] = { from: had[key] ?? "", to: wanted[key] };
      }
      if (had.state === "acquired") warnings.push({ code: "already_acquired", path, index, message: `${facts.name} is already marked acquired; importing does not make it wanted again.` });
    }
    const sources = lookups.sources(itemId);
    if (!sources.length) {
      warnings.push({ code: "not_in_dungeon_catalog", path, index, message: `${facts.name} exists, but no dungeon source is known for it yet.` });
    } else if (sources.every((entry) => entry.confidence === "delisted")) {
      warnings.push({ code: "stale_catalog_item", path, index, message: `${facts.name} is no longer listed for ${sources[0].source || sources[0].dungeon}; the catalog this list was planned from may be out of date.` });
    } else if (wanted.sourceDungeon && !sources.some((entry) => normalizedName(entry.dungeon) === normalizedName(wanted.sourceDungeon))) {
      warnings.push({ code: "source_dungeon_unknown", path, index, message: `${facts.name} is not known to come from "${shown(wanted.sourceDungeon)}" (known: ${[...new Set(sources.map((entry) => entry.dungeon))].slice(0, 3).join(", ")}).` });
    }
    entries.push({ index, path, itemId, itemKey, name: facts.name, qualityId: facts.qualityId ?? null, iconFileDataId: facts.iconFileDataId ?? null,
      priority: wanted.priority ?? had?.priority ?? "normal", note: wanted.note ?? had?.note ?? "", sourceDungeon: wanted.sourceDungeon ?? had?.sourceDungeon ?? "",
      fields: Object.fromEntries(Object.entries(wanted).filter(([, value]) => value !== undefined)),
      action: !had ? "add" : Object.keys(changes).length ? "update" : "unchanged", changes });
  });

  const adds = entries.filter((entry) => entry.action === "add").length;
  if (current.size + adds > MAX_WISHLIST_ITEMS) {
    fail("document", "wishlist_full", "limit", "$.items", { received: `${adds} new items onto ${current.size}`, expected: `at most ${MAX_WISHLIST_ITEMS} in total`,
      message: `The wishlist would hold ${current.size + adds} items; the limit is ${MAX_WISHLIST_ITEMS}.`, suggestion: "Import fewer items, or remove some from the wishlist first." });
  }
  if (Number.isSafeInteger(document.catalogRevision) && Number.isSafeInteger(lookups.catalogRevision) && document.catalogRevision < lookups.catalogRevision) {
    warnings.push({ code: "catalog_changed", path: "$.catalogRevision", message: `The loot catalog changed since this list was planned (revision ${document.catalogRevision}, now ${lookups.catalogRevision}). Every item was checked against the current catalog.` });
  }
  return done(entries);
}

export function importLookupsInDatabase(db, { catalogRevision = null } = {}) {
  const facts = new Map();
  const sources = new Map();
  return {
    catalogRevision,
    item(itemId) {
      if (!facts.has(itemId)) facts.set(itemId, lootItemFactsInDatabase(db, [itemId])(itemId));
      return facts.get(itemId);
    },
    // Items with exactly this name, ones with a dungeon source first.
    itemsByName(name) {
      const rows = db.prepare(`SELECT m.item_id AS itemId, m.name, EXISTS(SELECT 1 FROM dungeon_loot_entries e WHERE e.item_id = m.item_id) AS dungeon
        FROM market_item_meta m WHERE m.name = ? COLLATE NOCASE AND m.name <> '' ORDER BY dungeon DESC, m.item_id LIMIT 9`).all(String(name).trim().slice(0, 120));
      const found = rows.map((row) => ({ itemId: row.itemId, name: row.name, inDungeonCatalog: Boolean(row.dungeon) }));
      // Classic reference items the site's item index does not have yet.
      for (const item of referenceItemsByName(name)) {
        if (found.length < 9 && !found.some((entry) => entry.itemId === item.itemId)) found.push({ itemId: item.itemId, name: item.name, inDungeonCatalog: true });
      }
      return found;
    },
    sources(itemId) {
      if (!sources.has(itemId)) sources.set(itemId, lootSourcesForItemsInDatabase(db, [itemId]).get(itemId) || []);
      return sources.get(itemId);
    },
  };
}

// Checks an import and, with commit, applies it. All or nothing: a list
// with any error changes nothing, unless the player chose to leave the bad
// items out (skipInvalid) and every error is about a single item. Matching
// entries are only changed when the player confirmed that (updateExisting).
// Existing entries the import does not name are never touched.
export function importWishlist({ memberId, characterId, text, commit = false, skipInvalid = false, updateExisting = false, catalogRevision = null }) {
  const member = String(memberId ?? "").trim();
  return withGuildTransaction((db) => {
    const character = ownedCharacterInDatabase(db, member, characterId);
    if (!character) return { status: "not-found" };
    const before = readWishlistInDatabase(db, member, character.id);
    const result = validateWishlistImport({ text, character, existing: before.items, lookups: importLookupsInDatabase(db, { catalogRevision }) });
    const response = { ...result, character: { id: character.id, name: character.name },
      repairPrompt: result.errors.length ? buildRepairPrompt({ text: String(text ?? ""), errors: result.errors, character }) : null };
    if (!commit) return { status: "preview", ...response };
    if (!result.ok && !(skipInvalid && result.partialPossible)) return { status: "rejected", ...response };

    const now = Math.floor(Date.now() / 1000);
    const applied = { added: 0, updated: 0, unchanged: 0, skippedUpdates: 0, skippedInvalid: result.summary.invalid };
    for (const entry of result.entries) {
      if (entry.action === "unchanged") { applied.unchanged += 1; continue; }
      if (entry.action === "update" && !updateExisting) { applied.skippedUpdates += 1; continue; }
      const outcome = upsertWishlistItemInDatabase(db, { memberId: member, character, itemKey: entry.itemKey, fields: entry.fields, origin: "ai_import", now });
      // The capacity was checked above; anything else is a bug, and the
      // transaction takes the whole import back.
      if (outcome === "full") throw new Error("Wishlist import exceeded the wishlist limit");
      if (outcome === "created") applied.added += 1; else applied.updated += 1;
    }
    if (applied.added || applied.updated) {
      const bump = db.prepare(`INSERT INTO character_wishlist_revisions (member_id, character_id, revision, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(member_id, character_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at`);
      bump.run(member, character.id, now);
      bump.run(member, "", now);
    }
    return { status: "imported", ...response, applied, wishlist: readWishlistInDatabase(db, member, character.id, now) };
  });
}
