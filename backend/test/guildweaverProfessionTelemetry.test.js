import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { readLatestTelemetryState } from "../src/Character/Telemetry/telemetryStateRepository.js";
import { canonicalProfessionSnapshot } from "../src/Character/Telemetry/professionModel.js";
import { applyProfessionTelemetry } from "../src/Character/professionArmory.js";
import { readCharacterArmoryFromReadModel } from "../src/Character/ReadModel/readModelReader.js";
import { ingestCharacterIdentity } from "../testSupport/characterTelemetry.js";
import { readTelemetryRecord } from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/guildweaver-profession-snapshot.v1.json", import.meta.url), "utf8"),
);

function ingest(envelope, revision = 1) {
  return ingestTelemetry({
    deviceId: "device-profession-telemetry",
    memberId: memberIds.member,
    idempotencyKey: `gw-profession-${revision}`,
    body: {
      streamKey: "profession_snapshot:character-rook",
      kind: "state",
      revision,
      envelope,
    },
    receivedAt: new Date(Number(envelope.capturedAt) * 1000 + revision).toISOString(),
  });
}

function latest() {
  return readLatestTelemetryState({
    memberId: memberIds.member,
    characterId: "character-rook",
    eventType: "profession_snapshot",
  });
}

test("profession_snapshot keeps the raw payload and stores a canonical latest state", () =>
  withHttpApp(async () => {
    const result = ingest(structuredClone(fixture));
    assert.equal(result.status, "created");
    assert.equal(result.handlerName, "profession_snapshot");

    const raw = readTelemetryRecord(result.record.id);
    assert.deepEqual(raw.envelope, fixture, "original envelope preserved for debugging");

    const [state] = latest();
    assert.equal(state.handlerName, "profession_snapshot");
    const { payload: _incoming, ...incomingMetadata } = fixture;
    assert.deepEqual(state.envelope, incomingMetadata, "latest state keeps the envelope metadata; the payload is stored once");

    const payload = state.payload;
    assert.equal(payload.modelVersion, 1);
    assert.equal(payload.professions.length, 2);
    const smithing = payload.professions[0];
    assert.equal(smithing.key, "id:164");
    assert.equal(smithing.skillLevel, 120);
    assert.equal(smithing.recipeBook.knownCount, 1);
    const recipe = smithing.recipes[0];
    assert.equal(recipe.key, "id:2660");
    assert.equal(recipe.professionKey, "id:164");
    assert.equal(recipe.difficulty, "trivial");
    assert.equal(recipe.cooldown.isDayCooldown, true);
    assert.equal(recipe.crafted.name, "Rough Sharpening Stone");
    assert.equal(recipe.crafted.maxQuantity, 2);
    assert.equal(recipe.reagents[0].name, "Rough Stone");
    assert.equal(recipe.reagents[0].quantity, 1);
    assert.deepEqual(payload.professions[1].recipes, [], "professions without a recipe book");
  }));

test("profession_snapshot revisions replace latest state; duplicates and bad payloads do not", () =>
  withHttpApp(async () => {
    assert.equal(ingest(structuredClone(fixture)).status, "created");
    assert.equal(ingest(structuredClone(fixture)).status, "duplicate");

    const skillUp = structuredClone(fixture);
    skillUp.capturedAt += 60;
    skillUp.payload.professions[0].skillLevel = 121;
    assert.equal(ingest(skillUp, 2).status, "created");
    const [state] = latest();
    assert.equal(state.revision, 2);
    assert.equal(state.payload.professions[0].skillLevel, 121);

    const malformed = structuredClone(fixture);
    malformed.capturedAt += 120;
    malformed.payload.professions = { blacksmithing: true };
    const invalid = ingest(malformed, 3);
    assert.equal(invalid.status, "invalid");
    assert.equal(invalid.error, "invalid_telemetry_domain_payload");
    assert.equal(latest()[0].revision, 2);
  }));

test("armory uses profession telemetry and keeps legacy recipes for professions without a book", () => {
  const state = {
    revision: 4,
    capturedAt: "2026-10-08T20:00:00.000Z",
    receivedAt: "2026-10-08T20:00:01.000Z",
    payload: canonicalProfessionSnapshot(fixture.payload),
  };
  const armory = {
    character: { id: "character-rook" },
    professions: [{ key: "id:164", name: "Blacksmithing", current: 100, max: 150 }],
    recipes: [
      { key: "id:1", name: "Old Smithing Recipe", professionKey: "id:164" },
      { key: "id:2", name: "Spiced Wolf Meat", professionKey: "id:185" },
    ],
  };

  const decorated = applyProfessionTelemetry(armory, state);
  assert.equal(decorated.professions.length, 2);
  assert.equal(decorated.professions[0].current, 120);
  assert.equal(decorated.professions[0].max, 150);
  assert.equal(decorated.professions[0].modifier, 5);
  assert.deepEqual(
    decorated.recipes.map((recipe) => recipe.name),
    ["Rough Sharpening Stone", "Spiced Wolf Meat"],
    "telemetry recipes replace the smithing book; cooking keeps its legacy recipes",
  );
  const recipe = decorated.recipes[0];
  assert.equal(recipe.craftedItemId, 2862);
  assert.equal(recipe.crafted.iconFileDataId, 135248);
  assert.equal(recipe.reagents[0].iconFileId, 135232);
  assert.equal(recipe.description, "Sharpens a bladed weapon.");
  assert.equal(decorated.professionTelemetry.revision, 4);

  assert.equal(applyProfessionTelemetry(armory, null), armory, "no telemetry leaves the armory alone");
});

