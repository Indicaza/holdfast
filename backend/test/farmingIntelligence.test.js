import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { canonicalTelemetryPayload } from "../src/Character/Telemetry/handlerRegistry.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { readLatestTelemetryState } from "../src/Character/Telemetry/telemetryStateRepository.js";
import { readTelemetryRecord, recordTelemetry } from "../src/Character/telemetryRecordRepository.js";
import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { resetLiveUpdatesForTests, subscribeLiveUpdates } from "../src/Live/liveUpdateBus.js";
import {
  backfillEconomicObservationsInDatabase,
  recordEconomicObservationInDatabase,
} from "../src/Economy/economicObservationRepository.js";
import {
  economicItemKey,
  economicObservationFromTelemetry,
  economicSourceKey,
} from "../src/Economy/economicObservationModel.js";
import { readFarmingSource, searchFarmingSources } from "../src/Economy/farmingRepository.js";
import { observedRate, rateConfidence, skillBucket, wilsonInterval } from "../src/Economy/farmingStatistics.js";
import { ingestCharacterIdentity } from "../testSupport/characterTelemetry.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/guildweaver-gathering-loot.v1.json", import.meta.url), "utf8"),
);

const DEVICE = "device-farming";
const PEACEBLOOM = { kind: "herb_node", name: "Peacebloom", objectId: 1618 };
const SILVERLEAF = { kind: "herb_node", name: "Silverleaf", objectId: 1617 };
const PEACEBLOOM_ITEM = { itemId: 2447, name: "Peacebloom", qualityId: 1, iconFileDataId: 133939 };
const SILVERLEAF_ITEM = { itemId: 765, name: "Silverleaf", qualityId: 1, iconFileDataId: 134190 };
const LICHEN = { itemId: 249399, name: "Frilled Lichen", qualityId: 2 };

let sequence = 0;

function gather({
  source = PEACEBLOOM,
  outputs = [{ ...PEACEBLOOM_ITEM, quantity: 2 }],
  skill = 60,
  level = 20,
  rank = 0,
  zone = "Elwynn Forest",
  build = "70338",
  characterId = "character-rook",
  observationId,
} = {}) {
  sequence += 1;
  const id = observationId || `obs-${sequence}`;
  const envelope = structuredClone(fixture);
  envelope.capturedAt = 1791761400 + sequence;
  envelope.characterId = characterId;
  envelope.gameBuild = { ...envelope.gameBuild, build };
  envelope.payload.observationId = id;
  envelope.payload.source = { ...source, guid: `GameObject-0-1-2-3-${source.objectId}-${sequence}` };
  envelope.payload.outputs = outputs;
  envelope.payload.context.characterLevel = level;
  envelope.payload.context.profession.skillLevel = skill;
  if (rank === null) delete envelope.payload.context.modifiers.bountifulHarvest;
  else envelope.payload.context.modifiers.bountifulHarvest.rank = rank;
  envelope.payload.context.location.zone = zone;
  return envelope;
}

function ingest(envelope, { idempotencyKey } = {}) {
  return ingestTelemetry({
    deviceId: DEVICE,
    memberId: memberIds.member,
    idempotencyKey: idempotencyKey || `gw-gather-${envelope.payload.observationId}`,
    body: {
      streamKey: `gathering_loot:${envelope.characterId}:${envelope.payload.observationId}`,
      kind: "event",
      revision: 1,
      envelope,
    },
    receivedAt: new Date(Number(envelope.capturedAt) * 1000).toISOString(),
  });
}

// Many observations without the HTTP transport round trip per row.
function seed(count, options) {
  withGuildTransaction((db) => {
    for (let index = 0; index < count; index += 1) {
      const envelope = gather(typeof options === "function" ? options(index) : options);
      recordEconomicObservationInDatabase(db, {
        eventType: "gathering_loot",
        envelope,
        memberId: memberIds.member,
        deviceId: DEVICE,
        rawCharacterId: envelope.characterId,
        streamKey: `gathering_loot:${envelope.payload.observationId}`,
        receivedAt: new Date().toISOString(),
      });
    }
  });
}

