import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { setSession } from "../src/Auth/session.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { flushCharacterChanges } from "../src/Live/characterChangeEvents.js";
import { resetLiveUpdatesForTests, subscribeLiveUpdates } from "../src/Live/liveUpdateBus.js";
import { flushPlayerChanges } from "../src/Live/playerChangeEvents.js";
import { playerSyncState } from "../src/Player/playerRepository.js";
import { groupServers, requestedServer, serverKey } from "../src/Player/playerServers.js";
import { withGuildHttpApp, withHttpApp } from "../testSupport/httpHarness.js";

// Two players who signed in with Discord and belong to no guild. Neither is
// in Holdfast's Discord server, so the website stores them as "departed".
const ASH = { id: "411111111111111111", username: "ash", globalName: "Ash" };
const BRAM = { id: "422222222222222222", username: "bram", globalName: "Bram" };

const gatheringFixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/guildweaver-gathering-loot.v1.json", import.meta.url), "utf8"),
);

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

// A player signs in, pairs one computer, and gets that computer's key.
async function connectComputer(request, user, deviceName = `${user.username}'s PC`) {
  const cookie = soloCookie(user);
  const me = await request("/api/me", { rawCookie: cookie });
  assert.equal(me.json.authenticated, true);
  assert.equal(me.json.guild, null);
  const started = await request("/api/bridge/pairing/start", { method: "POST", body: { deviceName } });
  const approved = await request("/api/bridge/pairing/approve", { method: "POST", rawCookie: cookie, body: { userCode: started.json.userCode } });
  assert.equal(approved.status, 200, approved.text);
  const exchanged = await request("/api/bridge/pairing/token", { method: "POST", body: { deviceCode: started.json.deviceCode } });
  assert.equal(exchanged.status, 200, exchanged.text);
  assert.equal(exchanged.json.memberId, user.id);
  return { cookie, token: exchanged.json.deviceToken, deviceId: exchanged.json.deviceId };
}

let capture = 1791322400;

// Uploads a character's identity through the bridge endpoint, as the bridge does.
function syncCharacter(request, token, { characterId, name, realm, region = "US", level = 20 }) {
  capture += 1;
  return request("/api/bridge/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `player-${characterId}-${capture}` },
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
        region,
        payloadSchemaVersion: 1,
        payload: {
          schemaVersion: 1,
          name,
          realm,
          region,
          level,
          class: { id: 1, name: "Warrior", token: "WARRIOR" },
          race: { id: 4, name: "Night Elf", token: "NightElf" },
        },
      },
    },
  });
}

function syncGather(request, token, { characterId, realm, observationId }) {
  const envelope = structuredClone(gatheringFixture);
  envelope.characterId = characterId;
  envelope.realm = realm;
  envelope.payload.observationId = observationId;
  return request("/api/bridge/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `gather-${observationId}` },
    body: { streamKey: `gathering_loot:${characterId}:${observationId}`, kind: "event", revision: 1, envelope },
  });
}

test("a Discord player with no guild connects a computer and sees their characters by server", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    assert.equal(withGuildDatabase((db) => db.prepare("SELECT status FROM members WHERE id = ?").get(ASH.id)).status, "departed");
    assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM guild_memberships WHERE member_id = ?").get(ASH.id)).n, 0, "sign-in never joins a guild");

    const before = await request("/api/player/overview", { rawCookie: ash.cookie });
    assert.equal(before.status, 200);
    assert.equal(before.json.sync.state, "waiting_for_data");
    assert.equal(before.json.devices.length, 1);
    assert.equal(before.json.devices[0].status, "connected");

    assert.equal((await syncCharacter(request, ash.token, { characterId: "ash-rook", name: "Rook", realm: "Doomhowl" })).status, 201);
    assert.equal((await syncCharacter(request, ash.token, { characterId: "ash-rook-2", name: "Rook", realm: "Shadowmoon" })).status, 201);
    assert.equal((await syncCharacter(request, ash.token, { characterId: "ash-fern", name: "Fern", realm: "Doomhowl" })).status, 201);

    const overview = (await request("/api/player/overview", { rawCookie: ash.cookie })).json;
    assert.equal(overview.characters.length, 3, "same-named characters on different realms stay apart");
    assert.deepEqual(overview.servers.map((server) => [server.key, server.characterCount]).sort(), [["us:doomhowl", 2], ["us:shadowmoon", 1]]);
    assert.equal(overview.sync.state, "synced");
    assert.ok(overview.devices[0].lastUploadAt);
    assert.equal(overview.devices[0].characterCount, 3);

    const doomhowl = (await request("/api/player/characters?server=us%3Adoomhowl", { rawCookie: ash.cookie })).json;
    assert.deepEqual(doomhowl.characters.map((character) => character.name).sort(), ["Fern", "Rook"]);
    assert.ok(doomhowl.characters.every((character) => character.realm === "Doomhowl"));
    const all = (await request("/api/player/characters?server=nonsense", { rawCookie: ash.cookie })).json;
    assert.equal(all.characters.length, 3, "an unusable server filter shows all servers");
  });
});

