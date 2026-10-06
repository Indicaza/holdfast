import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { ensureTelemetryProjectionSchema } from "../src/Character/telemetryProjection.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function richSnapshot() {
  return {
    schemaVersion: 1,
    capturedAt: 1791255600,
    lastSeen: "2026-10-06T03:00:00.000Z",
    guid: "Player-1-ARMORYROOK",
    characterKey: "classic-beta:rook",
    name: "Rook",
    realm: "Classic Beta PvE 2",
    region: "US",
    level: 30,
    race: { id: 4, name: "Night Elf" },
    class: { id: 1, name: "Warrior" },
    specialization: { id: 73, name: "Protection" },
    guild: { id: "holdfast", name: "Holdfast" },
    gameBuild: "Forever Beta 1.0.0",
    stats: { strength: 91, stamina: 104, armor: 1820 },
    equipment: [
      {
        slot: "HEAD",
        itemID: 11746,
        itemLink: "|cff0070dd|Hitem:11746::::::::30:::::::|h[Golem Skull Helm]|h|r",
        name: "Golem Skull Helm",
        quality: 3,
        itemLevel: 35,
        enchant: { name: "+8 Stamina" },
        iconFileID: 132767,
      },
      {
        slot: "MAINHAND",
        itemID: 6975,
        name: "Whirlwind Axe",
        quality: 3,
        itemLevel: 40,
        iconFileID: 132402,
      },
    ],
    talents: {
      configID: 901,
      treeID: 73,
      specID: 73,
      name: "Protection",
      nodes: [
        {
          nodeID: 101,
          x: 0,
          y: 0,
          rank: 2,
          maxRank: 2,
          selected: true,
          entries: [
            {
              entryID: 1001,
              spellID: 12975,
              name: "Last Stand",
              description: "Temporarily increases maximum health.",
              iconFileID: 135871,
              selected: true,
              rank: 1,
              maxRank: 1,
            },
          ],
        },
        {
          nodeID: 102,
          x: 1,
          y: 1,
          entries: [
            {
              entryID: 1002,
              spellID: 12328,
              name: "Sweeping Strikes",
              iconFileID: 132306,
              selected: false,
              rank: 0,
              maxRank: 1,
            },
          ],
        },
      ],
      edges: [{ from: 101, to: 102, required: true }],
    },
    professions: [
      {
        professionID: 164,
        name: "Blacksmithing",
        iconFileID: 136241,
        skillLevel: 225,
        maxSkillLevel: 225,
        skillModifier: 5,
        specialization: "Weaponsmith",
        recipes: [
          {
            recipeID: 9789,
            name: "Mithril Spurs",
            known: true,
            iconFileID: 132307,
            requiredSkill: 215,
            craftedItemID: 7969,
            craftedItem: { id: 7969, name: "Mithril Spurs" },
            reagents: [
              { itemID: 3860, name: "Mithril Bar", quantity: 4 },
              { itemID: 7067, name: "Elemental Earth", quantity: 3 },
            ],
          },
        ],
      },
      {
        professionID: 186,
        name: "Mining",
        skillLevel: 250,
        maxSkillLevel: 300,
      },
    ],
  };
}

