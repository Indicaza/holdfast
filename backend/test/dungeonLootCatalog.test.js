import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase } from "../src/Data/database.js";
import { compareBuilds, sourceConfidence, validLootCatalogSnapshot, validLootRoll, wishlistItemKey } from "../src/Loot/lootModel.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { BUILD, DEADMINES, ITEMS, NEXT_BUILD, WAILING, connect, corpseLoot, dungeonRunFixture, journalSnapshot, lootRoll, post, seedItems, syncCharacter } from "../testSupport/lootHarness.js";

// The dungeon loot catalog: Dungeon → Boss/Source → Items from loot
// windows, group rolls and the client's journal, each kept as its own kind
// of evidence, versioned, and never shrunk by something nobody saw.

const ASH = { id: "discord-loot-ash", username: "ash" };
const BRAM = { id: "discord-loot-bram", username: "bram" };
const VANCLEEF = { npcId: 639, npcName: "Edwin VanCleef" };

const counts = () => withGuildDatabase((db) => ({
  entries: db.prepare("SELECT COUNT(*) AS n FROM dungeon_loot_entries").get().n,
  changes: db.prepare("SELECT COUNT(*) AS n FROM dungeon_loot_changes").get().n,
  revision: Number(db.prepare("SELECT value FROM app_meta WHERE key = 'dungeon_loot_revision'").get()?.value) || 0,
}));

async function dungeon(request, cookie, instanceId = 36, query = "") {
  const response = await request(`/api/player/loot/dungeons/${instanceId}${query}`, { rawCookie: cookie });
  assert.equal(response.status, 200, response.text);
  return response.json;
}

const itemOf = (catalog, sourceName, itemId) => catalog.sources.find((source) => source.name === sourceName)?.items.find((item) => item.itemId === itemId);
const evidenceOf = (item, provenance) => item.evidence.find((line) => line.provenance === provenance);

test("item keys, build order and confidence are derived, never guessed", () => {
  assert.equal(wishlistItemKey(5191), "i:5191");
  assert.equal(wishlistItemKey(15210, "i:15210:s-1081"), "i:15210:s-1081");
  assert.equal(wishlistItemKey(15210, "i:999:s-1081"), null, "a variant of another item");
  assert.equal(wishlistItemKey("5191.5"), null);
  assert.equal(compareBuilds("70400", "70338"), 1);
  assert.equal(compareBuilds("1.60.1.70338", "70338"), 0);
  assert.equal(compareBuilds("", "70338"), null, "an unknown build has no order");
  const line = (provenance, extra = {}) => ({ provenance, status: "active", lastSeenAt: "2026-11-02", removedAt: null, ...extra });
  assert.equal(sourceConfidence([line("loot_window"), line("encounter_journal")]), "confirmed");
  assert.equal(sourceConfidence([line("encounter_journal")]), "advertised");
  assert.equal(sourceConfidence([line("group_roll")]), "reported");
  assert.equal(sourceConfidence([line("external")]), "candidate");
  assert.equal(sourceConfidence([line("encounter_journal", { status: "removed", removedAt: "2026-11-05" })]), "delisted");
  assert.equal(sourceConfidence([line("encounter_journal", { status: "removed", removedAt: "2026-11-05" }), line("loot_window", { lastSeenAt: "2026-11-06" })]), "confirmed",
    "seen dropping after the journal dropped it");
});

