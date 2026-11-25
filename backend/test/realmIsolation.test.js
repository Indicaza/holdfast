import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { setSession } from "../src/Auth/session.js";
import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { readCharacterArmoryFromReadModel } from "../src/Character/ReadModel/readModelReader.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { readItemMarket, readPrices } from "../src/Market/marketRepository.js";
import { readPlayerCharacters } from "../src/Player/playerRepository.js";
import { ingestCharacterIdentity } from "../testSupport/characterTelemetry.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

// A character is account + region + realm + name. The player moved from an
// RP-PvP realm to a PvP one and made a character of the same name there:
// two characters, never one, and nothing of one realm shows on the other.

const RP = "Forever RP-PvP";
const PVP = "Forever PvP";
const RP_KEY = "us:forever rp-pvp";
const PVP_KEY = "us:forever pvp";

let nonce = 0;
function equipment(helm, { deviceId = "device-pc", characterId, realm, capturedAt }) {
  nonce += 1;
  return ingestTelemetry({
    deviceId,
    memberId: memberIds.member,
    idempotencyKey: `realm-eq-${nonce}`,
    body: {
      streamKey: `equipment:${characterId}`,
      kind: "state",
      revision: capturedAt,
      envelope: { schemaVersion: 1, eventType: "equipment", capturedAt, characterId, realm, region: "US", payloadSchemaVersion: 1,
        payload: { schemaVersion: 1, equipment: [{ slot: "head", slotId: 1, itemId: 11746, name: helm, qualityId: 3 }] } },
    },
    receivedAt: new Date(capturedAt * 1000 + 500).toISOString(),
  });
}

function identity(characterId, realm, { deviceId = "device-pc", name = "Rook", capturedAt = 1791322400, region = "US" } = {}) {
  return ingestCharacterIdentity({ deviceId, memberId: memberIds.member, characterId, name, realm, region, capturedAt });
}

function characters(server = "") {
  return readPlayerCharacters(memberIds.member, { server });
}

function idOn(server) {
  const list = characters(server).characters;
  assert.equal(list.length, 1, `one character on ${server}`);
  return list[0].id;
}

test("the same name on PvP and RP-PvP is two characters, each on its own server", () =>
  withHttpApp(async () => {
    // One installation: the add-on keys characters by realm and name, so each realm has its own id.
    identity("character-rook-rp", RP, { capturedAt: 1791320000 });
    equipment("RP Helm", { characterId: "character-rook-rp", realm: RP, capturedAt: 1791320100 });
    identity("character-rook-pvp", PVP, { capturedAt: 1791330000 });
    equipment("PvP Helm", { characterId: "character-rook-pvp", realm: PVP, capturedAt: 1791330100 });

    const all = characters();
    assert.equal(all.characters.length, 2, "two characters, not one");
    assert.deepEqual(all.servers.map((server) => server.key), [PVP_KEY, RP_KEY], "most recently active server first");
    const rp = idOn(RP_KEY);
    const pvp = idOn(PVP_KEY);
    assert.notEqual(rp, pvp);
    assert.equal(readCharacterArmoryFromReadModel(rp).equipment[0].name, "RP Helm");
    assert.equal(readCharacterArmoryFromReadModel(pvp).equipment[0].name, "PvP Helm");

    // Switching back to the old realm on the same installation: an old (or late) RP-PvP capture lands on the RP-PvP character only.
    equipment("Late RP Helm", { characterId: "character-rook-rp", realm: RP, capturedAt: 1791320200 });
    assert.equal(readCharacterArmoryFromReadModel(rp).equipment[0].name, "Late RP Helm");
    assert.equal(readCharacterArmoryFromReadModel(pvp).equipment[0].name, "PvP Helm", "the PvP character is untouched");
  }));

