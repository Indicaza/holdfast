import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { setSession } from "../src/Auth/session.js";
import { migrateGuildDatabase, withGuildDatabase } from "../src/Data/database.js";
import { validDungeonRun, xpPerHour } from "../src/Dungeon/dungeonRunModel.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-dungeon-run.v1.json", import.meta.url), "utf8"));
const mobLootFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-mob-loot.v1.json", import.meta.url), "utf8"));
const ASH = { id: "discord-dungeon-ash", username: "ash" };
const BRAM = { id: "discord-dungeon-bram", username: "bram" };

function run(overrides = {}, envelope = {}) {
  const copy = structuredClone(fixture);
  return { ...copy, ...envelope, payload: { ...copy.payload, ...overrides } };
}

test("migration 15 adds dungeon runs after the live cutover", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateGuildDatabase(db, { throughVersion: 14 });
    migrateGuildDatabase(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dungeon_runs").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dungeon_run_loot").get().n, 0);
  } finally { db.close(); }
});

test("validates dungeon runs and never reports XP at the level cap", () => {
  const good = { kind: "event", payloadSchemaVersion: 1, envelope: run() };
  assert.equal(validDungeonRun(good), true);
  const open = run({ status: "open", endReason: undefined, endedAt: undefined });
  assert.equal(validDungeonRun({ kind: "event", envelope: open }), true);
  // Lua's empty table for a run with no events yet.
  assert.equal(validDungeonRun({ kind: "event", envelope: run({ timeline: {} }) }), true);
  for (const change of [
    { schemaVersion: 2 }, { runId: "" }, { runId: "bad id!" }, { sequence: 0 }, { status: "wiped" },
    { startedAt: 0 }, { durationSeconds: -1 }, { durationSeconds: 604801 }, { endedAt: fixture.payload.startedAt - 1 },
    { endedAt: fixture.payload.startedAt + 10 }, { endReason: "" }, { deaths: -1 }, { deaths: 1.5 },
    { instance: { ...fixture.payload.instance, type: "pvp" } },
    { xp: { available: true, atLevelCap: true, gained: 10 } },
    { xp: { available: false, atLevelCap: false, gained: 10 } },
    { wallet: { basis: "profit", available: true, netCopper: 1 } },
    { wallet: { basis: "wallet_delta", available: false, netCopper: 1 } },
    { bosses: { defeated: -1, encounterEvents: true } },
    { timeline: Array.from({ length: 61 }, () => ({ at: 1, kind: "death" })) },
    { timeline: [{ at: 1, kind: "wipe" }] },
  ]) assert.equal(validDungeonRun({ kind: "event", envelope: run(change) }), false, JSON.stringify(change));
  assert.equal(validDungeonRun({ kind: "state", envelope: run() }), false);
  assert.equal(validDungeonRun({ kind: "event", envelope: run({}, { installationId: "" }) }), false);
  assert.equal(xpPerHour({ xpAvailable: true, atLevelCap: false, xpGained: 14250, durationSeconds: 1740 }), 29483);
  assert.equal(xpPerHour({ xpAvailable: true, atLevelCap: true, xpGained: 0, durationSeconds: 1740 }), null);
  assert.equal(xpPerHour({ xpAvailable: true, atLevelCap: false, xpGained: 900, durationSeconds: 120 }), null, "too short to rate");
});

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
function upload(request, token, envelope, streamKey = `dungeon_run:${envelope.characterId}:${envelope.payload.runId}`) {
  key += 1;
  return request("/api/bridge/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `dungeon-${key}` },
    body: { streamKey, kind: "event", revision: envelope.payload.sequence || 1, envelope },
  });
}

function syncCharacter(request, token, characterId, name, realm = "Live Realm") {
  key += 1;
  return request("/api/bridge/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `character-${key}` },
    body: { streamKey: `character:${characterId}`, kind: "state", revision: key, envelope: {
      schemaVersion: 1, eventType: "character", capturedAt: 1791761000 + key, characterId, realm, region: "US",
      payloadSchemaVersion: 1, payload: { schemaVersion: 1, name, realm, region: "US", level: 19,
        class: { id: 11, name: "Druid", token: "DRUID" }, race: { id: 4, name: "Night Elf", token: "NightElf" } } } },
  });
}

