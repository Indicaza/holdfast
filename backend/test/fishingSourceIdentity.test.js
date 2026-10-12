import assert from "node:assert/strict";
import test from "node:test";

import { economicObservationFromTelemetry, economicSourceKey } from "../src/Economy/economicObservationModel.js";

test("open-water fishing is scoped by map instead of collapsing globally", () => {
  const westfall = economicSourceKey({
    discipline: "fishing",
    kind: "fishing_water",
    name: "Open Water",
    mapId: 1436,
    zone: "Westfall",
  });
  const darkshore = economicSourceKey({
    discipline: "fishing",
    kind: "fishing_water",
    name: "Open Water",
    mapId: 1439,
    zone: "Darkshore",
  });

  assert.equal(westfall, "fishing:fishing-water:map-1436");
  assert.equal(darkshore, "fishing:fishing-water:map-1439");
  assert.notEqual(westfall, darkshore);
});

test("fishing falls back to zone identity when map id is unavailable", () => {
  assert.equal(
    economicSourceKey({ discipline: "fishing", kind: "fishing_water", name: "Open Water", zone: "The Barrens" }),
    "fishing:fishing-water:zone-the-barrens",
  );
});

test("named fishing pools remain readable and location-sensitive", () => {
  const darkshore = economicSourceKey({
    discipline: "fishing",
    kind: "fishing_pool",
    name: "Oily Blackmouth School",
    objectId: 180682,
    mapId: 1439,
  });
  const wetlands = economicSourceKey({
    discipline: "fishing",
    kind: "fishing_pool",
    name: "Oily Blackmouth School",
    objectId: 180682,
    mapId: 1437,
  });

  assert.equal(darkshore, "fishing:fishing-pool:oily-blackmouth-school:map-1439");
  assert.equal(wetlands, "fishing:fishing-pool:oily-blackmouth-school:map-1437");
  assert.notEqual(darkshore, wetlands);
});

test("restricted fishing-pool names fall back to stable object identity", () => {
  assert.equal(
    economicSourceKey({
      discipline: "fishing",
      kind: "fishing_pool",
      name: "Fishing Pool",
      objectId: 180684,
      mapId: 1439,
    }),
    "fishing:fishing-pool:object-180684:map-1439",
  );
});

test("telemetry normalization feeds map context into fishing source identity", () => {
  const normalized = economicObservationFromTelemetry({
    eventType: "gathering_loot",
    memberId: "member-1",
    deviceId: "device-1",
    receivedAt: "2026-10-11T20:00:00.000Z",
    envelope: {
      capturedAt: 1791763200,
      gameBuild: { build: "70338", version: "1.60.1" },
      payload: {
        observationId: "pool-catch-1",
        activity: "catch",
        discipline: "fishing",
        source: {
          kind: "fishing_pool",
          name: "Firefin Snapper School",
          objectId: 180683,
        },
        outputs: [{ itemId: 6359, name: "Firefin Snapper", quantity: 1 }],
        context: {
          profession: { skillLineId: 356, skillLevel: 125 },
          location: { mapId: 1439, zone: "Darkshore", subzone: "Auberdine" },
        },
      },
    },
  });

  assert.ok(normalized);
  assert.equal(normalized.observation.sourceKey, "fishing:fishing-pool:firefin-snapper-school:map-1439");
  assert.equal(normalized.observation.zone, "Darkshore");
  assert.equal(normalized.observation.mapId, 1439);
  assert.equal(normalized.outputs[0].itemId, 6359);
});
