import assert from "node:assert/strict";
import test from "node:test";

import { withGuildTransaction } from "../src/Data/database.js";
import { withHttpApp } from "../testSupport/httpHarness.js";
import { BUILD, connect, corpseLoot, post, syncCharacter } from "../testSupport/lootHarness.js";

const ITEM_ID = 990123;
const HALL = { instanceId: 3065, name: "The Hall of Thanes", type: "party", difficultyId: 1, difficultyName: "Normal" };

const observedTooltip = {
  source: "GameTooltip", method: "SetHyperlink", rendered: true, complete: true,
  lines: [
    { left: "Durgen's Crescent Axe", leftColor: { r: 0, g: 0.44, b: 1 } },
    { left: "Soulbound" },
    { left: "Main Hand", right: "Axe" },
    { left: "20 - 39 Damage", right: "Speed 2.40" },
    { left: "(12.3 damage per second)" },
    { left: "+4 Strength" },
    { left: "Durability 65 / 65" },
    { left: "Requires Level 13" },
    { sellPrice: true },
    { left: "Transmogrified to:" },
    { left: "Brushwood Blade" },
    { left: "Vendor x1", right: "12s 36c" },
    { left: "Inventory" },
    { left: "Rook Smith" },
    { left: "Total: 1" },
  ],
};

test("new dungeon drops upgrade from sparse observations to client-authoritative tooltips without an AH index refresh", () => withHttpApp(async ({ request }) => {
  const user = await connect(request, { id: "discord-client-tooltip", username: "item-capture" });
  await syncCharacter(request, user.token, "character-rook", "Rook");

  const dropped = await corpseLoot(request, user.token, {
    npcId: 261306, npcName: "Faldrim Anvilmar", serial: 11, instance: HALL,
    items: [{ itemId: ITEM_ID, name: "Durgen's Crescent Axe", qualityId: 1, iconFileDataId: 135419 }],
  });
  assert.equal(dropped.status, 201, dropped.text);
  const url = "/api/player/loot/dungeons/3065";
  const before = await request(url, { rawCookie: user.cookie });
  assert.equal(before.status, 200, before.text);
  const initial = before.json.sources.find((source) => source.name === "Faldrim Anvilmar")?.items.find((item) => item.itemId === ITEM_ID);
  assert.ok(initial, "the observed item is attributed to the actual HoT source");
  assert.equal(initial.qualityId, 1, "the first observation is sparse");
  assert.equal(initial.tooltip?.lines?.length ?? 0, 0);

  withGuildTransaction((db) => {
    db.prepare("UPDATE market_item_meta SET quality_id = 1, name_source = 'blizzard', item_level = 10 WHERE item_id = ?").run(ITEM_ID);
  });

  const captured = await post(request, user.token, {
    streamKey: "game_item_definition:item:" + ITEM_ID, kind: "state", revision: 1,
    envelope: {
      schemaVersion: 1, eventType: "game_item_definition", capturedAt: 1791761420,
      gameBuild: BUILD, realm: "Live Realm", region: "US", locale: "enUS",
      installationId: "install-fixture", characterId: "character-rook", payloadSchemaVersion: 1,
      payload: {
        schemaVersion: 1, basis: "base_item_id", reference: "item:" + ITEM_ID,
        item: {
          itemId: ITEM_ID, name: "Durgen's Crescent Axe", qualityId: 3,
          iconFileDataId: 135419, itemLevel: 21, requiredLevel: 13,
          sellPrice: 1186, bindType: 1, equipLocation: "INVTYPE_WEAPON",
          itemClass: { id: 2, name: "Weapon" }, itemSubclass: { id: 0, name: "One-Handed Axes" },
          tooltip: observedTooltip,
        },
      },
    },
  });
  assert.equal(captured.status, 201, captured.text);

  const response = await request(url, { rawCookie: user.cookie });
  assert.equal(response.status, 200, response.text);
  const source = response.json.sources.find((entry) => entry.name === "Faldrim Anvilmar");
  const axe = source?.items.find((item) => item.itemId === ITEM_ID);
  assert.ok(axe, "the item keeps its original observed boss association");
  assert.equal(axe.qualityId, 3, "client rarity wins over stale market data");
  assert.equal(axe.itemLevel, 21);
  assert.equal(axe.sellPrice, 1186, "vendor price reaches the dungeon Journal");
  assert.equal(axe.itemDefinition.source, "game_item_definition");
  assert.equal(axe.itemDefinition.gameBuild, "70338");
  assert.equal(axe.tooltip.source, "game");
  assert.deepEqual(axe.tooltip.lines[0].leftColor, { r: 0, g: 0.44, b: 1 });
  assert.ok(axe.tooltip.lines.some((line) => line.left === "20 - 39 Damage" && line.right === "Speed 2.40"));
  assert.ok(axe.tooltip.lines.some((line) => line.left === "Durability 65 / 65"));
  assert.ok(axe.tooltip.lines.some((line) => line.sellPrice === true));
  const text = axe.tooltip.lines.map((line) => line.left).join(" | ");
  assert.doesNotMatch(text, /Transmogrified|Brushwood Blade|Vendor x1|Inventory|Rook Smith|Total: 1/i);
  assert.ok(axe.evidence.some((entry) => entry.provenance === "loot_window"), "loot evidence remains independent of item facts");
}));