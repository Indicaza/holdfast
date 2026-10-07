import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { createBlizzardIconMediaResolver } from "../src/GameData/blizzardIconMedia.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

test("same first name with different Forever surnames stays as distinct characters", async () => {
  await withHttpApp(async () => {
    const warrior = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: {
        schemaVersion: 3,
        capturedAt: 1791330000,
        characterId: "character-rook-ravenstar",
        characterKey: "classic beta pve 2:rook ravenstar",
        name: "Rook Ravenstar",
        firstName: "Rook",
        lastName: "Ravenstar",
        fullName: "Rook Ravenstar",
        realm: "Classic Beta PvE 2",
        class: { name: "Warrior" },
        race: { name: "Night Elf" },
        professions: [],
      },
    });
    const rogue = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot: {
        schemaVersion: 3,
        capturedAt: 1791330010,
        characterId: "character-rook-darkwing",
        characterKey: "classic beta pve 2:rook darkwing",
        name: "Rook Darkwing",
        firstName: "Rook",
        lastName: "Darkwing",
        fullName: "Rook Darkwing",
        realm: "Classic Beta PvE 2",
        class: { name: "Rogue" },
        race: { name: "Night Elf" },
        professions: [],
      },
    });

    assert.equal(warrior.status, "created");
    assert.equal(rogue.status, "created");
    assert.notEqual(warrior.character.id, rogue.character.id);
    assert.equal(warrior.character.firstName, "Rook");
    assert.equal(warrior.character.lastName, "Ravenstar");
    assert.equal(rogue.character.lastName, "Darkwing");

    const rows = withGuildDatabase((db) =>
      db.prepare(
        "SELECT id, name, class_name FROM characters WHERE member_id = ? AND name LIKE 'Rook %' ORDER BY name",
      ).all(memberIds.member),
    );
    assert.deepEqual(
      rows.map((row) => [row.name, row.class_name]),
      [["Rook Darkwing", "Rogue"], ["Rook Ravenstar", "Warrior"]],
    );
  });
});

test("Blizzard icon media resolver turns FileDataID into a CDN URL and caches it", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).includes("oauth.battle.net")) {
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      results: [{
        data: {
          assets: [{
            key: "icon",
            file_data_id: 273088,
            value: "https://render.worldofwarcraft.com/us/icons/56/inv_misc_questionmark.jpg",
          }],
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const resolver = createBlizzardIconMediaResolver({
    env: {
      BLIZZARD_CLIENT_ID: "client",
      BLIZZARD_CLIENT_SECRET: "secret",
      BLIZZARD_REGION: "US",
    },
    fetchImpl,
    now: () => 1791330000000,
  });

  const first = await resolver.resolve(273088);
  const second = await resolver.resolve(273088);
  assert.equal(first, "https://render.worldofwarcraft.com/us/icons/56/inv_misc_questionmark.jpg");
  assert.equal(second, first);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /assets\.file_data_id=273088/);
  assert.match(requests[1], /namespace=static-us/);
});
