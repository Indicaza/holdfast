import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setSession } from "../src/Auth/session.js";
import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { buildComparisons, completionQuality, deriveCheckpoints, median, referenceClear } from "../src/Dungeon/dungeonRunInsights.js";
import { validDungeonRun } from "../src/Dungeon/dungeonRunModel.js";
import { factionForRace } from "../src/Dungeon/dungeonRunRepository.js";
import { recordMarketSnapshotInDatabase } from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// Dungeon V2: payload schema 2 beside schema 1, personal bests and
// comparisons that never mix dungeons, difficulties or characters, loot
// enriched from the shared item catalog and the run's own auction house,
// honest value accounting, and the objective checklist.

const v1 = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-dungeon-run.v1.json", import.meta.url), "utf8"));
const v2 = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-dungeon-run.v2.json", import.meta.url), "utf8"));
const mobLootFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-mob-loot.v1.json", import.meta.url), "utf8"));
const ASH = { id: "discord-dv2-ash", username: "ash" };
const BRAM = { id: "discord-dv2-bram", username: "bram" };

function payload(base, overrides = {}, envelope = {}) {
  const copy = structuredClone(base);
  return { ...copy, ...envelope, payload: { ...copy.payload, ...overrides } };
}

// Unit: the model and the insights -------------------------------------------------

test("accepts schema 1 and 2, rejects mixed or malformed schema 2", () => {
  const event = (envelope) => ({ kind: "event", envelope });
  assert.equal(validDungeonRun(event(v1)), true, "schema 1 still valid");
  assert.equal(validDungeonRun(event(v2)), true, "schema 2 valid");
  assert.equal(validDungeonRun(event(payload(v1, { checkpoints: [] }))), false, "schema 2 field on schema 1");
  assert.equal(validDungeonRun(event(payload(v2, {}, { payloadSchemaVersion: 1 }))), false, "envelope and payload disagree");
  for (const change of [
    { checkpoints: [{ id: "boss:1", kind: "boss", at: 1 }, { id: "boss:1", kind: "boss", at: 2 }] },
    { checkpoints: [{ id: "bad id!", kind: "boss", at: 1 }] },
    { checkpoints: [{ id: "x", kind: "wipe", at: 1 }] },
    { checkpoints: Array.from({ length: 41 }, (_, index) => ({ id: `split:${index}`, kind: "split", at: index })) },
    { completion: { basis: "vibes" } },
    { bosses: { ...v2.payload.bosses, duplicatesIgnored: -1 } },
  ]) assert.equal(validDungeonRun(event(payload(v2, change))), false, JSON.stringify(change).slice(0, 80));
  // Lua's empty table for "no checkpoints yet".
  assert.equal(validDungeonRun(event(payload(v2, { checkpoints: {} }))), true);
});

function fakeRun(id, fields = {}) {
  return {
    id, startedAt: 1000 + id, status: "completed", endReason: "all_bosses_defeated", durationSeconds: 1800,
    dungeon: { name: "The Deadmines", instanceId: 36, difficultyId: 1, difficultyName: "Normal", type: "party" },
    character: { id: "char-rook", name: "Rook", classToken: "DRUID" },
    xp: { available: true, atLevelCap: false, gained: 10000, perHour: 20000, partial: false },
    bosses: { defeated: 2, total: 2, encounterEvents: true }, ...fields,
  };
}