test("a second computer joins the character of its own realm, never the same name on another realm", () =>
  withHttpApp(async () => {
    identity("character-rook-rp", RP, { capturedAt: 1791320000 });
    identity("character-rook-pvp", PVP, { capturedAt: 1791330000 });
    const rp = idOn(RP_KEY);
    const pvp = idOn(PVP_KEY);

    // The laptop has its own local ids for the same two characters.
    identity("laptop-rook-pvp", PVP, { deviceId: "device-laptop", capturedAt: 1791331000 });
    equipment("Laptop PvP Helm", { deviceId: "device-laptop", characterId: "laptop-rook-pvp", realm: PVP, capturedAt: 1791331100 });
    identity("laptop-rook-rp", RP, { deviceId: "device-laptop", capturedAt: 1791332000 });
    equipment("Laptop RP Helm", { deviceId: "device-laptop", characterId: "laptop-rook-rp", realm: RP, capturedAt: 1791332100 });

    assert.equal(characters().characters.length, 2, "still two characters");
    assert.equal(readCharacterArmoryFromReadModel(pvp).equipment[0].name, "Laptop PvP Helm");
    assert.equal(readCharacterArmoryFromReadModel(rp).equipment[0].name, "Laptop RP Helm");
  }));

test("different characters of one account, and switching between them across realms, stay apart", () =>
  withHttpApp(async () => {
    identity("character-rook-rp", RP, { capturedAt: 1791320000 });
    identity("character-fern-pvp", PVP, { name: "Fern", capturedAt: 1791321000 });
    identity("character-rook-pvp", PVP, { capturedAt: 1791322000 });
    identity("character-fern-rp", RP, { name: "Fern", capturedAt: 1791323000 });
    const all = characters().characters;
    assert.equal(all.length, 4);
    assert.deepEqual(characters(PVP_KEY).characters.map((character) => character.name).sort(), ["Fern", "Rook"]);
    assert.deepEqual(characters(RP_KEY).characters.map((character) => character.name).sort(), ["Fern", "Rook"]);
    assert.equal(new Set(all.map((character) => character.id)).size, 4);
  }));

test("telemetry without a realm is never given another character's realm", () =>
  withHttpApp(async () => {
    identity("character-rook-pvp", PVP, { capturedAt: 1791330000 });
    const pvp = idOn(PVP_KEY);

    // A new local id whose upload has no realm: it is not matched by name to the PvP Rook.
    identity("character-rook-unknown", "", { deviceId: "device-laptop", capturedAt: 1791331000 });
    assert.equal(characters().characters.length, 2);
    assert.equal(idOn(PVP_KEY), pvp);
    assert.notEqual(idOn("unknown"), pvp, "it waits under Unknown server");

    // A later upload of the PvP character itself without its realm does not move it off PvP.
    identity("character-rook-pvp", "", { capturedAt: 1791332000 });
    assert.equal(idOn(PVP_KEY), pvp, "the known realm is kept");
  }));

test("a local id already known on another realm never carries a character across realms", () =>
  withHttpApp(async () => {
    const snapshot = (realm, capturedAt) => syncGuildweaverCharacter({
      memberId: memberIds.member,
      deviceId: "device-pc",
      bridgeRevision: capturedAt,
      snapshot: { schemaVersion: 3, capturedAt, characterId: "character-reused", name: "Rook", realm, region: "US", level: 20,
        class: { id: 1, name: "Warrior", token: "WARRIOR" }, race: { id: 4, name: "Night Elf", token: "NightElf" },
        equipment: [{ slot: "head", slotId: 1, itemId: 11746, name: `${realm} Helm`, qualityId: 3 }], professions: [] },
    });
    await snapshot(RP, 1791320000);
    const rp = idOn(RP_KEY);
    // The same local id now reports PvP (an id reused by an old add-on, or a copied SavedVariables).
    await snapshot(PVP, 1791330000);
    const pvp = idOn(PVP_KEY);
    assert.notEqual(pvp, rp, "a character of its own on PvP");
    assert.equal(idOn(RP_KEY), rp, "the RP-PvP character stays on RP-PvP");
    assert.equal(readCharacterArmoryFromReadModel(rp).equipment[0].name, `${RP} Helm`, "its history is kept");
    assert.equal(readCharacterArmoryFromReadModel(pvp).equipment[0].name, `${PVP} Helm`);
    // The original envelopes are untouched.
    const raw = withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM character_snapshots").get().n);
    assert.ok(raw >= 2);
  }));