test("roll and journal payloads are validated strictly", () => {
  const roll = (payload, extra = {}) => ({ kind: "event", envelope: { characterId: "c", gameBuild: BUILD, payload: { schemaVersion: 1, rollKey: "c:1:7", evidence: "group_roll",
    outcome: "offered", startedAt: 1791761500, item: { itemId: 5191, itemKey: "i:5191" }, ...payload }, ...extra } });
  assert.equal(validLootRoll(roll({})), true);
  assert.equal(validLootRoll(roll({ outcome: "won", acquired: { basis: "chat_loot_self" } })), true);
  assert.equal(validLootRoll(roll({ outcome: "won" })), false, "won needs the game's own report");
  assert.equal(validLootRoll(roll({ outcome: "needed" })), false);
  assert.equal(validLootRoll(roll({ item: { itemId: 5191, itemKey: "i:1:s2" } })), false, "key of another item");
  assert.equal(validLootRoll(roll({ rollKey: "bad key!" })), false);
  assert.equal(validLootRoll(roll({}, { characterId: "" })), false);
  const journal = (payload) => ({ kind: "event", envelope: { gameBuild: BUILD, payload: { schemaVersion: 1, sourceApi: "encounter_journal", complete: true, difficultyId: 1,
    instance: { instanceId: 36, name: "The Deadmines", type: "party" }, encounters: [{ journalEncounterId: 91, name: "Edwin VanCleef", complete: true, items: [5191] }], ...payload } } });
  assert.equal(validLootCatalogSnapshot(journal({})), true);
  assert.equal(validLootCatalogSnapshot(journal({ encounters: [{ journalEncounterId: 91, complete: true, items: {} }] })), true, "Lua's empty table");
  assert.equal(validLootCatalogSnapshot(journal({ instance: { instanceId: 1, name: "Kalimdor", type: "none" } })), false, "not a dungeon");
  assert.equal(validLootCatalogSnapshot(journal({ sourceApi: "wowhead" })), false);
  assert.equal(validLootCatalogSnapshot(journal({ encounters: [] })), false);
  assert.equal(validLootCatalogSnapshot(journal({ encounters: [{ journalEncounterId: 91, complete: true, items: ["x"] }] })), false);
});

test("loot windows build the catalog once per corpse, with provenance and revisions", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, ASH);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  assert.deepEqual(counts(), { entries: 0, changes: 0, revision: 0 });

  assert.equal((await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 1, items: [ITEMS.barb, { ...ITEMS.linen, quantity: 3 }] })).status, 201);
  const first = counts();
  assert.equal(first.entries, 2);
  assert.equal(first.revision, 1, "one ingest, one revision");

  // The same corpse again (LOOT_READY then LOOT_OPENED, a reopen, a resend):
  // not a second sighting.
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 1, items: [ITEMS.barb, { ...ITEMS.linen, quantity: 3 }], revision: 2 });
  assert.deepEqual(counts(), first, "a resent corpse changes nothing");
  // Another kill dropping the same item refreshes the evidence without a new revision.
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 2, items: [ITEMS.barb], capturedAt: 1791765000 });
  assert.equal(counts().revision, 1, "more evidence for a known claim is not a catalog change");
  // A kill that drops nothing we know of removes nothing.
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 3, items: [{ ...ITEMS.linen, quantity: 1 }], capturedAt: 1791766000 });

  const catalog = await dungeon(request, ash.cookie);
  assert.equal(catalog.instance.name, "The Deadmines");
  const barb = itemOf(catalog, "Edwin VanCleef", 5191);
  assert.ok(barb, "the item sits under the creature that dropped it");
  assert.equal(barb.confidence, "confirmed");
  assert.equal(barb.name, "Cruel Barb");
  assert.equal(barb.slot, "One-Hand");
  assert.equal(barb.itemLevel, 24);
  assert.equal(barb.requiredLevel, 19);
  assert.equal(barb.equippable, true);
  assert.deepEqual(barb.difficultyIds, [1]);
  const sightings = evidenceOf(barb, "loot_window");
  assert.equal(sightings.evidenceCount, 2, "two corpses, two sightings");
  assert.equal(sightings.firstBuild, "70338");
  assert.ok(sightings.firstSeenAt < sightings.lastSeenAt);
  assert.equal(itemOf(catalog, "Edwin VanCleef", 2589).equippable, false);
  assert.deepEqual(catalog.changes.map((change) => change.kind).sort(), ["new_item", "new_item", "new_source"]);

  const list = (await request("/api/player/loot/dungeons", { rawCookie: ash.cookie })).json;
  assert.deepEqual(list.dungeons.map((entry) => [entry.name, entry.itemCount, entry.sourceCount]), [["The Deadmines", 2, 1]]);
  assert.equal(list.revision, 1);
  assert.equal((await request("/api/player/loot/dungeons/999", { rawCookie: ash.cookie })).status, 404);
  assert.equal((await request("/api/player/loot/dungeons")).status, 401, "signed-in players only");
}));

test("open-world loot and quest drops never enter the dungeon catalog", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, ASH);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  await corpseLoot(request, ash.token, { npcId: 30, npcName: "Forest Spider", serial: 1, items: [ITEMS.linen], instance: { instanceId: 1, name: "Kalimdor", type: "none", difficultyId: 0 } });
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 1, items: [{ ...ITEMS.linen, isQuestItem: true }] });
  assert.equal(counts().entries, 0);
}));