test("personal bests, medians and marks stay inside one dungeon, difficulty and character", () => {
  const runs = [
    fakeRun(1, { durationSeconds: 2000, xp: { available: true, perHour: 18000 } }),
    fakeRun(2, { durationSeconds: 1500, xp: { available: true, perHour: 21000 } }),
    fakeRun(3, { durationSeconds: 1700, xp: { available: true, perHour: 30000 } }),
    // Completed by the add-on but only one of two bosses: not a clear.
    fakeRun(4, { durationSeconds: 900, bosses: { defeated: 1, total: 2, encounterEvents: true } }),
    // Faster, but heroic: another group.
    fakeRun(5, { durationSeconds: 600, dungeon: { name: "The Deadmines", instanceId: 36, difficultyId: 2, difficultyName: "Heroic" } }),
    // Faster, but another character.
    fakeRun(6, { durationSeconds: 700, character: { id: "char-alt", name: "Alt" } }),
    // Abandoned: never a clear.
    fakeRun(7, { durationSeconds: 300, status: "abandoned", endReason: "left_instance", bosses: { defeated: 0, total: 2 },
      xp: { available: true, perHour: 90000 } }),
    // Hand-finished with every kill the verified clears had: counts.
    fakeRun(8, { durationSeconds: 1600, endReason: "manual_finish", bosses: { defeated: 2, total: null, encounterEvents: false } }),
    // Hand-finished with fewer kills: does not.
    fakeRun(9, { durationSeconds: 400, endReason: "manual_finish", bosses: { defeated: 1, total: null, encounterEvents: false } }),
  ];
  const { marks, groups } = buildComparisons(runs);
  const normal = groups.find((group) => group.dungeon.difficultyId === 1 && group.character.id === "char-rook");
  assert.equal(normal.runs, 7);
  assert.equal(normal.clears, 4, "runs 1, 2, 3 and the matching manual finish");
  assert.equal(normal.verifiedClears, 3);
  assert.equal(normal.fastest.id, 2, "the 900 s partial clear is not a PB");
  assert.equal(normal.medianDurationSeconds, median([2000, 1500, 1700, 1600]));
  assert.equal(normal.bestXpPerHour.id, 3, "the abandoned run's 90k/h is not a record");
  assert.equal(marks.get(2).pb, true);
  assert.equal(marks.get(4).clear, false);
  assert.equal(marks.get(4).completion, "manual", "completed flag alone is not trusted");
  assert.equal(marks.get(5).pb, false, "a single heroic run is not a PB yet (too few runs)");
  assert.equal(marks.get(6).pb, false);
  assert.equal(marks.get(7).completion, "incomplete");
  assert.equal(marks.get(9).clear, false);
  assert.equal(marks.get(2).vsPrevious.durationSeconds, -500, "faster than the previous clear");
  assert.equal(marks.get(3).vsPrevious.durationSeconds, 200);
  assert.equal(marks.get(1).vsPrevious.durationSeconds, null, "first clear has nothing to compare");
  assert.equal(marks.get(3).exceptional, true, "30k/h against a ~20k median");
  assert.equal(marks.get(1).exceptional, false);
  assert.equal(groups.length, 3, "normal Rook, heroic Rook, normal Alt");
  assert.equal(referenceClear(runs[2], runs).id, 2, "pace against the PB");
  assert.equal(referenceClear(runs[1], runs).id, 8, "the PB itself paces against the next best clear");
  assert.equal(completionQuality(fakeRun(10, { status: "open" })).completion, "open");
});

test("checkpoints from a schema 1 timeline keep boss identity and dedupe kills", () => {
  const list = deriveCheckpoints([
    { at: 0, kind: "enter" },
    { at: 100, kind: "boss_kill", encounterId: 1, name: "Rhahk'Zor", source: "encounter_end" },
    { at: 101, kind: "boss_kill", encounterId: 1, name: "Rhahk'Zor", source: "boss_kill" },
    { at: 200, kind: "manual_split", name: "Ship" },
    { at: 300, kind: "manual_split", name: "Ship" },
    { at: 400, kind: "boss_kill", name: "Cookie" },
  ]);
  assert.deepEqual(list.map((entry) => entry.id), ["boss:1", "split:ship", "split:ship:2", "boss:name:cookie"]);
  assert.equal(list[1].source, "manual");
  assert.equal(factionForRace("Night Elf"), "alliance");
  assert.equal(factionForRace("Scourge"), "horde");
  assert.equal(factionForRace("Pandaren"), "");
});

// HTTP: ingest, isolation, enrichment, objectives ---------------------------------

function soloCookie(user) {
  let header;
  setSession({ append(_name, value) { header = value; } }, { user, permissions: [], homeServer: false, verifiedAt: Date.now() });
  return header.split(";", 1)[0];
}

