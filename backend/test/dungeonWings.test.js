import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { withGuildDatabase } from "../src/Data/database.js";
import { atlasDungeon, atlasWingEntries, resolveDungeonId, withAtlasWingDetail } from "../src/Atlas/atlasRepository.js";
import { hasWings, parentKeyFor, unassignedOf, wingDefinitions, wingForKills, wingsOf } from "../src/Atlas/atlasWings.js";
import { referenceDungeon } from "../src/Atlas/referenceLoot.js";
import { buildWingManifest, wingManifestText } from "../src/Atlas/atlasWingManifest.js";
import { validDungeonRun } from "../src/Dungeon/dungeonRunModel.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { ITEMS, connect, corpseLoot, post, seedItems, syncCharacter } from "../testSupport/lootHarness.js";

// Dungeon wings: one atlas entry per independently played wing of a
// dungeon whose wings share one game map (one numeric instance ID), with
// sourced bosses, rares, levels, floors and entrances; quests and trash
// loot shared; old numeric links and stored runs unchanged.

const SM = { instanceId: 189, name: "Scarlet Monastery", type: "party", difficultyId: 1, difficultyName: "Normal" };
const v2 = JSON.parse(fs.readFileSync(new URL("./fixtures/guildweaver-dungeon-run.v2.json", import.meta.url), "utf8"));

const EXPECTED_KEYS = [
  "scarlet-monastery:graveyard", "scarlet-monastery:library", "scarlet-monastery:armory", "scarlet-monastery:cathedral",
  "blackrock-spire:lower", "blackrock-spire:upper",
  "stratholme:live", "stratholme:undead",
  "dire-maul:east", "dire-maul:west", "dire-maul:north",
];

test("wings of one dungeon share its numeric instance ID under stable, unique keys", () => {
  const entries = atlasWingEntries();
  assert.deepEqual(entries.map((entry) => entry.dungeonKey), EXPECTED_KEYS, "stable keys, in atlas order");
  assert.equal(new Set(entries.map((entry) => entry.dungeonKey)).size, entries.length, "unique");
  const sm = entries.filter((entry) => entry.parentKey === "scarlet-monastery");
  assert.equal(sm.length, 4);
  assert.ok(sm.every((entry) => entry.instanceId === 189 && entry.instanceName === "Scarlet Monastery"), "the game's instance ID is kept");
  assert.deepEqual(sm.map((entry) => entry.name), ["Scarlet Monastery — Graveyard", "Scarlet Monastery — Library", "Scarlet Monastery — Armory",
    "Scarlet Monastery — Cathedral"]);
  assert.deepEqual(entries.filter((entry) => entry.parentKey === "blackrock-spire").map((entry) => entry.name), ["Lower Blackrock Spire", "Upper Blackrock Spire"]);
  // Deterministic: the same atlas gives the same wings.
  assert.deepEqual(atlasWingEntries(), entries);
  for (const id of [189, 229, 329, 429]) assert.deepEqual(wingsOf(atlasDungeon(id)), wingsOf(atlasDungeon(id)));
  // Every other dungeon is one entry, keyed by its name.
  assert.equal(parentKeyFor(atlasDungeon(36)), "deadmines");
  assert.equal(parentKeyFor(atlasDungeon(249)), "onyxias-lair");
  assert.deepEqual(wingsOf(atlasDungeon(36)), [], "a single-instance dungeon has no wings");
  assert.equal(hasWings(230), false, "Blackrock Depths is one dungeon");
  assert.equal(hasWings(349), false, "Maraudon is one dungeon");
});

