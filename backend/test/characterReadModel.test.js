import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { searchCraftFinderWithSkill } from "../src/Character/craftFinderRepository.js";
import { readCharacterArmoryFromReadModel, readCharacterCards } from "../src/Character/ReadModel/readModelReader.js";
import { rebuildCharacterReadModel } from "../src/Character/ReadModel/rebuildReadModel.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { ingestCharacterIdentity } from "../testSupport/characterTelemetry.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const DEVICE = "device-read-model";
const RAW_ID = "character-rook";
const CHARACTER_ID = `guildweaver-id:${RAW_ID}`;

const professionFixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/guildweaver-profession-snapshot.v1.json", import.meta.url), "utf8"),
);

function stream(eventType, payload, capturedAt, { deviceId = DEVICE, characterId = RAW_ID, revision = capturedAt } = {}) {
  return ingestTelemetry({
    deviceId,
    memberId: memberIds.member,
    idempotencyKey: `gw-${deviceId}-${eventType}-${characterId}-${revision}`,
    body: {
      streamKey: `${eventType}:${characterId}`,
      kind: "state",
      revision,
      envelope: { schemaVersion: 1, eventType, capturedAt, characterId, realm: "Darkwing", region: "US", payloadSchemaVersion: 1, payload: { schemaVersion: 1, ...payload } },
    },
    receivedAt: new Date(capturedAt * 1000 + 500).toISOString(),
  });
}

function stats(health, capturedAt, options) {
  return stream("stats", { stats: { resources: { health: { current: health, max: health }, power: { token: "RAGE", current: 0, max: 100 } } } }, capturedAt, options);
}

function equipment(name, capturedAt, options) {
  return stream("equipment", { equipment: name ? [{ slot: "head", slotId: 1, itemId: 11746, name, qualityId: 3 }] : [] }, capturedAt, options);
}

function legacySnapshot(capturedAt, { level = 20, helm = "Legacy Helm", health = 500, characterId = RAW_ID, deviceId = DEVICE, capture } = {}) {
  return syncGuildweaverCharacter({
    memberId: memberIds.member,
    deviceId,
    bridgeRevision: capturedAt,
    snapshot: {
      schemaVersion: 3,
      capturedAt,
      characterId,
      name: "Rook",
      realm: "Darkwing",
      region: "US",
      level,
      class: { id: 1, name: "Warrior", token: "WARRIOR" },
      race: { id: 4, name: "Night Elf", token: "NightElf" },
      stats: { resources: { health: { current: health, max: health } } },
      equipment: [{ slot: "head", slotId: 1, itemId: 11746, name: helm, qualityId: 3 }],
      professions: [],
      ...(capture ? { capture } : {}),
    },
  });
}

test("each section shows its newest capture, whichever stream sent it", () =>
  withHttpApp(async () => {
    await legacySnapshot(1791320000, { level: 20, helm: "Old Helm", health: 500 });
    // The modular streams have moved on since the last legacy snapshot.
    stats(900, 1791323600);
    equipment("New Helm", 1791323600);

    let armory = readCharacterArmoryFromReadModel(CHARACTER_ID);
    assert.equal(armory.stats.resources.health.max, 900);
    assert.equal(armory.equipment[0].name, "New Helm");
    assert.equal(armory.character.lastSeenAt, new Date(1791323600 * 1000).toISOString(), "last seen is the newest section");

    // A delayed legacy snapshot from before them changes nothing it is older than.
    await legacySnapshot(1791321000, { level: 21, helm: "Middle Helm", health: 600 });
    armory = readCharacterArmoryFromReadModel(CHARACTER_ID);
    assert.equal(armory.stats.resources.health.max, 900);
    assert.equal(armory.equipment[0].name, "New Helm");
    assert.equal(armory.character.level, 21, "identity it is newer for still applies");

    const card = readCharacterCards().characters.find((character) => character.id === CHARACTER_ID);
    assert.equal(card.vitals.healthMax, 900, "cards and the modal agree");
    assert.equal(card.level, 21);
  }));

test("out-of-order arrivals never roll a section back", () =>
  withHttpApp(async () => {
    ingestCharacterIdentity({ deviceId: DEVICE, memberId: memberIds.member, characterId: RAW_ID });
    equipment("Second Helm", 1791322600, { revision: 2 });
    equipment("First Helm", 1791322500, { revision: 1 });
    assert.equal(readCharacterArmoryFromReadModel(CHARACTER_ID).equipment[0].name, "Second Helm");
  }));

test("partial or empty captures never blank what the character has", () =>
  withHttpApp(async () => {
    await legacySnapshot(1791320000, { helm: "Real Helm" });
    equipment(null, 1791323600);
    await legacySnapshot(1791324000, {
      helm: "Teardown Helm",
      capture: { integrityVersion: 1, reason: "PLAYER_LOGIN", sections: { stats: "partial", equipment: "partial", talents: "partial", professions: "partial" } },
    });
    const armory = readCharacterArmoryFromReadModel(CHARACTER_ID);
    assert.equal(armory.equipment[0].name, "Real Helm");
  }));

test("telemetry that arrives before its character waits for it", () =>
  withHttpApp(async () => {
    const early = stats(777, 1791323000);
    assert.equal(early.canonicalCharacterId, null, "no character yet");
    assert.equal(readCharacterArmoryFromReadModel(CHARACTER_ID), null);

    await legacySnapshot(1791320000, { health: 500 });
    const armory = readCharacterArmoryFromReadModel(CHARACTER_ID);
    assert.equal(armory.stats.resources.health.max, 777, "the earlier, newer stats were replayed onto the character");
  }));