// Dungeon runs ----------------------------------------------------------------------------

const runFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-dungeon-run.v1.json", import.meta.url), "utf8"));
const ASH = { id: "discord-realm-ash", username: "ash" };

function cookieFor(user) {
  let header;
  setSession({ append(_name, value) { header = value; } }, { user, permissions: [], homeServer: false, verifiedAt: Date.now() });
  return header.split(";", 1)[0];
}

async function connect(request, user) {
  const cookie = cookieFor(user);
  await request("/api/me", { rawCookie: cookie });
  const started = await request("/api/bridge/pairing/start", { method: "POST", body: { deviceName: "Realm PC" } });
  await request("/api/bridge/pairing/approve", { method: "POST", rawCookie: cookie, body: { userCode: started.json.userCode } });
  const exchanged = await request("/api/bridge/pairing/token", { method: "POST", body: { deviceCode: started.json.deviceCode } });
  assert.equal(exchanged.status, 200, exchanged.text);
  return { cookie, token: exchanged.json.deviceToken };
}

let key = 0;
function telemetry(request, token, body) {
  key += 1;
  return request("/api/bridge/telemetry", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `realm-${key}` }, body });
}

function syncCharacter(request, token, characterId, realm) {
  return telemetry(request, token, { streamKey: `character:${characterId}`, kind: "state", revision: key + 1, envelope: {
    schemaVersion: 1, eventType: "character", capturedAt: 1791761000 + key, characterId, realm, region: "US", payloadSchemaVersion: 1,
    payload: { schemaVersion: 1, name: "Rook", realm, region: "US", level: 19,
      class: { id: 11, name: "Druid", token: "DRUID" }, race: { id: 4, name: "Night Elf", token: "NightElf" } } } });
}

function uploadRun(request, token, characterId, realm, runId) {
  const copy = structuredClone(runFixture);
  const envelope = { ...copy, characterId, realm, payload: { ...copy.payload, runId } };
  return telemetry(request, token, { streamKey: `dungeon_run:${characterId}:${runId}`, kind: "event", revision: envelope.payload.sequence || 1, envelope });
}

test("dungeon runs keep their realm and each server shows only its own", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, ASH);
  for (const [id, realm] of [["character-rook-rp", RP], ["character-rook-pvp", PVP]]) {
    assert.ok([200, 201].includes((await syncCharacter(request, ash.token, id, realm)).status));
  }
  assert.ok([200, 201].includes((await uploadRun(request, ash.token, "character-rook-rp", RP, "dungeon-6ac1f000-aaaaaa-000001")).status));
  assert.ok([200, 201].includes((await uploadRun(request, ash.token, "character-rook-pvp", PVP, "dungeon-6ac1f000-bbbbbb-000002")).status));

  const list = async (server) => (await request(`/api/player/dungeon-runs?server=${encodeURIComponent(server)}`, { rawCookie: ash.cookie })).json.runs;
  const pvp = await list(PVP_KEY);
  assert.equal(pvp.length, 1);
  assert.equal(pvp[0].realm, PVP);
  const rp = await list(RP_KEY);
  assert.equal(rp.length, 1);
  assert.equal(rp[0].realm, RP);
  assert.notEqual(pvp[0].character.id, rp[0].character.id, "each run is linked to its own realm's Rook");
  assert.equal((await list("all")).length, 2, "All servers shows both, when chosen");
}));

// Auction House ----------------------------------------------------------------------------