async function connect(request, user) {
  const cookie = soloCookie(user);
  await request("/api/me", { rawCookie: cookie });
  const started = await request("/api/bridge/pairing/start", { method: "POST", body: { deviceName: `${user.username} PC` } });
  await request("/api/bridge/pairing/approve", { method: "POST", rawCookie: cookie, body: { userCode: started.json.userCode } });
  const exchanged = await request("/api/bridge/pairing/token", { method: "POST", body: { deviceCode: started.json.deviceCode } });
  assert.equal(exchanged.status, 200, exchanged.text);
  return { cookie, token: exchanged.json.deviceToken };
}

let key = 0;
function post(request, token, body) {
  key += 1;
  return request("/api/bridge/telemetry", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `dv2-${key}` }, body });
}
const upload = (request, token, envelope) => post(request, token,
  { streamKey: `dungeon_run:${envelope.characterId}:${envelope.payload.runId}`, kind: "event", revision: envelope.payload.sequence || 1, envelope });

function syncCharacter(request, token, characterId, name, race = { id: 4, name: "Night Elf", token: "NightElf" }) {
  key += 1;
  return post(request, token, { streamKey: `character:${characterId}`, kind: "state", revision: key, envelope: {
    schemaVersion: 1, eventType: "character", capturedAt: 1791761000 + key, characterId, realm: "Live Realm", region: "US",
    payloadSchemaVersion: 1, payload: { schemaVersion: 1, name, realm: "Live Realm", region: "US", level: 19,
      class: { id: 11, name: "Druid", token: "DRUID" }, race } } });
}

function loot(request, token, runId, guid, outputs) {
  const event = structuredClone(mobLootFixture);
  event.installationId = v2.installationId;
  event.payload.observationId = guid;
  event.payload.source = { ...event.payload.source, guid, npcId: Number(guid.split("-")[5]) };
  event.payload.outputs = outputs;
  event.payload.context = { ...event.payload.context, dungeonRun: { runId } };
  return post(request, token, { streamKey: `mob_loot:character-rook:${guid}`, kind: "event", revision: 1, envelope: event });
}

const NOW = Math.floor(Date.now() / 1000);
const MARKET = { marketKey: "game:us:live-realm:alliance", kind: "client_house", region: "us", realm: "Live Realm", faction: "alliance", name: "Live Realm Alliance" };
const HORDE = { ...MARKET, marketKey: "game:us:live-realm:horde", faction: "horde", name: "Live Realm Horde" };

function seedCatalogAndPrices() {
  withGuildTransaction((db) => {
    const insert = db.prepare(`INSERT OR REPLACE INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
      VALUES (?, '70338', 'en_US', ?, ?, ?, ?, '2026-11-01')`);
    insert.run(2589, "Linen Cloth", 1, 132889, JSON.stringify({ itemId: 2589, name: "Linen Cloth", qualityId: 1, sellPrice: 13, stackCount: 20,
      itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 5, name: "Cloth" },
      tooltip: { lines: [{ left: "Linen Cloth" }, { left: "Max Stack: 20" }] } }));
    // A blue with no tooltip yet: identity and quality, no invented lines.
    insert.run(5191, "Cruel Barb", 3, 135321, JSON.stringify({ itemId: 5191, name: "Cruel Barb", qualityId: 3, itemLevel: 24, requiredLevel: 19 }));
    const item = (itemId, minUnitBuyout) => ({ itemKey: `i:${itemId}`, itemId, minUnitBuyout, typicalUnitBuyout: minUnitBuyout + 5, maxUnitBuyout: minUnitBuyout * 2,
      minUnitBid: null, quantity: 40, listings: 3, bidOnlyListings: 0 });
    // Linen is fresh on Ash's own house; the Barb was last seen two days ago.
    recordMarketSnapshotInDatabase(db, { market: MARKET, sourceType: "addon_scan", sourceId: "dv2-a", coverage: "items", observedAt: NOW - 2 * 86400, now: NOW,
      items: [item(5191, 250000)] });
    recordMarketSnapshotInDatabase(db, { market: MARKET, sourceType: "addon_scan", sourceId: "dv2-b", coverage: "items", observedAt: NOW - 600, now: NOW,
      items: [item(2589, 40)] });
    // The other faction's house has wildly different prices; never used.
    recordMarketSnapshotInDatabase(db, { market: HORDE, sourceType: "addon_scan", sourceId: "dv2-h", coverage: "items", observedAt: NOW - 600, now: NOW,
      items: [item(2589, 9999), item(5191, 9999999)] });
  });
}

