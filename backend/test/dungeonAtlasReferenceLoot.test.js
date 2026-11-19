import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifySpell } from "../src/Atlas/atlasContent.js";
import { cleanObjective, curateItem, extractQuestDetails, extractReferenceLoot, normalizeReferenceLoot, referenceItemOf, referenceLootProblems,
  REFERENCE_KINDS } from "../src/Atlas/atlasLoot.js";
import { loadAtlas } from "../src/Atlas/atlasRepository.js";
import { loadReferenceData } from "../src/Atlas/atlasData.js";
import { referenceItem, referenceItemFacts, referenceSourcesOf } from "../src/Atlas/referenceLoot.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { ITEMS, connect, corpseLoot, seedItems, syncCharacter } from "../testSupport/lootHarness.js";

// Classic reference loot and quest details: real item ids from the Classic
// Era client, linked to bosses by AzerothCore's loot tables, never claimed
// for Forever, with the loot catalog's own observations winning.

const DATA = new URL("../src/Atlas/data/", import.meta.url);
const readSource = (name) => JSON.parse(readFileSync(new URL(`sources/${name}`, DATA), "utf8"));
const item = (fields) => ({ id: 1, name: "Item", quality: 2, icon: 1, classId: 4, subclassId: 1, inventoryType: 5, itemLevel: 20, requiredLevel: 15, allowableClass: -1,
  bonding: 1, armor: 30, resistances: [0, 0, 0, 0, 0, 0], minDamage: 0, maxDamage: 0, delay: 0, stats: [], randomStats: false, itemSet: 0, setName: null,
  startQuestId: 0, ...fields });
const lootRow = (Entry, Item, extra = {}) => ({ Entry: String(Entry), Item: String(Item), Reference: "0", Chance: "10", QuestRequired: "0", LootMode: "1", ...extra });

test("curation keeps gear, sets, rares, materials and quest starters; drops the rest", () => {
  assert.equal(curateItem(item({})), "gear");
  assert.equal(curateItem(item({ bonding: 2 })), "boe");
  assert.equal(curateItem(item({ quality: 1, itemSet: 161 })), "set", "a set piece of any quality");
  assert.equal(curateItem(item({ quality: 1 })), null, "white gear");
  assert.equal(curateItem(item({ quality: 0 })), null, "grey gear");
  assert.equal(curateItem(item({ classId: 7, inventoryType: 0, quality: 2 })), "material");
  assert.equal(curateItem(item({ classId: 7, inventoryType: 0, quality: 1 })), null, "plain trade goods");
  assert.equal(curateItem(item({ classId: 0, inventoryType: 0, quality: 1 })), null, "consumables");
  assert.equal(curateItem(item({ classId: 12, inventoryType: 0, quality: 1, startQuestId: 373 })), "other", "starts a quest");
  assert.equal(curateItem(item({ classId: 9, inventoryType: 0, quality: 3 })), "other", "a rare recipe");
  assert.equal(curateItem(item({ classId: 11, inventoryType: 18, quality: 2 })), "other", "a quiver");
  assert.equal(curateItem(item({ name: null })), null);
});