function observationCount() {
  return withGuildDatabase((db) => Number(db.prepare("SELECT COUNT(*) AS count FROM economic_observations").get().count));
}

const PEACEBLOOM_KEY = "herbalism:herb-node:peacebloom";

test("a gathering_loot event becomes one observation and keeps its raw record", () =>
  withHttpApp(async () => {
    const result = ingest(structuredClone(fixture));
    assert.equal(result.status, "created");
    assert.equal(result.handlerName, "gathering_loot");
    assert.deepEqual(result.changedSections, [], "an event never touches the character read model");

    const raw = readTelemetryRecord(result.record.id);
    assert.equal(raw.kind, "event");
    assert.deepEqual(raw.envelope.payload, fixture.payload, "raw payload preserved for debugging");
    assert.deepEqual(readLatestTelemetryState({ eventType: "gathering_loot" }), [], "events are not latest state");

    const [row] = withGuildDatabase((db) => db.prepare("SELECT * FROM economic_observations").all());
    assert.equal(row.record_id, result.record.id);
    assert.equal(row.source_key, PEACEBLOOM_KEY);
    assert.equal(row.source_name, "Peacebloom");
    assert.equal(row.source_object_id, 1618);
    assert.equal(row.discipline, "herbalism");
    assert.equal(row.activity, "harvest");
    assert.equal(row.skill_level, 87);
    assert.equal(row.skill_modifier, 5);
    assert.equal(row.character_level, 30);
    assert.equal(row.bountiful_harvest_rank, 3);
    assert.equal(row.bountiful_harvest_max_ranks, 5);
    assert.equal(row.zone, "Duskwood");
    assert.equal(row.subzone, "The Rotting Orchard");
    assert.equal(row.map_id, 1431);
    assert.equal(row.game_build, "70338");
    assert.equal(row.game_version, "1.60.1");
    assert.equal(row.character_key, `${memberIds.member}:character-rook`);
    assert.equal(row.captured_at, new Date(1791761400 * 1000).toISOString());

    const outputs = withGuildDatabase((db) => db.prepare("SELECT * FROM economic_observation_outputs ORDER BY item_key").all());
    assert.deepEqual(outputs.map((output) => [output.item_key, output.item_name, output.quantity]), [
      ["item:2447", "Peacebloom", 2],
      ["item:249399", "Frilled Lichen", 1],
    ]);

    assert.equal(ingest(structuredClone(fixture)).status, "duplicate");
    ingest(structuredClone(fixture), { idempotencyKey: "resent-by-a-reset-bridge" });
    assert.equal(observationCount(), 1, "the same observation is counted once however often it arrives");
    assert.deepEqual(canonicalTelemetryPayload({ eventType: "gathering_loot", envelope: fixture }), fixture.payload, "forwarded unchanged");
  }));

test("observations join the website's character once it is known", () =>
  withHttpApp(async () => {
    ingestCharacterIdentity({ deviceId: DEVICE, memberId: memberIds.member, characterId: "character-rook" });
    ingest(gather());
    const row = withGuildDatabase((db) => db.prepare("SELECT character_key FROM economic_observations").get());
    assert.equal(row.character_key, "guildweaver-id:character-rook");
  }));

test("unanalysable gathering events are kept raw but not counted", () =>
  withHttpApp(async () => {
    const empty = gather({ outputs: [] });
    const result = ingest(empty);
    assert.equal(result.status, "created");
    assert.ok(readTelemetryRecord(result.record.id));
    const sourceless = gather();
    delete sourceless.payload.source;
    assert.equal(ingest(sourceless).status, "created");
    assert.equal(observationCount(), 0);

    assert.equal(economicObservationFromTelemetry({ eventType: "character", envelope: fixture }), null);
    assert.equal(economicObservationFromTelemetry({ eventType: "gathering_loot", envelope: { payload: [] } }), null);
  }));

