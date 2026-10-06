import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeArmoryEquipment } from "../src/Character/armorySanitizer.js";
import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import {
  normalizeEquipment,
  normalizeProfessions,
  normalizeRecipes,
  normalizeTalents,
  readIntelligenceSummary,
  searchCraftFinder,
} from "../src/Character/telemetryProjection.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

test("telemetry normalizers accept alternate and malformed optional shapes", () => {
  const professions = normalizeProfessions({
    professions: [
      { id: "164", displayName: "Blacksmithing", current: "100", max: "225", modifier: "3", icon: { fileDataID: "42" } },
      { professionID: 164, name: "Duplicate", skillLevel: 1 },
      { name: "Alchemy", rank: 75, maximum: 150, specialization: { name: "Elixirs" } },
      null,
      {},
    ],
  });
  assert.equal(professions.length, 2);
  assert.equal(professions[0].id, 164);
  assert.equal(professions[0].iconFileId, 42);
  assert.equal(professions[0].current, 100);
  assert.equal(professions[1].name, "Alchemy");

  const recipes = normalizeRecipes(
    {
      recipes: [
        {
          id: 77,
          displayName: "Top Recipe",
          profession: { id: 171, name: "Alchemy" },
          known: false,
          requirements: { skill: 50 },
          craftedItem: { id: 88, displayName: "Potion" },
          materials: [{ id: 99, displayName: "Herb", count: 2 }],
        },
      ],
    },
    professions,
  );
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].known, false);
  assert.equal(recipes[0].professionId, 171);
  assert.equal(recipes[0].requiredSkill, 50);
  assert.equal(recipes[0].craftedItemId, 88);
  assert.equal(recipes[0].reagents[0].quantity, 2);

  const equipment = sanitizeArmoryEquipment(normalizeEquipment({
    equipment: {
      slots: [
        { inventorySlot: "CHEST", id: "123", itemName: "Old Chest", level: "19", modifiers: ["old"] },
        null,
      ],
    },
  }));
  assert.equal(equipment.length, 1);
  assert.equal(equipment[0].slot, "CHEST");
  assert.equal(equipment[0].itemId, 123);
  assert.equal(equipment[0].itemLevel, 19);

  const talents = normalizeTalents({
    specialization: { id: 63, name: "Fire" },
    talentTree: {
      treeId: "12",
      selectedEntryID: 4,
      nodes: [
        {
          id: 1,
          position: { x: "2", y: "3" },
          selectedEntryID: 4,
          entries: [
            { id: 4, definitionId: "5", spellId: "6", displayName: "Hot Stuff", tooltip: "Burns.", ranks: "2" },
          ],
        },
      ],
      connections: [
        { source: "1", target: "2", required: false },
        { source: null, target: 2 },
      ],
    },
  });
  assert.equal(talents.treeId, 12);
  assert.equal(talents.specId, 63);
  assert.equal(talents.nodes[0].entries[0].selected, true);
  assert.equal(talents.nodes[0].entries[0].description, "Burns.");
  assert.equal(talents.edges.length, 1);
  assert.equal(talents.edges[0].required, false);
});

test("legacy summary and craft projections remain readable for compatibility", async () => {
  await withHttpApp(async () => {
    await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: {
        schemaVersion: 1,
        capturedAt: 1791255600,
        guid: "Player-1-PROJECTION-BRANCH",
        name: "Projection",
        realmName: "Branch Realm",
        region: "US",
        level: 20,
        race: "Human",
        class: "Paladin",
        spec: "Holy",
        organization: { id: "sister-guild", name: "Sister Guild" },
        gameVersion: { build: "branch-build" },
        professions: [
          {
            id: 164,
            name: "Blacksmithing",
            current: 150,
            max: 225,
            recipes: [
              {
                id: 444,
                name: "Branch Blade",
                known: true,
                professionId: 164,
                craftedItemId: 445,
                craftedItemName: "Branch Blade",
              },
            ],
          },
        ],
      },
    });

    const summary = readIntelligenceSummary();
    assert.equal(summary.characters.length, 1);
    assert.equal(summary.characters[0].organizationName, "Sister Guild");
    assert.equal(summary.professions[0].name, "Blacksmithing");
    assert.equal(summary.summary.recipeCount, 1);

    const craft = searchCraftFinder("branch");
    assert.equal(craft.length, 1);
    assert.equal(craft[0].recipe.name, "Branch Blade");
    assert.equal(craft[0].crafters[0].name, "Projection");
  });
});
