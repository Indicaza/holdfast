import assert from "node:assert/strict";
import fs from "node:fs";

import { setSession } from "../src/Auth/session.js";
import { withGuildTransaction } from "../src/Data/database.js";
import { learnPublicItemInDatabase } from "../src/GameData/publicGameDataProjection.js";

// Helpers for the dungeon loot and wishlist tests: two solo players, each
// with a paired computer, uploading what the add-on would.

export const mobLootFixture = JSON.parse(fs.readFileSync(new URL("../test/fixtures/guildweaver-mob-loot.v1.json", import.meta.url), "utf8"));
export const dungeonRunFixture = JSON.parse(fs.readFileSync(new URL("../test/fixtures/guildweaver-dungeon-run.v2.json", import.meta.url), "utf8"));
export const BUILD = { version: "1.60.1", build: "70338", interface: 16001 };
export const NEXT_BUILD = { version: "1.60.2", build: "70400", interface: 16001 };
export const DEADMINES = { instanceId: 36, name: "The Deadmines", type: "party", difficultyId: 1, difficultyName: "Normal" };
export const WAILING = { instanceId: 43, name: "Wailing Caverns", type: "party", difficultyId: 1, difficultyName: "Normal" };

function cookieFor(user) {
  let header;
  setSession({ append(name, value) { header = value; } }, { user, permissions: [], homeServer: false, verifiedAt: Date.now() });
  return header.split(";", 1)[0];
}

export async function connect(request, user) {
  const cookie = cookieFor(user);
  await request("/api/me", { rawCookie: cookie });
  const started = await request("/api/bridge/pairing/start", { method: "POST", body: { deviceName: `${user.username} PC` } });
  await request("/api/bridge/pairing/approve", { method: "POST", rawCookie: cookie, body: { userCode: started.json.userCode } });
  const exchanged = await request("/api/bridge/pairing/token", { method: "POST", body: { deviceCode: started.json.deviceCode } });
  assert.equal(exchanged.status, 200, exchanged.text);
  return { cookie, token: exchanged.json.deviceToken, user };
}

let sequence = 0;
export function post(request, token, body) {
  sequence += 1;
  return request("/api/bridge/telemetry", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `loot-${sequence}` }, body });
}

function envelope(eventType, characterId, payload, extra = {}) {
  return { schemaVersion: 1, eventType, capturedAt: 1791761400, gameBuild: BUILD, realm: "Live Realm", region: "US", locale: "enUS",
    installationId: "install-fixture", characterId, payloadSchemaVersion: 1, payload, ...extra };
}

export async function syncCharacter(request, token, characterId, name, { race = { id: 4, name: "Night Elf", token: "NightElf" }, level = 19 } = {}) {
  sequence += 1;
  const response = await post(request, token, { streamKey: `character:${characterId}`, kind: "state", revision: sequence, envelope: envelope("character", characterId,
    { schemaVersion: 1, name, realm: "Live Realm", region: "US", level, class: { id: 1, name: "Warrior", token: "WARRIOR" }, race }, { capturedAt: 1791761000 + sequence }) });
  assert.equal(response.status, 201, response.text);
  return response.json.characterId;
}

// Corpse loot inside a dungeon, as MobLootCapture sends it.
export function corpseLoot(request, token, { characterId = "character-rook", npcId, npcName, serial, items, instance = DEADMINES, gameBuild = BUILD, capturedAt = 1791761400, revision = 1 }) {
  const guid = `Creature-0-1-${instance.instanceId}-3-${npcId}-${String(serial).padStart(6, "0")}`;
  const event = structuredClone(mobLootFixture);
  Object.assign(event, { characterId, gameBuild, capturedAt });
  event.payload.observationId = guid;
  event.payload.source = { guid, npcId, name: npcName, kind: "creature" };
  event.payload.outputs = items.map((item) => ({ quantity: 1, isQuestItem: false, ...item }));
  event.payload.context = { ...event.payload.context, instance };
  return post(request, token, { streamKey: `mob_loot:${characterId}:${guid}`, kind: "event", revision, envelope: event });
}

export function lootRoll(request, token, { characterId = "character-rook", rollKey, itemId, itemKey, outcome = "offered", instance = DEADMINES, source, startedAt = 1791761500, revision = 1 }) {
  return post(request, token, { streamKey: `loot_roll:${characterId}:${rollKey}`, kind: "event", revision, envelope: envelope("loot_roll", characterId, {
    schemaVersion: 1, rollKey, evidence: "group_roll", outcome, startedAt, item: { itemId, itemKey: itemKey || `i:${itemId}`, quantity: 1 },
    ...(outcome === "won" ? { acquired: { basis: "chat_loot_self" } } : {}),
    context: { instance, ...(source ? { source } : {}) },
  }, { capturedAt: startedAt }) });
}