test("every boss and rare belongs to one wing at most, and only with a source", () => {
  const names = (key) => withAtlasWingDetail(null, key).atlas.bosses.map((boss) => boss.name);
  assert.deepEqual(names("scarlet-monastery:graveyard"), ["Interrogator Vishas", "Bloodmage Thalnos"]);
  assert.deepEqual(names("scarlet-monastery:library"), ["Houndmaster Loksey", "Arcanist Doan"]);
  assert.deepEqual(names("scarlet-monastery:armory"), ["Herod"]);
  assert.deepEqual(names("scarlet-monastery:cathedral"), ["High Inquisitor Fairbanks", "High Inquisitor Whitemane"]);
  assert.deepEqual(withAtlasWingDetail(null, "scarlet-monastery:graveyard").atlas.rares.map((rare) => rare.name).sort(),
    ["Azshir the Sleepless", "Fallen Champion", "Ironspine"]);
  assert.deepEqual(names("dire-maul:north").at(-1), "King Gordok");
  assert.ok(names("dire-maul:west").includes("Tsu'zee"));
  assert.deepEqual(names("stratholme:undead").at(-1), "Postmaster Malown");
  assert.ok(names("stratholme:live").includes("Balnazzar"));
  assert.ok(names("blackrock-spire:upper").includes("General Drakkisath"));
  assert.ok(names("blackrock-spire:lower").includes("Overlord Wyrmthalak"));

  for (const id of [189, 229, 329, 429]) {
    const dungeon = atlasDungeon(id);
    const wings = wingsOf(dungeon);
    const owned = wings.flatMap((wing) => [...wing.bosses, ...wing.rares]);
    assert.equal(new Set(owned).size, owned.length, `${dungeon.name}: no boss in two wings`);
    const unassigned = unassignedOf(dungeon);
    assert.equal(owned.length + unassigned.bosses.length + unassigned.rares.length, dungeon.bosses.length + dungeon.rares.length, "nothing lost");
    // Every NPC a wing names is one the atlas lists, and every one has a source.
    for (const definition of wingDefinitions(id)) {
      for (const [npcId, sources] of Object.entries({ ...definition.bosses, ...definition.rares })) {
        assert.ok([...dungeon.bosses, ...dungeon.rares].some((entry) => entry.npcId === Number(npcId)), `${dungeon.name}: NPC ${npcId} is in the atlas`);
        assert.ok(sources.length > 0);
      }
    }
  }
  // What no source places in a wing stays on the dungeon.
  assert.deepEqual(unassignedOf(atlasDungeon(429)).bosses.map((boss) => boss.name), ["Lord Hel'nurath"]);
  assert.deepEqual(unassignedOf(atlasDungeon(329)).bosses.map((boss) => boss.name).sort(),
    ["Black Guard Swordsmith", "Crimson Hammersmith", "Ezra Grimm", "Skul", "Stonespine"]);
  assert.deepEqual(unassignedOf(atlasDungeon(229)).rares.map((rare) => rare.name), ["Burning Felguard"]);
  assert.deepEqual(withAtlasWingDetail(null, "stratholme:live").atlas.unassigned.bosses.length, 5);
});

test("levels, floors and entrances come from their sources; none are invented", () => {
  const detail = (key) => withAtlasWingDetail(null, key);
  const library = detail("scarlet-monastery:library");
  assert.deepEqual([library.atlas.levelMin, library.atlas.levelMax, library.atlas.levelSource], [32, 40, "instance-journal"]);
  assert.deepEqual(library.atlas.floors, [{ name: "Library", source: "openmap" }]);
  assert.deepEqual(library.atlas.entrances.map((entry) => entry.areaTriggerId), [614], "the entrance the atlas names after the wing");
  assert.equal(library.atlas.entrancesShared, false);
  assert.deepEqual(detail("dire-maul:west").atlas.floors.map((floor) => floor.name), ["Capital Gardens", "Court of the Highborne", "Prison of Immol'Thar"]);
  assert.deepEqual(detail("dire-maul:north").atlas.entrances.map((entry) => entry.areaTriggerId), [3189]);
  assert.deepEqual([detail("dire-maul:east").atlas.levelMin, detail("dire-maul:east").atlas.levelSource], [54, "wago-classic-era"]);
  assert.deepEqual(detail("stratholme:undead").atlas.floors.map((floor) => floor.name), ["The Gauntlet"]);
  const strat = detail("stratholme:live").atlas;
  assert.deepEqual([strat.levelMin, strat.levelMax, strat.levelSource], [56, 60, "parent"], "no source gives the half its own band");
  assert.equal(strat.entrancesShared, true, "which entrance is which half is not sourced");
  assert.equal(strat.entrances.length, atlasDungeon(329).entrances.length);
  // OpenMap's Blackrock Spire floors all say Lower (retail's grouping): not used.
  assert.deepEqual(detail("blackrock-spire:upper").atlas.floors, []);
  assert.deepEqual(detail("blackrock-spire:lower").atlas.floors, []);
  // The map is the dungeon's spawn layout; the wing pins only its bosses.
  assert.deepEqual(library.atlas.maps, atlasDungeon(189).maps);
  for (const line of library.atlas.provenance) assert.ok(line.source && line.tier && line.confidence, "every fact says where it came from");
  assert.ok(library.atlas.provenance.some((line) => line.source === "dungeon-planner"));
  assert.ok(library.atlas.provenance.some((line) => line.source === "instance-journal"));
});