test("item facts: only what the client row says, null when unknown", () => {
  const names = { classNames: new Map([[2, "Weapon"], [4, "Armor"]]), subclassNames: new Map([["2:7", "One-Handed Swords"], ["4:2", "Leather"]]) };
  const sword = referenceItemOf(item({ id: 5191, name: "Cruel Barb", quality: 3, classId: 2, subclassId: 7, inventoryType: 13, armor: 0, minDamage: 30,
    maxDamage: 57, delay: 2800 }), names);
  assert.deepEqual([sword.slot, sword.itemClass, sword.itemSubclass, sword.armor, sword.bindType, sword.classes], ["One-Hand", "Weapon", "One-Handed Swords", null, "BoP", null]);
  assert.deepEqual(sword.weapon, { minDamage: 30, maxDamage: 57, speed: 2.8, dps: 15.5 });
  assert.deepEqual(sword.stats, [], "known: no stats");
  assert.ok(!("dropChance" in sword));
  const chest = referenceItemOf(item({ subclassId: 2, armor: 92, stats: [[7, 11], [3, 3]], resistances: [0, 5, 0, 0, 0, 0], allowableClass: 8 | 1024, itemSet: 161,
    setName: "Defias Leather" }), names);
  assert.deepEqual(chest.stats, [{ stat: "Stamina", value: 11 }, { stat: "Agility", value: 3 }, { stat: "Fire Resistance", value: 5 }]);
  assert.deepEqual([chest.armor, chest.weapon, chest.setName, chest.kind], [92, null, "Defias Leather", "set"]);
  assert.deepEqual(chest.classes, ["Rogue", "Druid"]);
  assert.equal(referenceItemOf(item({ allowableClass: 32767 })).classes, null, "every class: no restriction");
  assert.equal(referenceItemOf(item({ randomStats: true, stats: [] })).stats, null, "a random suffix: stats unknown");
  assert.equal(referenceItemOf(item({ stats: [[45, 10]] })).stats, null, "a stat this reader cannot name: unknown, not partial");
  assert.deepEqual([referenceItemOf(item({ requiredLevel: 0, itemLevel: 0, icon: null })).requiredLevel, referenceItemOf(item({ icon: null })).iconFileDataId], [null, null]);
});

test("extraction: references resolve, world drops and quest objectives stay out, chests are their own source", () => {
  const items = [item({ id: 10 }), item({ id: 11 }), item({ id: 12 }), item({ id: 13, quality: 0 }), item({ id: 14 }), item({ id: 15 })];
  const extract = () => extractReferenceLoot({
    lootRows: [lootRow(639, 10), lootRow(639, 0, { Reference: "900" }), lootRow(639, 13), lootRow(639, 14, { QuestRequired: "1" }), lootRow(5000, 11)],
    referenceRows: [lootRow(900, 12), lootRow(900, 11)],
    templateRows: [{ entry: "639", name: "Edwin VanCleef", rank: "1", lootid: "639" }, { entry: "5000", name: "Outdoor Ogre", rank: "0", lootid: "5000" }],
    spawnRows: [{ id1: "639", map: "36" }, { id1: "5000", map: "0" }],
    objectTemplateRows: [{ entry: "179703", type: "3", name: "Cache of the Firelord", Data1: "16719" }, { entry: "1", type: "0", name: "Door", Data1: "16719" }],
    objectRows: [{ id: "179703", map: "409" }],
    objectLootRows: [lootRow(16719, 15)],
    items,
  });
  const out = extract();
  assert.deepEqual(out.creature_loot, [[639, 10], [639, 12]], "11 also drops outdoors (world drop); 13 is grey; 14 is a quest objective");
  assert.deepEqual(out.creatures, [[639, "Edwin VanCleef", 1, [36]]]);
  assert.deepEqual(out.object_loot, [[179703, 15]]);
  assert.deepEqual(out.objects, [[179703, "Cache of the Firelord", [409]]]);
  assert.deepEqual(extract(), out, "repeatable");
  const anchored = extractReferenceLoot({ lootRows: [lootRow(11502, 10)], templateRows: [{ entry: "11502", name: "Ragnaros", rank: "3", lootid: "11502" }],
    items, anchors: new Map([[11502, 409]]) });
  assert.deepEqual(anchored.creature_loot, [[11502, 10]], "a summoned boss is placed by the atlas");
});

test("quest details: objective, prerequisite, rewards and giver spawns", () => {
  const details = extractQuestDetails({
    questRows: [{ ID: "166", LogTitle: "The Defias Brotherhood", LogDescription: "Kill Edwin VanCleef and bring his head to Gryan Stoutmantle.", RewardItem1: "0",
      RewardChoiceItemID1: "6087", RewardChoiceItemID2: "2041" }, { ID: "155", LogTitle: "The Defias Brotherhood" }],
    addonRows: [{ ID: "166", PrevQuestID: "155" }], starterRows: [{ id: "234", quest: "166" }],
    spawnRows: [{ id1: "234", map: "0", position_x: "-10508.9", position_y: "1047.3" }], questIds: [166],
  });
  assert.deepEqual(details.quest_details, [{ ID: 166, objective: "Kill Edwin VanCleef and bring his head to Gryan Stoutmantle.", prevQuestId: 155, rewardItems: [],
    choiceItems: [6087, 2041] }]);
  assert.deepEqual(details.quest_names, [[155, "The Defias Brotherhood"]]);
  assert.deepEqual(details.quest_giver_spawns, [[234, 0, -10508.9, 1047.3]]);
  assert.equal(cleanObjective("Bring 10 Linen to $N.$B$BThen talk to $g him:her;."), "Bring 10 Linen to <name>. Then talk to him/her.");
  assert.equal(cleanObjective("  "), null);
});