test("auction scans and prices are kept per realm and faction, and a scan without a realm is refused", () => withHttpApp(async () => {
  const now = Math.floor(Date.now() / 1000);
  const scan = (realm, scanId, price, faction = "horde") => {
    nonce += 1;
    return ingestTelemetry({ memberId: "realm-ash", deviceId: "device-1", idempotencyKey: `realm-scan-${nonce}`,
      body: { kind: "event", revision: 1, streamKey: `auction_scan:character-rook:${scanId}`, envelope: {
        schemaVersion: 1, eventType: "auction_scan", capturedAt: now, characterId: "character-rook", installationId: "install-1",
        realm, region: "US", gameBuild: { build: "70338" }, payloadSchemaVersion: 1,
        payload: { schemaVersion: 1, scanId, observedAt: now - 30, market: { faction }, query: { kind: "commodity" }, coverage: "items",
          items: [{ itemId: 2589, quantity: 20, listings: 2, complete: true, prices: [[price, 20, 2]] }] } } } });
  };
  assert.equal(scan(RP, "scan-rp-1", 12).recordedEvent.status, "recorded");
  assert.equal(scan(PVP, "scan-pvp-1", 30).recordedEvent.status, "recorded");
  assert.equal(scan(PVP, "scan-pvp-2", 55, "alliance").recordedEvent.status, "recorded");
  assert.equal(scan("", "scan-none-1", 1).status, "invalid", "no realm: no market to file it under");

  const markets = withGuildDatabase((db) => db.prepare("SELECT market_key FROM market_markets ORDER BY market_key").all().map((row) => row.market_key));
  assert.deepEqual(markets, ["game:us:forever-pvp:alliance", "game:us:forever-pvp:horde", "game:us:forever-rp-pvp:horde"]);
  const price = (marketKey) => readPrices({ marketKey, itemIds: [2589] }).prices[0]?.minUnitBuyout ?? null;
  assert.equal(price("game:us:forever-rp-pvp:horde"), 12);
  assert.equal(price("game:us:forever-pvp:horde"), 30);
  assert.equal(price("game:us:forever-pvp:alliance"), 55, "factions stay apart");
  assert.equal(price("game:us:forever-pvp:neutral"), null, "a house with no data is empty, not another house's");
  const detail = readItemMarket({ itemId: 2589, marketKey: "game:us:forever-pvp:horde" });
  assert.equal(detail.variants[0].minUnitBuyout, 30);
  assert.ok(detail.evidence.every((row) => row.marketKey === undefined || row.marketKey === "game:us:forever-pvp:horde"));
}));


function realmFreeIdentity(characterId, { name = "Rook Smith", firstName = "Rook", lastName = "Smith", region = "US", capturedAt = 1793340000 } = {}) {
  nonce += 1;
  return ingestTelemetry({
    deviceId: "device-laptop",
    memberId: memberIds.member,
    idempotencyKey: `realm-free-${nonce}`,
    body: { kind: "state", revision: capturedAt, streamKey: `character:${characterId}`, envelope: {
      schemaVersion: 1, eventType: "character", capturedAt, characterId, region, payloadSchemaVersion: 1,
      payload: { schemaVersion: 1, name, fullName: name, firstName, lastName, region, realmUnavailable: true, level: 18 },
    } },
    receivedAt: new Date(capturedAt * 1000 + 500).toISOString(),
  });
}

test("explicit Forever realm-free identity reconnects a unique regional full name", () => withHttpApp(async () => {
  identity("old-smith", PVP, { name: "Rook Smith" });
  const old = idOn(PVP_KEY);
  const result = realmFreeIdentity("new-smith");
  assert.equal(result.canonicalCharacterId, old);
  assert.equal(characters().characters.length, 1);
  assert.equal(characters().characters[0].level, 18);
  assert.equal(idOn(PVP_KEY), old, "historical server grouping retained until ruleset assignment");
}));

test("realm-free identity never merges ambiguous or different-region names", () => withHttpApp(async () => {
  identity("old-smith-rp", RP, { name: "Rook Smith" });
  identity("old-smith-pvp", PVP, { name: "Rook Smith" });
  const oldIds = characters().characters.map((entry) => entry.id);
  const result = realmFreeIdentity("new-smith");
  assert.ok(result.canonicalCharacterId);
  assert.ok(!oldIds.includes(result.canonicalCharacterId));
  assert.equal(characters().characters.length, 3);
  identity("old-fern", PVP, { name: "Fern Oak", region: "EU" });
  const fern = characters().characters.find((entry) => entry.name === "Fern Oak");
  const different = realmFreeIdentity("new-fern", { name: "Fern Oak", firstName: "Fern", lastName: "Oak" });
  assert.notEqual(different.canonicalCharacterId, fern.id);
}));