test("reference loot follows its boss; quests, trash and chest loot are shared, never a wing's own", () => {
  const reference = referenceDungeon(189);
  const herodIds = reference.bosses.find((boss) => boss.npcId === 3975).itemIds;
  const doanIds = reference.bosses.find((boss) => boss.npcId === 6487).itemIds;
  const library = withAtlasWingDetail(null, "scarlet-monastery:library").atlas;
  const doan = library.bosses.find((boss) => boss.name === "Arcanist Doan");
  assert.deepEqual(doan.referenceLoot.map((item) => item.itemId).sort(), [...doanIds].sort(), "the boss keeps its reference loot");
  const sharedIds = new Set(reference.dungeonLoot.map((entry) => entry.itemId));
  const [library2] = atlasWingEntries().filter((entry) => entry.dungeonKey === "scarlet-monastery:library");
  for (const id of herodIds) if (!sharedIds.has(id)) assert.ok(!library2.atlas.referenceItemIds.includes(id), `Herod's ${id} is not the Library's`);
  for (const id of doanIds) assert.ok(library2.atlas.referenceItemIds.includes(id));
  assert.ok(library.dungeonLoot.length > 0 && library.dungeonLoot.every((item) => item.wingAttribution === "shared"), "trash loot: shared");
  assert.ok(library.quests.length === atlasDungeon(189).quests.length && library.quests.every((quest) => quest.wingAttribution === "shared"),
    "no source attributes a quest to a wing: every quest is shared");
  assert.ok(library.creatures.every((creature) => creature.wingAttribution === "shared"));
  assert.equal(library2.atlas.sharedQuestCount, library.quests.length);
});

test("observed loot: a wing keeps its bosses' and the shared sources, never a sibling's", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, { id: "discord-wings-ash", username: "ash" });
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  assert.equal((await corpseLoot(request, ash.token, { npcId: 6487, npcName: "Arcanist Doan", serial: 1, items: [ITEMS.staff], instance: SM })).status, 201);
  assert.equal((await corpseLoot(request, ash.token, { npcId: 3975, npcName: "Herod", serial: 2, items: [ITEMS.barb], instance: SM })).status, 201);
  assert.equal((await corpseLoot(request, ash.token, { npcId: 4295, npcName: "Scarlet Myrmidon", serial: 3, items: [ITEMS.cape], instance: SM })).status, 201);
  const get = async (id) => request(`/api/player/loot/dungeons/${encodeURIComponent(id)}`, { rawCookie: ash.cookie });

  // The old numeric link: the whole dungeon, exactly as before.
  const parent = (await get(189)).json;
  assert.equal(parent.instance.instanceId, 189);
  assert.equal(parent.wing, undefined, "never sent to an arbitrary wing");
  assert.equal(parent.atlas.bosses.length, atlasDungeon(189).bosses.length, "every boss");
  assert.equal(parent.sources.length, 3, "every observed source");
  assert.deepEqual(parent.atlas.wingEntries.map((entry) => entry.dungeonKey), EXPECTED_KEYS.slice(0, 4), "the overview lists its wings");
  assert.equal(parent.atlas.dungeonKey, "scarlet-monastery");
  assert.deepEqual((await get("scarlet-monastery")).json.atlas.bosses.length, parent.atlas.bosses.length, "the dungeon key is the same dungeon");

  const library = (await get("scarlet-monastery:library")).json;
  assert.equal(library.instance.instanceId, 189, "the wing's catalog instance is the game's");
  assert.equal(library.wing.dungeonKey, "scarlet-monastery:library");
  assert.deepEqual(library.sources.map((source) => [source.name, source.wingAttribution]).sort(),
    [["Arcanist Doan", "wing"], ["Scarlet Myrmidon", "shared"]], "Herod's loot is the Armory's");
  assert.equal(library.wing.sourcesLeftOut, 1);
  assert.deepEqual(library.atlas.bosses.find((boss) => boss.name === "Arcanist Doan").loot, ["i:5201"]);
  const armory = (await get("scarlet-monastery:armory")).json;
  assert.deepEqual(armory.sources.map((source) => source.name).sort(), ["Herod", "Scarlet Myrmidon"]);

  assert.equal((await get("scarlet-monastery:crypt")).status, 404, "an unknown wing");
  assert.equal((await get("not-a-dungeon")).status, 404);
  assert.equal((await get("189:library")).status, 404);
  assert.equal((await get("deadmines")).json.instance.instanceId, 36, "a single dungeon by key");

  // The list: the dungeon's own entry is unchanged; wings are an addition.
  const list = (await request("/api/player/loot/dungeons", { rawCookie: ash.cookie })).json;
  const smEntry = list.dungeons.find((entry) => entry.instanceId === 189);
  assert.equal(smEntry.name, "Scarlet Monastery");
  assert.equal(smEntry.atlas.bossCount, atlasDungeon(189).bosses.length);
  assert.deepEqual(list.atlasWings.map((entry) => entry.dungeonKey), EXPECTED_KEYS);
  assert.equal(list.atlasWings.find((entry) => entry.dungeonKey === "scarlet-monastery:library").atlas.bossCount, 2);
  assert.ok(list.atlasWings.find((entry) => entry.dungeonKey === "scarlet-monastery:library").atlas.bossNpcIds.includes(6487));

  // The wishlist works from a wing as before: its source is the game's instance.
  const rook = (await request("/api/player/characters", { rawCookie: ash.cookie })).json.characters?.[0]?.id
    || withGuildDatabase((db) => db.prepare("SELECT id FROM characters LIMIT 1").get()?.id);
  const put = await request(`/api/player/wishlists/${rook}/items/i:5201`, { method: "PUT", rawCookie: ash.cookie,
    body: { sourceDungeon: library.instance.name, sourceInstanceId: library.instance.instanceId } });
  assert.equal(put.status, 200, put.text);
  const wish = (await request(`/api/player/wishlists/${rook}`, { rawCookie: ash.cookie })).json.items.find((item) => item.itemKey === "i:5201");
  assert.ok(wish, "on the wishlist");
  assert.ok((wish.sources || []).some((source) => Number(source.instanceId) === 189), "sourced to instance 189");
}));

