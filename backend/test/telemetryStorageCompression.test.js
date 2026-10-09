import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase } from "../src/Data/database.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import {
  COMPRESS_OVER_BYTES,
  compactStoredTelemetry,
  decodeTelemetryJson,
  encodeTelemetryJson,
  parseTelemetryJson,
} from "../src/Character/Telemetry/telemetryJson.js";
import { readLatestTelemetryState } from "../src/Character/Telemetry/telemetryStateRepository.js";
import { applyProfessionTelemetry } from "../src/Character/professionArmory.js";
import { readTelemetryRecord } from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function recipeBook(recipeCount) {
  return {
    streamKey: "profession_snapshot:character-rook",
    kind: "state",
    revision: 1,
    envelope: {
      schemaVersion: 1,
      eventType: "profession_snapshot",
      capturedAt: 1791322510,
      characterId: "character-rook",
      payload: {
        schemaVersion: 1,
        professions: [{
          skillLineId: 164,
          name: "Blacksmithing",
          skillLevel: 300,
          maxSkillLevel: 300,
          recipes: Array.from({ length: recipeCount }, (_, index) => ({
            recipeId: 2000 + index,
            name: `Plate Recipe ${index}`,
            known: true,
            description: "Hammers out a sturdy piece of plate armor at an anvil.",
            crafted: { itemId: 9000 + index, name: `Plate ${index}`, qualityId: 2, tooltip: { lines: [{ left: `Plate ${index}` }, { left: "Binds when equipped" }] } },
            reagents: [{ itemId: 12359, name: "Thorium Bar", quantity: 12 }],
          })),
        }],
      },
    },
  };
}

test("small values stay text and large values are stored compressed", () => {
  assert.equal(encodeTelemetryJson({ hello: "world" }), '{"hello":"world"}');
  const large = { text: "x".repeat(COMPRESS_OVER_BYTES + 1) };
  const encoded = encodeTelemetryJson(large);
  assert.ok(Buffer.isBuffer(encoded));
  assert.ok(encoded.length < 1024);
  assert.deepEqual(JSON.parse(decodeTelemetryJson(encoded)), large);
  assert.deepEqual(parseTelemetryJson(new Uint8Array(encoded)), large, "SQLite returns BLOBs as Uint8Array");
  assert.deepEqual(parseTelemetryJson("not json", { fallback: true }), { fallback: true });
  assert.equal(decodeTelemetryJson(null), null);
});

test("recipe books are stored compressed and read back intact", () =>
  withHttpApp(async () => {
    const body = recipeBook(300);
    const result = ingestTelemetry({
      deviceId: "device-compression",
      memberId: memberIds.member,
      idempotencyKey: "gw-compression-1",
      body,
      receivedAt: "2026-10-09T12:00:00.000Z",
    });
    assert.equal(result.status, "created");

    const stored = withGuildDatabase((db) => ({
      record: db.prepare("SELECT typeof(envelope_json) AS type, length(envelope_json) AS bytes FROM guildweaver_telemetry_records WHERE id = ?").get(result.record.id),
      state: db.prepare("SELECT typeof(envelope_json) AS envelopeType, typeof(payload_json) AS payloadType, length(envelope_json) + length(payload_json) AS bytes FROM guildweaver_telemetry_latest_state WHERE stream_key = ?").get(body.streamKey),
    }));
    const jsonBytes = JSON.stringify(body.envelope).length;
    assert.equal(stored.record.type, "blob");
    assert.equal(stored.state.envelopeType, "blob");
    assert.equal(stored.state.payloadType, "blob");
    assert.ok(stored.record.bytes * 8 < jsonBytes, `raw record compressed (${stored.record.bytes} of ${jsonBytes} bytes)`);

    assert.deepEqual(readTelemetryRecord(result.record.id).envelope, body.envelope);
    assert.equal(readTelemetryRecord(result.record.id).payloadBytes, jsonBytes, "inspector reports the JSON size");
    const [state] = readLatestTelemetryState({ memberId: memberIds.member, characterId: "character-rook", eventType: "profession_snapshot" });
    assert.deepEqual(state.envelope, body.envelope);
    const armory = applyProfessionTelemetry({ professions: [], recipes: [] }, state);
    assert.equal(armory.recipes.length, 300);
    assert.equal(armory.recipes[299].crafted.tooltip.lines[1].left, "Binds when equipped");
  }));

test("telemetry stored before compression is compacted once", () =>
  withHttpApp(async () => {
    const body = recipeBook(300);
    const result = ingestTelemetry({
      deviceId: "device-compression",
      memberId: memberIds.member,
      idempotencyKey: "gw-compaction-1",
      body,
      receivedAt: "2026-10-09T12:00:00.000Z",
    });
    // Rewrite the rows as plain text, the way older builds stored them.
    withGuildDatabase((db) => {
      const envelope = JSON.stringify(body.envelope);
      db.prepare("UPDATE guildweaver_telemetry_records SET envelope_json = ? WHERE id = ?").run(envelope, result.record.id);
      db.prepare("UPDATE guildweaver_telemetry_latest_state SET envelope_json = ?, payload_json = ? WHERE stream_key = ?")
        .run(envelope, decodeTelemetryJson(db.prepare("SELECT payload_json FROM guildweaver_telemetry_latest_state WHERE stream_key = ?").get(body.streamKey).payload_json), body.streamKey);
    });

    assert.equal(withGuildDatabase(compactStoredTelemetry), 3, "record envelope, state envelope and state payload");
    assert.equal(withGuildDatabase(compactStoredTelemetry), 0, "already compacted");
    const types = withGuildDatabase((db) => db.prepare("SELECT typeof(envelope_json) AS type FROM guildweaver_telemetry_records WHERE id = ?").get(result.record.id).type);
    assert.equal(types, "blob");
    assert.deepEqual(readTelemetryRecord(result.record.id).envelope, body.envelope);
    const [state] = readLatestTelemetryState({ memberId: memberIds.member, characterId: "character-rook", eventType: "profession_snapshot" });
    assert.equal(state.payload.professions[0].recipes.length, 300);
  }));