test("v2 runs store checkpoints, keep v1 working, and stay idempotent and private", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  assert.ok([200, 201].includes((await upload(request, ash.token, payload(v1, { runId: "dungeon-old" }))).status));
  assert.ok([200, 201].includes((await upload(request, ash.token, v2)).status));
  assert.ok([200, 201].includes((await upload(request, ash.token, v2)).status), "a retry is accepted");
  await upload(request, ash.token, payload(v2, { sequence: 1, status: "open", endReason: undefined, endedAt: undefined }));
  const count = withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM dungeon_runs WHERE run_id = ?").get(v2.payload.runId).n);
  assert.equal(count, 1, "one canonical row per run");

  const list = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json;
  assert.equal(list.runs.length, 2);
  assert.ok(list.lastReceivedAt, "freshness of the last sync");
  const latest = list.runs.find((entry) => entry.runId === v2.payload.runId);
  assert.equal(latest.status, "completed", "a late open checkpoint did not reopen it");
  assert.equal(latest.schemaVersion, 2);
  assert.equal(latest.completionBasis, "lockout");
  assert.ok(latest.marks, "every run carries its comparison marks");
  assert.equal(list.comparisons.length, 1, "same dungeon, difficulty and character: one group");
  assert.equal(list.comparisons[0].clears, 2);
  assert.equal(list.comparisons[0].fastest.id, latest.id, "the faster v2 run is the PB");
  assert.equal(latest.marks.pb, true);

  const old = list.runs.find((entry) => entry.runId === "dungeon-old");
  const oldDetail = (await request(`/api/player/dungeon-runs/${old.id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(oldDetail.checkpointBasis, "timeline", "v1 checkpoints derived from the timeline");
  assert.deepEqual(oldDetail.checkpoints.map((entry) => entry.id), ["boss:1", "split:ship", "boss:2"]);
  assert.equal(oldDetail.reference.id, latest.id, "the v1 run paces against the PB");

  const detail = (await request(`/api/player/dungeon-runs/${latest.id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(detail.checkpointBasis, "addon");
  assert.equal(detail.checkpoints.length, v2.payload.checkpoints.length);
  assert.equal(detail.reference.id, old.id, "the PB paces against the next clear");
  assert.equal(detail.sync.schemaVersion, 2);
  assert.ok(detail.sync.receivedAt);

  // Filters: completed / incomplete.
  await upload(request, ash.token, payload(v2, { runId: "dungeon-left", status: "abandoned", endReason: "left_instance",
    bosses: { ...v2.payload.bosses, defeated: 1, list: {} }, checkpoints: [v2.payload.checkpoints[0]], completion: { basis: "none" } }));
  const get = async (query) => (await request(`/api/player/dungeon-runs${query}`, { rawCookie: ash.cookie })).json;
  assert.equal((await get("?status=completed")).runs.length, 2);
  assert.deepEqual((await get("?status=incomplete")).runs.map((entry) => entry.runId), ["dungeon-left"]);

  // Bram sees nothing of Ash's, and cannot read the detail.
  assert.equal((await get("")).runs.length, 3);
  assert.equal((await request("/api/player/dungeon-runs", { rawCookie: bram.cookie })).json.runs.length, 0);
  assert.equal((await request(`/api/player/dungeon-runs/${latest.id}`, { rawCookie: bram.cookie })).status, 404);
}));

test("loot is enriched from the catalog and the character's own auction house, with honest value", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  seedCatalogAndPrices();
  await upload(request, ash.token, v2);
  const runId = v2.payload.runId;
  const first = await loot(request, ash.token, runId, "Creature-0-1-36-3-639-000101",
    [{ itemId: 2589, name: "Linen Cloth", quantity: 3, qualityId: 1, isQuestItem: false }]);
  assert.ok([200, 201].includes(first.status), first.text);
  const second = await loot(request, ash.token, runId, "Creature-0-1-36-3-640-000102",
    [{ itemId: 2589, name: "Linen Cloth", quantity: 2, qualityId: 1, isQuestItem: false }, { itemId: 5191, name: "Cruel Barb", quantity: 1, qualityId: 3, isQuestItem: false }]);
  assert.ok([200, 201].includes(second.status), second.text);
  // The same corpse again (a reopen): linked once.
  await loot(request, ash.token, runId, "Creature-0-1-36-3-640-000102",
    [{ itemId: 2589, name: "Linen Cloth", quantity: 2, qualityId: 1, isQuestItem: false }, { itemId: 5191, name: "Cruel Barb", quantity: 1, qualityId: 3, isQuestItem: false }]);
  // An item no catalog knows.
  await loot(request, ash.token, runId, "Creature-0-1-36-3-641-000103", [{ itemId: 999901, quantity: 1, qualityId: 0, isQuestItem: false }]);

  const list = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json;
  const detail = (await request(`/api/player/dungeon-runs/${list.runs[0].id}`, { rawCookie: ash.cookie })).json.run;
  const items = new Map(detail.loot.items.map((entry) => [entry.itemId, entry]));
  assert.equal(detail.loot.corpseObservations, 3, "three corpses, the reopen linked once");
  assert.equal(items.get(2589).quantity, 5, "linked loot aggregates across corpses");
  assert.equal(items.get(2589).observedQuantity, 5);
  assert.equal(items.get(2589).qualityId, 1);
  assert.equal(items.get(2589).iconFileDataId, 132889);
  assert.equal(items.get(2589).sellPrice, 13);
  assert.ok(items.get(2589).tooltip.lines.length >= 2, "verified tooltip lines from the catalog");
  assert.equal(items.get(5191).qualityId, 3);
  assert.equal(items.get(5191).itemLevel, 24);
  assert.deepEqual(items.get(5191).tooltip.lines, [], "missing tooltip stays missing");
  assert.ok(items.has(999901), "an unknown item is still listed");
  assert.equal(items.get(999901).unitPrice, null);

  // Prices: Ash is a Night Elf, so the Alliance house on the run's realm.
  assert.equal(detail.loot.market.marketKey, MARKET.marketKey);
  assert.equal(items.get(2589).unitPrice, 40, "own faction's price, not the Horde house's");
  assert.equal(items.get(2589).price.stale, false);
  assert.equal(items.get(5191).price.stale, true, "two-day-old price is flagged stale");
  assert.ok(Number.isFinite(items.get(5191).price.ageSeconds));

  const value = detail.loot.value;
  assert.equal(value.basis, "loot_window");
  assert.equal(value.confirmedAcquired, null, "a loot window is not proof of ownership");
  assert.equal(value.realizedRevenueCopper, null, "no sale evidence, no revenue");
  assert.equal(value.estimatedAuctionCopper, 5 * 40 + 250000);
  assert.equal(value.pricedItems, 2);
  assert.equal(value.unpricedItems, 1);
  assert.equal(value.stalePrices, 1);
  assert.equal(value.vendorCopper, 5 * 13);
  assert.equal(detail.wallet.netCopper, v2.payload.wallet.netCopper, "wallet change untouched by item value");

  // Nothing about items is copied into run rows.
  const columns = withGuildDatabase((db) => [
    ...db.prepare("PRAGMA table_info(dungeon_runs)").all().map((column) => column.name),
    ...db.prepare("PRAGMA table_info(dungeon_run_loot)").all().map((column) => column.name),
  ]);
  assert.equal(columns.some((name) => /item|price|quality|icon|tooltip/.test(name)), false, "no item definitions in run rows");
}));