test("a group roll is an offer in the dungeon: its own evidence, counted once, private", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  assert.equal((await lootRoll(request, ash.token, { rollKey: "character-rook:1791761500:3", itemId: 6694 })).status, 201);
  // The same roll resent with its outcome.
  await lootRoll(request, ash.token, { rollKey: "character-rook:1791761500:3", itemId: 6694, outcome: "not_won", revision: 2 });
  const rows = withGuildDatabase((db) => db.prepare("SELECT member_id, outcome, item_id FROM loot_roll_events").all());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "not_won");
  assert.equal(rows[0].member_id, ASH.id);

  let catalog = await dungeon(request, bram.cookie);
  const unknown = catalog.sources.find((source) => source.kind === "unknown");
  assert.equal(unknown.name, null, "the roll does not say which creature dropped it");
  assert.equal(unknown.items[0].confidence, "reported");
  assert.equal(evidenceOf(unknown.items[0], "group_roll").evidenceCount, 1, "a resent roll is one roll");

  // The looter's own client saw that item on exactly one corpse: pinned.
  await lootRoll(request, ash.token, { rollKey: "character-rook:1791761900:4", itemId: 5193, source: { npcId: 639, name: "Edwin VanCleef", basis: "loot_window_single_source" } });
  // The corpse's loot window is separate evidence for the same item, not a second count of the roll.
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 9, items: [ITEMS.cape] });
  catalog = await dungeon(request, bram.cookie);
  const cape = itemOf(catalog, "Edwin VanCleef", 5193);
  assert.equal(evidenceOf(cape, "group_roll").evidenceCount, 1);
  assert.equal(evidenceOf(cape, "loot_window").evidenceCount, 1);
  assert.equal(cape.confidence, "confirmed");
  assert.ok(!JSON.stringify(catalog).includes(ASH.id), "the catalog names no account");

  // A roll out in the world is kept as the player's evidence, not as dungeon loot.
  const before = counts().entries;
  await lootRoll(request, ash.token, { rollKey: "character-rook:1791762000:5", itemId: 2168, instance: { instanceId: 1, name: "Kalimdor", type: "none" } });
  assert.equal(counts().entries, before);
}));

