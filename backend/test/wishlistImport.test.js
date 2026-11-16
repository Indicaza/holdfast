import assert from "node:assert/strict";
import test from "node:test";

import { MAX_IMPORT_BYTES, MAX_IMPORT_ITEMS, validateWishlistImport } from "../src/Loot/wishlistImport.js";
import { buildPlanningPrompt, buildRepairPrompt } from "../src/Loot/wishlistPrompt.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { ITEMS, WAILING, connect, corpseLoot, journalSnapshot, seedItems, syncCharacter } from "../testSupport/lootHarness.js";

// The AI wishlist builder: a prompt to copy, a JSON import that trusts
// nothing, errors precise enough to hand back to the AI, and an import that
// is all or nothing.

const ROOK = { id: "rook", name: "Rook Shepard" };
const KNOWN = new Map(Object.values(ITEMS).map((item) => [item.itemId, { ...item, nameKnown: true }]));
const lookups = {
  catalogRevision: 7,
  item: (itemId) => KNOWN.get(itemId) || { itemId, name: `Item ${itemId}`, nameKnown: false },
  itemsByName: (name) => [...KNOWN.values()].filter((item) => item.name.toLowerCase() === String(name).toLowerCase()).map((item) => ({ itemId: item.itemId, name: item.name })),
  sources: (itemId) => (itemId === 2168 ? [] : itemId === 5201 ? [{ dungeon: "The Deadmines", source: "Edwin VanCleef", confidence: "delisted" }]
    : [{ dungeon: itemId === 6468 ? "Wailing Caverns" : "The Deadmines", source: "Edwin VanCleef", confidence: "confirmed" }]),
};
const document = (items, extra = {}) => JSON.stringify({ schemaVersion: 1, character: "Rook Shepard", items, ...extra });
const check = (text, existing = []) => validateWishlistImport({ text, character: ROOK, existing, lookups });
const codes = (result) => result.errors.map((error) => error.code);

test("a valid import is previewed as adds, updates and unchanged entries", () => {
  const result = check(document([
    { itemId: 5191, name: "Cruel Barb", priority: "high", note: "Tank-oriented upgrade", sourceDungeon: "The Deadmines" },
    { itemId: 5193, note: "Lateral: more stamina" },
    { itemId: 6468 },
  ], { catalogRevision: 7 }), [
    { itemKey: "i:5193", priority: "normal", note: "", sourceDungeon: null, state: "wanted" },
    { itemKey: "i:6468", priority: "normal", note: "", sourceDungeon: null, state: "wanted" },
    { itemKey: "i:2168", priority: "low", note: "keep me", sourceDungeon: null, state: "wanted" },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.entries.map((entry) => [entry.itemKey, entry.action]), [["i:5191", "add"], ["i:5193", "update"], ["i:6468", "unchanged"]]);
  assert.deepEqual(result.entries[1].changes, { note: { from: "", to: "Lateral: more stamina" } }, "only what the import says is compared");
  assert.deepEqual(result.summary, { total: 3, add: 1, update: 1, unchanged: 1, invalid: 0 });
  assert.equal(result.entries[0].name, "Cruel Barb");
  assert.ok(!result.entries.some((entry) => entry.itemKey === "i:2168"), "an entry the import does not name is not touched");
  assert.equal(result.warnings.length, 0);
});

test("a chat answer wrapped in a code block still imports, with a note", () => {
  const result = check(`\`\`\`json\n${document([{ itemId: 5191 }])}\n\`\`\``);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["code_fence_removed"]);
});

test("malformed JSON says where and how to fix it", () => {
  const broken = '{ "schemaVersion": 1, "character": "Rook Shepard", "items": [ { "itemId": 5191, }, ] }';
  const result = check(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ["invalid_json"]);
  const [error] = result.errors;
  assert.equal(error.category, "json");
  assert.equal(error.path, "$");
  assert.equal(error.line, 1);
  assert.ok(error.column > 1);
  assert.match(error.message, /not valid JSON \(line 1, column \d+\)/);
  assert.match(error.suggestion, /trailing commas/);
  assert.equal(result.partialPossible, false, "there is nothing to import from text that does not parse");
  assert.deepEqual(codes(check("")), ["empty"]);
  assert.deepEqual(codes(check("Here is your wishlist!")), ["invalid_json"]);
  assert.deepEqual(codes(check("[1, 2]")), ["wrong_type"]);
});

