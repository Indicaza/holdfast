// Seeds dungeon runs for the development "member" persona (Mira, Human
// Rogue) so the Dungeon runs page can be used and screenshotted locally.
//
// Runs and loot go through the same telemetry ingest as the add-on's
// uploads: dungeon_run (payload schema 1 and 2) and mob_loot linked by
// context.dungeonRun.runId. Item definitions come from seed/devData
// (real FileDataIDs and tooltips); cloth is described here. Prices are
// recorded on Mira's own faction house. Times, XP and prices are invented.
//
// Run after `npm run dev:seed` and `npm run dev:seed:characters`.
// Deterministic: re-running records nothing new.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { readGuildweaverDevices } from "../src/Character/guildweaverDeviceRepository.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { initializeGuildData } from "../src/Data/initializeData.js";
import { ensureRuntimeDataDirectory } from "../src/Data/runtimeData.js";
import { clientMarketKey } from "../src/Market/marketModel.js";
import { recordMarketSnapshotInDatabase } from "../src/Market/marketRepository.js";

const MEMBER = "dev-member";
const seedDir = join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "devData");
const CATALOG = JSON.parse(readFileSync(join(seedDir, "items.json"), "utf8")).items;

const CLOTH = {
  2589: { name: "Linen Cloth", icon: 132889, sell: 13 },
  2592: { name: "Wool Cloth", icon: 132911, sell: 33 },
  4306: { name: "Silk Cloth", icon: 132905, sell: 150 },
};
const BLUES = [7717, 10328, 10330, 10332];
const GREENS = [7711, 7712, 10329, 10331, 10333];

const SM = { name: "Scarlet Monastery", type: "party", instanceId: 189, difficultyId: 1, difficultyName: "Normal", maxPlayers: 5 };
const RFK = { name: "Razorfen Kraul", type: "party", instanceId: 47, difficultyId: 1, difficultyName: "Normal", maxPlayers: 5 };
const STOCKS = { name: "The Stockade", type: "party", instanceId: 34, difficultyId: 1, difficultyName: "Normal", maxPlayers: 5 };

const BOSSES = {
  189: [[2, "Houndmaster Loksey", 420], [3, "Arcanist Doan", 1350], [4, "Herod", 2100]],
  47: [[10, "Roogug", 520], [11, "Aggem Thorncurse", 980], [12, "Death Speaker Jargba", 1300], [13, "Overlord Ramtusk", 1700], [14, "Charlga Razorflank", 2300]],
  34: [[20, "Targorr the Dread", 300], [21, "Kam Deepfury", 700], [22, "Bazil Thredd", 1200]],
};

// [instance, startedDaysAgo, scale (time multiplier), deaths, status, schema, extras]
const PLAN = [
  [SM, 18, 1.25, 2, "completed", 1],
  [RFK, 16, 1.1, 1, "completed", 1],
  [SM, 14, 1.12, 0, "completed", 1],
  [STOCKS, 13, 1, 0, "abandoned", 1, { bossesDone: 1 }],
  [SM, 11, 1.05, 1, "completed", 2],
  [RFK, 9, 1.0, 0, "completed", 2],
  [SM, 7, 0.97, 0, "completed", 2, { levelUp: true }],
  [RFK, 6, 1.18, 3, "completed", 2, { manual: true }],
  [SM, 4, 0.93, 0, "completed", 2],
  [SM, 2, 1.02, 1, "completed", 2, { reentry: true }],
  [RFK, 1, 0.55, 0, "interrupted", 2, { bossesDone: 2 }],
  [SM, 0, 0.6, 0, "open", 2, { bossesDone: 2 }],
];