test("the journal advertises loot; only a complete newer list delists, and history stays", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  await syncCharacter(request, bram.token, "character-fern", "Fern");
  const boss = (items, extra = {}) => [{ journalEncounterId: 91, name: "Edwin VanCleef", items, ...extra }];

  assert.equal((await journalSnapshot(request, ash.token, { encounters: boss([5191, 5193, { itemId: 5201, name: "Emberstone Staff" }]) })).status, 201);
  let catalog = await dungeon(request, ash.cookie);
  assert.equal(itemOf(catalog, "Edwin VanCleef", 5193).confidence, "advertised", "listed, nobody has seen it");
  assert.equal(catalog.sources[0].boss, true);
  const afterFirst = counts();

  // A player's loot window for the same boss joins the journal's group.
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 1, items: [ITEMS.barb] });
  catalog = await dungeon(request, ash.cookie);
  assert.equal(catalog.sources.filter((source) => source.name === "Edwin VanCleef").length, 1, "one boss, two kinds of evidence");
  assert.equal(itemOf(catalog, "Edwin VanCleef", 5191).confidence, "confirmed");
  assert.deepEqual(catalog.sources[0].npcIds, [639]);
  assert.deepEqual(catalog.sources[0].encounterIds, [91]);

  // Lists that prove nothing: partial, filtered to a class, empty, or older.
  await journalSnapshot(request, ash.token, { encounters: boss([5191], { complete: false }), capturedAt: 1791770000, revision: 2 });
  await journalSnapshot(request, ash.token, { encounters: boss([5191]), filters: { classId: 8 }, capturedAt: 1791770100, revision: 3 });
  await journalSnapshot(request, ash.token, { encounters: boss([]), capturedAt: 1791770200, revision: 4 });
  await journalSnapshot(request, ash.token, { encounters: boss([5191]), capturedAt: 1791700000, revision: 5 });
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM dungeon_loot_entries WHERE status = 'removed'").get().n), 0,
    "nothing is delisted by a partial, filtered, empty or older list");

  // A complete list on a newer build without the cape and the staff.
  const delist = await journalSnapshot(request, bram.token, { characterId: "character-fern", encounters: boss([5191, 6694]), gameBuild: NEXT_BUILD, capturedAt: 1791790000 });
  assert.equal(delist.status, 201);
  catalog = await dungeon(request, ash.cookie);
  const cape = itemOf(catalog, "Edwin VanCleef", 5193);
  assert.equal(cape.confidence, "delisted");
  assert.equal(evidenceOf(cape, "encounter_journal").status, "removed");
  assert.ok(evidenceOf(cape, "encounter_journal").removedAt);
  assert.equal(itemOf(catalog, "Edwin VanCleef", 6694).confidence, "advertised", "newly advertised");
  const kinds = catalog.changes.map((change) => change.kind);
  assert.equal(kinds.filter((kind) => kind === "potentially_removed").length, 2);
  assert.ok(kinds.includes("new_item"));
  const removal = catalog.changes.find((change) => change.kind === "potentially_removed");
  assert.equal(removal.detail.lastListedOnBuild, "70338");
  assert.equal(removal.detail.missingOnBuild, "70400");
  assert.ok(counts().revision > afterFirst.revision);
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM dungeon_loot_snapshots").get().n), 5, "every distinct list is kept");
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM dungeon_loot_entries WHERE item_id = 5193").get().n), 1, "the delisted entry is still there");

  // Seen dropping after it was delisted: the sighting wins, and it is flagged.
  await corpseLoot(request, ash.token, { ...VANCLEEF, serial: 2, items: [ITEMS.cape], gameBuild: NEXT_BUILD, capturedAt: 1791795000 });
  catalog = await dungeon(request, ash.cookie);
  assert.equal(itemOf(catalog, "Edwin VanCleef", 5193).confidence, "confirmed");
  assert.ok(catalog.changes.some((change) => change.kind === "conflict" && change.item?.itemId === 5193));

  // Listed again later: restored, with the removal still on record.
  await journalSnapshot(request, bram.token, { characterId: "character-fern", encounters: boss([5191, 6694, 5201]), gameBuild: NEXT_BUILD, capturedAt: 1791799000, revision: 2 });
  catalog = await dungeon(request, ash.cookie);
  assert.equal(itemOf(catalog, "Edwin VanCleef", 5201).confidence, "advertised");
  assert.ok(catalog.changes.some((change) => ["restored", "conflict"].includes(change.kind) && change.item?.itemId === 5201));
  const changes = (await request("/api/player/loot/changes", { rawCookie: ash.cookie })).json;
  assert.ok(changes.changes.some((change) => change.kind === "potentially_removed" && change.dungeon === "The Deadmines"), "the history is readable");
}));

test("bosses the client reported, searching, and what an existing database starts with", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, ASH);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  // A recorded run names its bosses (ENCOUNTER_END); trash is never called one.
  const run = structuredClone(dungeonRunFixture);
  assert.ok([200, 201].includes((await post(request, ash.token, { streamKey: `dungeon_run:${run.characterId}:${run.payload.runId}`, kind: "event", revision: run.payload.sequence, envelope: run })).status));
  await corpseLoot(request, ash.token, { npcId: 644, npcName: "Rhahk'Zor", serial: 1, items: [ITEMS.shield] });
  await corpseLoot(request, ash.token, { npcId: 1729, npcName: "Defias Evoker", serial: 1, items: [ITEMS.buckler] });
  await corpseLoot(request, ash.token, { npcId: 3653, npcName: "Kresh", serial: 1, items: [ITEMS.belt, ITEMS.shield], instance: WAILING });
  const catalog = await dungeon(request, ash.cookie);
  assert.deepEqual(catalog.sources.map((source) => [source.name, source.kind]), [["Rhahk'Zor", "boss"], ["Defias Evoker", "creature"]]);
  assert.equal(catalog.difficulties["1"], "Normal");

  const search = (await request("/api/player/loot/items?q=phantom", { rawCookie: ash.cookie })).json;
  assert.equal(search.items.length, 1);
  assert.deepEqual(search.items[0].sources.map((source) => source.dungeon).sort(), ["The Deadmines", "Wailing Caverns"], "one item, two dungeons");
  assert.equal(search.items[0].confidence, "confirmed");
  assert.equal((await request("/api/player/loot/items?q=p", { rawCookie: ash.cookie })).json.items.length, 0, "too short to search");
}));
