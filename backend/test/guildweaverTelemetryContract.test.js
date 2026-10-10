import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const envelope = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/guildweaver-character-snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

test("Armory consumes the canonical Guildweaver schema 2 character payload", async () => {
  await withHttpApp(async ({ request }) => {
    const snapshot = structuredClone(envelope.payload);
    const first = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot,
      deviceId: "device-guildweaver-contract",
      bridgeRevision: 3,
    });

    assert.equal(first.status, "created");
    assert.equal(
      first.character.id,
      "guildweaver-id:character-6ac2d704-aabbccdd-11223344",
    );

    const duplicate = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot,
      deviceId: "device-guildweaver-contract",
      bridgeRevision: 3,
    });
    assert.equal(duplicate.status, "unchanged");
    assert.equal(duplicate.snapshot.id, first.snapshot.id);

    const response = await request(
      `/api/intelligence/characters/${encodeURIComponent(first.character.id)}`,
      { persona: "member" },
    );
    const recipeBook = await request(
      `/api/intelligence/characters/${encodeURIComponent(first.character.id)}/recipes`,
      { persona: "member" },
    );

    assert.equal(response.status, 200);
    assert.equal(response.json.character.name, "Rook");
    assert.equal(response.json.character.schemaVersion, 2);
    assert.equal(response.json.character.gameBuild, "1.60.1 · build 60001 · interface 16001");
    assert.equal(response.json.character.guildName, "Example Guild");

    assert.equal(response.json.equipment.length, 1);
    assert.equal(response.json.equipment[0].slot, "MainHandSlot");
    assert.equal(response.json.equipment[0].itemId, 5191);
    assert.equal(response.json.equipment[0].iconFileId, 135324);
    assert.equal(response.json.equipment[0].enchantId, 17);
    assert.equal(response.json.equipment[0].enchant.id, 17);
    assert.deepEqual(response.json.equipment[0].modifierData.slice(0, 2), [5191, 17]);

    assert.equal(response.json.talents.configId, 10001);
    assert.equal(response.json.talents.treeId, 20001);
    assert.deepEqual(response.json.talents.treeIds, [20001]);
    assert.equal(response.json.talents.nodes.length, 2);
    assert.equal(response.json.talents.nodes[0].id, 40001);
    assert.equal(response.json.talents.nodes[0].x, 540);
    assert.equal(response.json.talents.nodes[0].entries[0].spellId, 70001);
    assert.equal(response.json.talents.nodes[0].entries[0].iconFileId, 132333);
    assert.equal(response.json.talents.nodes[0].entries[0].maxRank, 1);
    assert.equal(response.json.talents.nodes[1].maxRank, 2);
    assert.deepEqual(
      {
        from: response.json.talents.edges[0].from,
        to: response.json.talents.edges[0].to,
        active: response.json.talents.edges[0].active,
      },
      { from: 40001, to: 40002, active: true },
    );

    assert.equal(response.json.professions.length, 1);
    assert.equal(response.json.professions[0].id, 164);
    assert.equal(response.json.professions[0].iconFileId, 136241);
    assert.equal(response.json.professions[0].current, 150);
    assert.equal(response.json.professions[0].max, 150);
    assert.equal(response.json.professions[0].modifier, 5);
    assert.equal(response.json.professions[0].specialization.configId, 81001);

    assert.equal(recipeBook.json.recipes.length, 1);
    assert.equal(recipeBook.json.recipes[0].id, 1001);
    assert.equal(recipeBook.json.recipes[0].iconFileId, 132604);
    assert.equal(recipeBook.json.recipes[0].professionId, 164);
    assert.equal(recipeBook.json.recipes[0].craftedItemId, 2853);
    assert.equal(recipeBook.json.recipes[0].craftedItemName, "Copper Bracers");
    assert.equal(recipeBook.json.recipes[0].reagents.length, 1);
    assert.deepEqual(
      {
        itemId: recipeBook.json.recipes[0].reagents[0].itemId,
        quantity: recipeBook.json.recipes[0].reagents[0].quantity,
        slotIndex: recipeBook.json.recipes[0].reagents[0].slotIndex,
        required: recipeBook.json.recipes[0].reagents[0].required,
      },
      { itemId: 2840, quantity: 2, slotIndex: 1, required: true },
    );

    const craftFinder = await request("/api/intelligence/craft-finder?q=copper", {
      persona: "member",
    });
    assert.equal(craftFinder.status, 200);
    assert.equal(craftFinder.json.results.length, 1);
    assert.equal(craftFinder.json.results[0].recipe.name, "Copper Bracers");
  });
});
