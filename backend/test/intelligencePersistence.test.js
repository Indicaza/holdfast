import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase } from "../src/Data/database.js";
import { ensureTelemetryProjectionSchema } from "../src/Character/telemetryProjection.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

function persistedSnapshot() {
  return {
    schemaVersion: 3,
    capturedAt: 1791484000,
    characterId: "persisted-rook-raw-id",
    name: "Rook Ravenstar",
    firstName: "Rook",
    lastName: "Ravenstar",
    fullName: "Rook Ravenstar",
    realm: "Classic Beta PvE 2",
    region: "US",
    level: 31,
    race: { id: 4, name: "Night Elf", token: "NightElf" },
    class: { id: 1, name: "Warrior", token: "WARRIOR" },
    specialization: { id: 73, name: "Protection", role: "TANK" },
    guild: { name: "Holdfast" },
    equipment: [
      {
        slot: "main_hand",
        slotId: 16,
        itemId: 6975,
        name: "Whirlwind Axe",
        qualityId: 3,
        itemLevel: 40,
      },
    ],
    professions: [
      {
        skillLineId: 164,
        name: "Blacksmithing",
        skillLevel: 225,
        maxSkillLevel: 225,
        recipes: [
          {
            recipeId: 1001,
            name: "Copper Bracers",
            known: true,
            professionSkillLineId: 164,
          },
        ],
      },
    ],
    stats: { strength: 91, stamina: 104 },
  };
}

function seedPersistedCharacter() {
  const characterId = "persisted-db-only-rook";
  const snapshot = persistedSnapshot();
  let snapshotId = null;

  withGuildDatabase((db) => {
    db.prepare(`
      INSERT INTO characters (
        id, member_id, name, race, class_name, spec, professions_json, is_main, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 99)
    `).run(
      characterId,
      memberIds.member,
      "Rook Ravenstar",
      "Night Elf",
      "Warrior",
      "Protection",
      JSON.stringify(["Blacksmithing"]),
    );

    const inserted = db.prepare(`
      INSERT INTO character_snapshots (character_id, source, captured_at, payload_json)
      VALUES (?, 'guildweaver', ?, ?)
    `).run(
      characterId,
      new Date(snapshot.capturedAt * 1000).toISOString(),
      JSON.stringify(snapshot),
    );
    snapshotId = Number(inserted.lastInsertRowid);

    // Reproduce the exact production failure mode: projection infrastructure exists,
    // but it has no authoritative latest_snapshot_id. Durable history must still win.
    ensureTelemetryProjectionSchema(db);
    db.prepare(`
      INSERT INTO telemetry_organizations (id, name, guild_name, updated_at)
      VALUES ('org:stale', 'Stale cache', 'Stale cache', ?)
    `).run(new Date().toISOString());
    db.prepare(`
      INSERT INTO telemetry_characters (
        character_id, organization_id, realm, region, guild_name, level,
        schema_version, game_build, latest_snapshot_id, last_seen_at, updated_at
      ) VALUES (?, 'org:stale', 'Wrong Realm', 'US', 'Wrong Guild', 1, 3, '', NULL, '', ?)
    `).run(characterId, new Date().toISOString());
  });

  return { characterId, snapshotId };
}

test("GuildOS hydrates synced characters from durable DB snapshots without fresh telemetry", async () => {
  await withHttpApp(async ({ request }) => {
    const { characterId } = seedPersistedCharacter();

    const response = await request("/api/intelligence", { persona: "member" });
    assert.equal(response.status, 200, response.text);

    const character = response.json.characters.find((entry) => entry.id === characterId);
    assert.ok(character, "persisted character should be visible without a current projection");
    assert.equal(character.name, "Rook Ravenstar");
    assert.equal(character.className, "Warrior");
    assert.equal(character.spec, "Protection");
    assert.equal(character.level, 31);
    assert.equal(character.realm, "Classic Beta PvE 2");
    assert.equal(character.guildName, "Holdfast");
    assert.equal(character.organizationName, "Holdfast");

    assert.ok(response.json.summary.characterCount >= 1);
    assert.ok(
      response.json.classDistribution.some((entry) => entry.name === "Warrior" && entry.count >= 1),
    );
    assert.ok(
      response.json.specDistribution.some((entry) => entry.name === "Protection" && entry.count >= 1),
    );
    assert.ok(
      response.json.professions.some(
        (entry) => entry.name === "Blacksmithing" && entry.characters >= 1,
      ),
    );
    assert.ok(response.json.summary.recipeCount >= 1);
  });
});

test("a persisted DB-only character still opens in Armory", async () => {
  await withHttpApp(async ({ request }) => {
    const { characterId } = seedPersistedCharacter();

    const response = await request(
      `/api/intelligence/characters/${encodeURIComponent(characterId)}`,
      { persona: "member" },
    );
    const recipeBook = await request(
      `/api/intelligence/characters/${encodeURIComponent(characterId)}/recipes`,
      { persona: "member" },
    );

    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.character.name, "Rook Ravenstar");
    assert.equal(response.json.character.level, 31);
    assert.equal(response.json.equipment[0].name, "Whirlwind Axe");
    assert.equal(response.json.professions[0].name, "Blacksmithing");
    assert.equal(recipeBook.json.recipes[0].name, "Copper Bracers");
  });
});