test("the armory carries the latest profession telemetry, whichever arrives first", () =>
  withHttpApp(async () => {
    // Recipe books arrive before the website knows the character: they wait
    // under the addon's character id and project once the character exists.
    ingest(structuredClone(fixture));
    assert.equal(readCharacterArmoryFromReadModel("guildweaver-id:character-rook"), null);

    const identity = ingestCharacterIdentity({ deviceId: "device-profession-telemetry", memberId: memberIds.member, characterId: "character-rook" });
    assert.equal(identity.canonicalCharacterId, "guildweaver-id:character-rook");

    const armory = readCharacterArmoryFromReadModel("guildweaver-id:character-rook");
    assert.equal(armory.professions[0].name, "Blacksmithing");
    assert.equal(armory.recipes[0].crafted.name, "Rough Sharpening Stone");
    assert.equal(armory.professionTelemetry.eventType, "profession_snapshot");
  }));

test("recipe categories, reagent details and recipe tooltips reach the armory", () => {
  const book = structuredClone(fixture);
  const smithing = book.payload.professions[0];
  smithing.recipes[0].categoryId = 2460;
  smithing.recipes[0].spellLink = "|cff71d5ff|Hspell:2660|h[Rough Sharpening Stone]|h|r";
  smithing.recipes[0].tooltip = { source: "C_TooltipInfo.GetSpellByID", lines: [{ left: "Rough Sharpening Stone" }, { left: "Sharpens a bladed weapon." }] };
  // The client had not cached the reagent when the recipe was read.
  smithing.recipes[0].reagents[0] = { itemId: 2835, quantity: 1, required: true, slotIndex: 1 };
  smithing.categories = [
    { categoryId: 2460, name: "Weapon Stones", parentCategoryId: 2425, order: 20 },
    { categoryId: 2425, name: "Blacksmithing", parentCategoryId: 0, order: 0 },
    { name: "missing an id" },
  ];
  smithing.items = [
    { itemId: 2835, name: "Rough Stone", iconFileDataId: 135232, qualityId: 1, itemLevel: 5, tooltip: { lines: [{ left: "Rough Stone" }, { left: "Max Stack: 20" }] } },
    { name: "missing an id" },
  ];

  const canonical = canonicalProfessionSnapshot(book.payload);
  assert.equal(canonical.professions[0].categories.length, 2, "categories without an id are dropped");
  assert.equal(canonical.professions[0].items.length, 1, "items without an id are dropped");
  assert.equal(canonical.professions[0].recipes[0].tooltip.lines.length, 2, "recipe tooltip kept");

  const decorated = applyProfessionTelemetry({ professions: [], recipes: [] }, { revision: 1, payload: canonical });
  assert.deepEqual(decorated.professions[0].categories.map((category) => category.name), ["Weapon Stones", "Blacksmithing"]);
  const recipe = decorated.recipes[0];
  assert.equal(recipe.categoryId, 2460);
  assert.equal(recipe.tooltip.lines[1].left, "Sharpens a bladed weapon.");
  assert.match(recipe.spellLink, /Hspell:2660/);
  const [stone] = recipe.reagents;
  assert.equal(stone.name, "Rough Stone", "uncached reagent named from the book's item details");
  assert.equal(stone.iconFileId, 135232);
  assert.equal(stone.tooltip.lines[1].left, "Max Stack: 20");
  assert.equal(stone.quantity, 1);
});

test("snapshots without category names fall back to WoW Forever's categories", () => {
  const book = structuredClone(fixture);
  book.payload.professions[0].recipes[0].categoryId = 2460;
  const decorated = applyProfessionTelemetry({ professions: [], recipes: [] }, { revision: 1, payload: canonicalProfessionSnapshot(book.payload) });
  const categories = decorated.professions[0].categories;
  assert.deepEqual(categories.map((category) => [category.categoryId, category.name]), [[2460, "Weapon Stones"], [2425, "Blacksmithing"]]);
  assert.equal(categories[0].parentCategoryId, 2425);
  assert.equal(categories[0].order, 20);
  assert.deepEqual(decorated.professions[1].categories, [], "professions without recipes have no categories");
});
