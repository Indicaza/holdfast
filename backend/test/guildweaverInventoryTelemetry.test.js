import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { readLatestTelemetryState } from "../src/Character/Telemetry/telemetryStateRepository.js";
import { canonicalInventorySnapshot, inventoryMoney } from "../src/Character/Telemetry/inventoryModel.js";
import { applyInventoryTelemetry } from "../src/Character/inventoryArmory.js";
import { readCharacterArmoryFromReadModel } from "../src/Character/ReadModel/readModelReader.js";
import { ingestCharacterIdentity } from "../testSupport/characterTelemetry.js";
import { readTelemetryRecord } from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/guildweaver-inventory-snapshot.v1.json", import.meta.url), "utf8"),
);

function ingest(envelope, revision = 1) {
  return ingestTelemetry({
    deviceId: "device-inventory-telemetry",
    memberId: memberIds.member,
    idempotencyKey: `gw-inventory-${revision}`,
    body: {
      streamKey: "inventory_snapshot:character-rook",
      kind: "state",
      revision,
      envelope,
    },
    receivedAt: new Date(Number(envelope.capturedAt) * 1000 + revision).toISOString(),
  });
}

function latest() {
  return readLatestTelemetryState({
    memberId: memberIds.member,
    characterId: "character-rook",
    eventType: "inventory_snapshot",
  });
}

test("inventory_snapshot keeps the raw payload and stores a canonical latest state", () =>
  withHttpApp(async () => {
    const result = ingest(structuredClone(fixture));
    assert.equal(result.status, "created");
    assert.equal(result.handlerName, "inventory_snapshot");

    const raw = readTelemetryRecord(result.record.id);
    assert.deepEqual(raw.envelope, fixture, "original envelope preserved for debugging");
    assert.equal(raw.domain, "inventory");

    const [state] = latest();
    assert.equal(state.handlerName, "inventory_snapshot");
    assert.deepEqual(state.envelope, fixture, "latest state keeps the incoming envelope");

    const payload = state.payload;
    assert.equal(payload.modelVersion, 1);
    assert.deepEqual(payload.money, { copper: 1234567, gold: 123, silver: 45, copperRemainder: 67 });
    assert.equal(payload.slotCount, 22);
    assert.equal(payload.freeSlots, 16);
    assert.equal(payload.usedSlots, 6);
    assert.deepEqual(payload.containers.map((entry) => entry.kind), ["backpack", "bag"]);
    assert.equal(payload.containers[1].item.name, "Linen Bag");
    assert.deepEqual(payload.containers[0].slots.map((stack) => stack.slot), [1, 2, 3, 7]);
    assert.equal(payload.containers[0].slots[0].isBound, true);
    const ore = payload.items.find((item) => item.itemId === 2770);
    assert.equal(ore.itemClass.name, "Trade Goods");
    assert.equal(ore.maxStackSize, 20);
    assert.equal(ore.tooltip.lines[1].left, "Crafting Reagent");
    const sword = payload.items.find((item) => item.itemId === 15210);
    assert.equal(sword.stats.ITEM_MOD_AGILITY_SHORT, 2);
    assert.equal(sword.suffixId, 1027);
    assert.equal(payload.items.find((item) => item.itemId === 6948).spell.id, 8690);
    assert.deepEqual(payload.totals.find((total) => total.itemId === 2770), { itemId: 2770, count: 25, stacks: 3 });
  }));

test("inventory_snapshot revisions replace latest state; duplicates and bad payloads do not", () =>
  withHttpApp(async () => {
    assert.equal(ingest(structuredClone(fixture)).status, "created");
    assert.equal(ingest(structuredClone(fixture)).status, "duplicate");

    const looted = structuredClone(fixture);
    looted.capturedAt += 60;
    looted.payload.containers[0].slots[2].count = 6;
    looted.payload.money.copper += 300;
    assert.equal(ingest(looted, 2).status, "created");
    const [state] = latest();
    assert.equal(state.revision, 2);
    assert.equal(state.payload.totals.find((total) => total.itemId === 2770).count, 28);
    assert.equal(state.payload.money.copper, 1234867);
    assert.equal(latest().length, 1, "one canonical state per character, not one per snapshot");

    const malformed = structuredClone(fixture);
    malformed.capturedAt += 120;
    malformed.payload.containers = "backpack";
    const invalid = ingest(malformed, 3);
    assert.equal(invalid.status, "invalid");
    assert.equal(invalid.error, "invalid_telemetry_domain_payload");
    assert.equal(latest()[0].revision, 2);
  }));

