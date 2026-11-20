import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase } from "../src/Data/database.js";
import { observedLootRatesInDatabase, wilsonInterval } from "../src/Loot/lootObservationRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { BUILD, NEXT_BUILD, connect, mobLootFixture, post } from "../testSupport/lootHarness.js";

// Loot intelligence, PR 3: Guildweaver's observed drop rates. One corpse is
// one opportunity whoever saw it; only complete windows are a denominator;
// rates come with their Wilson interval and never without their count.

let serial = 0;
function corpse(request, token, { npcId = 639, name = "Edwin VanCleef", guid = null, items = [], inspection = "complete", partialReason, gameBuild = BUILD,
  locale = "enUS", characterId = "character-rook", capturedAt = 1791800000, idempotency = null, instanceId = 36 } = {}) {
  serial += 1;
  const corpseGuid = guid || `Creature-0-1-${instanceId}-3-${npcId}-${String(serial).padStart(6, "0")}`;
  const envelope = structuredClone(mobLootFixture);
  Object.assign(envelope, { characterId, gameBuild, locale, capturedAt });
  envelope.payload.observationId = corpseGuid;
  envelope.payload.source = { guid: corpseGuid, npcId, name, kind: "creature" };
  envelope.payload.outputs = items.map((itemId) => ({ itemId, name: `Item ${itemId}`, quantity: 1, qualityId: 3, isQuestItem: false }));
  envelope.payload.context = { ...envelope.payload.context, instance: { instanceId, name: "The Deadmines", type: "party", difficultyId: 1, difficultyName: "Normal" } };
  if (inspection === null) {
    delete envelope.payload.capture.inspection;
  } else {
    envelope.payload.capture = { ...envelope.payload.capture, inspection, slotCount: items.length + 1, ...(partialReason ? { partialReason } : {}) };
  }
  const body = { streamKey: `mob_loot:${characterId}:${corpseGuid}`, kind: "event", revision: 1, envelope };
  if (idempotency) return request("/api/bridge/telemetry", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotency }, body });
  return post(request, token, body).then((response) => Object.assign(response, { guid: corpseGuid }));
}

test("the Wilson interval: small samples, zero drops, no denominator", () => {
  assert.deepEqual(wilsonInterval(12, 72), { low: 9.8, high: 26.9 });
  assert.deepEqual(wilsonInterval(0, 10), { low: 0, high: 27.8 }, "zero drops still has an upper bound");
  assert.deepEqual(wilsonInterval(1, 1), { low: 20.7, high: 100 }, "one kill proves little");
  assert.deepEqual(wilsonInterval(0, 0), null, "no kills: no rate");
  assert.equal(wilsonInterval(3, 2), null);
  assert.equal(wilsonInterval(-1, 5), null);
});