test("the checked-in reference loot is current, sourced and free of drop chances", () => {
  const { atlas } = loadAtlas();
  const reference = loadReferenceData();
  assert.deepEqual(referenceLootProblems(reference, atlas), []);
  const regenerated = normalizeReferenceLoot({ atlas, loot: readSource("azerothcore-loot.json"), items: readSource("wago-classic-era-items.json"),
    planner: readSource("dungeonplanner-loot.json"), generatedAt: reference.generatedAt });
  assert.deepEqual(JSON.parse(JSON.stringify(regenerated)), reference, "run node scripts/importDungeonAtlas.mjs");
  assert.deepEqual(normalizeReferenceLoot({ atlas, loot: readSource("azerothcore-loot.json"), items: readSource("wago-classic-era-items.json"),
    planner: readSource("dungeonplanner-loot.json"), generatedAt: reference.generatedAt }), regenerated, "idempotent");
  // No drop chance anywhere: no key that names one, in the data or its extract.
  const chanceKeys = (text) => [...text.matchAll(/"([^"]*chance[^"]*)"\s*:/gi)].map((match) => match[1]);
  assert.deepEqual(chanceKeys(readFileSync(new URL("reference-loot.json", DATA), "utf8")), []);
  assert.deepEqual(chanceKeys(readFileSync(new URL("sources/azerothcore-loot.json", DATA), "utf8")), []);
  assert.deepEqual(chanceKeys(readFileSync(new URL("sources/dungeonplanner-loot.json", DATA), "utf8")), []);

  // Provenance: the Classic client for facts; the emulator and DungeonPlanner
  // (Wowhead Classic drop lists) for who drops it.
  assert.deepEqual(reference.provenance.map((line) => [line.source, line.tier]), [["wago-classic-era", "classic-reference"], ["azerothcore", "community-unverified"],
    ["dungeon-planner", "community-unverified"]]);
  assert.ok(reference.provenance.every((line) => line.revision && line.retrievedAt && line.url));
  assert.ok(reference.sources.every((source) => source.license && source.revision));

  // No duplicate ids, every kind known, nothing claims Forever.
  const ids = Object.values(reference.items).map((entry) => entry.itemId);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of Object.values(reference.items)) {
    assert.ok(REFERENCE_KINDS.includes(entry.kind));
    assert.ok(!("observed" in entry) && !("verifiedForForever" in entry), "per-response fields are not stored");
  }
  for (const dungeon of reference.dungeons) assert.equal(new Set(dungeon.itemIds).size, dungeon.itemIds.length, `${dungeon.name}: unique item ids`);
  assert.ok(ids.length > 1000, "a meaningful catalog");
});