test("the schema is checked field by field, each item on its own", () => {
  const result = check(JSON.stringify({ schemaVersion: 2, character: "Fern", comment: "hi", items: [
    { itemId: "5191" }, { itemId: 5193.5 }, { itemId: -4 }, { itemId: 5191, priority: "urgent" }, { itemId: 5193, note: "x".repeat(141) },
    { itemId: 6468, variant: "i:999:s-1" }, { itemId: 6694, reason: "because", stats: { stamina: 4 } }, "5191", { itemId: 2168, note: 7 }, { name: "Cruel Barb" }, {},
  ] }));
  const at = (path) => result.errors.filter((error) => error.path === path).map((error) => error.code);
  assert.deepEqual(at("$.schemaVersion"), ["unsupported_schema_version"]);
  assert.deepEqual(at("$.character"), ["character_mismatch"]);
  assert.deepEqual(at("$.comment"), ["unknown_field"]);
  assert.deepEqual(at("$.items[0].itemId"), ["invalid_item_id"]);
  assert.match(result.errors.find((error) => error.path === "$.items[0].itemId").suggestion, /without quotes: 5191/);
  assert.deepEqual(at("$.items[1].itemId"), ["invalid_item_id"]);
  assert.deepEqual(at("$.items[2].itemId"), ["invalid_item_id"]);
  assert.deepEqual(at("$.items[3].priority"), ["invalid_priority"]);
  assert.deepEqual(at("$.items[4].note"), ["text_too_long"]);
  assert.deepEqual(at("$.items[5].variant"), ["invalid_variant"]);
  assert.deepEqual(at("$.items[6].reason"), ["unknown_field"]);
  assert.deepEqual(at("$.items[6].stats"), ["unknown_field"]);
  assert.equal(result.errors.find((error) => error.path === "$.items[6].stats").received, "[object]", "nested values are never echoed");
  assert.deepEqual(at("$.items[7]"), ["wrong_type"]);
  assert.deepEqual(at("$.items[8].note"), ["wrong_type"]);
  assert.deepEqual(at("$.items[9].itemId"), ["item_id_missing"]);
  assert.deepEqual(result.errors.find((error) => error.path === "$.items[9].itemId").candidates, [{ itemId: 5191, name: "Cruel Barb" }], "the name finds the id");
  assert.deepEqual(at("$.items[10].itemId"), ["item_id_missing"]);
  for (const error of result.errors) {
    for (const field of ["code", "category", "path", "message", "suggestion"]) assert.ok(error[field], `${error.code} has ${field}`);
    assert.ok(error.expected !== undefined, `${error.code} says what was expected`);
  }
  assert.equal(result.entries.length, 0);
  assert.equal(result.partialPossible, false, "document errors cannot be skipped");
});

test("invented, unknown and ambiguous items are catalog errors, never accepted", () => {
  const result = check(document([
    { itemId: 987654, name: "Blade of Imagined Glory" },
    { itemId: 5193, name: "Cruel Barb" },
    { name: "Band of Echoes", priority: "high" },
    { itemId: 987655, name: "Phantom Shield" },
    { itemId: 6468, name: "deviate scale belt" },
  ]));
  const [unknown, mismatch, ambiguous, wrongId] = result.errors;
  assert.equal(unknown.code, "unknown_item");
  assert.equal(unknown.category, "catalog", "missing knowledge, not a formatting mistake");
  assert.match(unknown.message, /well formed: this is missing catalog knowledge/);
  assert.match(unknown.suggestion, /Do not make up an id/);
  assert.equal(mismatch.code, "item_name_mismatch");
  assert.match(mismatch.message, /Item 5193 is "Cape of the Brotherhood", not "Cruel Barb"/);
  assert.deepEqual(mismatch.candidates, [{ itemId: 5191, name: "Cruel Barb" }]);
  assert.equal(ambiguous.code, "item_name_ambiguous");
  assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.itemId), [7001, 7002]);
  assert.equal(wrongId.code, "unknown_item");
  assert.deepEqual(wrongId.candidates, [{ itemId: 6694, name: "Phantom Shield" }], "the right id for the name is offered");
  assert.deepEqual(result.entries.map((entry) => entry.itemId), [6468], "case does not matter for a name; the valid item is kept");
  assert.equal(result.partialPossible, true);
  assert.equal(result.summary.invalid, 4);
});

