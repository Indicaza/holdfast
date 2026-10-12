import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { economicObservationMigration } from "../src/Economy/economicObservationMigration.js";
import { economicObservationFromTelemetry, economicSourceKey } from "../src/Economy/economicObservationModel.js";
import { repairFishingSourceKeysInDatabase } from "../src/Economy/economicObservationRepository.js";

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

test("persisted fishing observations are re-keyed by their stored map and zone", () => {
  const db = new DatabaseSync(":memory:");

  try {
    economicObservationMigration.up(db);
    const insert = db.prepare(`
      INSERT INTO economic_observations (
        observation_key, event_type, activity, discipline,
        source_key, source_kind, source_name,
        map_id, zone, captured_at, received_at
      ) VALUES (?, 'gathering_loot', 'catch', 'fishing', ?, 'fishing-water', 'Open Water', ?, ?, ?, ?)
    `);
    const when = "2026-10-11T21:00:00.000Z";

    insert.run("old-elwynn", "fishing:fishing-water:open-water", 1429, "Elwynn Forest", when, when);
    insert.run("old-westfall", "fishing:fishing-water:open-water", 1436, "Westfall", when, when);

    assert.equal(repairFishingSourceKeysInDatabase(db), 2);
    const repaired = db
      .prepare("SELECT zone, source_key FROM economic_observations ORDER BY zone")
      .all()
      .map((row) => ({ zone: row.zone, source_key: row.source_key }));
    assert.deepEqual(repaired, [
      { zone: "Elwynn Forest", source_key: "fishing:fishing-water:map-1429" },
      { zone: "Westfall", source_key: "fishing:fishing-water:map-1436" },
    ]);
    assert.equal(repairFishingSourceKeysInDatabase(db), 0, "repair remains idempotent");
  } finally {
    db.close();
  }
});