test("bosses, rares and trash are linked to the right dungeon", () => {
  const reference = loadReferenceData();
  const { atlas } = loadAtlas();
  const deadmines = reference.dungeons.find((dungeon) => dungeon.instanceId === 36);
  const vancleef = deadmines.bosses.find((boss) => boss.npcId === 639);
  assert.equal(atlas.dungeons.find((d) => d.instanceId === 36).bosses.find((boss) => boss.encounterId === vancleef.encounterId).name, "Edwin VanCleef");
  for (const id of [5191, 5193, 5202, 10399]) assert.ok(vancleef.itemIds.includes(id), `VanCleef drops ${id}`);
  assert.equal(reference.items[10399].setName, "Defias Leather");
  assert.equal(reference.items[10399].kind, "set");
  assert.ok(deadmines.dungeonLoot.some((entry) => reference.items[entry.itemId].setName === "Defias Leather"), "set pieces from trash");
  const smite = deadmines.bosses.find((boss) => boss.npcId === 646);
  assert.ok(smite.itemIds.includes(7230), "Smite's Mighty Hammer");
  assert.ok(!smite.itemIds.includes(5191), "a boss keeps its own loot");
  // Every listed boss is the atlas's boss of that dungeon, every rare its rare.
  for (const dungeon of reference.dungeons) {
    const atlasDungeon = atlas.dungeons.find((d) => d.instanceId === dungeon.instanceId);
    for (const boss of dungeon.bosses) assert.ok(atlasDungeon.bosses.some((entry) => entry.encounterId === boss.encounterId));
    for (const rare of dungeon.rares) assert.ok(atlasDungeon.rares.some((entry) => entry.npcId === rare.npcId));
  }
  const moltenCore = reference.dungeons.find((dungeon) => dungeon.instanceId === 409);
  // Majordomo's chest: the emulator's Cache of the Firelord holds exactly the
  // drops DungeonPlanner lists for him, so the chest is his.
  const majordomo = moltenCore.bosses.find((boss) => boss.npcId === 12018);
  assert.deepEqual(majordomo.chests, [{ objectId: 179703, name: "Cache of the Firelord" }], "the chest's name is kept");
  assert.ok(majordomo.sources.azerothcore.includes(18646) && majordomo.sources["dungeon-planner"].includes(18646), "both sources, the emulator through the chest");
  assert.ok(!moltenCore.dungeonLoot.some((entry) => entry.itemId === 18646), "never shared trash as well");
  // A chest no boss's list explains stays shared loot under its own name.
  const depths = reference.dungeons.find((dungeon) => dungeon.instanceId === 230);
  assert.ok(depths.dungeonLoot.some((entry) => (entry.sources || []).some((source) => source.objectId && source.name === "Secret Safe")), "chest loot under the chest's name");
  assert.deepEqual(referenceSourcesOf(5193).map((source) => [source.instanceId, source.bossName, source.sourceType, source.reference]),
    [[36, "Edwin VanCleef", "boss", true]]);
});

test("quests: rewards and prerequisites resolve, unknowns stay null", () => {
  const { atlas } = loadAtlas();
  const reference = loadReferenceData();
  let rewards = 0;
  for (const dungeon of atlas.dungeons) {
    for (const quest of dungeon.quests) {
      for (const key of ["objective", "prerequisites", "rewards", "location", "provenance"]) assert.ok(key in quest, `${quest.questId} has ${key}`);
      for (const reward of quest.rewards) {
        rewards += 1;
        assert.ok(reference.items[reward.itemId], `quest ${quest.questId} reward ${reward.itemId} is a known item`);
        assert.equal(typeof reward.choice, "boolean");
      }
      for (const prerequisite of quest.prerequisites) assert.ok(Number.isSafeInteger(prerequisite.questId) && prerequisite.name, `quest ${quest.questId} prerequisite resolves`);
      if (quest.location?.mapId) assert.ok(quest.location.x >= 0 && quest.location.x <= 1 && quest.location.y >= 0 && quest.location.y <= 1);
      if (!quest.giver) assert.equal(quest.location, null, "no giver, no place");
    }
  }
  assert.ok(rewards > 200);
  const brotherhood = atlas.dungeons.find((d) => d.instanceId === 36).quests.find((quest) => quest.questId === 166);
  assert.equal(brotherhood.objective, "Kill Edwin VanCleef and bring his head to Gryan Stoutmantle.");
  assert.deepEqual(brotherhood.prerequisites, [{ questId: 155, name: "The Defias Brotherhood" }]);
  assert.deepEqual(brotherhood.rewards.map((reward) => [reward.itemId, reward.choice]), [[6087, true], [2041, true], [2042, true]]);
  assert.deepEqual([brotherhood.location.zoneName, brotherhood.location.mapId], ["Westfall", 1436]);
  assert.equal(brotherhood.provenance[0].tier, "community-unverified");
});