test("a second computer's telemetry lands on the same character", () =>
  withHttpApp(async () => {
    await legacySnapshot(1791320000, { helm: "PC Helm" });
    // The Mac install has its own anonymous character id for the same character.
    ingestCharacterIdentity({ deviceId: "device-mac", memberId: memberIds.member, characterId: "character-rook-mac", capturedAt: 1791323000 });
    equipment("Mac Helm", 1791323100, { deviceId: "device-mac", characterId: "character-rook-mac" });

    const cards = readCharacterCards();
    assert.equal(cards.characters.length, 1, "one character, not two");
    assert.equal(readCharacterArmoryFromReadModel(CHARACTER_ID).equipment[0].name, "Mac Helm");
  }));

test("a rebuild from stored telemetry reproduces the live model", () =>
  withHttpApp(async () => {
    await legacySnapshot(1791320000, { helm: "Old Helm" });
    stats(900, 1791323600);
    equipment("New Helm", 1791323600);
    stream("profession_snapshot", professionFixture.payload, 1791323700);

    const before = readCharacterArmoryFromReadModel(CHARACTER_ID);
    const cardsBefore = readCharacterCards();
    rebuildCharacterReadModel();
    const after = readCharacterArmoryFromReadModel(CHARACTER_ID);

    for (const key of ["character", "stats", "equipment", "talents", "professions", "recipes", "freshness"]) {
      assert.deepEqual(after[key], before[key], key);
    }
    assert.deepEqual(readCharacterCards(), cardsBefore);
  }));

test("talent definitions outlive the raw records they came from", () =>
  withHttpApp(async () => {
    const definition = {
      schemaVersion: 1,
      treeId: 4242,
      class: { token: "WARRIOR" },
      gameBuild: { build: "70245" },
      nodes: [{ nodeId: 1, maxRanks: 1, entries: [{ entryId: 11, spellId: 12294, name: "Mortal Strike", maxRanks: 1 }] }],
      edges: [],
    };
    stream("talent_tree_definition", definition, 1791323000, { characterId: "" });
    withGuildDatabase((db) => db.prepare("DELETE FROM guildweaver_telemetry_records WHERE event_type = 'talent_tree_definition'").run());

    await legacySnapshot(1791323100);
    stream("talents", { talents: { api: "traits", treeIds: [4242], allocations: [{ nodeId: 1, rank: 1, activeEntryId: 11, activeEntryRank: 1 }] } }, 1791323200);
    const talents = readCharacterArmoryFromReadModel(CHARACTER_ID).talents;
    assert.equal(talents.nodes[0].entries[0].name, "Mortal Strike");
    assert.equal(talents.nodes[0].selected, true);
  }));

test("recipe books reach the craft finder, not only the modal", () =>
  withHttpApp(async () => {
    await legacySnapshot(1791320000);
    stream("profession_snapshot", professionFixture.payload, 1791323700);
    const results = searchCraftFinderWithSkill("sharpening");
    assert.equal(results.length, 1);
    assert.equal(results[0].crafters[0].name, "Rook");
  }));

test("a sync burst announces each changed character once, and unchanged telemetry not at all", () =>
  withHttpApp(async () => {
    const { flushCharacterChanges } = await import("../src/Live/characterChangeEvents.js");
    const { subscribeLiveUpdates } = await import("../src/Live/liveUpdateBus.js");
    const events = [];
    const unsubscribe = subscribeLiveUpdates({ memberId: memberIds.member, send: (event) => events.push(event) });
    try {
      const { publishCharacterChanged } = await import("../src/Live/characterChangeEvents.js");
      await legacySnapshot(1791320000);
      for (const result of [stats(900, 1791323600), equipment("New Helm", 1791323600), stats(900, 1791323600)]) {
        publishCharacterChanged({ characterId: result.canonicalCharacterId, sections: result.changedSections });
      }
      flushCharacterChanges();
      const changes = events.filter((event) => event.source === "character.changed");
      assert.equal(changes.length, 1);
      assert.equal(changes[0].entityId, CHARACTER_ID);
      assert.deepEqual(changes[0].detail.sections, ["equipment", "identity", "professions", "stats"]);

      events.length = 0;
      const repeat = stats(900, 1791323600);
      assert.deepEqual(repeat.changedSections, [], "a duplicate changes nothing");
      publishCharacterChanged({ characterId: repeat.canonicalCharacterId, sections: repeat.changedSections });
      flushCharacterChanges();
      assert.equal(events.length, 0);
    } finally {
      unsubscribe();
    }
  }));

test("a device whose revision counter reset still updates the character", () =>
  withHttpApp(async () => {
    await legacySnapshot(1791320000);
    equipment("Before Reset", 1791323000, { revision: 1 });
    // Same stream, same revision number, new content (SavedVariables wiped).
    const reset = ingestTelemetry({
      deviceId: DEVICE,
      memberId: memberIds.member,
      idempotencyKey: "gw-after-reset",
      body: {
        streamKey: `equipment:${RAW_ID}`,
        kind: "state",
        revision: 1,
        envelope: { schemaVersion: 1, eventType: "equipment", capturedAt: 1791326000, characterId: RAW_ID, payloadSchemaVersion: 1, payload: { schemaVersion: 1, equipment: [{ slot: "head", itemId: 11746, name: "After Reset" }] } },
      },
      receivedAt: new Date(1791326000 * 1000).toISOString(),
    });
    assert.equal(reset.status, "created");
    assert.equal(readCharacterArmoryFromReadModel(CHARACTER_ID).equipment[0].name, "After Reset");
  }));
