import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadAtlas } from "../src/Atlas/atlasData.js";
import { FOREVER_OBSERVED, extractForever, normalizeForever, parseOpenMapPlaces } from "../src/Atlas/atlasForever.js";
import { atlasDetail, atlasQuests, atlasReadiness, resolveDungeonId, withAtlasList } from "../src/Atlas/atlasRepository.js";
import { VANILLA_INSTANCE_IDS } from "../src/Atlas/atlasSources.js";
import { wingsOf } from "../src/Atlas/atlasWings.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { connect } from "../testSupport/lootHarness.js";

// WoW Forever's own dungeons: from the Forever client's tables (OpenMap's
// Places.lua), with IDs only the client gives, names in the client's words,
// and everything unknown left unknown.

const FOREVER_IDS = [2959, 2970, 2974, 2994, 2998, 2999, 3001, 3039, 3065];
const read = (name) => JSON.parse(readFileSync(new URL(`../src/Atlas/data/${name}`, import.meta.url), "utf8"));

const PLACES = `ns.MapPlaces = {
	instances = {
		{ 0, -11207.8, 1681.2, { { 36, "Deadmines", false, 17, 26 } } },
		{ nil, 0.277, 0.479, { { 3065, "The Hall of Thanes", false, 13, 20 } }, map = 1455 },
		{ nil, 0.5, 0.5, { { 3100, "A \\"Quoted\\" Hold", true, 60, 60 } }, map = 1440 },
	},
	unplaced = {
	},
	bosses = {
		[36] = { "Rhahk'Zor", "Edwin VanCleef" },
		[3065] = { "Faldrim Anvilmar", "Infurnus" },
		[3100] = { "Gatekeeper" },
	},
}`;

test("the client's places: Forever instances, their entrances and encounters", () => {
  const parsed = parseOpenMapPlaces(PLACES);
  assert.deepEqual(parsed.instances, [[3065, "The Hall of Thanes", false, 13, 20, 1455, 0.277, 0.479], [3100, 'A "Quoted" Hold', true, 60, 60, 1440, 0.5, 0.5]],
    "zone-map entrances; the original game's world-coordinate rows are not this shape");
  const extract = extractForever(parsed);
  assert.deepEqual(extract.instances.map((row) => row[0]), [3065, 3100]);
  assert.deepEqual(extract.encounters, [[3065, 1, "Faldrim Anvilmar"], [3065, 2, "Infurnus"], [3100, 1, "Gatekeeper"]], "only the Forever instances' encounters");
  // To atlas entries: client names; NPC IDs only on an exact name; nothing invented.
  const entries = normalizeForever({
    forever: { source: "openmap-forever", revision: "r", retrievedAt: "t", url: "u", tables: extract },
    planner: { source: "dungeon-planner", revision: "p", retrievedAt: "t", url: "u", tables: { creatures: [[3065, 261306, "Faldrim Anvilmar", "hall-of-thanes"],
      [3065, 261316, "Magmatus", "hall-of-thanes"]], floors: [[3065, 1, "The Hall of Thanes"]] } },
    zoneName: (uiMapId) => (uiMapId === 1455 ? "Ironforge" : null),
  });
  const hall = entries.find((entry) => entry.instanceId === 3065);
  assert.deepEqual([hall.name, hall.kind, hall.levelMin, hall.levelMax, hall.zoneName, hall.origin], ["The Hall of Thanes", "dungeon", 13, 20, "Ironforge", "forever"]);
  assert.deepEqual(hall.entrance, { mapId: 1455, x: 0.277, y: 0.479 });
  assert.deepEqual(hall.bosses.map((boss) => [boss.name, boss.npcId, boss.encounterId]), [["Faldrim Anvilmar", 261306, null], ["Infurnus", null, null]],
    "the guide's 'Magmatus' is not the client's 'Infurnus': no NPC ID guessed");
  assert.deepEqual(hall.floorNames, ["The Hall of Thanes"]);
  assert.deepEqual([hall.maps, hall.quests, hall.rares], [[], [], []]);
  assert.equal(hall.coverage.encounterIds, "none");
  assert.equal(hall.coverage.npcIds, "partial");
  assert.equal(entries.find((entry) => entry.instanceId === 3100).kind, "raid");
  assert.ok(hall.provenance.every((line) => line.tier !== "classic-reference"), "never labelled Classic reference");
});