test("source and item identity", () => {
  assert.equal(economicSourceKey({ discipline: "Herbalism", kind: "herb_node", name: "Peacebloom", objectId: 1618 }), PEACEBLOOM_KEY);
  assert.equal(economicSourceKey({ discipline: "herbalism", kind: "herb_node", objectId: 3724 }), "herbalism:herb-node:object-3724");
  assert.equal(economicSourceKey({ discipline: "mining", kind: "", name: "" }), "mining:source:unknown");
  assert.equal(
    economicSourceKey({ discipline: "skinning", kind: "creature", name: "Young Crocolisk" }),
    "skinning:creature:young-crocolisk",
  );
  assert.equal(economicItemKey({ itemId: 2447, name: "Peacebloom" }), "item:2447");
  assert.equal(economicItemKey({ name: "Strange Dust" }), "name:strange-dust");
  assert.equal(economicItemKey({}), "");

  const merged = economicObservationFromTelemetry({
    eventType: "gathering_loot",
    envelope: gather({ outputs: [{ ...PEACEBLOOM_ITEM, quantity: 3 }, { itemId: 2447, quantity: 2 }, { quantity: 1 }, null] }),
  });
  assert.deepEqual(merged.outputs.map((output) => [output.itemKey, output.quantity]), [["item:2447", 5]], "slots of one item merge");
  const unranked = economicObservationFromTelemetry({ eventType: "gathering_loot", envelope: gather({ rank: null }) });
  assert.equal(unranked.observation.bountifulHarvestRank, null, "an unreadable talent is unknown, not rank 0");
});

test("an unnamed node joins the named source with the same object id", () =>
  withHttpApp(async () => {
    seed(2, {});
    seed(1, { source: { kind: "herb_node", objectId: 1618 } });
    seed(1, { source: { kind: "herb_node", objectId: 9999 } });
    const keys = withGuildDatabase((db) => db.prepare("SELECT source_key, COUNT(*) AS count FROM economic_observations GROUP BY source_key ORDER BY source_key").all());
    assert.deepEqual(keys.map((row) => [row.source_key, Number(row.count)]), [
      ["herbalism:herb-node:object-9999", 1],
      [PEACEBLOOM_KEY, 3],
    ]);
  }));

test("drop chance divides by every eligible observation, not by successful drops", () =>
  withHttpApp(async () => {
    seed(97, {});
    seed(3, { outputs: [{ ...PEACEBLOOM_ITEM, quantity: 1 }, { ...LICHEN, quantity: 2 }] });

    const detail = readFarmingSource(PEACEBLOOM_KEY);
    assert.equal(detail.summary.observations, 100);
    assert.equal(detail.summary.characters, 1);
    assert.equal(detail.summary.zones, 1);
    assert.deepEqual(detail.summary.builds.map((build) => [build.build, build.version, build.observations]), [["70338", "1.60.1", 100]]);
    assert.deepEqual(detail.source.objectIds, [1618]);

    const [herb, lichen] = detail.outputs;
    assert.equal(herb.name, "Peacebloom");
    assert.equal(herb.drops, 100);
    assert.equal(herb.rate, 1);
    assert.equal(herb.avgQuantity, (97 * 2 + 3) / 100);
    assert.equal(herb.iconFileDataId, 133939);

    assert.equal(lichen.name, "Frilled Lichen");
    assert.equal(lichen.drops, 3);
    assert.equal(lichen.observations, 100, "the denominator is all gathers of the source");
    assert.equal(lichen.rate, 0.03);
    assert.equal(lichen.avgQuantity, 2, "average quantity is per drop");
    assert.equal(detail.selectedItemKey, "item:249399", "breakdowns follow the uncommon drop by default");

    assert.equal(readFarmingSource(PEACEBLOOM_KEY, { item: "item:2447" }).selectedItemKey, "item:2447");
    assert.equal(readFarmingSource("herbalism:herb-node:nothing"), null);
  }));

