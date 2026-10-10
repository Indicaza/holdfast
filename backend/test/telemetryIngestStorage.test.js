import assert from "node:assert/strict";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { compactStoredTelemetry } from "../src/Character/Telemetry/telemetryJson.js";
import { readLatestTelemetryState } from "../src/Character/Telemetry/telemetryStateRepository.js";
import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { ingestCharacterIdentity } from "../testSupport/characterTelemetry.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const DEVICE = "device-atomicity";
const RAW_ID = "character-rook";

function equipment(name, revision) {
  return ingestTelemetry({
    deviceId: DEVICE,
    memberId: memberIds.member,
    idempotencyKey: `gw-${DEVICE}-equipment-${revision}`,
    body: {
      streamKey: `equipment:${RAW_ID}`,
      kind: "state",
      revision,
      envelope: {
        schemaVersion: 1,
        eventType: "equipment",
        capturedAt: 1791450000 + revision,
        characterId: RAW_ID,
        realm: "Darkwing",
        region: "US",
        payloadSchemaVersion: 1,
        payload: { schemaVersion: 1, equipment: [{ slot: "head", slotId: 1, itemId: 11746, name, qualityId: 3 }] },
      },
    },
  });
}

function storedState() {
  return withGuildDatabase((db) => ({
    records: db.prepare("SELECT COUNT(*) AS n FROM guildweaver_telemetry_records WHERE device_id = ? AND stream_key LIKE 'equipment:%'").get(DEVICE).n,
    latest: db.prepare("SELECT revision FROM guildweaver_telemetry_latest_state WHERE device_id = ? AND event_type = 'equipment'").get(DEVICE)?.revision ?? null,
    head: db.prepare("SELECT revision FROM guildweaver_telemetry_stream_heads WHERE device_id = ? AND stream_key LIKE 'equipment:%'").get(DEVICE)?.revision ?? null,
  }));
}

test("a failure part way through ingest stores nothing and the retry succeeds", async () => {
  await withHttpApp(async () => {
    ingestCharacterIdentity({ deviceId: DEVICE, memberId: memberIds.member, characterId: RAW_ID });
    assert.equal(equipment("First Helm", 1).status, "created");
    assert.deepEqual(storedState(), { records: 1, latest: 1, head: 1 });

    withGuildDatabase((db) => db.exec(`
      CREATE TRIGGER fail_projection BEFORE UPDATE ON character_sections
      BEGIN SELECT RAISE(ABORT, 'projection failed'); END;
    `));
    assert.throws(() => equipment("Second Helm", 2), /projection failed/);
    assert.deepEqual(storedState(), { records: 1, latest: 1, head: 1 }, "raw record, latest state and head roll back together");

    withGuildDatabase((db) => db.exec("DROP TRIGGER fail_projection"));
    assert.equal(equipment("Second Helm", 2).status, "created", "the retry is not mistaken for a duplicate");
    assert.deepEqual(storedState(), { records: 2, latest: 2, head: 2 });
    const helm = withGuildDatabase((db) => db.prepare("SELECT payload_json FROM character_sections WHERE section = 'equipment'").get());
    assert.equal(JSON.parse(helm.payload_json).equipment[0].name, "Second Helm");
  });
});

test("nested transactions roll back only their own savepoint", async () => {
  await withHttpApp(async () => {
    withGuildDatabase((db) => db.exec("CREATE TABLE nesting (value TEXT)"));
    withGuildTransaction((db) => {
      db.prepare("INSERT INTO nesting VALUES ('outer')").run();
      assert.throws(() => withGuildTransaction((inner) => {
        inner.prepare("INSERT INTO nesting VALUES ('inner')").run();
        throw new Error("inner failed");
      }), /inner failed/);
    });
    const rows = withGuildDatabase((db) => db.prepare("SELECT value FROM nesting").all().map((row) => row.value));
    assert.deepEqual(rows, ["outer"]);
  });
});

test("latest state stores the payload once and keeps the envelope metadata", async () => {
  await withHttpApp(async () => {
    ingestCharacterIdentity({ deviceId: DEVICE, memberId: memberIds.member, characterId: RAW_ID });
    equipment("Only Helm", 1);
    const row = withGuildDatabase((db) => db.prepare("SELECT envelope_json, payload_json FROM guildweaver_telemetry_latest_state WHERE event_type = 'equipment'").get());
    assert.equal("payload" in JSON.parse(row.envelope_json), false);
    assert.equal(JSON.parse(row.payload_json).equipment[0].name, "Only Helm");

    const [state] = readLatestTelemetryState({ memberId: memberIds.member, eventType: "equipment" });
    assert.equal(state.envelope.eventType, "equipment");
    assert.equal(state.payload.equipment[0].name, "Only Helm");
  });
});

test("startup removes payload copies from envelopes stored before", async () => {
  await withHttpApp(async () => {
    ingestCharacterIdentity({ deviceId: DEVICE, memberId: memberIds.member, characterId: RAW_ID });
    withGuildDatabase((db) => db.prepare(`
      UPDATE guildweaver_telemetry_latest_state SET envelope_json = json_set(envelope_json, '$.payload', json('{"name":"Rook"}'))
    `).run());
    assert.equal(withGuildDatabase(compactStoredTelemetry) >= 1, true);
    const envelope = withGuildDatabase((db) => db.prepare("SELECT envelope_json FROM guildweaver_telemetry_latest_state").get().envelope_json);
    assert.equal("payload" in JSON.parse(envelope), false);
    assert.equal(withGuildDatabase(compactStoredTelemetry), 0, "runs once");
  });
});
