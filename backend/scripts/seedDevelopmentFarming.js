// Seeds synthetic gathering observations so Farming Intelligence can be used
// locally without gathering thousands of herbs by hand.
//
// Each observation is a gathering_loot envelope shaped like the addon's
// (Data/GatheringTelemetry.lua) and goes through the same normalizer and
// repository as live telemetry. They are written straight to the observation
// tables rather than the raw telemetry history, so the seed does not crowd the
// bounded raw history out. Item ids and icons are real Classic data; the
// rates are invented, but vary with skill, Bountiful Harvest rank, zone and
// build so every chart and filter visibly responds.
//
// Deterministic and idempotent: observation keys are fixed, so re-running adds
// nothing. Bump FARMING_SEED_VERSION when the generated data changes; older
// seeded observations are replaced.

import { pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { withGuildTransaction } from "../src/Data/database.js";
import { initializeGuildData } from "../src/Data/initializeData.js";
import { ensureRuntimeDataDirectory } from "../src/Data/runtimeData.js";
import { recordEconomicObservationInDatabase } from "../src/Economy/economicObservationRepository.js";

const ITEMS = {
  peacebloom: { itemId: 2447, name: "Peacebloom", qualityId: 1, iconFileDataId: 133939 },
  silverleaf: { itemId: 765, name: "Silverleaf", qualityId: 1, iconFileDataId: 134190 },
  earthroot: { itemId: 2449, name: "Earthroot", qualityId: 1, iconFileDataId: 134187 },
  mageroyal: { itemId: 785, name: "Mageroyal", qualityId: 1, iconFileDataId: 133436 },
  briarthorn: { itemId: 2450, name: "Briarthorn", qualityId: 1, iconFileDataId: 134412 },
  swiftthistle: { itemId: 2452, name: "Swiftthistle", qualityId: 1, iconFileDataId: 134184 },
  kingsblood: { itemId: 3356, name: "Kingsblood", qualityId: 1, iconFileDataId: 134183 },
  // WoW Forever's rare herbalism reagent; the fixture carries no icon for it.
  lichen: { itemId: 249399, name: "Frilled Lichen", qualityId: 2 },
  copperOre: { itemId: 2770, name: "Copper Ore", qualityId: 1, iconFileDataId: 134566 },
  roughStone: { itemId: 2835, name: "Rough Stone", qualityId: 1, iconFileDataId: 135232 },
  malachite: { itemId: 774, name: "Malachite", qualityId: 2, iconFileDataId: 134106 },
  tigerseye: { itemId: 818, name: "Tigerseye", qualityId: 2, iconFileDataId: 134118 },
  shadowgem: { itemId: 1210, name: "Shadowgem", qualityId: 2, iconFileDataId: 134074 },
};

const HERBALISM = { skillLineId: 182, name: "Herbalism" };
const MINING = { skillLineId: 186, name: "Mining" };
const MAP_IDS = {
  "Elwynn Forest": 1429, "Dun Morogh": 1426, Teldrassil: 1438, Durotar: 1411, Mulgore: 1412,
  "Tirisfal Glades": 1420, Westfall: 1436, "Loch Modan": 1432, "The Barrens": 1413, Darkshore: 1439,
  "Silverpine Forest": 1421, "Redridge Mountains": 1433, "Hillsbrad Foothills": 1424, Wetlands: 1437, Duskwood: 1431,
};

// count: observations. skill: [required, typical max]. lichen: base chance
// multiplier. extras: [item, chance] secondary outputs.
const SOURCES = [
  { name: "Peacebloom", objectIds: [1618, 3724], primary: "peacebloom", count: 8143, skill: [1, 150], lichen: 1, zones: ["Elwynn Forest", "Dun Morogh", "Teldrassil", "Durotar", "Mulgore", "Tirisfal Glades"] },
  { name: "Silverleaf", objectIds: [1617, 3725], primary: "silverleaf", count: 6412, skill: [1, 150], lichen: 0.8, zones: ["Elwynn Forest", "Dun Morogh", "Teldrassil", "Durotar", "Tirisfal Glades"] },
  { name: "Briarthorn", objectIds: [2045], primary: "briarthorn", count: 2991, skill: [70, 150], lichen: 0.6, extras: [["swiftthistle", 0.07]], zones: ["Silverpine Forest", "Westfall", "Redridge Mountains", "Darkshore", "The Barrens", "Hillsbrad Foothills"] },
  { name: "Mageroyal", objectIds: [1620], primary: "mageroyal", count: 1530, skill: [50, 150], lichen: 0.5, extras: [["swiftthistle", 0.09]], zones: ["Westfall", "Loch Modan", "Darkshore", "The Barrens", "Silverpine Forest"] },
  { name: "Earthroot", objectIds: [1619, 3726], primary: "earthroot", count: 892, skill: [15, 150], lichen: 1.6, zones: ["Westfall", "Loch Modan", "The Barrens", "Darkshore"] },
  { name: "Kingsblood", objectIds: [1624], primary: "kingsblood", count: 14, skill: [125, 150], lichen: 2, zones: ["Wetlands", "Hillsbrad Foothills"] },
];

const VEINS = [
  {
    name: "Copper Vein", objectIds: [1731], count: 1240, skill: [1, 125],
    zones: ["Elwynn Forest", "Dun Morogh", "Durotar", "Westfall", "Loch Modan", "Darkshore"],
    outputs: [["roughStone", 0.45], ["malachite", 0.015], ["tigerseye", 0.012], ["shadowgem", 0.006]],
  },
];

const FARMING_SEED_VERSION = 2;
const SEED_DEVICE = "dev-farming-seed";

// Bountiful Harvest is one Legacy Professions talent shared by Herbalism,
// Mining and Skinning.
const BOUNTIFUL_HARVEST_SPELL_ID = 1225435;

const BUILDS = [
  { version: "1.60.1", build: "70245", weight: 0.4 },
  { version: "1.60.1", build: "70338", weight: 0.6 },
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

// Skill skews toward the low end of a source's range: most gathers happen
// while a node is still worth levelling on.
function skillFor(random, [required, max]) {
  return Math.min(max, Math.round(required + (max - required) * random() ** 1.6));
}

// Ranks 0-5 weighted toward the low end; some clients cannot read the talent.
function rankFor(random) {
  const roll = random();
  if (roll < 0.08) return null;
  return Math.min(5, Math.floor(((roll - 0.08) / 0.92) ** 1.4 * 6));
}

function bountifulHarvest(rank) {
  return rank === null ? {} : { bountifulHarvest: { spellId: BOUNTIFUL_HARVEST_SPELL_ID, rank, maxRanks: 5 } };
}

function buildFor(random) {
  return random() < BUILDS[0].weight ? BUILDS[0] : BUILDS[1];
}

function characterFor(random) {
  const index = Math.floor(random() * 312);
  return { memberId: `dev-farmer-${index % 40}`, characterId: `character-dev-farmer-${index}` };
}

function envelope({ id, capturedAt, build, characterId, payload }) {
  return {
    schemaVersion: 1,
    eventType: "gathering_loot",
    capturedAt,
    gameBuild: { version: build.version, build: build.build, interface: 16001 },
    realm: "Classic Beta PvE 2",
    region: "US",
    characterId,
    payloadSchemaVersion: 1,
    payload: { schemaVersion: 1, observationId: id, ...payload },
  };
}

function herbObservation(source, index, random, startAt) {
  const skill = skillFor(random, source.skill);
  const rank = rankFor(random);
  const build = buildFor(random);
  const zone = pick(random, source.zones);
  const level = Math.max(5, Math.min(60, Math.round(skill / 3 + 4 + random() * 12)));
  // Frilled Lichen: rises with skill and rank, a touch higher on the newer
  // build and in the source's first listed zone.
  const lichenChance = source.lichen * (
    0.009 + Math.min(skill, 125) * 0.00012 + (rank ?? 0) * 0.0035 +
    (build.build === "70338" ? 0.003 : 0) + (zone === source.zones[0] ? 0.002 : 0)
  );
  const outputs = [{ ...ITEMS[source.primary], quantity: 1 + Math.floor(random() * 3) + (random() < (rank ?? 0) * 0.06 ? 1 : 0) }];
  for (const [item, chance] of source.extras || []) {
    if (random() < chance) outputs.push({ ...ITEMS[item], quantity: 1 });
  }
  if (random() < lichenChance) outputs.push({ ...ITEMS.lichen, quantity: random() < 0.06 ? 2 : 1 });
  const { characterId, memberId } = characterFor(random);
  const id = `dev-farm-v${FARMING_SEED_VERSION}-${source.name.toLowerCase()}-${index}`;

  return {
    memberId,
    characterId,
    envelope: envelope({
      id,
      capturedAt: startAt + index * 37 + Math.floor(random() * 30),
      build,
      characterId,
      payload: {
        activity: "harvest",
        discipline: "herbalism",
        source: { kind: "herb_node", name: source.name, objectId: pick(random, source.objectIds), guidKind: "GameObject" },
        outputs,
        context: {
          characterLevel: level,
          profession: { ...HERBALISM, skillLevel: skill, maxSkillLevel: Math.min(300, Math.ceil((skill + 1) / 75) * 75), skillModifier: 0 },
          modifiers: bountifulHarvest(rank),
          location: { mapId: MAP_IDS[zone], zone, x: Number(random().toFixed(4)), y: Number(random().toFixed(4)) },
          trigger: { spellId: 2366, spellName: "Herbalism" },
        },
        capture: { lootSlotCount: outputs.length, sourceCount: 1 },
      },
    }),
  };
}

function veinObservation(vein, index, random, startAt) {
  const skill = skillFor(random, vein.skill);
  const rank = rankFor(random);
  const build = buildFor(random);
  const zone = pick(random, vein.zones);
  // Bountiful Harvest: more ore per vein, and gems a little more often.
  const outputs = [{ ...ITEMS.copperOre, quantity: 1 + Math.floor(random() * 3) + (random() < (rank ?? 0) * 0.07 ? 1 : 0) }];
  for (const [item, chance] of vein.outputs) {
    const boost = item === "roughStone" ? 1 : 1 + (rank ?? 0) * 0.12;
    if (random() < chance * boost * (1 + skill / 250)) outputs.push({ ...ITEMS[item], quantity: 1 + (item === "roughStone" ? Math.floor(random() * 2) : 0) });
  }
  const { characterId, memberId } = characterFor(random);
  const id = `dev-farm-v${FARMING_SEED_VERSION}-${vein.name.toLowerCase().replace(/\s+/g, "-")}-${index}`;

  return {
    memberId,
    characterId,
    envelope: envelope({
      id,
      capturedAt: startAt + index * 41,
      build,
      characterId,
      payload: {
        activity: "mine",
        discipline: "mining",
        source: { kind: "ore_vein", name: vein.name, objectId: pick(random, vein.objectIds), guidKind: "GameObject" },
        outputs,
        context: {
          characterLevel: Math.max(5, Math.min(60, Math.round(skill / 3 + 6 + random() * 10))),
          profession: { ...MINING, skillLevel: skill, maxSkillLevel: Math.min(300, Math.ceil((skill + 1) / 75) * 75), skillModifier: 0 },
          modifiers: bountifulHarvest(rank),
          location: { mapId: MAP_IDS[zone], zone, x: Number(random().toFixed(4)), y: Number(random().toFixed(4)) },
          trigger: { spellId: 2575, spellName: "Mining" },
        },
        capture: { lootSlotCount: outputs.length, sourceCount: 1 },
      },
    }),
  };
}

export function developmentFarmingObservations() {
  const startAt = 1791000000;
  const observations = [];
  for (const [sourceIndex, source] of SOURCES.entries()) {
    const random = seededRandom(1000 + sourceIndex);
    for (let index = 0; index < source.count; index += 1) observations.push(herbObservation(source, index, random, startAt));
  }
  for (const [veinIndex, vein] of VEINS.entries()) {
    const random = seededRandom(2000 + veinIndex);
    for (let index = 0; index < vein.count; index += 1) observations.push(veinObservation(vein, index, random, startAt));
  }
  return observations;
}

export function seedDevelopmentFarming({ logger = console } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development farming data cannot be seeded in production.");
  }

  const counts = { created: 0, duplicate: 0, skipped: 0, replaced: 0 };
  const receivedAt = new Date().toISOString();
  withGuildTransaction((db) => {
    const replaced = db.prepare(`
      DELETE FROM economic_observations
      WHERE device_id = ? AND observation_key NOT LIKE ?
    `).run(SEED_DEVICE, `%:dev-farm-v${FARMING_SEED_VERSION}-%`);
    counts.replaced = Number(replaced.changes);
    for (const { memberId, characterId, envelope: observed } of developmentFarmingObservations()) {
      const result = recordEconomicObservationInDatabase(db, {
        eventType: "gathering_loot",
        envelope: observed,
        memberId,
        deviceId: SEED_DEVICE,
        rawCharacterId: characterId,
        streamKey: `gathering_loot:${characterId}:${observed.payload.observationId}`,
        receivedAt,
      });
      counts[result.status] += 1;
    }
  });

  logger.log(`Farming observations: ${counts.created} created, ${counts.duplicate} already present, ${counts.replaced} from an older seed replaced.`);
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    await ensureRuntimeDataDirectory();
    initializeGuildData();
    seedDevelopmentFarming();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