export function journalSnapshot(request, token, { characterId = "character-rook", instance = DEADMINES, encounters, complete = true, gameBuild = BUILD, capturedAt = 1791761600, revision = 1, filters }) {
  return post(request, token, { streamKey: `loot_catalog:${instance.instanceId}:${instance.difficultyId}`, kind: "event", revision, envelope: envelope("loot_catalog_snapshot", characterId, {
    schemaVersion: 1, sourceApi: "encounter_journal", complete, difficultyId: instance.difficultyId, ...(filters ? { filters } : {}),
    instance: { instanceId: instance.instanceId, journalInstanceId: 63, name: instance.name, type: instance.type },
    encounters: encounters.map((encounter) => ({ complete: true, ...encounter })),
  }, { gameBuild, capturedAt }) });
}

// Bags and worn gear, as the inventory and equipment streams project them.
export function syncInventory(request, token, characterId, itemIds, capturedAt = 1791762000) {
  sequence += 1;
  return post(request, token, { streamKey: `inventory_snapshot:${characterId}`, kind: "state", revision: sequence, envelope: envelope("inventory_snapshot", characterId, {
    schemaVersion: 1, slotCount: 16, freeSlots: 16 - itemIds.length, money: { copper: 0 },
    containers: [{ bagId: 0, slotCount: 16, slots: itemIds.map((itemId, index) => ({ slot: index + 1, itemId, count: 1, itemKey: `item:${itemId}` })) }],
    items: itemIds.map((itemId) => ({ itemKey: `item:${itemId}`, itemId, name: `Item ${itemId}` })), totals: itemIds.map((itemId) => ({ itemId, count: 1, stacks: 1 })),
  }, { capturedAt: capturedAt + sequence }) });
}

// Items a player's game described: what makes an id "known" to the website.
export const ITEMS = {
  barb: { itemId: 5191, name: "Cruel Barb", qualityId: 3, iconFileDataId: 135321, itemLevel: 24, requiredLevel: 19, bindType: 1, equipLocation: "INVTYPE_WEAPON",
    itemClass: { id: 2, name: "Weapon" }, itemSubclass: { id: 7, name: "One-Handed Swords" } },
  cape: { itemId: 5193, name: "Cape of the Brotherhood", qualityId: 2, iconFileDataId: 133762, itemLevel: 23, requiredLevel: 18, bindType: 1, equipLocation: "INVTYPE_CLOAK",
    itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 1, name: "Cloth" } },
  staff: { itemId: 5201, name: "Emberstone Staff", qualityId: 3, iconFileDataId: 135151, itemLevel: 23, requiredLevel: 18, bindType: 1, equipLocation: "INVTYPE_2HWEAPON",
    itemClass: { id: 2, name: "Weapon" }, itemSubclass: { id: 10, name: "Staves" }, classesLine: "Classes: Mage, Warlock" },
  buckler: { itemId: 2168, name: "Corpse Rompers", qualityId: 2, iconFileDataId: 132543, itemLevel: 20, requiredLevel: 15, bindType: 2, equipLocation: "INVTYPE_FEET",
    itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 2, name: "Leather" } },
  shield: { itemId: 6694, name: "Phantom Shield", qualityId: 3, iconFileDataId: 134955, itemLevel: 22, requiredLevel: 17, bindType: 2, equipLocation: "INVTYPE_SHIELD",
    itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 6, name: "Shields" } },
  belt: { itemId: 6468, name: "Deviate Scale Belt", qualityId: 3, iconFileDataId: 132492, itemLevel: 23, requiredLevel: 18, bindType: 2, equipLocation: "INVTYPE_WAIST",
    itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 2, name: "Leather" } },
  // Two different items the game gives one name.
  ringA: { itemId: 7001, name: "Band of Echoes", qualityId: 2, iconFileDataId: 133345, itemLevel: 20, requiredLevel: 15, bindType: 1, equipLocation: "INVTYPE_FINGER",
    itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 0, name: "Miscellaneous" } },
  ringB: { itemId: 7002, name: "Band of Echoes", qualityId: 3, iconFileDataId: 133345, itemLevel: 30, requiredLevel: 25, bindType: 1, equipLocation: "INVTYPE_FINGER",
    itemClass: { id: 4, name: "Armor" }, itemSubclass: { id: 0, name: "Miscellaneous" } },
  linen: { itemId: 2589, name: "Linen Cloth", qualityId: 1, iconFileDataId: 132889, stackCount: 20, sellPrice: 13, bindType: 0,
    itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 5, name: "Cloth" } },
};

export function seedItems(items = Object.values(ITEMS)) {
  withGuildTransaction((db) => {
    for (const { classesLine, ...item } of items) {
      learnPublicItemInDatabase(db, { ...item, tooltip: { lines: [{ left: item.name }, { left: item.bindType === 2 ? "Binds when equipped" : "Binds when picked up" },
        ...(classesLine ? [{ left: classesLine }] : []), { left: "+3 Stamina" }] } }, { gameBuild: "70338", locale: "en_US" }, { base: true, capturedAt: "2026-11-01T00:00:00.000Z" });
    }
  });
}
