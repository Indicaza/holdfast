import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentIconMediaResolver } from "../src/Development/developmentIconMedia.js";
import { seedDevelopmentCharacters } from "../scripts/seedDevelopmentCharacters.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const quiet = { log() {} };

function blizzardStub(url = "") {
  return {
    async resolve() { return url; },
    status() { return { configured: Boolean(url) }; },
  };
}

test("development icon media prefers Blizzard and falls back to recorded icon names", async () => {
  const iconNames = { 133138: "inv_helmet_41" };

  const fromBlizzard = createDevelopmentIconMediaResolver({
    blizzard: blizzardStub("https://render.worldofwarcraft.com/icon.jpg"),
    iconNames,
  });
  assert.equal(await fromBlizzard.resolve(133138), "https://render.worldofwarcraft.com/icon.jpg");

  const fallback = createDevelopmentIconMediaResolver({ blizzard: blizzardStub(), iconNames });
  assert.equal(await fallback.resolve(133138), "https://wow.zamimg.com/images/wow/icons/large/inv_helmet_41.jpg");
  assert.equal(await fallback.resolve(999999), "");
  assert.equal(fallback.status().developmentFallback, true);
});

test("development character seed produces armory-ready characters idempotently", async () => {
  await withHttpApp(async ({ request }) => {
    const first = await seedDevelopmentCharacters({ logger: quiet });
    assert.ok(first.created >= 20);
    assert.ok(first.trees >= 1);
    assert.equal(first.recipeBooks, first.created);
    assert.equal(first.inventories, first.created);

    const second = await seedDevelopmentCharacters({ logger: quiet });
    assert.equal(second.created, 0);
    assert.equal(second.trees, 0);
    assert.equal(second.recipeBooks, 0);
    assert.equal(second.inventories, 0);

    const summary = await request("/api/intelligence", { persona: "member" });
    assert.equal(summary.status, 200);
    assert.ok(summary.json.characters.some((character) => character.firstName === "Ironhide" && character.name === "Ironhide Blackforge"));

    const armory = await request("/api/intelligence/characters/guildweaver-id:character-dev-ironhide", { persona: "member" });
    assert.equal(armory.status, 200);
    assert.equal(armory.json.character.level, 60);
    assert.equal(armory.json.talents.pointsSpent, 51);
    assert.ok(armory.json.talents.nodes.length > 40);
    assert.ok(armory.json.talents.nodes.some((node) => node.selected && node.entries.some((entry) => entry.name === "Bloodthirst")));
    assert.ok(armory.json.equipment.length >= 17);
    assert.ok(armory.json.equipment.every((item) => item.itemId && item.iconFileId && item.tooltipLines.length));
    assert.ok(armory.json.stats.attributes.strength.effective > 100);

    // Raw recipe-book metadata can include recipes the character does not know,
    // while the Armory spellbook exposes only learned recipes.
    const engineering = armory.json.professions.find((profession) => profession.name === "Engineering");
    assert.ok(engineering.recipeBook.knownCount > 50);
    const recipes = armory.json.recipes.filter((recipe) => recipe.professionKey === engineering.key);
    assert.equal(recipes.length, engineering.recipeBook.knownCount);
    assert.ok(engineering.recipeBook.recipeCount >= recipes.length);
    assert.ok(recipes.every((recipe) => recipe.known !== false));
    const bomb = recipes.find((recipe) => recipe.name === "Rough Dynamite");
    assert.equal(bomb.crafted.name, "Rough Dynamite");
    assert.deepEqual(bomb.reagents.map((reagent) => reagent.name), ["Rough Blasting Powder", "Linen Cloth"]);
    assert.ok(bomb.reagents.every((reagent) => reagent.iconFileId));
    // Recipes sit in the game's categories; reagents carry tooltips.
    const explosives = engineering.categories.find((category) => category.categoryId === bomb.categoryId);
    assert.equal(explosives?.name, "Explosives");
    assert.ok(engineering.categories.length > 5);
    assert.ok(bomb.reagents.every((reagent) => reagent.tooltip?.lines?.length));
    assert.ok(bomb.tooltip.lines.length >= 1);

    // inventory_snapshot telemetry reaches the armory as its own section.
    const inventory = armory.json.inventory;
    assert.equal(inventory.telemetry.eventType, "inventory_snapshot");
    assert.equal(inventory.containers[0].kind, "backpack");
    assert.deepEqual(inventory.containers.map((container) => container.kind), ["backpack", "bag", "bag", "bag", "bag", "reagent"], "backpack, four bags and a reagent bag at level 60");
    assert.ok(inventory.containers.at(-1).slots.length > 0, "materials go to the reagent bag");
    assert.ok(inventory.money.gold > 0);
    assert.ok(inventory.usedSlots > 3);
    const keys = new Set(inventory.items.map((item) => item.key));
    assert.ok(inventory.containers.every((container) => container.slots.every((stack) => keys.has(stack.itemKey))));
    assert.ok(inventory.items.some((item) => item.name === "Hearthstone" && item.spell?.id === 8690));
    assert.ok(inventory.items.every((item) => item.iconFileDataId && item.tooltip?.lines?.length));
    assert.ok(inventory.totals.length >= 3);

    // Classes without a real capture use synthetic trees built from Classic Era data.
    const mage = await request("/api/intelligence/characters/guildweaver-id:character-dev-mirelle", { persona: "member" });
    assert.equal(mage.status, 200);
    assert.equal(mage.json.talents.pointsSpent, 51);
    assert.equal(mage.json.talents.name, "Fire");
    assert.ok(mage.json.talents.nodes.some((node) => node.selected && node.entries.some((entry) => entry.name === "Combustion")));

    const icon = await request("/api/intelligence/media/icon/133138", { persona: "member" });
    assert.equal(icon.status, 302);
    assert.match(icon.headers.get("location"), /^https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/large\/.+\.jpg$/);
  }, { env: { NODE_ENV: "development", HOLDFAST_DEV_AUTH: "true", BLIZZARD_CLIENT_ID: "", BLIZZARD_CLIENT_SECRET: "" } });
});

test("development character seed refuses to run in production", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(seedDevelopmentCharacters({ logger: quiet }), /cannot be seeded in production/);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