test("resolving dungeon ids: numbers, dungeon keys and wing keys", () => {
  assert.deepEqual(resolveDungeonId("189"), { instanceId: 189, wingKey: null });
  assert.deepEqual(resolveDungeonId(189), { instanceId: 189, wingKey: null });
  assert.deepEqual(resolveDungeonId("Scarlet-Monastery:Library"), { instanceId: 189, wingKey: "scarlet-monastery:library" });
  assert.deepEqual(resolveDungeonId("dire-maul"), { instanceId: 429, wingKey: null });
  for (const bad of ["", "189:x", "../etc", "scarlet monastery", "a".repeat(200), "deadmines:wing"]) assert.equal(resolveDungeonId(bad), null, bad);
});

test("a run's wing comes only from its boss kills; stored runs are never rewritten", () => withHttpApp(async ({ request }) => {
  const ash = await connect(request, { id: "discord-wings-runs", username: "ash" });
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  let sequence = 0;
  const upload = (runId, checkpoints, instance = SM) => {
    sequence += 1;
    const envelope = structuredClone(v2);
    Object.assign(envelope.payload, { runId, instance: { ...instance, maxPlayers: 5 }, status: "abandoned", endReason: "left_instance",
      checkpoints, completion: { basis: "none" }, bosses: { ...envelope.payload.bosses, defeated: checkpoints.filter((entry) => entry.kind === "boss").length,
        total: 4, list: {} } });
    return post(request, ash.token, { streamKey: `dungeon_run:${envelope.characterId}:${runId}`, kind: "event", revision: sequence, envelope });
  };
  const boss = (encounterId, name, at) => ({ id: `boss:${encounterId}`, kind: "boss", at, name, encounterId, source: "encounter_end" });
  for (const [runId, checkpoints] of [
    ["run-library", [boss(446, "Houndmaster Loksey", 100), boss(447, "Arcanist Doan", 300)]],
    ["run-two-wings", [boss(444, "Interrogator Vishas", 100), boss(450, "High Inquisitor Whitemane", 300)]],
    ["run-no-kills", []],
    ["run-split-only", [{ id: "split:door", kind: "split", at: 50, name: "Herod", source: "manual" }]],
  ]) {
    const response = await upload(runId, checkpoints);
    assert.ok([200, 201].includes(response.status), response.text);
  }
  const before = withGuildDatabase((db) => db.prepare("SELECT * FROM dungeon_runs ORDER BY id").all());

  const runs = (await request("/api/player/dungeon-runs", { rawCookie: ash.cookie })).json.runs;
  const byId = Object.fromEntries(runs.map((run) => [run.runId, run]));
  assert.deepEqual(byId["run-library"].dungeon.wing, { dungeonKey: "scarlet-monastery:library", wing: "Library", name: "Scarlet Monastery — Library",
    evidence: "boss_kills", bosses: ["Houndmaster Loksey", "Arcanist Doan"] });
  assert.equal(byId["run-library"].dungeon.dungeonKey, "scarlet-monastery:library");
  assert.equal(byId["run-library"].dungeon.instanceId, 189, "the game's instance ID is kept");
  assert.equal(byId["run-library"].dungeon.name, "Scarlet Monastery", "and the old fields");
  for (const runId of ["run-two-wings", "run-no-kills", "run-split-only"]) {
    assert.equal(byId[runId].dungeon.wing, null, `${runId} stays on its dungeon`);
    assert.equal(byId[runId].dungeon.dungeonKey, "scarlet-monastery");
  }
  const detail = (await request(`/api/player/dungeon-runs/${byId["run-library"].id}`, { rawCookie: ash.cookie })).json.run;
  assert.equal(detail.dungeon.wing.dungeonKey, "scarlet-monastery:library");
  const after = withGuildDatabase((db) => db.prepare("SELECT * FROM dungeon_runs ORDER BY id").all());
  assert.deepEqual(after, before, "reading never writes a run");
}));