test("canonical inventory tolerates empty Lua tables and drops broken slots", () => {
  const payload = structuredClone(fixture.payload);
  payload.containers[1].slots = {};
  payload.containers[0].slots.push({ slot: 99, itemKey: "item:1", count: 1 }, { slot: 4 }, { ...payload.containers[0].slots[0] });
  payload.items.push({ key: "item:unreferenced", itemId: 1 });
  payload.totals = {};

  const canonical = canonicalInventorySnapshot(payload);
  assert.deepEqual(canonical.containers[1].slots, []);
  assert.deepEqual(canonical.containers[0].slots.map((stack) => stack.slot), [1, 2, 3, 7], "out of range, keyless and duplicate slots dropped");
  assert.equal(canonical.items.some((item) => item.key === "item:unreferenced"), false);
  assert.equal(canonical.items.some((item) => item.itemId === 2318), false, "items only in the emptied bag are dropped");
  assert.deepEqual(canonical.totals.map((total) => [total.itemId, total.count]), [[2770, 23], [6948, 1], [15210, 1]]);
  assert.deepEqual(inventoryMoney(9), { copper: 9, gold: 0, silver: 0, copperRemainder: 9 });

  const spaced = structuredClone(fixture.payload);
  const sword = spaced.items.find((item) => item.itemId === 15210);
  sword.tooltip.lines.splice(2, 0, { blank: true }, { blank: true }, { left: "Indented", offset: 8 });
  sword.tooltip.lines.push({ blank: true });
  const spacedLines = canonicalInventorySnapshot(spaced).items.find((item) => item.itemId === 15210).tooltip.lines;
  assert.deepEqual(spacedLines.slice(2, 4), [{ blank: true }, { left: "Indented", right: null, leftColor: null, rightColor: null, offset: 8 }], "one blank between sections, offsets kept");
  assert.equal(spacedLines.at(-1).blank, undefined, "no trailing blank");
  assert.deepEqual(canonicalInventorySnapshot({}).containers, []);

  const withKeyring = structuredClone(fixture.payload);
  withKeyring.containers.push({ bagId: -2, kind: "keyring", slotCount: 12, freeSlots: 11, slots: [{ slot: 1, itemKey: "item:5396", itemId: 5396, count: 1 }] });
  const keyed = canonicalInventorySnapshot(withKeyring);
  assert.equal(keyed.slotCount, 22, "keyring slots are not bag space");
  assert.equal(keyed.freeSlots, 16);
  assert.equal(keyed.usedSlots, 6);
  assert.deepEqual(keyed.containers.map((entry) => entry.kind), ["backpack", "bag", "keyring"], "keyring sorts last");
  assert.equal(keyed.totals.some((total) => total.itemId === 5396), true, "keys still count as carried items");
});

test("armory carries the latest inventory telemetry", () =>
  withHttpApp(async () => {
    const armory = { character: { id: "character-rook" }, equipment: [] };
    assert.equal(applyInventoryTelemetry(armory, null), armory, "no telemetry leaves the armory alone");

    ingestCharacterIdentity({ deviceId: "device-inventory-telemetry", memberId: memberIds.member, characterId: "character-rook" });
    const result = ingest(structuredClone(fixture));
    assert.equal(result.canonicalCharacterId, "guildweaver-id:character-rook");
    assert.deepEqual(result.changedSections, ["inventory"]);

    const decorated = readCharacterArmoryFromReadModel("guildweaver-id:character-rook");
    assert.equal(decorated.inventory.money.gold, 123);
    assert.equal(decorated.inventory.containers.length, 2);
    assert.equal(decorated.inventory.telemetry.revision, 1, "the stream's revision");
    assert.equal(decorated.inventory.telemetry.eventType, "inventory_snapshot");
    assert.deepEqual(decorated.equipment, [], "equipment untouched");
    assert.ok(decorated.freshness.inventory, "the section's capture time is reported");
  }));