test("character intelligence projects rich snapshots and remains idempotent", async () => {
  await withHttpApp(async ({ request }) => {
    const anonymous = await request("/api/intelligence");
    assert.equal(anonymous.status, 401);

    const first = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: richSnapshot(),
      deviceId: "device-armory",
      bridgeRevision: 7,
    });
    assert.equal(first.status, "created");

    const duplicate = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: richSnapshot(),
      deviceId: "device-armory",
      bridgeRevision: 7,
    });
    assert.equal(duplicate.status, "unchanged");
    assert.equal(duplicate.snapshot.id, first.snapshot.id);

    const snapshotCount = withGuildDatabase((db) =>
      Number(
        db
          .prepare("SELECT COUNT(*) AS count FROM character_snapshots WHERE character_id = ?")
          .get(first.character.id).count,
      ),
    );
    assert.equal(snapshotCount, 1);

    const summary = await request("/api/intelligence", { persona: "member" });
    assert.equal(summary.status, 200);
    assert.equal(summary.json.summary.characterCount, 1);
    assert.equal(summary.json.summary.professionCount, 2);
    assert.equal(summary.json.summary.recipeCount, 1);
    assert.deepEqual(summary.json.classDistribution, [{ name: "Warrior", count: 1 }]);
    assert.deepEqual(summary.json.specDistribution, [{ name: "Protection", count: 1 }]);

    const armory = await request(`/api/intelligence/characters/${encodeURIComponent(first.character.id)}`, { persona: "member" });
    assert.equal(armory.status, 200);
    assert.equal(armory.json.character.name, "Rook");
    assert.equal(armory.json.character.level, 30);
    assert.equal(armory.json.character.guildName, "Holdfast");
    assert.equal(armory.json.equipment.length, 2);
    assert.equal(armory.json.equipment[0].name, "Golem Skull Helm");
    assert.equal(armory.json.equipment[0].itemLevel, 35);
    assert.equal(armory.json.talents.nodes.length, 2);
    assert.deepEqual(armory.json.talents.edges[0], { from: 101, to: 102, required: true });
    assert.equal(armory.json.professions.find((entry) => entry.name === "Blacksmithing").current, 225);
    assert.equal(armory.json.recipes[0].name, "Mithril Spurs");
    assert.equal(armory.json.recipes[0].reagents[0].quantity, 4);

    const recipes = await request("/api/intelligence/recipes?q=mithril", { persona: "member" });
    assert.equal(recipes.status, 200);
    assert.equal(recipes.json.recipes.length, 1);
    assert.equal(recipes.json.recipes[0].character.name, "Rook");

    const craftFinder = await request("/api/intelligence/craft-finder?q=spurs", { persona: "member" });
    assert.equal(craftFinder.status, 200);
    assert.equal(craftFinder.json.results.length, 1);
    assert.equal(craftFinder.json.results[0].recipe.name, "Mithril Spurs");
    assert.equal(craftFinder.json.results[0].crafters[0].professionSkill, 225);
    assert.equal(craftFinder.json.results[0].crafters[0].professionMaxSkill, 225);
    assert.equal(craftFinder.json.results[0].crafters[0].professionModifier, 5);
  });
});

test("character intelligence tolerates incomplete old telemetry and schema bootstrap is repeatable", async () => {
  await withHttpApp(async ({ request }) => {
    withGuildDatabase((db) => {
      ensureTelemetryProjectionSchema(db);
      ensureTelemetryProjectionSchema(db);
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name),
      );
      assert.equal(tables.has("telemetry_characters"), true);
      assert.equal(tables.has("telemetry_professions"), true);
      assert.equal(tables.has("telemetry_recipes"), true);
    });

    const result = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: {
        schemaVersion: 1,
        capturedAt: "2026-10-06T02:30:00.000Z",
        guid: "Player-1-SPARSE",
        name: "Sparse",
        class: "Mage",
      },
    });

    assert.equal(result.status, "created");

    const armory = await request(`/api/intelligence/characters/${encodeURIComponent(result.character.id)}`, { persona: "member" });
    assert.equal(armory.status, 200);
    assert.equal(armory.json.character.name, "Sparse");
    assert.equal(armory.json.character.className, "Mage");
    assert.deepEqual(armory.json.equipment, []);
    assert.deepEqual(armory.json.talents.nodes, []);
    assert.deepEqual(armory.json.talents.edges, []);
    assert.deepEqual(armory.json.professions, []);
    assert.deepEqual(armory.json.recipes, []);

    const missing = await request("/api/intelligence/characters/not-real", { persona: "member" });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, "character_not_found");
  });
});