test("players never see, open, search or change each other's data, even by id", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    const bram = await connectComputer(request, BRAM);
    await syncCharacter(request, ash.token, { characterId: "same-local-id", name: "Rook", realm: "Doomhowl" });
    await syncCharacter(request, bram.token, { characterId: "same-local-id", name: "Rook", realm: "Doomhowl" });
    await syncGather(request, bram.token, { characterId: "same-local-id", realm: "Doomhowl", observationId: "bram-herb-1" });

    const ashCharacters = (await request("/api/player/characters", { rawCookie: ash.cookie })).json.characters;
    const bramCharacters = (await request("/api/player/characters", { rawCookie: bram.cookie })).json.characters;
    assert.equal(ashCharacters.length, 1);
    assert.equal(bramCharacters.length, 1);
    assert.notEqual(ashCharacters[0].id, bramCharacters[0].id, "same name, realm and addon id across owners are two characters");
    const bramCharacter = bramCharacters[0].id;

    // Direct ids: another player's character answers like a missing one.
    assert.equal((await request(`/api/player/characters/${encodeURIComponent(bramCharacter)}`, { rawCookie: bram.cookie })).status, 200);
    for (const route of [`/api/player/characters/${encodeURIComponent(bramCharacter)}`, `/api/player/characters/${encodeURIComponent(bramCharacter)}/recipes`]) {
      const response = await request(route, { rawCookie: ash.cookie });
      assert.equal(response.status, 404, route);
      assert.equal(response.json.error, "character_not_found");
    }

    // Uploading another player's character id never takes their character:
    // the older snapshot route used to reassign it to the uploader.
    await syncCharacter(request, ash.token, { characterId: "ash-only", name: "Fern", realm: "Doomhowl" });
    const fern = (await request("/api/player/characters", { rawCookie: ash.cookie })).json.characters.find((character) => character.name === "Fern");
    const forged = await request("/api/bridge/characters/snapshot", {
      method: "POST",
      headers: { Authorization: `Bearer ${bram.token}` },
      body: {
        revision: 1,
        snapshot: {
          schemaVersion: 3,
          capturedAt: capture + 100,
          characterId: "ash-only",
          name: "Fern",
          realm: "Doomhowl",
          region: "US",
          level: 60,
          race: { id: 1, name: "Human", token: "Human" },
          class: { id: 1, name: "Warrior", token: "WARRIOR" },
          professions: [],
          equipment: [],
        },
      },
    });
    assert.ok([200, 201].includes(forged.status), forged.text);
    assert.notEqual(forged.json.character.id, fern.id);
    assert.equal(withGuildDatabase((db) => db.prepare("SELECT member_id FROM characters WHERE id = ?").get(fern.id)).member_id, ASH.id);
    const ashFern = await request(`/api/player/characters/${encodeURIComponent(fern.id)}`, { rawCookie: ash.cookie });
    assert.equal(ashFern.status, 200);
    assert.equal(ashFern.json.character.level, 20, "Bram's upload did not change Ash's character");
    assert.equal((await request(`/api/player/characters/${encodeURIComponent(fern.id)}`, { rawCookie: bram.cookie })).status, 404);

    // A client-supplied owner is ignored: the session decides.
    const spoofed = await request(`/api/player/characters?memberId=${BRAM.id}&ownerId=${BRAM.id}`, { rawCookie: ash.cookie });
    assert.deepEqual(spoofed.json.characters.map((character) => character.id).sort(), [ashCharacters[0].id, fern.id].sort());

    // Farming and crafting are the player's own.
    const bramFarming = (await request("/api/player/farming", { rawCookie: bram.cookie })).json;
    assert.equal(bramFarming.summary.observations, 1);
    assert.equal(bramFarming.recent[0].character?.name, "Rook", "each gather names the character that made it");
    const ashFarming = (await request("/api/player/farming", { rawCookie: ash.cookie })).json;
    assert.equal(ashFarming.summary.observations, 0);
    assert.deepEqual(ashFarming.recent, []);
    assert.deepEqual((await request("/api/player/craft-finder?q=", { rawCookie: ash.cookie })).json.results, []);

    // Devices: listing and disconnecting are owner-only.
    const ashDevices = (await request("/api/player/devices", { rawCookie: ash.cookie })).json.devices;
    assert.deepEqual(ashDevices.map((device) => device.id), [ash.deviceId]);
    const stolen = await request(`/api/player/devices/${bram.deviceId}/disconnect`, { method: "POST", rawCookie: ash.cookie });
    assert.equal(stolen.status, 404);
    const renamedElsewhere = await request(`/api/player/devices/${bram.deviceId}/rename`, { method: "POST", rawCookie: ash.cookie, body: { name: "Mine now" } });
    assert.equal(renamedElsewhere.status, 404, "another player's device cannot be renamed");
    assert.equal((await syncCharacter(request, bram.token, { characterId: "bram-2", name: "Kip", realm: "Doomhowl" })).status, 201, "Bram's computer still uploads");

    // The guild workspace is hidden while guild features are off.
    for (const route of ["/api/intelligence", `/api/intelligence/characters/${encodeURIComponent(bramCharacter)}`, "/api/intelligence/craft-finder?q=a", "/api/intelligence/recipes"]) {
      assert.equal((await request(route, { rawCookie: ash.cookie })).status, 404, route);
    }
  });
});

