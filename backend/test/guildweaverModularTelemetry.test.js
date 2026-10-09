import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import {
  readLatestTelemetryState,
  telemetryRetention,
} from "../src/Character/Telemetry/telemetryStateRepository.js";
import {
  readTelemetryHistory,
  readTelemetryRecord,
} from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const fixtures = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/guildweaver-modular-telemetry.v1.json", import.meta.url),
    "utf8",
  ),
);

function ingest(eventType, envelope, revision = 1) {
  return ingestTelemetry({
    deviceId: "device-modular-telemetry",
    memberId: memberIds.member,
    idempotencyKey: `gw-modular-${eventType}-${revision}`,
    body: {
      streamKey: `${eventType}:character-rook`,
      kind: "state",
      revision,
      envelope,
    },
    receivedAt: new Date(Number(envelope.capturedAt) * 1000 + revision).toISOString(),
  });
}

test("modular domains ingest independently, retain raw payloads, and maintain latest state", () =>
  withHttpApp(async () => {
    const recordIds = {};

    for (const [eventType, envelope] of Object.entries(fixtures)) {
      const result = ingest(eventType, structuredClone(envelope));
      assert.equal(result.status, "created", eventType);
      assert.equal(result.handlerName, eventType, eventType);
      assert.ok(result.record?.id, eventType);
      recordIds[eventType] = result.record.id;
    }

    const latest = readLatestTelemetryState({
      memberId: memberIds.member,
      characterId: "character-rook",
    });
    assert.equal(latest.length, 5);
    assert.deepEqual(
      latest.map((entry) => entry.eventType).sort(),
      ["character", "equipment", "professions", "stats", "talents"],
    );

    for (const entry of latest) {
      assert.equal(entry.payloadSchemaVersion, 1, entry.eventType);
      assert.equal(entry.envelopeSchemaVersion, 1, entry.eventType);
      assert.equal(entry.rawCharacterId, "character-rook", entry.eventType);
      assert.equal(entry.handlerName, entry.eventType, entry.eventType);
      assert.deepEqual(entry.payload, fixtures[entry.eventType].payload, entry.eventType);
    }

    const rawCharacter = readTelemetryRecord(recordIds.character);
    assert.deepEqual(rawCharacter.envelope, fixtures.character);
    assert.deepEqual(rawCharacter.payload, fixtures.character.payload);

    const duplicate = ingest("stats", structuredClone(fixtures.stats));
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.record, null);

    const changedEquipment = structuredClone(fixtures.equipment);
    changedEquipment.capturedAt += 10;
    changedEquipment.payload.equipment[0].itemLevel = 19;
    const updated = ingest("equipment", changedEquipment, 2);
    assert.equal(updated.status, "created");

    const equipmentState = readLatestTelemetryState({
      memberId: memberIds.member,
      characterId: "character-rook",
      eventType: "equipment",
    });
    assert.equal(equipmentState.length, 1);
    assert.equal(equipmentState[0].revision, 2);
    assert.equal(equipmentState[0].payload.equipment[0].itemLevel, 19);

    const unsupportedStats = structuredClone(fixtures.stats);
    unsupportedStats.payloadSchemaVersion = 2;
    unsupportedStats.payload.schemaVersion = 2;
    const unsupported = ingest("stats", unsupportedStats, 2);
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.error, "unsupported_telemetry_payload_schema");
  }));

test("unknown telemetry types remain transport-compatible and raw history is bounded", () =>
  withHttpApp(async () => {
    const futureEnvelope = {
      schemaVersion: 1,
      eventType: "future_domain",
      capturedAt: 1791322600,
      characterId: "character-rook",
      payloadSchemaVersion: 7,
      payload: { schemaVersion: 7, future: { untouched: true } },
    };

    const future = ingestTelemetry({
      deviceId: "device-modular-telemetry",
      memberId: memberIds.member,
      idempotencyKey: "gw-modular-future-1",
      body: {
        streamKey: "future_domain:character-rook",
        kind: "state",
        revision: 1,
        envelope: futureEnvelope,
      },
      receivedAt: "2026-10-08T20:00:00.000Z",
    });

    assert.equal(future.status, "created");
    assert.equal(future.handlerName, "opaque");
    const futureState = readLatestTelemetryState({
      memberId: memberIds.member,
      characterId: "character-rook",
      eventType: "future_domain",
    });
    assert.equal(futureState.length, 1);
    assert.deepEqual(futureState[0].payload, futureEnvelope.payload);

    for (let revision = 1; revision <= telemetryRetention.rawRecordsPerStream + 5; revision += 1) {
      const envelope = structuredClone(fixtures.stats);
      envelope.capturedAt += revision;
      envelope.payload.stats.attributes.strength.effective = 83 + revision;
      const result = ingest("stats", envelope, revision);
      assert.ok(["created", "duplicate"].includes(result.status));
    }

    const history = readTelemetryHistory({ eventType: "stats", limit: 100 });
    const retained = history.records.filter(
      (entry) => entry.streamKey === "stats:character-rook",
    );
    assert.ok(retained.length <= telemetryRetention.rawRecordsPerStream);
    assert.ok(retained.length > 0);
  }));
