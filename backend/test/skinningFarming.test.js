import assert from "node:assert/strict";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { readFarmingSource, searchFarmingSources } from "../src/Economy/farmingRepository.js";
import { economicSourceKey } from "../src/Economy/economicObservationModel.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const DEVICE = "device-skinning";

function skinningEnvelope({
  observationId = "skin-1",
  sourceName = "Young Crocolisk",
  npcId = 12345,
  outputs = [
    { itemId: 2318, name: "Light Leather", quantity: 2, qualityId: 1, iconFileDataId: 134252 },
    { itemId: 783, name: "Light Hide", quantity: 1, qualityId: 1, iconFileDataId: 134365 },
  ],
} = {}) {
  return {
    schemaVersion: 1,
    eventType: "gathering_loot",
    capturedAt: 1791762400,
    gameBuild: { version: "1.60.1", build: "70338", interface: 16001 },
    realm: "Classic Beta PvE 2",
    region: "US",
    installationId: "install-skinning",
    characterId: "character-skinner",
    addon: { name: "Guildweaver", version: "0.5.0-alpha.1" },
    payloadSchemaVersion: 1,
    payload: {
      schemaVersion: 1,
      activity: "harvest",
      discipline: "skinning",
      observationId,
      source: {
        kind: "creature",
        name: sourceName,
        guid: `Creature-0-1-2-3-${npcId}-000001`,
        npcId,
        guidKind: "Creature",
      },
      outputs,
      context: {
        attemptedAt: 1791762398,
        characterLevel: 24,
        profession: {
          skillLineId: 393,
          name: "Skinning",
          skillLevel: 92,
          maxSkillLevel: 150,
          skillModifier: 5,
        },
        location: {
          mapId: 1437,
          zone: "Wetlands",
          subzone: "Bluegill Marsh",
          x: 0.37,
          y: 0.61,
        },
        trigger: {
          spellId: 8613,
          spellName: "Skinning",
          castGuid: "Cast-Skin-1",
        },
      },
      capture: { lootSlotCount: outputs.length, sourceCount: 1 },
    },
  };
}

function ingest(envelope) {
  return ingestTelemetry({
    deviceId: DEVICE,
    memberId: memberIds.member,
    idempotencyKey: `gw-skin-${envelope.payload.observationId}`,
    body: {
      streamKey: `gathering_loot:${envelope.characterId}:${envelope.payload.observationId}`,
      kind: "event",
      revision: 1,
      envelope,
    },
    receivedAt: new Date(Number(envelope.capturedAt) * 1000).toISOString(),
  });
}

test("Skinning observations flow into the generic Farming Intelligence source browser", () =>
  withHttpApp(async () => {
    const envelope = skinningEnvelope();
    const result = ingest(envelope);
    assert.equal(result.status, "created");
    assert.equal(result.handlerName, "gathering_loot");

    const row = withGuildDatabase((db) => db.prepare("SELECT * FROM economic_observations").get());
    assert.equal(row.discipline, "skinning");
    assert.equal(row.source_kind, "creature");
    assert.equal(row.source_name, "Young Crocolisk");
    assert.equal(row.source_object_id, 12345);
    assert.equal(row.skill_line_id, 393);
    assert.equal(row.skill_level, 92);
    assert.equal(row.bountiful_harvest_rank, null);

    const sourceKey = "skinning:creature:young-crocolisk";
    const all = searchFarmingSources();
    assert.deepEqual(all.disciplines, [{ discipline: "skinning", observations: 1, sources: 1 }]);
    assert.equal(all.sources[0].sourceKey, sourceKey);
    assert.equal(all.sources[0].name, "Young Crocolisk");

    const byLeather = searchFarmingSources({ q: "Light Leather" });
    assert.equal(byLeather.sources[0].sourceKey, sourceKey);
    assert.equal(byLeather.sources[0].matches[0].name, "Light Leather");

    const filtered = searchFarmingSources({ discipline: "skinning" });
    assert.equal(filtered.sources.length, 1);

    const detail = readFarmingSource(sourceKey);
    assert.equal(detail.source.discipline, "skinning");
    assert.equal(detail.source.kind, "creature");
    assert.equal(detail.summary.observations, 1);
    assert.deepEqual(detail.outputs.map((output) => [output.name, output.drops]), [
      ["Light Hide", 1],
      ["Light Leather", 1],
    ]);
    assert.equal(detail.byBountifulHarvest.every((entry) => entry.rank === "unknown"), true);
  }));

test("unnamed Skinning sources use NPC identity and join named observations", () =>
  withHttpApp(async () => {
    ingest(skinningEnvelope({ observationId: "skin-named", npcId: 777 }));
    ingest(skinningEnvelope({ observationId: "skin-unnamed", sourceName: "", npcId: 777 }));

    assert.equal(
      economicSourceKey({ discipline: "skinning", kind: "creature", npcId: 777 }),
      "skinning:creature:npc-777",
    );

    const rows = withGuildDatabase((db) => db.prepare(`
      SELECT source_key, COUNT(*) AS count
      FROM economic_observations
      GROUP BY source_key
    `).all());
    assert.deepEqual(rows.map((row) => [row.source_key, Number(row.count)]), [
      ["skinning:creature:young-crocolisk", 2],
    ]);
  }));