test("anonymous requests read no private data", async () => {
  await withHttpApp(async ({ request }) => {
    for (const route of ["/api/player/overview", "/api/player/characters", "/api/player/characters/anything", "/api/player/professions", "/api/player/craft-finder?q=a", "/api/player/farming", "/api/player/devices", "/api/intelligence/farming/sessions"]) {
      const response = await request(route);
      assert.equal(response.status, 401, route);
      assert.equal(response.json.error, "authentication_required", route);
    }
    assert.equal((await request("/api/player/devices/x/disconnect", { method: "POST" })).status, 401);
    assert.equal((await request("/api/player/devices/x/rename", { method: "POST", body: { name: "Laptop" } })).status, 401);
  });
});

test("with guild features on, signing in is still not enough to read the guild workspace", async () => {
  await withGuildHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    await syncCharacter(request, ash.token, { characterId: "ash-rook", name: "Rook", realm: "Doomhowl" });
    for (const route of ["/api/intelligence", "/api/intelligence/craft-finder?q=a", "/api/intelligence/recipes"]) {
      const response = await request(route, { rawCookie: ash.cookie });
      assert.equal(response.status, 403, route);
    }
    // Holdfast's members do not see a guildless player's characters.
    const roster = await request("/api/intelligence", { persona: "member" });
    assert.equal(roster.status, 200);
    assert.equal(roster.json.characters.some((character) => character.name === "Rook"), false);
  });
});

test("disconnecting a device revokes its key at once and the dashboard says so", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    await syncCharacter(request, ash.token, { characterId: "ash-rook", name: "Rook", realm: "Doomhowl" });

    const disconnected = await request(`/api/player/devices/${ash.deviceId}/disconnect`, { method: "POST", rawCookie: ash.cookie });
    assert.equal(disconnected.status, 200, disconnected.text);
    assert.equal(disconnected.json.status, "disconnected");
    assert.equal(disconnected.json.device.status, "disconnected");
    assert.ok(disconnected.json.device.revokedAt);

    const rejected = await syncCharacter(request, ash.token, { characterId: "ash-rook", name: "Rook", realm: "Doomhowl" });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.json.error, "invalid_device_token");

    const overview = (await request("/api/player/overview", { rawCookie: ash.cookie })).json;
    assert.equal(overview.sync.connectedDevices, 0);
    assert.equal(overview.sync.disconnectedDevices, 1);
    assert.equal(overview.characters.length, 1, "data already sent stays");

    const again = await request(`/api/player/devices/${ash.deviceId}/disconnect`, { method: "POST", rawCookie: ash.cookie });
    assert.equal(again.json.status, "already-disconnected");

    // A mutation from another site is refused before it reaches the route.
    const crossSite = await request(`/api/player/devices/${ash.deviceId}/disconnect`, { method: "POST", rawCookie: ash.cookie, headers: { Origin: "https://evil.example" } });
    assert.equal(crossSite.status, 403);
  });
});

test("live updates about a player's data reach only that player", async () => {
  await withHttpApp(async ({ request }) => {
    flushPlayerChanges();
    flushCharacterChanges();
    resetLiveUpdatesForTests();
    const ash = await connectComputer(request, ASH);
    const heard = { ash: [], bram: [], holdfast: [] };
    subscribeLiveUpdates({ memberId: ASH.id, send: (event) => heard.ash.push(event) });
    subscribeLiveUpdates({ memberId: BRAM.id, send: (event) => heard.bram.push(event) });
    subscribeLiveUpdates({ memberId: "e2e-member", guildIds: ["guild-holdfast"], send: (event) => heard.holdfast.push(event) });

    const second = await connectComputer(request, ASH, "Ash laptop");
    const synced = await syncCharacter(request, second.token, { characterId: "ash-rook", name: "Rook", realm: "Doomhowl" });
    assert.equal(synced.status, 201, synced.text);
    const levelled = await syncCharacter(request, second.token, { characterId: "ash-rook", name: "Rook", realm: "Doomhowl", level: 21 });
    assert.equal(levelled.status, 201, levelled.text);
    flushPlayerChanges();
    flushCharacterChanges();

    assert.ok(heard.ash.some((event) => event.topics.includes("player")), "the owner's dashboard refreshes");
    assert.ok(heard.ash.some((event) => event.source === "character.changed"), JSON.stringify(heard.ash.map((event) => [event.source, event.memberId, event.guildId])));
    for (const other of [heard.bram, heard.holdfast]) {
      assert.deepEqual(other.filter((event) => event.topics.includes("player") || event.source === "character.changed" || event.source === "guildweaver.connected"), []);
    }
    assert.equal(heard.bram.some((event) => JSON.stringify(event).includes(second.deviceId)), false, "no device ids leak");
    assert.ok(ash.token);
  });
});

