import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { withGuildTransaction } from "../src/Data/database.js";
import { recordEconomicObservationInDatabase } from "../src/Economy/economicObservationRepository.js";
import { readFarmingSource, searchFarmingSources } from "../src/Economy/farmingRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/guildweaver-gathering-loot.v1.json", import.meta.url), "utf8"),
);

const DEVICE = "device-farming-browser";
const LICHEN = { itemId: 249399, name: "Frilled Lichen", quantity: 1, qualityId: 2, iconFileDataId: 134193 };
const PEACEBLOOM = { itemId: 2447, name: "Peacebloom", quantity: 1, qualityId: 1, iconFileDataId: 133939 };
const SILVERLEAF = { itemId: 765, name: "Silverleaf", quantity: 1, qualityId: 1, iconFileDataId: 134190 };
let sequence = 0;

function observation({ sourceName, sourceId, primary, zone, rare = false }) {
  sequence += 1;
  const envelope = structuredClone(fixture);
  envelope.capturedAt = 1791770000 + sequence;
  envelope.characterId = "character-farmer";
  envelope.payload.observationId = `browser-${sequence}`;
  envelope.payload.source = {
    kind: "herb_node",
    name: sourceName,
    objectId: sourceId,
    guid: `GameObject-0-1-2-3-${sourceId}-${sequence}`,
  };
  envelope.payload.outputs = [primary, ...(rare ? [LICHEN] : [])];
  envelope.payload.context.location.zone = zone;
  return envelope;
}

function seed(rows) {
  withGuildTransaction((db) => {
    for (const envelope of rows) {
      recordEconomicObservationInDatabase(db, {
        eventType: "gathering_loot",
        envelope,
        memberId: memberIds.member,
        deviceId: DEVICE,
        rawCharacterId: envelope.characterId,
        streamKey: `gathering_loot:${envelope.payload.observationId}`,
        receivedAt: new Date(Number(envelope.capturedAt) * 1000).toISOString(),
      });
    }
  });
}

function many(count, options, rareCount = 0) {
  return Array.from({ length: count }, (_, index) => observation({ ...options, rare: index < rareCount }));
}

test("the source browser filters by zone and sorts searched drops by observed chance", () =>
  withHttpApp(async () => {
    seed([
      ...many(20, { sourceName: "Peacebloom", sourceId: 1618, primary: PEACEBLOOM, zone: "Elwynn Forest" }, 1),
      ...many(10, { sourceName: "Peacebloom", sourceId: 1618, primary: PEACEBLOOM, zone: "Duskwood" }, 5),
      ...many(10, { sourceName: "Silverleaf", sourceId: 1617, primary: SILVERLEAF, zone: "Duskwood" }, 1),
    ]);

    const result = searchFarmingSources({ q: "Frilled Lichen", zone: "Duskwood", sort: "chance" });
    assert.equal(result.zone, "Duskwood");
    assert.equal(result.sort, "chance");
    assert.deepEqual(result.sources.map((source) => source.name), ["Peacebloom", "Silverleaf"]);
    assert.equal(result.sources[0].observations, 10, "zone filter changes the denominator");
    assert.equal(result.sources[0].matches[0].rate, 0.5);
    assert.equal(result.sources[1].matches[0].rate, 0.1);
    assert.equal(result.sources[0].primaryZone, "Duskwood");
    assert.deepEqual(result.zones.map((entry) => entry.zone), ["Duskwood", "Elwynn Forest"]);
  }));

test("canonical item definitions enrich Farming outputs with the client tooltip", () =>
  withHttpApp(async () => {
    const itemState = ingestTelemetry({
      deviceId: DEVICE,
      memberId: memberIds.member,
      idempotencyKey: "item-definition-2447-v1",
      body: {
        streamKey: "item_definition:item:2447",
        kind: "state",
        revision: 1,
        envelope: {
          schemaVersion: 1,
          eventType: "item_definition",
          capturedAt: 1791770200,
          installationId: "install-farming-browser",
          gameBuild: { build: "70338", version: "1.60.1" },
          payloadSchemaVersion: 1,
          payload: {
            schemaVersion: 1,
            itemKey: "item:2447",
            item: {
              itemId: 2447,
              name: "Peacebloom",
              qualityId: 1,
              iconFileDataId: 133939,
              sellPrice: 10,
              itemClass: { id: 7, name: "Trade Goods" },
              itemSubclass: { id: 9, name: "Herb" },
              tooltip: {
                source: "C_TooltipInfo",
                lines: [
                  { left: "Peacebloom", leftColor: { r: 1, g: 1, b: 1 } },
                  { left: "Crafting Reagent", leftColor: { r: 0.4, g: 0.73, b: 1 } },
                ],
              },
            },
          },
        },
      },
      receivedAt: new Date(1791770200 * 1000).toISOString(),
    });
    assert.equal(itemState.status, "created");
    assert.equal(itemState.handlerName, "opaque", "item catalog stays generic telemetry state");

    seed(many(2, { sourceName: "Peacebloom", sourceId: 1618, primary: PEACEBLOOM, zone: "Elwynn Forest" }));
    const detail = readFarmingSource("herbalism:herb-node:peacebloom");
    assert.equal(detail.outputs[0].item.sellPrice, 10);
    assert.equal(detail.outputs[0].item.tooltip.source, "C_TooltipInfo");
    assert.equal(detail.outputs[0].item.tooltip.lines[1].left, "Crafting Reagent");
  }));