test("a Horde character values loot on the Horde house; unknown faction picks none", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  await syncCharacter(request, ash.token, "character-rook", "Rook", { id: 2, name: "Orc", token: "Orc" });
  seedCatalogAndPrices();
  await upload(request, ash.token, v2);
  await loot(request, ash.token, v2.payload.runId, "Creature-0-1-36-3-639-000201", [{ itemId: 2589, quantity: 1, qualityId: 1, isQuestItem: false }]);
  const list = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json;
  let detail = (await request(`/api/player/dungeon-runs/${list.runs[0].id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(detail.loot.market.marketKey, HORDE.marketKey);
  assert.equal(detail.loot.items[0].unitPrice, 9999);

  await syncCharacter(request, ash.token, "character-rook", "Rook", { id: 99, name: "Mystery", token: "Mystery" });
  detail = (await request(`/api/player/dungeon-runs/${list.runs[0].id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(detail.loot.market.marketKey, null);
  assert.match(detail.loot.market.reason, /faction/);
  assert.equal(detail.loot.value.estimatedAuctionCopper, null);
}));

test("objectives: per character, private, ordered, and auto-completed only by a reported boss kill", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  await upload(request, ash.token, payload(v2, { runId: "dungeon-before", startedAt: 1700000000, endedAt: 1700001800, lastActiveAt: 1700001800 }));
  const runs = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json;
  const character = runs.filters.characters[0].id;
  const write = (method, path, body, cookie = ash.cookie) => request(`/api/player/dungeon-objectives${path}`, { method, rawCookie: cookie, body });

  assert.equal((await write("POST", "", { character, text: "" })).status, 400);
  assert.equal((await write("POST", "", { character, text: "x".repeat(141) })).status, 400);
  assert.equal((await write("POST", "", { character: "someone-else", text: "Nope" })).status, 404);
  assert.equal((await write("POST", "", { character, text: "Nope" }, bram.cookie)).status, 404, "another account's character");

  let state = (await write("POST", "", { character, text: "Kill Edwin VanCleef", targetBoss: "Edwin VanCleef", targetDungeon: "The Deadmines" })).json;
  state = (await write("POST", "", { character, text: "Kill Ship split", targetBoss: "Ship" })).json;
  state = (await write("POST", "", { character, text: "Buy repair bots" })).json;
  assert.deepEqual(state.objectives.map((entry) => entry.text), ["Kill Edwin VanCleef", "Kill Ship split", "Buy repair bots"]);
  assert.equal(state.objectives.some((entry) => entry.completed), false, "a kill from before the objective does not count");
  assert.equal(state.currentId, state.objectives[0].id);

  const [vancleef, ship, bots] = state.objectives;
  state = (await write("PATCH", `/${bots.id}`, { move: "up" })).json;
  assert.deepEqual(state.objectives.map((entry) => entry.id), [vancleef.id, bots.id, ship.id]);
  state = (await write("PATCH", `/${bots.id}`, { text: "Buy two repair bots" })).json;
  assert.equal(state.objectives[1].text, "Buy two repair bots");
  assert.equal((await write("PATCH", `/${bots.id}`, { completed: true }, bram.cookie)).status, 404);
  assert.equal((await write("DELETE", `/${bots.id}`, undefined, bram.cookie)).status, 404);

  // A new run with a reported VanCleef kill and a manual "Ship" split.
  await upload(request, ash.token, payload(v2, { runId: "dungeon-after", startedAt: Math.floor(Date.now() / 1000) + 5,
    endedAt: Math.floor(Date.now() / 1000) + 1805, lastActiveAt: Math.floor(Date.now() / 1000) + 1805 }));
  state = (await request(`/api/player/dungeon-objectives?character=${encodeURIComponent(character)}`, { rawCookie: ash.cookie })).json;
  const byId = new Map(state.objectives.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(vancleef.id).completed, true);
  assert.equal(byId.get(vancleef.id).completion.source, "boss_kill");
  assert.equal(byId.get(ship.id).completed, false, "a manual split is not proof");
  assert.equal(state.currentId, bots.id);

  state = (await write("PATCH", `/${bots.id}`, { completed: true })).json;
  assert.equal(state.objectives.find((entry) => entry.id === bots.id).completion.source, "manual");
  state = (await write("DELETE", `/${ship.id}`)).json;
  assert.equal(state.objectives.length, 2);
  assert.equal((await request(`/api/player/dungeon-objectives?character=${encodeURIComponent(character)}`, { rawCookie: bram.cookie })).json.objectives.length, 0);
  assert.equal((await request("/api/player/dungeon-objectives")).status, 401);
}));