test("observed rates: one corpse once, complete windows only, per build, nobody named", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-obs-ash", username: "ash" });
  const bram = await connect(request, { id: "discord-obs-bram", username: "bram" });

  // Four VanCleef corpses with complete windows: one Cruel Barb, one with
  // only coins, two Blackened Defias Belts.
  const first = await corpse(request, ash.token, { items: [5191] });
  assert.equal(first.status, 201, first.text);
  const empty = await corpse(request, ash.token, { items: [] });
  assert.equal(empty.status, 201, "a complete window with no items is an opportunity");
  await corpse(request, ash.token, { items: [5193] });
  await corpse(request, ash.token, { items: [5193, 2589] });
  // The same first corpse seen by bram too (another account, another locale): still one.
  const again = await corpse(request, bram.token, { guid: first.guid, items: [5191], locale: "deDE", characterId: "character-thorn" });
  assert.equal(again.status, 201);
  // A partial window (an unmapped slot): a sighting, not a denominator.
  await corpse(request, ash.token, { items: [5202], inspection: "partial", partialReason: "unmapped-slot" });
  // An older add-on that does not say: legacy, a sighting.
  await corpse(request, ash.token, { items: [5202], inspection: null });
  // Trash: not an atlas boss or rare, not an opportunity.
  await corpse(request, ash.token, { npcId: 657, name: "Defias Pirate", items: [5202] });
  // A retried upload (same corpse, same idempotency key): a duplicate, counted once.
  const retryBody = { items: [10399], idempotency: "obs-retry", guid: "Creature-0-1-36-3-639-777777" };
  assert.equal((await corpse(request, ash.token, retryBody)).status, 201);
  const retried = await corpse(request, ash.token, retryBody);
  assert.equal(retried.status, 200);
  assert.equal(retried.json.status, "duplicate");
  // A partial window with no items is refused: nothing can be learned from it.
  assert.equal((await corpse(request, ash.token, { items: [], inspection: "partial", partialReason: "unmapped-slot" })).status, 400);
  // The next build's kills are rated apart.
  await corpse(request, ash.token, { items: [5191], gameBuild: NEXT_BUILD });

  const rates = withGuildDatabase((db) => observedLootRatesInDatabase(db, [639, 657]));
  assert.equal(rates.has(657), false, "trash is not counted");
  const vancleef = rates.get(639);
  assert.equal(vancleef.build, "70400", "the newest build with complete windows is the one rated");
  assert.deepEqual(vancleef.builds.map((entry) => entry.build), ["70400", "70338"]);
  const old = vancleef.builds.find((entry) => entry.build === "70338");
  assert.equal(old.completeWindows, 5, "four corpses and the retried one, each once");
  assert.equal(old.otherWindows, 2, "one partial, one legacy");

  const oldRates = withGuildDatabase((db) => {
    // Rate the old build alone by leaving the new one out.
    db.prepare("DELETE FROM loot_opportunities WHERE game_build = '70400'").run();
    return observedLootRatesInDatabase(db, [639]).get(639);
  });
  const item = (id) => oldRates.items.find((entry) => entry.itemId === id);
  assert.equal(oldRates.eligibleKills, old.completeWindows);
  assert.equal(item(5191).drops, 1, "seen by two players, one drop");
  assert.equal(item(5193).drops, 2);
  assert.equal(item(5193).percent, Math.round((2 / oldRates.eligibleKills) * 1000) / 10);
  assert.ok(item(5193).low < item(5193).percent && item(5193).percent < item(5193).high, "with its interval");
  assert.equal(item(5202).drops, 0, "only partial and legacy sightings");
  assert.equal(item(5202).sightings, 2);
  assert.equal(item(5202).percent, 0);
  assert.ok(oldRates.noDropUpper > 0, "an unseen item's upper bound");
  // Nobody named: no member, character or contributor in the aggregate.
  const text = JSON.stringify(oldRates);
  for (const secret of ["ash", "bram", "character-rook", "character-thorn", "discord"]) assert.ok(!text.includes(secret), `no ${secret}`);
  // The observers merged: the first corpse has two observers.
  const observers = withGuildDatabase((db) => db.prepare("SELECT MAX(observers) AS most FROM loot_opportunities").get().most);
  assert.equal(observers, 2);

  // Served on the dungeon detail.
  const detail = await request("/api/player/loot/dungeons/36", { rawCookie: ash.cookie });
  assert.equal(detail.status, 200);
  const served = detail.json.atlas.bosses.find((boss) => boss.npcId === 639).observedLoot;
  assert.equal(served.eligibleKills, oldRates.eligibleKills);
  assert.ok(served.items.every((entry) => entry.percent === null || entry.percent >= 0));
  assert.ok(!JSON.stringify(served).includes("contributor"));
}));

test("no complete windows: sightings only, no percentage", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-obs-solo", username: "solo" });
  await corpse(request, ash.token, { npcId: 645, name: "Cookie", items: [5197], inspection: "partial", partialReason: "free-for-all" });
  const cookie = withGuildDatabase((db) => observedLootRatesInDatabase(db, [645]).get(645));
  assert.equal(cookie.eligibleKills, 0);
  assert.equal(cookie.items[0].percent, null, "never a percentage without a denominator");
  assert.equal(cookie.items[0].sightings, 1);
  assert.ok(!("low" in cookie.items[0]));
  assert.equal(cookie.noDropUpper, null);
}));