function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function seedCatalog(db, marketKey, now) {
  const insert = db.prepare(`INSERT OR IGNORE INTO public_game_items (item_id, game_build, locale, name, quality_id, icon_file_id, definition_json, captured_at)
    VALUES (?, '70338', 'en_US', ?, ?, ?, ?, ?)`);
  const captured = new Date(now * 1000).toISOString();
  for (const id of [...BLUES, ...GREENS]) {
    const item = CATALOG[String(id)];
    if (item) insert.run(id, item.name, item.qualityId, item.iconFileDataId, JSON.stringify(item), captured);
  }
  for (const [id, cloth] of Object.entries(CLOTH)) {
    insert.run(Number(id), cloth.name, 1, cloth.icon, JSON.stringify({ itemId: Number(id), name: cloth.name, qualityId: 1, iconFileDataId: cloth.icon, sellPrice: cloth.sell,
      stackCount: 20, itemClass: { id: 7, name: "Trade Goods" }, itemSubclass: { id: 5, name: "Cloth" },
      tooltip: { source: "C_TooltipInfo.GetHyperlink", lines: [{ left: cloth.name, leftColor: { r: 1, g: 1, b: 1 } }, { left: "Max Stack: 20", leftColor: { r: 1, g: 1, b: 1 } }] } }), captured);
  }
  const listing = (itemId, unit, quantity) => ({ itemKey: `i:${itemId}`, itemId, minUnitBuyout: unit, typicalUnitBuyout: Math.round(unit * 1.08), maxUnitBuyout: unit * 2,
    minUnitBid: null, quantity, listings: Math.max(1, Math.round(quantity / 10)), bidOnlyListings: 0 });
  const market = { marketKey, kind: "client_house", region: marketKey.split(":")[1], realm: "Classic Beta PvE 2", faction: "alliance", name: "Classic Beta PvE 2 Alliance (in-game)" };
  // Most prices from an hour ago; the Ravager last seen three days ago.
  recordMarketSnapshotInDatabase(db, { market, sourceType: "addon_scan", sourceId: "dev-dungeon-seed-old", coverage: "items", observedAt: now - 3 * 86400, now,
    items: [listing(7717, 1250000, 1)] });
  recordMarketSnapshotInDatabase(db, { market, sourceType: "addon_scan", sourceId: "dev-dungeon-seed", coverage: "items", observedAt: now - 3600, now,
    items: [listing(2589, 45, 400), listing(2592, 160, 320), listing(4306, 520, 180), listing(10328, 185000, 2), listing(10330, 240000, 1),
      listing(7711, 42000, 3), listing(10329, 18500, 4), listing(10333, 21000, 2)] });
}