test("stores one run per character run, in order, and only for its owner", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  const bram = await connect(request, BRAM);
  assert.ok([200, 201].includes((await syncCharacter(request, ash.token, "character-rook", "Rook")).status));

  // Open checkpoint from a /reload, a retry of it, then the final run.
  const open = run({ sequence: 1, status: "open", endReason: undefined, endedAt: undefined, durationSeconds: 600, insideSeconds: 580,
    bosses: { ...fixture.payload.bosses, defeated: 1 } });
  assert.ok([200, 201].includes((await upload(request, ash.token, open)).status));
  assert.ok([200, 201].includes((await upload(request, ash.token, open)).status), "a retry is accepted");
  let list = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json;
  assert.equal(list.runs.length, 1);
  assert.equal(list.runs[0].status, "open");
  assert.equal(list.runs[0].character.name, "Rook", "run linked to the owner's character");

  assert.ok([200, 201].includes((await upload(request, ash.token, run())).status));
  // A late interim checkpoint (sequence 2) and a newer open one after the
  // end must not reopen or overwrite the finished run.
  await upload(request, ash.token, run({ sequence: 2, status: "open", endReason: undefined, endedAt: undefined }));
  await upload(request, ash.token, run({ sequence: 9, status: "open", endReason: undefined, endedAt: undefined, deaths: 7 }));
  list = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json;
  assert.equal(list.runs.length, 1, "no duplicate rows");
  const stored = list.runs[0];
  assert.equal(stored.status, "completed");
  assert.equal(stored.deaths, 1);
  assert.equal(stored.dungeon.name, "The Deadmines");
  assert.equal(stored.durationSeconds, 1740);
  assert.equal(stored.xp.gained, 14250);
  assert.equal(stored.xp.perHour, 29483);
  assert.equal(stored.wallet.netCopper, 18450);
  assert.equal(stored.wallet.basis, "wallet_delta");
  assert.equal(stored.bosses.defeated, 2);
  assert.equal(stored.character.levelAtEntry, 19);
  assert.equal(stored.character.levelAtExit, 20);

  const detail = (await request(`/api/player/dungeon-runs/${stored.id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(detail.timeline.length, fixture.payload.timeline.length);
  assert.deepEqual(detail.timeline.map((entry) => entry.kind).slice(0, 3), ["enter", "encounter_start", "boss_kill"]);

  // Another account sees none of it, and the same run id from them is theirs.
  assert.equal((await request("/api/player/dungeon-runs", { rawCookie: bram.cookie })).json.runs.length, 0);
  assert.equal((await request(`/api/player/dungeon-runs/${stored.id}`, { rawCookie: bram.cookie })).status, 404);
  assert.equal((await request("/api/player/dungeon-runs")).status, 401);
  await upload(request, bram.token, run({}, { characterId: "character-other" }));
  assert.equal((await request("/api/player/dungeon-runs", { rawCookie: bram.cookie })).json.runs.length, 1);
  assert.equal((await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json.runs.length, 1);

  // Invalid runs are not stored as runs.
  const bad = await upload(request, ash.token, run({ runId: "dungeon-bad", xp: { available: true, atLevelCap: true, gained: 5 } }));
  assert.notEqual(bad.json?.status, "accepted");
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM dungeon_runs WHERE run_id = 'dungeon-bad'").get().n), 0);
}));

test("filters by character, realm, dungeon and date, and links loot from the run", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  await syncCharacter(request, ash.token, "character-alt", "Alt", "Other Realm");
  const day = 86400;
  await upload(request, ash.token, run({ runId: "dungeon-a" }));
  await upload(request, ash.token, run({ runId: "dungeon-b", startedAt: fixture.payload.startedAt + day, endedAt: fixture.payload.endedAt + day,
    instance: { ...fixture.payload.instance, name: "The Stockade", instanceId: 34 } }));
  await upload(request, ash.token, run({ runId: "dungeon-c" }, { characterId: "character-alt", realm: "Other Realm" }));

  const get = async (query) => (await request(`/api/player/dungeon-runs${query}`, { rawCookie: ash.cookie })).json;
  const all = await get("");
  assert.equal(all.runs.length, 3);
  assert.deepEqual(all.filters.dungeons, ["The Deadmines", "The Stockade"]);
  assert.deepEqual(all.filters.realms, ["Live Realm", "Other Realm"]);
  assert.deepEqual(all.filters.characters.map((entry) => entry.name), ["Alt", "Rook"]);
  const rook = all.filters.characters.find((entry) => entry.name === "Rook");
  assert.equal((await get(`?character=${encodeURIComponent(rook.id)}`)).runs.length, 2);
  assert.equal((await get("?realm=Other%20Realm")).runs.length, 1);
  assert.equal((await get("?dungeon=The%20Stockade")).runs[0].runId, "dungeon-b");
  const firstDay = new Date(fixture.payload.startedAt * 1000).toISOString().slice(0, 10);
  assert.equal((await get(`?from=${firstDay}&to=${firstDay}`)).runs.length, 2, "date range is inclusive of the day");

  // Mob loot during dungeon-a links to it; the public loot row stays anonymous.
  const loot = structuredClone(mobLootFixture);
  loot.characterId = "character-rook";
  loot.installationId = fixture.installationId;
  loot.payload.context = { ...(loot.payload.context || {}), dungeonRun: { runId: "dungeon-a" } };
  key += 1;
  const response = await request("/api/bridge/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${ash.token}`, "Idempotency-Key": `loot-${key}` },
    body: { streamKey: `mob_loot:character-rook:${loot.payload.source.guid}`, kind: "event", revision: 1, envelope: loot },
  });
  assert.ok([200, 201].includes(response.status), response.text);
  const target = all.runs.find((entry) => entry.runId === "dungeon-a");
  const detail = (await request(`/api/player/dungeon-runs/${target.id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(detail.loot.observations, 1);
  assert.ok(detail.loot.items.length > 0, "loot items listed");
  const publicColumns = withGuildDatabase((db) => db.prepare("PRAGMA table_info(game_loot_observations)").all().map((column) => column.name));
  assert.equal(publicColumns.some((name) => name.includes("run") || name.includes("member")), false, "public loot has no run or member");
}));