test("the checked-in atlas: 26 original instances, 9 Forever dungeons, no duplicates", () => {
  const { atlas } = loadAtlas();
  const ids = atlas.dungeons.map((dungeon) => dungeon.instanceId);
  assert.equal(new Set(ids).size, ids.length, "no instance twice");
  assert.deepEqual(ids.filter((id) => !VANILLA_INSTANCE_IDS.includes(id)), FOREVER_IDS, "exactly the client's nine");
  assert.deepEqual(ids.filter((id) => VANILLA_INSTANCE_IDS.includes(id)), [...VANILLA_INSTANCE_IDS], "every original instance kept");
  const forever = atlas.dungeons.filter((dungeon) => dungeon.origin === "forever");
  assert.deepEqual(forever.map((dungeon) => dungeon.name), ["City of Dalaran", "The Drowned City", "Blackmaw Hold", "Alcaz Prison", "Excavation Site: Wetlands",
    "Ruins of Lordaeron", "Shaper's Terrace", "Krol'dok Stronghold", "The Hall of Thanes"]);
  for (const dungeon of forever) {
    assert.ok(dungeon.levelMin && dungeon.levelMax && dungeon.bosses.length, `${dungeon.name}: levels and bosses from the client`);
    assert.ok(dungeon.entrance, `${dungeon.name}: entrance`);
  }
  // Encounter IDs: only the ones players' clients reported.
  const encounterIds = forever.flatMap((dungeon) => dungeon.bosses.filter((boss) => boss.encounterId).map((boss) => [dungeon.instanceId, boss.encounterId]));
  assert.deepEqual(encounterIds, Object.entries(FOREVER_OBSERVED).flatMap(([id, list]) => list.map((entry) => [Number(id), entry.encounterId])));
  // The 11 wings, unchanged.
  assert.equal(atlas.dungeons.flatMap((dungeon) => wingsOf(dungeon)).length, 11);
  // The extract matches the OpenMap checkout it came from (when there is one).
  const extract = read("sources/forever-instances.json");
  assert.match(extract.revision, /^[0-9a-f]{40} \(client build \d+\.\d+\.\d+\.\d+\)$/);
  assert.deepEqual(extract.tables.instances.map((row) => row[0]), FOREVER_IDS);
});

test("served: cards, detail with unknown loot by id, quests and readiness", () => {
  const list = withAtlasList({ schemaVersion: 1, revision: 0, dungeons: [] });
  const cards = list.atlasDungeons.filter((entry) => entry.atlas.origin === "forever");
  assert.deepEqual(cards.map((entry) => entry.instanceId), FOREVER_IDS, "each Forever dungeon is a card");
  assert.ok(cards.every((entry) => entry.atlas.dungeonKey && entry.atlas.coverage && entry.type === "party"));
  assert.deepEqual(resolveDungeonId("the-hall-of-thanes"), { instanceId: 3065, wingKey: null });
  const hall = atlasDetail(3065, []);
  assert.equal(hall.origin, "forever");
  assert.ok(hall.unresolvedLoot.length > 0, "the guide's drop list, kept by item id");
  assert.ok(hall.unresolvedLoot.every((entry) => entry.factsKnown === false && entry.verifiedForForever === false && entry.itemKey === `i:${entry.itemId}`));
  const onBosses = hall.bosses.flatMap((boss) => boss.unresolvedLoot);
  assert.ok(onBosses.length > 0 && onBosses.length <= hall.unresolvedLoot.length, "a boss shows its own; unmatched ones stay on the dungeon");
  assert.ok(hall.bosses.every((boss) => boss.referenceLoot.length === 0), "no Classic item facts claimed");
  assert.ok(hall.quests.length >= 5 && hall.quests.every((quest) => quest.prerequisitesKnown === false));
  // Blackmaw Hold: no curated quest list: not "no quests".
  const blackmaw = atlasQuests(2974);
  assert.equal(blackmaw.curated, false);
  assert.equal(blackmaw.quests.length, 0);
  // Readiness: unknown chains are never "ready" or "missing".
  const outcome = atlasReadiness(3065, { schemaVersion: 1, faction: "alliance", race: "Dwarf", classToken: "WARRIOR", level: 15,
    completed: { coverage: "full", questIds: [] }, questLog: { coverage: "full", questIds: [] } });
  assert.equal(outcome.result.readiness, "unknown");
  assert.ok(outcome.result.quests.every((quest) => quest.state === "unknown" || quest.state === "ineligible"));
  assert.equal(atlasReadiness(2974, { schemaVersion: 1, completed: { coverage: "full", questIds: [] }, questLog: { coverage: "full", questIds: [] } }).result.readiness, "none");
  // The original dungeons are served as before.
  const deadmines = atlasDetail(36, []);
  assert.equal(deadmines.origin, "classic");
  // Forever's new drops in an original dungeon are kept the same way: by id, no facts.
  assert.ok(deadmines.unresolvedLoot.every((entry) => entry.factsKnown === false && entry.itemId > 200000));
  assert.ok(deadmines.quests.length >= 5);
});

test("the API: a Forever dungeon by instance ID and by key", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-forever-ash", username: "ash" });
  const get = (path) => request(`/api/player/loot/dungeons/${path}`, { rawCookie: ash.cookie });
  const byId = await get("3065");
  assert.equal(byId.status, 200);
  assert.equal(byId.json.instance.name, "The Hall of Thanes");
  assert.deepEqual(byId.json.sources, [], "nobody has reported its loot yet");
  assert.equal((await get("the-hall-of-thanes")).json.instance.instanceId, 3065);
  assert.equal((await get("3065/quests")).json.quests.length >= 5, true);
  const list = (await request("/api/player/loot/dungeons", { rawCookie: ash.cookie })).json;
  assert.ok(list.atlasDungeons.some((entry) => entry.instanceId === 2998 && entry.name === "Excavation Site: Wetlands"));
  assert.equal((await get("4000")).status, 404, "an instance no table lists");
}));