test("search finds a source by its name and every source producing an item", () =>
  withHttpApp(async () => {
    seed(40, (index) => ({ outputs: [PEACEBLOOM_ITEM, ...(index < 2 ? [LICHEN] : [])] }));
    seed(20, (index) => ({ source: SILVERLEAF, outputs: [SILVERLEAF_ITEM, ...(index < 4 ? [LICHEN] : [])] }));
    seed(5, { source: { kind: "herb_node", name: "Earthroot", objectId: 1619 }, outputs: [{ itemId: 2449, name: "Earthroot" }] });

    const all = searchFarmingSources();
    assert.deepEqual(all.sources.map((source) => [source.name, source.observations]), [
      ["Peacebloom", 40],
      ["Silverleaf", 20],
      ["Earthroot", 5],
    ]);
    assert.deepEqual(all.disciplines, [{ discipline: "herbalism", observations: 65, sources: 3 }]);
    assert.equal(all.sources[0].icon.itemId, 2447, "a source shows its most common output");
    assert.deepEqual(all.sources[0].drops.map((drop) => [drop.name, drop.drops, drop.rate]), [["Frilled Lichen", 2, 2 / 40]], "cards preview what else a source drops");
    assert.deepEqual(all.sources[2].drops, []);

    const bySource = searchFarmingSources({ q: "peace" });
    assert.deepEqual(bySource.sources.map((source) => source.name), ["Peacebloom"]);
    assert.equal(bySource.sources[0].matchedBy, "source");

    const byItem = searchFarmingSources({ q: "Frilled Lichen" });
    assert.deepEqual(byItem.sources.map((source) => source.name), ["Peacebloom", "Silverleaf"]);
    const [peacebloom, silverleaf] = byItem.sources;
    assert.equal(peacebloom.matchedBy, "output");
    assert.equal(peacebloom.matches[0].name, "Frilled Lichen");
    assert.equal(peacebloom.matches[0].drops, 2);
    assert.equal(peacebloom.matches[0].rate, 2 / 40);
    assert.equal(silverleaf.matches[0].rate, 4 / 20);

    assert.deepEqual(searchFarmingSources({ q: "249399" }).sources.map((source) => source.name), ["Peacebloom", "Silverleaf"], "item ids are searchable");
    assert.deepEqual(searchFarmingSources({ q: "100%_" }).sources, [], "LIKE wildcards are literal");
    assert.deepEqual(searchFarmingSources({ discipline: "mining" }).sources, []);
    assert.equal(searchFarmingSources({ discipline: "herbalism" }).sources.length, 3);
  }));