test("kick rules follow the client's prevention type and channel flags", () => {
  const spell = (fields) => ({ id: 1, name: "Bolt", description: null, castMs: 2000, passive: false, school: 4, interruptFlags: 15, preventionType: 1, dispelType: 0,
    mechanic: 0, effects: [[2, 0, 6, 0, 0]], ...fields });
  assert.equal(classifySpell(spell({})).interruptible, true);
  assert.equal(classifySpell(spell({ preventionType: 2 })).interruptible, false, "pacify only: a melee ability cannot be kicked");
  assert.equal(classifySpell(spell({ preventionType: 0 })).interruptible, false, "no prevention type: not kickable");
  assert.equal(classifySpell(spell({ castMs: 0 })).interruptible, null, "instant");
  const channel = classifySpell(spell({ castMs: 0, channeled: true, channelInterruptFlags: 0x7C0C }));
  assert.deepEqual([channel.interruptible, channel.category, channel.priority], [true, "interrupt", "high"]);
  assert.match(channel.summary, /^channeled · interruptible/);
  assert.equal(classifySpell(spell({ castMs: 0, channeled: true, channelInterruptFlags: 0 })).interruptible, false);
  assert.equal(classifySpell(spell({ castMs: 0, channeled: true, channelInterruptFlags: 0x7C0C, preventionType: 2 })).interruptible, false);
});

test("problems: duplicates, chances, unknown rewards and Forever claims are caught", () => {
  const atlas = { dungeons: [{ instanceId: 36, name: "Deadmines", bosses: [{ encounterId: 1 }], rares: [], quests: [{ questId: 5, rewards: [{ itemId: 99, choice: false }] }] }] };
  const good = { itemId: 10, itemKey: "i:10", name: "Blade", kind: "gear" };
  const reference = { provenance: [{ source: "wago-classic-era", revision: "r", tier: "classic-reference" }],
    items: { 10: good, 11: { ...good, itemId: 11, itemKey: "i:11", dropChance: 0.5, verifiedForForever: true } },
    dungeons: [{ instanceId: 36, name: "Deadmines", itemIds: [10, 10, 11], bosses: [{ encounterId: 2, itemIds: [10, 12] }], rares: [], dungeonLoot: [] }] };
  const problems = referenceLootProblems(reference, atlas).join("\n");
  for (const pattern of [/drop chance/, /claims observation/, /duplicate item ids/, /boss 2 not in the atlas/, /item 12 unknown/, /reward 99 unknown/]) assert.match(problems, pattern);
  assert.match(referenceLootProblems({ ...reference, provenance: [{ source: "x", revision: "r", tier: "official-client" }] }, atlas).join("\n"), /Classic sources/);
});

test("served reference loot: observed wins, the rest says it is Classic reference", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, { id: "discord-reference-ash", username: "ash" });
  await syncCharacter(request, ash.token, "character-rook", "Rook");
  assert.equal((await corpseLoot(request, ash.token, { npcId: 639, npcName: "Edwin VanCleef", serial: 1, items: [ITEMS.barb] })).status, 201);

  const list = (await request("/api/player/loot/dungeons", { rawCookie: ash.cookie })).json;
  const deadmines = list.dungeons.find((entry) => entry.instanceId === 36).atlas;
  assert.ok(deadmines.referenceLootCount > 20 && deadmines.referenceItemIds.length === deadmines.referenceLootCount);
  assert.ok(deadmines.referenceItemIds.includes(5191) && deadmines.referenceSlots.includes("One-Hand"));
  assert.ok(list.atlasDungeons.every((entry) => Number.isInteger(entry.atlas.referenceLootCount) && Array.isArray(entry.atlas.referenceItemIds)));

  const detail = (await request("/api/player/loot/dungeons/36", { rawCookie: ash.cookie })).json.atlas;
  assert.deepEqual(detail.referenceVersion.dataset, "atlas-reference-loot");
  assert.ok(detail.referenceVersion.revision && detail.referenceVersion.importedAt);
  const vancleef = detail.bosses.find((boss) => boss.atlasName === "Edwin VanCleef");
  const barb = vancleef.referenceLoot.find((entry) => entry.itemId === 5191);
  assert.deepEqual([barb.observed, barb.verifiedForForever, barb.iconFileDataId], [true, true, ITEMS.barb.iconFileDataId], "observed facts win");
  assert.equal(barb.provenance[0].tier, "official-client");
  const overshirt = vancleef.referenceLoot.find((entry) => entry.itemId === 5202);
  assert.deepEqual([overshirt.name, overshirt.observed, overshirt.verifiedForForever], ["Corsair's Overshirt", false, false]);
  assert.ok(overshirt.provenance.every((line) => ["classic-reference", "community-unverified"].includes(line.tier)));
  assert.ok(!("dropChance" in overshirt));
  const order = vancleef.referenceLoot.map((entry) => [entry.qualityId, entry.itemLevel]);
  assert.deepEqual(order, [...order].sort((a, b) => b[0] - a[0] || b[1] - a[1]), "quality, then item level, descending");
  assert.ok(detail.dungeonLoot.every((entry) => "sourceName" in entry && "npcId" in entry));
  assert.ok(detail.rares.every((rare) => Array.isArray(rare.referenceLoot)));
  const quest = detail.quests.find((entry) => entry.questId === 166);
  assert.ok(quest.rewards.every((reward) => reward.itemKey === `i:${reward.itemId}` && reward.choice === true && reward.name));
  assert.deepEqual(vancleef.loot, ["i:5191"], "boss.loot stays the catalog's observed loot");
}));

