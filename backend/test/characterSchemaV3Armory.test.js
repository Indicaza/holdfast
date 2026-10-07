import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { recordTelemetry } from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function v3Snapshot() {
  return {
    schemaVersion: 3,
    capturedAt: 1791262800,
    characterId: "character-v3-rook",
    characterKey: "classic beta pve 2:rook ravenstar",
    firstName: "Rook",
    lastName: "Ravenstar",
    fullName: "Rook Ravenstar",
    name: "Rook Ravenstar",
    realm: "Classic Beta PvE 2",
    region: "US",
    gameBuild: { version: "1.60.1", build: "70245", interface: 16001 },
    level: 22,
    race: { id: 4, name: "Night Elf", token: "NightElf" },
    class: { id: 1, name: "Warrior", token: "WARRIOR" },
    guild: { name: "Holdfast", realm: "Classic Beta PvE 2" },
    equipment: [
      {
        slot: "head",
        slotId: 1,
        itemId: 11746,
        name: "Golem Skull Helm",
        qualityId: 3,
        itemLevel: 35,
        requiredLevel: 20,
        iconFileDataId: 132767,
        enchantId: 17,
        gemItemIds: [1111],
        bonusIds: [2222],
        itemClass: { id: 4, name: "Armor" },
        itemSubclass: { id: 4, name: "Plate" },
        equipLocation: "INVTYPE_HEAD",
        sellPrice: 12345,
        rawItemString: "item:11746:17:1111::::::22:::::::::",
        stats: { ITEM_MOD_STAMINA_SHORT: 8, ITEM_MOD_ARMOR_SHORT: 350 },
        durability: { current: 42, max: 50 },
        spell: { id: 9001, name: "Helm Effect" },
        tooltip: {
          lines: [
            { left: "Golem Skull Helm" },
            { left: "Binds when picked up" },
            { left: "+8 Stamina" },
          ],
        },
      },
    ],
    talents: {
      api: "traits",
      kind: "combat",
      configId: 901,
      treeIds: [1111],
      pointsSpent: 2,
      pointsAvailable: 0,
      allocations: [
        {
          nodeId: 101,
          rank: 2,
          ranksPurchased: 2,
          activeEntryId: 1001,
          activeEntryRank: 2,
        },
      ],
    },
    professions: [
      {
        skillLineId: 164,
        name: "Blacksmithing",
        kind: "primary",
        iconFileDataId: 136241,
        skillLevel: 94,
        maxSkillLevel: 150,
        skillModifier: 5,
        recipes: [
          {
            recipeId: 9789,
            name: "Mithril Spurs",
            known: true,
            iconFileDataId: 132307,
            professionSkillLineId: 164,
            professionName: "Blacksmithing",
            craftedItemId: 7969,
            craftedItemLink: "|cff1eff00|Hitem:7969::::::::22:::::::|h[Mithril Spurs]|h|r",
            reagents: [
              {
                slotIndex: 1,
                quantityRequired: 4,
                required: true,
                reagents: [{ itemId: 3860, quantityRequired: 4 }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function talentDefinition(snapshot) {
  return {
    schemaVersion: 1,
    sourceApi: "traits",
    kind: "combat",
    treeId: 1111,
    rootNodeId: 101,
    class: snapshot.class,
    gameBuild: snapshot.gameBuild,
    nodes: [
      {
        nodeId: 101,
        type: "single",
        position: { x: 3, y: 2 },
        maxRanks: 2,
        entries: [
          {
            entryId: 1001,
            definitionId: 5001,
            spellId: 12975,
            iconFileDataId: 135871,
            name: "Last Stand",
            maxRanks: 2,
          },
        ],
      },
      {
        nodeId: 102,
        type: "single",
        position: { x: 4, y: 3 },
        maxRanks: 1,
        entries: [
          {
            entryId: 1002,
            definitionId: 5002,
            spellId: 12328,
            iconFileDataId: 132306,
            name: "Sweeping Strikes",
            maxRanks: 1,
          },
        ],
      },
    ],
    edges: [{ sourceNodeId: 101, targetNodeId: 102, type: "required" }],
  };
}

test("schema v3 character snapshots retain Armory data and rejoin talent definitions", async () => {
  await withHttpApp(async ({ request }) => {
    const snapshot = v3Snapshot();
    const synced = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot,
      deviceId: "device-v3-armory",
      bridgeRevision: 12,
    });

    assert.equal(synced.status, "created");

    const definition = talentDefinition(snapshot);
    const definitionRecord = recordTelemetry({
      deviceId: "device-v3-armory",
      memberId: memberIds.member,
      idempotencyKey: "talent-definition-v3-1111-1",
      streamKey: "talent_tree_definition:warrior:70245:1111",
      kind: "state",
      revision: 1,
      envelope: {
        schemaVersion: 1,
        eventType: "talent_tree_definition",
        capturedAt: snapshot.capturedAt,
        gameBuild: snapshot.gameBuild,
        realm: snapshot.realm,
        region: snapshot.region,
        payload: definition,
      },
    });
    assert.equal(definitionRecord.status, "created");

    const armory = await request(
      `/api/intelligence/characters/${encodeURIComponent(synced.character.id)}`,
      { persona: "member" },
    );

    assert.equal(armory.status, 200);
    assert.equal(armory.json.character.name, "Rook Ravenstar");
    assert.equal(armory.json.character.firstName, "Rook");
    assert.equal(armory.json.character.lastName, "Ravenstar");

    assert.equal(armory.json.equipment.length, 1);
    const helm = armory.json.equipment[0];
    assert.equal(helm.itemId, 11746);
    assert.equal(helm.quality, 3);
    assert.equal(helm.iconFileId, 132767);
    assert.equal(helm.itemLevel, 35);
    assert.equal(helm.requiredLevel, 20);
    assert.equal(helm.itemSubclassName, "Plate");
    assert.equal(helm.sellPrice, 12345);
    assert.deepEqual(helm.gemIds, [1111]);
    assert.equal(helm.stats.ITEM_MOD_STAMINA_SHORT, 8);
    assert.deepEqual(helm.durability, { current: 42, max: 50 });
    assert.equal(helm.spell.name, "Helm Effect");
    assert.equal(helm.tooltipLines[1].left, "Binds when picked up");

    const blacksmithing = armory.json.professions.find((entry) => entry.name === "Blacksmithing");
    assert.equal(blacksmithing.id, 164);
    assert.equal(blacksmithing.iconFileId, 136241);
    assert.equal(blacksmithing.current, 94);
    assert.equal(blacksmithing.max, 150);

    assert.equal(armory.json.recipes.length, 1);
    assert.equal(armory.json.recipes[0].id, 9789);
    assert.equal(armory.json.recipes[0].reagents[0].itemId, 3860);
    assert.equal(armory.json.recipes[0].reagents[0].quantity, 4);

    assert.equal(armory.json.talents.treeId, 1111);
    assert.equal(armory.json.talents.nodes.length, 2);
    const selected = armory.json.talents.nodes.find((node) => node.id === 101);
    assert.equal(selected.rank, 2);
    assert.equal(selected.selected, true);
    assert.equal(selected.entries[0].spellId, 12975);
    assert.equal(selected.entries[0].iconFileId, 135871);
    assert.equal(selected.entries[0].selected, true);
    assert.equal(armory.json.talents.edges[0].from, 101);
    assert.equal(armory.json.talents.edges[0].to, 102);

    const craftFinder = await request("/api/intelligence/craft-finder?q=spurs", { persona: "member" });
    assert.equal(craftFinder.status, 200);
    assert.equal(craftFinder.json.results.length, 1);
    assert.equal(craftFinder.json.results[0].recipe.name, "Mithril Spurs");
    assert.equal(craftFinder.json.results[0].crafters[0].professionSkill, 94);
  });
});