test("duplicates, conflicts with the wishlist, stale items and limits", () => {
  const duplicate = check(document([{ itemId: 5191, note: "a" }, { itemId: 5193 }, { itemId: 5191, note: "b" }, { itemId: 6468, variant: "i:6468:s-1081" }, { itemId: 6468 }]));
  assert.deepEqual(codes(duplicate), ["duplicate_item"]);
  assert.equal(duplicate.errors[0].path, "$.items[2]");
  assert.match(duplicate.errors[0].message, /same item as \$\.items\[0\]/);
  assert.deepEqual(duplicate.entries.map((entry) => entry.itemKey), ["i:5191", "i:5193", "i:6468:s-1081", "i:6468"], "a variant and its base item are two identities");

  const conflict = check(document([{ itemId: 5191, priority: "low", note: "sidegrade" }, { itemId: 5201 }, { itemId: 2168 }, { itemId: 6468, sourceDungeon: "The Deadmines" }], { catalogRevision: 3 }),
    [{ itemKey: "i:5191", priority: "high", note: "Main hand", sourceDungeon: "The Deadmines", state: "acquired" }]);
  assert.equal(conflict.ok, true);
  assert.deepEqual(conflict.entries[0].changes, { priority: { from: "high", to: "low" }, note: { from: "Main hand", to: "sidegrade" } });
  assert.deepEqual(conflict.warnings.map((warning) => warning.code).sort(),
    ["already_acquired", "catalog_changed", "not_in_dungeon_catalog", "source_dungeon_unknown", "stale_catalog_item"]);

  const many = check(document(Array.from({ length: MAX_IMPORT_ITEMS + 1 }, () => ({ itemId: 5191 }))));
  assert.deepEqual(codes(many), ["too_many_items"]);
  const huge = check(document([{ itemId: 5191, note: "x".repeat(MAX_IMPORT_BYTES) }]));
  assert.deepEqual(codes(huge), ["too_large"]);
  assert.equal(huge.entries.length, 0, "an oversized paste is not even parsed");
  const full = check(document([{ itemId: 5191 }]), Array.from({ length: 200 }, (_, index) => ({ itemKey: `i:${90000 + index}`, priority: "normal", note: "", state: "wanted" })));
  assert.deepEqual(codes(full), ["wishlist_full"]);
  assert.deepEqual(codes(check(document([]))), ["no_items"]);
  assert.deepEqual(codes(check(JSON.stringify({ schemaVersion: 1, character: "Rook Shepard" }))), ["missing_field"]);
});

test("the repair prompt carries the attempt, the exact errors and the rules", () => {
  const text = document([{ itemId: 987654, name: "Blade of Imagined Glory" }, { itemId: 5191, priority: "urgent" }, { itemId: 5193 }]);
  const result = check(text);
  const prompt = buildRepairPrompt({ text, errors: result.errors, character: ROOK });
  assert.match(prompt, /FORMAT ERRORS/);
  assert.match(prompt, /\[invalid_priority\] at \$\.items\[1\]\.priority/);
  assert.match(prompt, /received: "urgent"/);
  assert.match(prompt, /CATALOG ERRORS/);
  assert.match(prompt, /\[unknown_item\] at \$\.items\[0\]\.itemId/);
  assert.match(prompt, /Do not fix them by inventing or changing an id/);
  assert.match(prompt, /Keep every item that had no error exactly as it was/);
  assert.match(prompt, /"schemaVersion": 1/);
  assert.match(prompt, /"character": "Rook Shepard"/);
  assert.ok(prompt.includes(text), "the original attempt is included");
  assert.ok(prompt.indexOf("CATALOG ERRORS") > prompt.indexOf("FORMAT ERRORS"), "the two kinds of error are told apart");
});

test("the planning prompt lists the character, its gear, the catalog with ids, and the schema", () => {
  const prompt = buildPlanningPrompt({
    character: { name: "Rook Shepard", level: 19, className: "Warrior", race: "Night Elf", spec: "" },
    equipment: [{ slot: "main hand", itemId: 2168, name: "Corpse Rompers", itemLevel: 20, stats: ["+3 Stamina"] }],
    stats: ["strength 40", "stamina 38"],
    dungeons: [{ name: "The Deadmines", sources: [{ name: "Edwin VanCleef", boss: true, items: [{ ...ITEMS.barb, slot: "One-Hand", itemSubclass: "One-Handed Swords", confidence: "confirmed" },
      { ...ITEMS.cape, slot: "Back", itemSubclass: "Cloth", confidence: "advertised" }] }] }],
    wishlist: [{ itemId: 6468, name: "Deviate Scale Belt", priority: "high", note: "", state: "wanted" }],
    catalogRevision: 12, omitted: 3,
  });
  for (const expected of ["Name: Rook Shepard", "Level: 19", "Class: Warrior", "Race: Night Elf", "Stats: strength 40, stamina 38",
    "main hand: Corpse Rompers (2168), ilvl 20 [+3 Stamina]", "6468 | Deviate Scale Belt | high", "DUNGEON LOOT CATALOG (revision 12)", "The Deadmines", "Edwin VanCleef (boss):",
    "5191 | Cruel Barb | One-Hand, One-Handed Swords, ilvl 24, req 19", "5193 | Cape of the Brotherhood | Back, Cloth, ilvl 23, req 18, advertised",
    "3 more catalog items were left out", "Consider alternative builds and lateral upgrades", "Never invent, guess or adjust an id", "Return valid JSON only",
    '"schemaVersion": 1', '"character": "Rook Shepard"', '"catalogRevision": 12', "Ask me which build or playstyle"]) {
    assert.ok(prompt.includes(expected), `prompt includes: ${expected}`);
  }
});