test("reference items are wishlistable; unknown ids are still refused", () => withHttpApp(async ({ request }) => {
  seedItems();
  const ash = await connect(request, { id: "discord-reference-wish", username: "ash" });
  const rook = await syncCharacter(request, ash.token, "character-rook", "Rook");
  const put = (key, body = {}) => request(`/api/player/wishlists/${rook}/items/${key}`, { method: "PUT", rawCookie: ash.cookie, body });
  assert.equal(referenceItemFacts(5202).name, "Corsair's Overshirt");
  assert.equal((await put("i:5202", { sourceDungeon: "Deadmines", sourceInstanceId: 36 })).status, 200, "a reference-only item");
  assert.equal((await put("i:424242")).status, 422, "an id nobody knows");
  assert.equal((await put("i:987654")).status, 422);

  const list = (await request(`/api/player/wishlists/${rook}`, { rawCookie: ash.cookie })).json;
  const row = list.items.find((entry) => entry.itemId === 5202);
  assert.deepEqual([row.item.name, row.item.nameKnown, row.item.slot, row.item.itemClass], ["Corsair's Overshirt", true, "Chest", "Armor"]);
  assert.equal(row.item.reference.tier, "classic-reference");
  assert.equal(row.item.reference.verifiedForForever, false);
  const source = row.sources.find((entry) => entry.reference);
  assert.deepEqual([source.instanceId, source.dungeonName, source.bossName, source.npcId, source.confidence], [36, "Deadmines", "Edwin VanCleef", 639, "candidate"]);

  const importing = (text) => request(`/api/player/wishlists/${rook}/import`, { method: "POST", rawCookie: ash.cookie, body: { text, commit: false } });
  const doc = (items) => JSON.stringify({ schemaVersion: 1, character: "Rook", items });
  const preview = (await importing(doc([{ itemId: 5193, name: "Cape of the Brotherhood", priority: "high" }, { itemId: 10399, name: "Blackened Defias Armor" }]))).json;
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.entries.map((entry) => entry.itemId), [5193, 10399], "a reference item imports like a catalog item");
  const rejected = (await importing(doc([{ itemId: 987654, name: "Blade of Imagined Glory" }]))).json;
  assert.equal(rejected.errors[0].code, "unknown_item");
  const byName = (await importing(doc([{ name: "Blackened Defias Armor" }]))).json;
  assert.deepEqual(byName.errors[0].candidates.map((candidate) => candidate.itemId), [10399], "a name finds the reference item's id");

  const prompt = (await request(`/api/player/wishlists/${rook}/ai-prompt?dungeons=36`, { rawCookie: ash.cookie })).json.prompt;
  assert.match(prompt, /5202 \| Corsair's Overshirt/);
  assert.match(prompt, /Edwin VanCleef \(boss\) \[Classic reference: not yet observed on Forever\]/);
}));

test("observed-only reads are unchanged for items without reference data", () => {
  assert.equal(referenceItem(424242), null);
  assert.equal(referenceItemFacts(424242), null);
  assert.deepEqual(referenceSourcesOf(424242), []);
});