test("skill, Bountiful Harvest, zone, level and build filters recompute the drop table", () =>
  withHttpApp(async () => {
    // Lichen only drops at skill 51+ with rank 3, in Duskwood on build 70338.
    seed(40, (index) => ({
      skill: index < 20 ? 30 : 80,
      rank: index % 2 ? 3 : 0,
      level: index < 20 ? 12 : 28,
      zone: index % 4 < 2 ? "Duskwood" : "Elwynn Forest",
      build: index < 30 ? "70338" : "70245",
      characterId: `character-${index % 5}`,
      outputs: [PEACEBLOOM_ITEM, ...(index >= 20 && index % 2 && index % 4 < 2 && index < 30 ? [LICHEN] : [])],
    }));
    seed(4, { rank: null, skill: 0, level: 5, characterId: "character-0" });

    const all = readFarmingSource(PEACEBLOOM_KEY);
    assert.equal(all.summary.observations, 44);
    assert.equal(all.summary.characters, 5);
    assert.equal(all.summary.zones, 2);
    const lichenDrops = all.outputs.find((output) => output.itemKey === "item:249399").drops;
    assert.ok(lichenDrops > 0);

    assert.deepEqual(all.facets.ranks.map((rank) => [rank.value, rank.observations]), [[0, 20], [3, 20], ["unknown", 4]]);
    assert.deepEqual(all.facets.zones.map((zone) => zone.value).sort(), ["Duskwood", "Elwynn Forest"]);
    assert.deepEqual(all.facets.builds.map((build) => build.value).sort(), ["70245", "70338"]);
    assert.deepEqual(all.facets.skill, { min: 0, max: 80 });
    assert.deepEqual(all.facets.level, { min: 5, max: 28 });

    const skilled = readFarmingSource(PEACEBLOOM_KEY, { filters: { skillMin: "51", skillMax: "100" } });
    assert.equal(skilled.summary.observations, 20);
    assert.equal(skilled.outputs.find((output) => output.itemKey === "item:249399").rate, lichenDrops / 20);

    const novice = readFarmingSource(PEACEBLOOM_KEY, { filters: { skillMax: 50 } });
    assert.equal(novice.outputs.some((output) => output.itemKey === "item:249399"), false);

    const ranked = readFarmingSource(PEACEBLOOM_KEY, { filters: { rank: "3" } });
    assert.equal(ranked.summary.observations, 20);
    assert.equal(readFarmingSource(PEACEBLOOM_KEY, { filters: { rank: "unknown" } }).summary.observations, 4);
    assert.equal(readFarmingSource(PEACEBLOOM_KEY, { filters: { rank: "0" } }).outputs.length, 1);

    const zoned = readFarmingSource(PEACEBLOOM_KEY, { filters: { zone: "Elwynn Forest" } });
    assert.equal(zoned.summary.zones, 1);
    assert.equal(zoned.outputs.length, 1, "no lichen observed in Elwynn");

    const build = readFarmingSource(PEACEBLOOM_KEY, { filters: { build: "70245" } });
    assert.equal(build.summary.observations, 10);
    assert.deepEqual(build.summary.builds.map((entry) => entry.build), ["70245"]);
    assert.equal(build.outputs.length, 1);

    const leveled = readFarmingSource(PEACEBLOOM_KEY, { filters: { levelMin: "20", levelMax: "29" } });
    assert.equal(leveled.summary.observations, 20);
    assert.deepEqual(leveled.filters, { zone: "", build: "", rank: null, skillMin: null, skillMax: null, levelMin: 20, levelMax: 29 });

    const unmatched = readFarmingSource(PEACEBLOOM_KEY, { filters: { zone: "Nowhere" } });
    assert.equal(unmatched.summary.observations, 0);
    assert.deepEqual(unmatched.outputs, []);
    assert.equal(unmatched.selectedItemKey, null);
    assert.equal(unmatched.source.totalObservations, 44, "the source itself is still known");
  }));

test("skill and Bountiful Harvest breakdowns expose sample sizes beside each rate", () =>
  withHttpApp(async () => {
    seed(30, (index) => ({ skill: 10, rank: 0, outputs: [PEACEBLOOM_ITEM, ...(index < 3 ? [LICHEN] : [])] }));
    seed(60, (index) => ({ skill: 120, rank: 5, outputs: [{ ...PEACEBLOOM_ITEM, quantity: 3 }, ...(index < 12 ? [{ ...LICHEN, quantity: 2 }] : [])] }));
    seed(2, { skill: 0, rank: null });

    const detail = readFarmingSource(PEACEBLOOM_KEY, { item: "item:249399" });
    assert.deepEqual(detail.bySkill.map((row) => [row.bucket, row.observations, row.drops]), [
      ["1-25", 30, 3],
      ["101-125", 60, 12],
      ["unknown", 2, 0],
    ]);
    assert.equal(detail.bySkill[0].rate, 0.1);
    assert.equal(detail.bySkill[1].rate, 0.2);
    assert.equal(detail.bySkill[1].min, 101);
    assert.equal(detail.bySkill[1].max, 125);
    assert.equal(detail.bySkill[0].confidence, "low", "3 of 30 is still a hint");
    assert.equal(detail.bySkill[1].confidence, "medium");

    assert.deepEqual(detail.byBountifulHarvest.map((row) => [row.rank, row.observations, row.drops, row.quantity]), [
      [0, 30, 3, 3],
      [5, 60, 12, 24],
      ["unknown", 2, 0, 0],
    ]);
    assert.equal(detail.byBountifulHarvest[1].avgQuantityPerObservation, 24 / 60);
    assert.equal(detail.byBountifulHarvest[2].confidence, "low");

    const herb = readFarmingSource(PEACEBLOOM_KEY, { item: "item:2447" });
    assert.deepEqual(herb.byBountifulHarvest.map((row) => row.avgQuantityPerObservation), [1, 3, 2]);
  }));