function runFor(plan, index, character, now) {
  const [instance, daysAgo, scale, deaths, status, schema, extras = {}] = plan;
  const bosses = BOSSES[instance.instanceId];
  const total = bosses.length;
  const done = extras.bossesDone ?? total;
  const startedAt = now - daysAgo * 86400 - 3600 * (2 + (index % 5)) - (hash(index) % 1800);
  const killAt = (offset) => Math.round(offset * scale);
  const duration = status === "open" || done < total ? killAt(bosses[Math.max(0, done - 1)][2]) + 240 : killAt(bosses[total - 1][2]) + 150;
  const timeline = [{ at: 0, kind: "enter", name: instance.name }];
  const checkpoints = [];
  let deathsLeft = deaths;
  bosses.slice(0, done).forEach(([encounterId, name, offset], position) => {
    const at = killAt(offset);
    if (deathsLeft > 0 && position % 2 === 1) {
      timeline.push({ at: at - 140, kind: "encounter_start", encounterId, name });
      timeline.push({ at: at - 95, kind: "death" });
      timeline.push({ at: at - 94, kind: "encounter_failed", encounterId, name });
      deathsLeft -= 1;
    }
    if (extras.reentry && position === 1) {
      timeline.push({ at: at - 400, kind: "leave" });
      timeline.push({ at: at - 310, kind: "reenter" });
    }
    timeline.push({ at: at - 45, kind: "encounter_start", encounterId, name });
    const source = extras.manual ? null : "encounter_end";
    if (extras.manual) {
      timeline.push({ at, kind: "manual_split", name });
      checkpoints.push({ id: `split:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, kind: "split", at, name, source: "manual" });
    } else {
      timeline.push({ at, kind: "boss_kill", encounterId, name, source });
      checkpoints.push({ id: `boss:${encounterId}`, kind: "boss", at, name, encounterId, source });
    }
    if (instance === SM && position === 0 && schema === 2) {
      timeline.push({ at: at + 300, kind: "manual_split", name: "Courtyard" });
      checkpoints.push({ id: "split:courtyard", kind: "split", at: at + 300, name: "Courtyard", source: "manual" });
    }
  });
  while (deathsLeft > 0) { timeline.push({ at: Math.round(duration * 0.3) + deathsLeft * 7, kind: "death" }); deathsLeft -= 1; }
  if (extras.levelUp) timeline.push({ at: Math.round(duration * 0.62), kind: "level_up", level: 32 });
  if (status === "completed" && !extras.manual && schema === 2) timeline.push({ at: duration - 140, kind: "complete" });
  if (status !== "open") timeline.push({ at: duration, kind: "leave" });
  timeline.sort((a, b) => a.at - b.at);
  const xp = Math.round((instance === SM ? 21500 : instance === RFK ? 15800 : 7200) * (done / total) * (1 + (hash(`xp${index}`) % 13) / 100));
  const level = extras.levelUp ? 31 : index > 6 ? 32 : 31;
  const runId = `dungeon-dev-${index.toString(16)}-${hash(`run${index}`).toString(16)}`;
  const endedAt = startedAt + duration + (extras.reentry ? 30 : 15);
  const payload = {
    schemaVersion: schema, runId, sequence: status === "open" ? 1 : 3, status,
    ...(status !== "open" ? { endReason: extras.manual ? "manual_finish" : status === "completed" ? "all_bosses_defeated" : status === "abandoned" ? "left_instance" : "logout_not_resumed", endedAt } : {}),
    startedAt, lastActiveAt: endedAt, durationSeconds: duration, insideSeconds: duration - (extras.reentry ? 90 : 0),
    instance, character: { levelAtEntry: level, levelAtExit: extras.levelUp ? 32 : level, classToken: "ROGUE" },
    group: { sizeAtEntry: 5, maxSize: 5 },
    xp: { available: true, atLevelCap: false, gained: xp, levelUps: extras.levelUp ? 1 : 0 },
    wallet: { basis: "wallet_delta", available: true, netCopper: (hash(`gold${index}`) % 26000) - 6000 },
    deaths,
    bosses: { defeated: done, total: extras.manual ? undefined : total, manualSplits: checkpoints.filter((entry) => entry.kind === "split").length,
      encounterEvents: !extras.manual, list: [] },
    loot: { observations: 4 + (index % 5) },
    timeline: timeline.slice(0, 60),
    ...(schema === 2 ? { checkpoints, completion: { basis: status === "completed" ? (extras.manual ? "manual" : "lockout") : "none" } } : {}),
  };
  return {
    schemaVersion: 1, eventType: "dungeon_run", capturedAt: endedAt, gameBuild: { version: "1.60.1", build: "70338", interface: 16001 },
    realm: character.realm, region: character.region, locale: "enUS", installationId: character.installation_id, characterId: character.raw_character_id,
    addon: { name: "Guildweaver", version: schema === 2 ? "0.6.0" : "0.5.0" }, payloadSchemaVersion: schema, payload,
  };
}

function lootFor(run, index, character) {
  const events = [];
  const items = [[2592, 2 + (index % 3)], [4306, 1 + (index % 4)], [2589, index % 2 ? 3 : 0]];
  if (index % 3 === 0) items.push([BLUES[index % BLUES.length], 1]);
  if (index % 2 === 0) items.push([GREENS[index % GREENS.length], 1]);
  if (index === 9) items.push([999990, 1]); // an item no catalog knows yet
  items.filter(([, quantity]) => quantity > 0).forEach(([itemId, quantity], position) => {
    const npc = 4000 + index * 10 + position;
    const guid = `Creature-0-1-${run.payload.instance.instanceId}-${index}-${npc}-0000${(index * 31 + position).toString(16).padStart(4, "0")}`;
    events.push({
      schemaVersion: 1, eventType: "mob_loot", capturedAt: run.payload.startedAt + 300 + position * 200,
      gameBuild: run.gameBuild, realm: character.realm, region: character.region, locale: "enUS", installationId: character.installation_id,
      characterId: character.raw_character_id, addon: run.addon, payloadSchemaVersion: 1,
      payload: { schemaVersion: 1, observationId: guid, activity: "corpse_loot", source: { guid, npcId: npc, kind: "creature" },
        outputs: [{ itemId, quantity, qualityId: CATALOG[String(itemId)]?.qualityId ?? 1, isQuestItem: false }],
        context: { instance: { instanceId: run.payload.instance.instanceId, name: run.payload.instance.name, type: "party", difficultyId: 1, difficultyName: "Normal" },
          lootMethod: "group", dungeonRun: { runId: run.payload.runId } },
        capture: { attribution: "loot_source_pairs", visibility: "visible_to_observer", yieldBasis: "loot_window" } },
    });
  });
  return events;
}

export async function seedDevelopmentDungeons({ now = Math.floor(Date.now() / 1000), logger = console } = {}) {
  const character = withGuildDatabase((db) => db.prepare(`SELECT raw_character_id, installation_id, realm, region FROM guildweaver_character_aliases
    WHERE member_id = ? ORDER BY last_seen_at DESC LIMIT 1`).get(MEMBER));
  if (!character) {
    logger.log("No characters for dev-member yet: run npm run dev:seed and npm run dev:seed:characters first.");
    return { runs: 0 };
  }
  const deviceId = readGuildweaverDevices(MEMBER).find((device) => !device.revokedAt)?.id;
  const marketKey = clientMarketKey({ region: character.region, realm: character.realm, faction: "alliance" });
  withGuildTransaction((db) => seedCatalog(db, marketKey, now));
  // Runs are dated relative to today's start so a re-run lands on the same keys.
  const day = now - (now % 86400);
  let runs = 0;
  let loot = 0;
  PLAN.forEach((plan, index) => {
    const run = runFor(plan, index, character, day);
    const result = ingestTelemetry({ deviceId, memberId: MEMBER, idempotencyKey: `dev-dungeon:${run.payload.runId}:${run.payload.sequence}`,
      body: { streamKey: `dungeon_run:${character.raw_character_id}:${run.payload.runId}`, kind: "event", revision: run.payload.sequence, envelope: run },
      receivedAt: new Date((run.capturedAt + 20) * 1000).toISOString() });
    if (result.status === "invalid") throw new Error(`Seed run ${index} is invalid: ${result.error}`);
    if (result.status === "created") runs += 1;
    for (const event of lootFor(run, index, character)) {
      const stored = ingestTelemetry({ deviceId, memberId: MEMBER, idempotencyKey: `dev-dungeon-loot:${event.payload.observationId}`,
        body: { streamKey: `mob_loot:${character.raw_character_id}:${event.payload.observationId}`, kind: "event", revision: 1, envelope: event },
        receivedAt: new Date((event.capturedAt + 20) * 1000).toISOString() });
      if (stored.status === "invalid") throw new Error(`Seed loot is invalid: ${stored.error}`);
      if (stored.status === "created") loot += 1;
    }
  });
  logger.log(`Dungeon seed: ${runs} runs and ${loot} loot windows recorded for ${MEMBER} (${character.realm}).`);
  return { runs, loot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    await ensureRuntimeDataDirectory();
    initializeGuildData();
    await seedDevelopmentDungeons();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