const ASH = { id: "discord-import-ash", username: "ash" };

async function setup(request) {
  seedItems();
  const ash = await connect(request, ASH);
  const rook = await syncCharacter(request, ash.token, "character-rook", "Rook Shepard");
  await corpseLoot(request, ash.token, { npcId: 639, npcName: "Edwin VanCleef", serial: 1, items: [ITEMS.barb, ITEMS.cape, ITEMS.staff] });
  await corpseLoot(request, ash.token, { npcId: 3653, npcName: "Kresh", serial: 1, items: [ITEMS.belt], instance: WAILING });
  const importing = (body) => request(`/api/player/wishlists/${rook}/import`, { method: "POST", rawCookie: ash.cookie, body });
  const list = async () => (await request(`/api/player/wishlists/${rook}`, { rawCookie: ash.cookie })).json;
  return { ash, rook, importing, list };
}

test("importing over HTTP: preview first, all or nothing, updates only on confirmation", () => withHttpApp(async ({ request }) => {
  const { ash, rook, importing, list } = await setup(request);
  await request(`/api/player/wishlists/${rook}/items/i:5193`, { method: "PUT", rawCookie: ash.cookie, body: { priority: "low", note: "old note" } });
  await request(`/api/player/wishlists/${rook}/items/i:2168`, { method: "PUT", rawCookie: ash.cookie, body: { note: "untouched" } });
  const before = await list();
  const text = document([{ itemId: 5191, name: "Cruel Barb", priority: "high", note: "Main hand" }, { itemId: 5193, priority: "high" }, { itemId: 6468, sourceDungeon: "Wailing Caverns" }]);

  const preview = await importing({ text });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.status, "preview");
  assert.deepEqual(preview.json.summary, { total: 3, add: 2, update: 1, unchanged: 0, invalid: 0 });
  assert.equal(preview.json.repairPrompt, null);
  assert.deepEqual(await list(), before, "a preview changes nothing");

  // Committed without confirming updates: new items only.
  const added = await importing({ text, commit: true });
  assert.equal(added.json.status, "imported");
  assert.deepEqual(added.json.applied, { added: 2, updated: 0, unchanged: 0, skippedUpdates: 1, skippedInvalid: 0 });
  let now = await list();
  assert.equal(now.items.find((item) => item.itemId === 5193).priority, "low", "a matching entry is not changed without confirmation");
  assert.equal(now.items.find((item) => item.itemId === 5191).origin, "ai_import");
  assert.equal(now.items.find((item) => item.itemId === 2168).note, "untouched", "unrelated entries are preserved");
  assert.equal(now.items.length, 4);
  assert.equal(now.revision, before.revision + 1, "one import, one revision");

  // Confirmed: the matching entry is updated; nothing is ever deleted.
  const updated = await importing({ text, commit: true, updateExisting: true });
  assert.deepEqual(updated.json.applied, { added: 0, updated: 1, unchanged: 2, skippedUpdates: 0, skippedInvalid: 0 });
  now = await list();
  assert.equal(now.items.find((item) => item.itemId === 5193).priority, "high");
  assert.equal(now.items.find((item) => item.itemId === 5193).note, "old note", "a field the import left out is kept");
  assert.equal(now.items.find((item) => item.itemId === 5193).origin, "manual", "who added it first stays");
  assert.equal(now.items.length, 4);
  // The same import again is safe to repeat.
  const repeat = await importing({ text, commit: true, updateExisting: true });
  assert.deepEqual(repeat.json.applied, { added: 0, updated: 0, unchanged: 3, skippedUpdates: 0, skippedInvalid: 0 });
  assert.equal((await list()).revision, now.revision, "nothing changed, no new revision");
}));