test("tiny samples never look authoritative", () => {
  assert.equal(rateConfidence(3, 12), "low", "3 of 12 is a hint, not a rate");
  assert.equal(rateConfidence(284, 11300), "very_high");
  assert.equal(rateConfidence(228, 8143), "very_high");
  assert.equal(rateConfidence(30, 60), "high");
  assert.equal(rateConfidence(41, 8143), "medium");
  assert.equal(rateConfidence(1, 40), "low");
  assert.equal(rateConfidence(0, 0), "low");
  assert.equal(rateConfidence(0, 35), "low", "never seen in 35 gathers says little");
  assert.equal(rateConfidence(0, 100), "medium");
  assert.equal(rateConfidence(0, 1000), "high");
  assert.equal(rateConfidence(0, 10000), "very_high");

  const small = wilsonInterval(3, 12);
  assert.ok(small.low > 0.08 && small.low < 0.1 && small.high > 0.5 && small.high < 0.55);
  assert.deepEqual(wilsonInterval(1, 0), { low: 0, high: 0 });
  assert.equal(wilsonInterval(10, 10).high, 1);

  const rate = observedRate(284, 11300);
  assert.equal(rate.rate, 284 / 11300);
  assert.equal(rate.observations, 11300);
  assert.ok(rate.low < rate.rate && rate.rate < rate.high);
  assert.equal(observedRate(0, 0).rate, 0);

  assert.deepEqual(skillBucket(1), { index: 0, min: 1, max: 25, label: "1-25" });
  assert.equal(skillBucket(26).label, "26-50");
  assert.equal(skillBucket(150).label, "126-150");
  assert.equal(skillBucket(0), null);
  assert.equal(skillBucket("unknown"), null);
});

test("economic events stored before they could be analysed are backfilled once", () =>
  withHttpApp(async () => {
    const envelope = gather();
    recordTelemetry({
      deviceId: DEVICE,
      memberId: memberIds.member,
      idempotencyKey: "raw-only",
      streamKey: `gathering_loot:character-rook:${envelope.payload.observationId}`,
      kind: "event",
      revision: 1,
      envelope,
    });
    assert.equal(observationCount(), 0);

    assert.deepEqual(withGuildTransaction(backfillEconomicObservationsInDatabase), { created: 1, duplicate: 0, skipped: 0 });
    assert.deepEqual(withGuildTransaction(backfillEconomicObservationsInDatabase), { created: 0, duplicate: 0, skipped: 0 });
    const row = withGuildDatabase((db) => db.prepare("SELECT * FROM economic_observations").get());
    assert.equal(row.source_key, PEACEBLOOM_KEY);
    assert.equal(row.character_key, `${memberIds.member}:character-rook`);
  }));

