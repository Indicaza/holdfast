import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { setSession } from "../src/Auth/session.js";
import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { readCharacterArmoryFromReadModel } from "../src/Character/ReadModel/readModelReader.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { blizzardAuctionConfig } from "../src/Market/blizzardAuctionProvider.js";
import { readMarketIngestionControls, writeMarketIngestionControls } from "../src/Market/marketRepository.js";
import { createMarketRefresher } from "../src/Market/marketRefresh.js";
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


test("site admin controls persist independently and default to paused in production", () => withHttpApp(async ({ request }) => {
  const route = "/api/admin/guildweaver/ingestion";
  assert.equal((await request(route)).status, 401);
  assert.equal((await request(route, { persona: "member" })).status, 403);
  assert.equal((await request(route, { persona: "member", method: "PUT", body: { blizzard: true, addon: true } })).status, 403);
  const initial = await request(route, { persona: "owner" });
  assert.equal(initial.status, 200, initial.text);
  assert.equal(initial.json.controls.blizzard, false);
  assert.equal(initial.json.controls.addon, false);
  assert.equal((await request(route, { persona: "owner", method: "PUT", body: { blizzard: "true", addon: true } })).status, 400);
  assert.equal(readMarketIngestionControls().addon, false);
  const saved = await request(route, { persona: "owner", method: "PUT", body: { blizzard: true, addon: false } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.controls.blizzard, true);
  assert.equal(saved.json.controls.addon, false);
  assert.equal(saved.json.controls.updatedBy, memberIds.owner);
  assert.deepEqual((await request(route, { persona: "owner" })).json.controls, saved.json.controls);
  assert.equal(blizzardAuctionConfig({ NODE_ENV: "production", BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret" }).configured, true);
  let calls = 0;
  const provider = { configured: () => true, config: { regions: ["us"] }, discoverMarkets: async () => { calls++; return []; } };
  const refresher = createMarketRefresher({ provider, enabled: () => readMarketIngestionControls().blizzard });
  await refresher.discover();
  assert.equal(calls, 1);
  writeMarketIngestionControls({ blizzard: false, addon: true }, memberIds.owner);
  assert.equal((await refresher.tick()).status, "paused");
  assert.equal((await refresher.refreshOne()).status, "paused");
  assert.deepEqual(await refresher.discover(), []);
  assert.equal(calls, 1);
  assert.equal(readMarketIngestionControls().addon, true);
}));

test("pausing addon auction ingestion keeps raw scans out of storage while character sync continues", () => withHttpApp(async ({ request }) => {
  writeMarketIngestionControls({ blizzard: false, addon: false }, memberIds.owner);
  {
    const ash = await connect(request, ASH);
    const before = withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM guildweaver_telemetry_records WHERE event_type = 'auction_scan'").get().n);
    const answer = await telemetry(request, ash.token, { streamKey: "auction_scan:paused", kind: "event", revision: 1,
      envelope: { schemaVersion: 1, eventType: "auction_scan", capturedAt: 1793340000, realm: PVP, region: "US", installationId: "install-pause", characterId: "character-rook", payloadSchemaVersion: 1,
        payload: { schemaVersion: 1, scanId: "paused-scan", observedAt: 1793340000, market: { faction: "alliance" }, query: { kind: "commodity" }, coverage: "items",
          items: [{ itemId: 2589, quantity: 20, listings: 2, complete: true, prices: [[30, 20, 2]] }] } } });
    assert.equal(answer.status, 503, answer.text);
    assert.equal(answer.json.error, "auction_ingestion_paused");
    assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM guildweaver_telemetry_records WHERE event_type = 'auction_scan'").get().n), before);
    assert.ok([200, 201].includes((await syncCharacter(request, ash.token, "character-rook", PVP)).status));
  }
}));


test("archive permission belongs to an explicitly authorized admin computer; exports are bounded and read-only", () => withHttpApp(async ({ request }) => {
  const owner = await connect(request, { id: memberIds.owner, username: "owner" });
  const ordinary = await connect(request, ASH);
  const adminRoute = "/api/admin/guildweaver/archive/devices";
  const bridgeRoute = "/api/bridge/archive";
  const ownerHeaders = { Authorization: `Bearer ${owner.token}` };
  const ordinaryHeaders = { Authorization: `Bearer ${ordinary.token}` };
  assert.equal((await request(adminRoute)).status, 401);
  assert.equal((await request(adminRoute, { rawCookie: ordinary.cookie })).status, 403);
  const devices = await request(adminRoute, { persona: "owner" });
  assert.equal(devices.status, 200, devices.text);
  const id = devices.json.devices[0].id;
  assert.equal(devices.json.devices[0].archiveEnabled, false);
  assert.equal((await request(bridgeRoute + "/status", { headers: ownerHeaders })).json.enabled, false);
  assert.equal((await request(bridgeRoute + "/batch", { headers: ownerHeaders })).status, 403);
  assert.equal((await request(adminRoute + "/" + id, { rawCookie: ordinary.cookie, method: "PUT", body: { enabled: true } })).status, 403);
  assert.equal((await request(adminRoute + "/" + id, { persona: "owner", method: "PUT", body: { enabled: "true" } })).status, 400);
  assert.equal((await request(adminRoute + "/unknown", { persona: "owner", method: "PUT", body: { enabled: true } })).status, 400);
  const grant = await request(adminRoute + "/" + id, { persona: "owner", method: "PUT", body: { enabled: true } });
  assert.equal(grant.status, 200, grant.text);
  assert.equal((await request(bridgeRoute + "/status", { headers: ownerHeaders })).json.enabled, true);
  assert.equal((await request(bridgeRoute + "/status", { headers: ordinaryHeaders })).json.enabled, false);
  assert.equal((await request(bridgeRoute + "/batch", { headers: ordinaryHeaders })).status, 403);
  withGuildDatabase((db) => {
    db.prepare("INSERT INTO market_markets (market_key, kind, region, name, created_at) VALUES ('archive-test', 'api_house', 'us', 'Archive test', '2026-01-01')").run();
    const insert = db.prepare("INSERT INTO market_series_monthly (market_key,item_key,source_type,month,days,samples,quantity_low,quantity_high,quantity_close,final) VALUES ('archive-test',?,'official_api','2026-01-01',1,1,1,2,2,?)");
    for (let index = 0; index < 201; index++) insert.run("i:" + String(index).padStart(4, "0"), 1);
    insert.run("i:unfinished", 0);
  });
  const query = bridgeRoute + "/batch?dataset=market-monthly&market=archive-test";
  assert.equal((await request(query + "&cursor=bad", { headers: ownerHeaders })).status, 400);
  const first = await request(query, { headers: ownerHeaders });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.batch.rows.length, 200);
  assert.equal(first.json.sha256, createHash("sha256").update(JSON.stringify(first.json.batch)).digest("hex"));
  const second = await request(query + "&cursor=" + encodeURIComponent(first.json.batch.nextCursor), { headers: ownerHeaders });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.json.batch.rows.length, 1);
  assert.equal(second.json.batch.nextCursor, null);
  assert.equal((await request(bridgeRoute + "/batch?dataset=market-current&market=archive-test", { headers: ownerHeaders })).status, 200);
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM market_series_monthly WHERE market_key = 'archive-test'").get().n), 202);
  const queued = await request(bridgeRoute + "/jobs", { method: "POST", headers: ownerHeaders, body: { dataset: "market-monthly", market: "archive-test" } });
  assert.ok([200, 202].includes(queued.status), queued.text);
  const ticket = queued.json.ticket;
  assert.equal(typeof ticket, "string");
  assert.equal((await request(bridgeRoute + "/jobs/" + ticket, { headers: ordinaryHeaders })).status, 403);
  let answer = queued;
  const deadline = Date.now() + 9000;
  while (answer.status === 202 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    answer = await request(bridgeRoute + "/jobs/" + ticket, { headers: ownerHeaders });
  }
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.json.status, "ready");
  assert.equal(answer.json.result.batch.rows.length, 200);
  assert.equal(answer.json.result.sha256, createHash("sha256").update(JSON.stringify(answer.json.result.batch)).digest("hex"));
  assert.equal((await request(bridgeRoute + "/jobs/" + ticket, { method: "DELETE", headers: ownerHeaders })).status, 204);
  assert.equal((await request(bridgeRoute + "/jobs/" + ticket, { headers: ownerHeaders })).status, 404);

  assert.equal((await request(adminRoute + "/" + id, { persona: "owner", method: "PUT", body: { enabled: false } })).status, 200);
  assert.equal((await request(query, { headers: ownerHeaders })).status, 403);
}));