test("importing over HTTP: errors reject the whole list unless the player skips the bad items", () => withHttpApp(async ({ request }) => {
  const { importing, list } = await setup(request);
  const text = document([{ itemId: 5191 }, { itemId: 987654, name: "Blade of Imagined Glory" }, { itemId: 6468, priority: "urgent" }]);
  const preview = await importing({ text });
  assert.equal(preview.json.ok, false);
  assert.equal(preview.json.partialPossible, true);
  assert.match(preview.json.repairPrompt, /\[unknown_item\] at \$\.items\[1\]\.itemId/);
  assert.ok(preview.json.repairPrompt.includes(text));

  const rejected = await importing({ text, commit: true });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.json.status, "rejected");
  assert.equal((await list()).items.length, 0, "one bad item, nothing imported");
  assert.equal((await list()).revision, 0, "and no revision");

  const partial = await importing({ text, commit: true, skipInvalid: true });
  assert.equal(partial.json.status, "imported");
  assert.deepEqual(partial.json.applied, { added: 1, updated: 0, unchanged: 0, skippedUpdates: 0, skippedInvalid: 2 });
  assert.deepEqual((await list()).items.map((item) => item.itemId), [5191]);

  // Errors about the document itself cannot be skipped.
  const wrongCharacter = await importing({ text: JSON.stringify({ schemaVersion: 1, character: "Fern", items: [{ itemId: 5193 }] }), commit: true, skipInvalid: true });
  assert.equal(wrongCharacter.status, 422);
  assert.equal((await list()).items.length, 1);
  assert.equal((await importing({ text: "{ not json", commit: true, skipInvalid: true })).status, 422);
  assert.equal((await importing({ commit: true })).status, 422, "no text");
}));

test("the planning prompt over HTTP is built from the player's own character and the live catalog", () => withHttpApp(async ({ request }) => {
  const { ash, rook } = await setup(request);
  await request(`/api/player/wishlists/${rook}/items/i:6468`, { method: "PUT", rawCookie: ash.cookie, body: { priority: "high" } });
  // The journal lists the boss too: the same items, now also advertised.
  await journalSnapshot(request, ash.token, { encounters: [{ journalEncounterId: 91, name: "Edwin VanCleef", items: [5191, 5193, 5201] }] });
  const response = await request(`/api/player/wishlists/${rook}/ai-prompt`, { rawCookie: ash.cookie });
  assert.equal(response.status, 200);
  const { prompt, catalogRevision, candidates } = response.json;
  assert.ok(catalogRevision > 0);
  assert.match(prompt, /Name: Rook Shepard/);
  assert.match(prompt, /Level: 19/);
  assert.match(prompt, /Class: Warrior/);
  assert.match(prompt, /5191 \| Cruel Barb \| One-Hand/);
  assert.match(prompt, /Wailing Caverns/);
  assert.match(prompt, /6468 \| Deviate Scale Belt \| high/);
  assert.ok(!prompt.includes("Emberstone Staff"), "an item the game restricts to other classes is left out");
  assert.ok(!prompt.includes("Linen Cloth"), "gear only");
  assert.ok(prompt.includes(`"catalogRevision": ${catalogRevision}`));
  assert.equal(candidates, 3);

  const narrowed = (await request(`/api/player/wishlists/${rook}/ai-prompt?dungeons=43`, { rawCookie: ash.cookie })).json;
  assert.ok(!narrowed.prompt.includes("5191 | Cruel Barb"), "narrowed to one dungeon");
  assert.equal(narrowed.candidates, 1);
}));

test("the prompt's stats are the few numbers a gear plan needs", async () => {
  const { statSummary } = await import("../src/Loot/wishlistPrompt.js");
  assert.deepEqual(statSummary({ stats: { schemaVersion: 1, attributes: { strength: { effective: 66, base: 60 }, agility: 86 },
    resources: { health: { current: 900, max: 1122 }, power: { current: 100, max: 100 }, powerRegen: { active: 10 } },
    offense: { attackPower: 206, meleeDamage: { min: 71.2, multiplier: 1 }, crit: { melee: 7.974, ranged: 0 }, hit: { melee: 0 } } } }),
  ["strength 66", "agility 86", "health max 1122", "power max 100", "attackPower 206", "crit melee 7.97"]);
  assert.deepEqual(statSummary(undefined), []);
});