test("farming endpoints require a signed-in member", () =>
  withHttpApp(async ({ request }) => {
    seed(12, (index) => ({ outputs: [PEACEBLOOM_ITEM, ...(index < 3 ? [LICHEN] : [])] }));

    assert.equal((await request("/api/intelligence/farming/sources")).status, 401);
    assert.equal((await request(`/api/intelligence/farming/sources/${PEACEBLOOM_KEY}`)).status, 401);

    const list = await request("/api/intelligence/farming/sources?q=lichen", { persona: "member" });
    assert.equal(list.status, 200);
    assert.equal(list.json.sources[0].matches[0].confidence, "low");

    const detail = await request(
      `/api/intelligence/farming/sources/${encodeURIComponent(PEACEBLOOM_KEY)}?item=item:249399&zone=Duskwood&rank=3`,
      { persona: "member" },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.json.summary.observations, 0);
    assert.equal(detail.json.filters.zone, "Duskwood");

    const unfiltered = await request(`/api/intelligence/farming/sources/${PEACEBLOOM_KEY}`, { persona: "member" });
    const lichen = unfiltered.json.outputs.find((output) => output.name === "Frilled Lichen");
    assert.equal(lichen.rate, 3 / 12);
    assert.equal(lichen.confidence, "low");

    assert.equal((await request("/api/intelligence/farming/sources/herbalism:herb-node:nope", { persona: "member" })).status, 404);
  }));

async function pairBridge(request) {
  const started = await request("/api/bridge/pairing/start", { method: "POST", body: { deviceName: "Farming bridge" } });
  await request("/api/bridge/pairing/approve", { persona: "member", method: "POST", body: { userCode: started.json.userCode } });
  const exchanged = await request("/api/bridge/pairing/token", { method: "POST", body: { deviceCode: started.json.deviceCode } });
  return exchanged.json.deviceToken;
}

test("gathers synced through the bridge endpoint reach Farming, announce themselves live, and show in the ingest status", () =>
  withHttpApp(async ({ request }) => {
    resetLiveUpdatesForTests();
    const events = [];
    subscribeLiveUpdates({ memberId: memberIds.member, send: (event) => events.push(event) });
    const token = await pairBridge(request);
    const post = (envelope, key = envelope.payload.observationId) => request("/api/bridge/telemetry", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `gw-${key}` },
      body: { streamKey: `gathering_loot:character-rook:${envelope.payload.observationId}`, kind: "event", revision: 1, envelope },
    });

    const lichen = await post(gather({ outputs: [PEACEBLOOM_ITEM, LICHEN] }));
    assert.equal(lichen.status, 201);
    assert.equal(lichen.json.telemetryHandler, "gathering_loot");
    assert.equal((await post(gather())).status, 201);
    const empty = await post(gather({ outputs: [] }));
    assert.equal(empty.status, 201, "an unanalysable gather is still accepted, so the bridge never retries it forever");

    const farming = events.filter((event) => event.topics.includes("farming"));
    assert.equal(farming.length, 2, "one live update per recorded observation");
    assert.deepEqual(farming[0].detail, { sourceKey: PEACEBLOOM_KEY, discipline: "herbalism" });
    assert.equal(farming[0].entityId, PEACEBLOOM_KEY);

    // The bridge resending the same gather is neither counted nor announced.
    assert.equal((await post(gather({ observationId: "obs-resent" }))).status, 201);
    assert.equal((await post(gather({ observationId: "obs-resent" }), "obs-resent-again")).status, 201);
    assert.equal(events.filter((event) => event.topics.includes("farming")).length, 3);

    const detail = await request(`/api/intelligence/farming/sources/${PEACEBLOOM_KEY}`, { persona: "member" });
    assert.equal(detail.json.summary.observations, 3);
    assert.equal(detail.json.outputs.find((output) => output.name === "Frilled Lichen").drops, 1);

    assert.equal((await request("/api/intelligence/farming/status", { persona: "member" })).status, 403);
    const status = await request("/api/intelligence/farming/status", { persona: "owner" });
    assert.equal(status.status, 200);
    assert.deepEqual(status.json.eventTypes, ["gathering_loot"]);
    const [raw] = status.json.raw;
    assert.deepEqual([raw.eventType, raw.received, raw.recorded, raw.unrecorded], ["gathering_loot", 4, 3, 1], "a resend replaces its raw record and stays linked");
    assert.equal(status.json.unrecordedSamples.length, 1, "the empty gather is listed for inspection");
    assert.equal(status.json.observations[0].discipline, "herbalism");
    assert.equal(status.json.observations[0].observations, 3);
    resetLiveUpdatesForTests();
  }));