test("server identity is region and realm, and never merges distinct servers", () => {
  assert.equal(serverKey({ realm: "Doomhowl", region: "US" }), "us:doomhowl");
  assert.equal(serverKey({ realm: " doomhowl ", region: "us" }), "us:doomhowl");
  assert.notEqual(serverKey({ realm: "Doomhowl", region: "US" }), serverKey({ realm: "Doomhowl", region: "EU" }));
  assert.notEqual(serverKey({ realm: "Shadowmoon", region: "US" }), serverKey({ realm: "Doomhowl", region: "US" }));
  assert.equal(serverKey({ realm: "", region: "US" }), "unknown");

  const servers = groupServers([
    { realm: "Doomhowl", region: "US", lastSeenAt: "2026-11-01T00:00:00.000Z" },
    { realm: "Doomhowl", region: "EU", lastSeenAt: "2026-11-02T00:00:00.000Z" },
    { realm: "Shadowmoon", region: "US", lastSeenAt: "2026-10-01T00:00:00.000Z" },
    { realm: "", region: "", lastSeenAt: null },
  ]);
  assert.deepEqual(servers.map((server) => server.label), ["Doomhowl (EU)", "Doomhowl (US)", "Shadowmoon", "Unknown server"]);
  assert.ok(servers.every((server) => !("type" in server)), "server types are never invented");

  assert.equal(requestedServer("us:doomhowl"), "us:doomhowl");
  assert.equal(requestedServer("ALL"), "");
  assert.equal(requestedServer("unknown"), "unknown");
  assert.equal(requestedServer("drop table"), "");
});

test("sync state follows what the website actually received", () => {
  const now = Date.parse("2026-11-06T12:00:00.000Z");
  const connected = { status: "connected", lastUploadAt: null };
  const recent = "2026-11-06T11:00:00.000Z";
  const old = "2026-10-01T00:00:00.000Z";
  assert.equal(playerSyncState({ devices: [], characters: [], now }).state, "no_device");
  assert.equal(playerSyncState({ devices: [connected], characters: [], now }).state, "waiting_for_data");
  assert.equal(playerSyncState({ devices: [{ ...connected, lastUploadAt: recent }], characters: [], now }).state, "processing");
  assert.equal(playerSyncState({ devices: [{ ...connected, lastUploadAt: recent }], characters: [{ lastSeenAt: recent }], now }).state, "synced");
  assert.equal(playerSyncState({ devices: [{ ...connected, lastUploadAt: old }], characters: [{ lastSeenAt: old }], now }).state, "stale");
  assert.equal(playerSyncState({ devices: [{ status: "disconnected", lastUploadAt: recent }], characters: [{ lastSeenAt: recent }], now }).state, "stale");
});

test("a player can name their own devices to tell them apart", async () => {
  await withHttpApp(async ({ request }) => {
    const ash = await connectComputer(request, ASH);
    const route = `/api/player/devices/${ash.deviceId}/rename`;

    const renamed = await request(route, { method: "POST", rawCookie: ash.cookie, body: { name: "  Living   room\u0007 PC " } });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.json.device.name, "Living room PC", "spaces and control characters are tidied");
    assert.equal((await request("/api/player/devices", { rawCookie: ash.cookie })).json.devices[0].name, "Living room PC");

    for (const name of ["", "   ", "x".repeat(41), undefined]) {
      assert.equal((await request(route, { method: "POST", rawCookie: ash.cookie, body: { name } })).status, 400, JSON.stringify(name));
    }
    assert.equal((await request("/api/player/devices/nope/rename", { method: "POST", rawCookie: ash.cookie, body: { name: "Laptop" } })).status, 404);
    const crossSite = await request(route, { method: "POST", rawCookie: ash.cookie, body: { name: "Evil" }, headers: { Origin: "https://evil.example" } });
    assert.equal(crossSite.status, 403);
  });
});