test("boss kills prove a wing only when they agree", () => {
  const sm = atlasDungeon(189);
  assert.equal(wingForKills(sm, [{ encounterId: 448, name: "Herod" }]).dungeonKey, "scarlet-monastery:armory");
  assert.equal(wingForKills(sm, [{ name: "herod" }]).dungeonKey, "scarlet-monastery:armory", "by name when the id is missing");
  assert.equal(wingForKills(sm, [{ encounterId: 448 }, { encounterId: 449 }]), null, "two wings");
  assert.equal(wingForKills(sm, []), null);
  // Kills of unassigned bosses say nothing either way.
  const strat = atlasDungeon(329);
  assert.equal(wingForKills(strat, [{ name: "Skul" }]), null);
  assert.equal(wingForKills(strat, [{ name: "Skul" }, { name: "Baron Rivendare" }]).dungeonKey, "stratholme:undead");
  assert.equal(wingForKills(atlasDungeon(36), [{ name: "Edwin VanCleef" }]), null, "no wings, no wing");
});

test("the checked-in wing manifest is generated from atlasWings.js and current", () => {
  const checkedIn = fs.readFileSync(new URL("../src/Atlas/data/wing-manifest.json", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
  assert.equal(checkedIn, wingManifestText(), "run node scripts/exportWingManifest.mjs");
  const manifest = buildWingManifest();
  assert.deepEqual(manifest.dungeons.flatMap((dungeon) => dungeon.wings.map((wing) => wing.dungeonKey)), EXPECTED_KEYS);
  assert.equal(manifest.dungeons.length, atlasDungeon(36) ? 26 : 0, "every atlas dungeon has its key");
  assert.equal(manifest.dungeons.find((dungeon) => dungeon.instanceId === 36).dungeonKey, "deadmines");
  const library = manifest.dungeons.find((dungeon) => dungeon.instanceId === 189).wings.find((wing) => wing.slug === "library");
  assert.deepEqual(library.bosses.map((boss) => [boss.encounterId, boss.npcId]), [[446, 3974], [447, 6487]]);
  assert.deepEqual(library.entrances.map((place) => place.areaTriggerId), [614]);
  assert.deepEqual(manifest.dungeons.find((dungeon) => dungeon.instanceId === 429).unassigned.bosses.map((boss) => boss.name), ["Lord Hel'nurath"]);
  assert.deepEqual(buildWingManifest(), manifest, "deterministic");
});

test("a run that carries the add-on's optional wing evidence is accepted unchanged", () => {
  const event = (payload) => ({ kind: "event", envelope: { ...v2, payload: { ...v2.payload, ...payload } } });
  assert.equal(validDungeonRun(event({})), true);
  assert.equal(validDungeonRun(event({ wing: { dungeonKey: "scarlet-monastery:library", evidence: "boss_kill", encounterId: 447 } })), true);
  assert.equal(validDungeonRun(event({ wing: null })), true, "an unresolved wing");
});
