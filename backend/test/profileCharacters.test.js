import assert from "node:assert/strict";
import test from "node:test";

import { setSession } from "../src/Auth/session.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { updateGuildMemberProfile } from "../src/Guild/memberRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// Saving a profile or a detected timezone must never erase a player's synced
// characters. Character rows cascade into snapshots, telemetry, aliases and
// the dashboard's read model, so re-creating them loses all of that.

const ASH = { id: "431111111111111111", username: "ash", globalName: "Ash" };
const BRAM = { id: "432222222222222222", username: "bram", globalName: "Bram" };

function soloCookie(user) {
  let header;
  setSession({ append(name, value) { header = value; } }, {
    user,
    permissions: [],
    homeServer: false,
    verifiedAt: Date.now(),
  });
  return header.split(";", 1)[0];
}

async function connectComputer(request, user) {
  const cookie = soloCookie(user);
  assert.equal((await request("/api/me", { rawCookie: cookie })).json.authenticated, true);
  const started = await request("/api/bridge/pairing/start", { method: "POST", body: { deviceName: `${user.username}'s PC` } });
  const approved = await request("/api/bridge/pairing/approve", { method: "POST", rawCookie: cookie, body: { userCode: started.json.userCode } });
  assert.equal(approved.status, 200, approved.text);
  const exchanged = await request("/api/bridge/pairing/token", { method: "POST", body: { deviceCode: started.json.deviceCode } });
  assert.equal(exchanged.status, 200, exchanged.text);
  return { cookie, token: exchanged.json.deviceToken };
}

let capture = 1791422400;

function syncCharacter(request, token, { characterId, name, realm = "Doomhowl" }) {
  capture += 1;
  return request("/api/bridge/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `profile-${characterId}-${capture}` },
    body: {
      streamKey: `character:${characterId}`,
      kind: "state",
      revision: capture,
      envelope: {
        schemaVersion: 1,
        eventType: "character",
        capturedAt: capture,
        characterId,
        realm,
        region: "US",
        payloadSchemaVersion: 1,
        payload: {
          schemaVersion: 1,
          name,
          realm,
          region: "US",
          level: 30,
          class: { id: 1, name: "Warrior", token: "WARRIOR" },
          race: { id: 4, name: "Night Elf", token: "NightElf" },
        },
      },
    },
  });
}

// Rows of synced data per table for one member's characters.
function syncedRows(memberId) {
  return withGuildDatabase((db) => {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const counts = {};
    for (const table of ["character_cards", "character_sections", "character_snapshots", "telemetry_characters", "guildweaver_character_aliases"]) {
      if (!tables.has(table)) continue;
      counts[table] = db.prepare(`
        SELECT COUNT(*) AS n FROM ${table} t JOIN characters c ON c.id = t.character_id WHERE c.member_id = ?
      `).get(memberId).n;
    }
    return counts;
  });
}

function characterRows(memberId) {
  return withGuildDatabase((db) => db.prepare(
    "SELECT id, name, is_main, sort_order FROM characters WHERE member_id = ? ORDER BY sort_order, id",
  ).all(memberId).map((row) => ({ ...row })));
}

test("a detected timezone change keeps every synced character and its data", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    // More characters than a profile can hold (12): none may be dropped.
    for (let index = 0; index < 14; index += 1) {
      assert.equal((await syncCharacter(request, ash.token, { characterId: `ash-${index}`, name: `Alt${index}` })).status, 201);
    }

    const before = (await request("/api/player/overview", { rawCookie: ash.cookie })).json;
    assert.equal(before.characters.length, 14);
    const rowsBefore = syncedRows(ASH.id);
    assert.equal(rowsBefore.character_cards, 14);

    for (const timezone of ["America/Chicago", "Europe/Berlin"]) {
      const saved = await request("/api/guild/members/me/timezone", { method: "PATCH", rawCookie: ash.cookie, body: { timezone } });
      assert.equal(saved.status, 200, saved.text);
    }

    const after = (await request("/api/player/overview", { rawCookie: ash.cookie })).json;
    assert.equal(after.characters.length, 14, "the dashboard still shows every character");
    assert.deepEqual(syncedRows(ASH.id), rowsBefore, "snapshots, telemetry, aliases and cards are untouched");

    const armory = await request(`/api/player/characters/${encodeURIComponent(after.characters[0].id)}`, { rawCookie: ash.cookie });
    assert.equal(armory.status, 200, armory.text);
  });
});

test("a profile save updates listed characters in place and keeps synced ones it leaves out", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    await syncCharacter(request, ash.token, { characterId: "ash-rook", name: "Rook" });
    await syncCharacter(request, ash.token, { characterId: "ash-fern", name: "Fern" });
    const synced = (await request("/api/player/overview", { rawCookie: ash.cookie })).json.characters;
    const rook = synced.find((character) => character.name === "Rook");
    const fern = synced.find((character) => character.name === "Fern");

    // A hand-entered character, then a save that lists Rook and a new one only.
    await updateGuildMemberProfile(ASH.id, { characters: [{ id: "manual-moss", name: "Moss" }] });
    assert.ok(characterRows(ASH.id).some((row) => row.id === "manual-moss"));
    const rowsBefore = syncedRows(ASH.id);

    const saved = await updateGuildMemberProfile(ASH.id, {
      timezone: "America/Detroit",
      timezoneSource: "manual",
      characters: [
        { id: "manual-pip", name: "Pip" },
        { id: rook.id, name: "Rook", spec: "Arms", isMain: true },
      ],
    });
    assert.equal(saved.profile.timezone, "America/Detroit");

    const rows = characterRows(ASH.id);
    assert.deepEqual(rows.map((row) => row.id), ["manual-pip", rook.id, fern.id], "listed first, then synced ones the profile left out");
    assert.equal(rows.find((row) => row.id === "manual-moss"), undefined, "an unlisted hand-entered character is removed");
    assert.deepEqual(rows.filter((row) => row.is_main).map((row) => row.id), [rook.id], "the listed main is the only main");
    assert.deepEqual(syncedRows(ASH.id), rowsBefore, "no synced data was lost");

    const overview = (await request("/api/player/overview", { rawCookie: ash.cookie })).json;
    assert.deepEqual(overview.characters.map((character) => character.name).sort(), ["Fern", "Rook"]);
  });
});

test("a profile cannot take over or rewrite another player's character", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    await syncCharacter(request, ash.token, { characterId: "ash-rook", name: "Rook" });
    const rook = (await request("/api/player/overview", { rawCookie: ash.cookie })).json.characters[0];
    await connectComputer(request, BRAM);

    await updateGuildMemberProfile(BRAM.id, { characters: [{ id: rook.id, name: "Stolen" }] });

    assert.deepEqual(characterRows(BRAM.id), []);
    const owned = characterRows(ASH.id);
    assert.equal(owned.length, 1);
    assert.equal(owned[0].name, "Rook");
    assert.equal(syncedRows(ASH.id).character_cards, 1);
  });
});
