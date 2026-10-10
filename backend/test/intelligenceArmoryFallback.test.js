import test from "node:test";
import assert from "node:assert/strict";

import { prepareCharacterArmory } from "../src/Character/intelligenceRouter.js";

function storedArmory() {
  return {
    character: {
      id: "character-rook",
      name: "Rook Ravenstar",
      className: "Warrior",
      level: 22,
      gameBuild: "1.60.1 · build 70245",
    },
    stats: {
      resources: {
        health: { current: 984, max: 984 },
        power: { token: "RAGE", current: 100, max: 100 },
      },
    },
    equipment: [{ slot: "HEAD", itemId: 11746, name: "Golem Skull Helm" }],
    talents: { treeIds: [], nodes: [], edges: [] },
    professions: [],
    recipes: [],
  };
}

function iconResolver() {
  return {
    status() {
      return { provider: "test-icons" };
    },
  };
}

test("character armory keeps durable snapshot data when optional enrichment fails", async () => {
  const armory = await prepareCharacterArmory(storedArmory(), {
    provider: {
      status() {
        return { provider: "test-provider", configured: true };
      },
      async hydrateReferences() {
        throw new Error("provider unavailable");
      },
    },
    icons: iconResolver(),
    gameDataResolver() {
      throw new Error("catalog unavailable");
    },
  });

  assert.equal(armory.character.name, "Rook Ravenstar");
  assert.equal(armory.stats.resources.health.max, 984);
  assert.equal(armory.equipment.length, 1);
  assert.equal(armory.equipment[0].name, "Golem Skull Helm");
  assert.equal(armory.gameData.provider.provider, "test-provider");
  assert.equal(armory.gameData.provider.failed, 1);
  assert.equal(armory.gameData.iconMedia.provider, "test-icons");
});

test("character armory does not wait on slow external hydration", async () => {
  const startedAt = Date.now();
  const armory = await prepareCharacterArmory(storedArmory(), {
    provider: {
      status() {
        return { provider: "slow-provider", configured: true };
      },
      hydrateReferences() {
        return new Promise(() => {});
      },
    },
    icons: iconResolver(),
    gameDataResolver: () => ({ items: {} }),
    hydrationDeadlineMs: 10,
  });

  assert.ok(Date.now() - startedAt < 500);
  assert.equal(armory.character.name, "Rook Ravenstar");
  assert.equal(armory.gameData.provider.pending, true);
});

test("a malformed section never takes the character modal down", async () => {
  const { composeCharacterArmory } = await import("../src/Character/ReadModel/composeArmory.js");
  const at = "2026-10-09T12:00:00.000Z";
  const armory = composeCharacterArmory({
    character: { id: "character-rook", member_id: "member", name: "Rook", is_main: 1 },
    sections: {
      identity: { capturedAt: at, payload: { name: "Rook", level: 22, schemaVersion: 3 } },
      equipment: { capturedAt: at, payload: { equipment: [{ slot: "HeadSlot", itemId: 11746, name: "Golem Skull Helm" }] } },
      // Neither shape the decorators expect.
      profession_books: { capturedAt: at, payload: { professions: [null, 7] } },
      inventory: { capturedAt: at, payload: { containers: "broken" } },
    },
  });
  assert.equal(armory.character.name, "Rook");
  assert.equal(armory.character.level, 22);
  assert.equal(armory.equipment[0].itemId, 11746);
  assert.equal(armory.freshness.equipment, at);
});
