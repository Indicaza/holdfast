import test from "node:test";
import assert from "node:assert/strict";

import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import { recordTelemetry } from "../src/Character/telemetryRecordRepository.js";
import { memberIds, withHttpApp } from "../testSupport/httpHarness.js";

test("Armory preserves character-sheet stats and client-authored talent details", async () => {
  await withHttpApp(async ({ request }) => {
    const snapshot = {
      schemaVersion: 3,
      capturedAt: 1791392500,
      characterId: "character-rich-stats-talents",
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
      class: { id: 4, name: "Rogue", token: "ROGUE" },
      equipment: [],
      professions: [],
      stats: {
        schemaVersion: 1,
        resources: { health: { current: 818, max: 1050 }, power: { typeId: 3, token: "ENERGY", current: 100, max: 100 } },
        attributes: { agility: { current: 69, effective: 75, positive: 6, negative: 0 }, stamina: { current: 83, effective: 90, positive: 7, negative: 0 } },
        offense: { attackPower: { base: 178, positive: 12, negative: -4, effective: 186 }, crit: { melee: 12.5 }, weaponSkills: [{ name: "Daggers", current: 42, max: 75 }] },
        defense: { armor: { base: 1100, effective: 1297, positive: 197, negative: 0 }, dodge: 8.75 },
        ratings: { hitMelee: { rating: 60, bonus: 3 } },
        utility: { itemLevel: { overall: 55, equipped: 48, pvp: 60 }, movement: { runYardsPerSecond: 7 } },
      },
      talents: {
        api: "traits",
        kind: "combat",
        configId: 12467088,
        name: "Rogue",
        treeIds: [1111],
        pointsSpent: 1,
        pointsAvailable: 0,
        allocations: [{ nodeId: 105708, rank: 1, ranksPurchased: 1, activeEntryId: 130437, activeEntryRank: 1 }],
        nodeStates: [
          {
            nodeId: 105708,
            isAvailable: true,
            isVisible: true,
            meetsEdgeRequirements: true,
            conditions: [{ id: 43441, type: 1, isMet: true, isGate: true, isSufficient: true, ranksGranted: 0 }],
            entries: [{ entryId: 130437, isAvailable: true, isActiveEntry: true }],
          },
          {
            nodeId: 105709,
            isAvailable: false,
            isVisible: true,
            meetsEdgeRequirements: false,
            conditions: [{ id: 43442, type: 1, isMet: false, isGate: true, isSufficient: false, ranksGranted: 0 }],
            entries: [{ entryId: 130438, isAvailable: false, isActiveEntry: true }],
          },
        ],
      },
    };

    const synced = await syncGuildweaverCharacter({
      memberId: memberIds.member,
      snapshot,
      deviceId: "device-rich-stats-talents",
      bridgeRevision: 1,
    });
    assert.equal(synced.status, "created");

    const definition = {
      schemaVersion: 2,
      sourceApi: "traits",
      kind: "combat",
      treeId: 1111,
      rootNodeId: 105708,
      class: snapshot.class,
      gameBuild: snapshot.gameBuild,
      nodes: [
        {
          nodeId: 105708,
          type: "single",
          position: { x: 2, y: 1 },
          maxRanks: 3,
          entries: [
            {
              entryId: 130437,
              definitionId: 135238,
              spellId: 14162,
              iconFileDataId: 132292,
              name: "Improved Eviscerate",
              maxRanks: 3,
              description: "Increases the damage done by Eviscerate.",
              spellLink: "|Hspell:14162|h[Improved Eviscerate]|h",
              tooltip: {
                source: "C_TooltipInfo.GetSpellByID",
                lines: [
                  { left: "Improved Eviscerate", leftColor: { r: 1, g: 0.82, b: 0, a: 1 } },
                  { left: "Rank 1/3" },
                  { left: "Increases Eviscerate damage by 15%." },
                ],
              },
            },
          ],
        },
        {
          nodeId: 105709,
          type: "single",
          position: { x: 2, y: 2 },
          maxRanks: 1,
          entries: [{ entryId: 130438, definitionId: 135239, spellId: 14163, iconFileDataId: 132293, name: "Locked Talent", maxRanks: 1 }],
        },
      ],
      edges: [{ sourceNodeId: 105708, targetNodeId: 105709, type: 2, visualStyle: 1 }],
    };

    recordTelemetry({
      deviceId: "device-rich-stats-talents",
      memberId: memberIds.member,
      idempotencyKey: "rich-talent-definition-1",
      streamKey: "talent_tree_definition:rogue:70245:1111",
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

    const response = await request(`/api/intelligence/characters/${encodeURIComponent(synced.character.id)}`, { persona: "member" });
    assert.equal(response.status, 200);

    assert.equal(response.json.stats.resources.health.max, 1050);
    assert.equal(response.json.stats.attributes.agility.effective, 75);
    assert.equal(response.json.stats.offense.attackPower.effective, 186);
    assert.equal(response.json.stats.utility.itemLevel.equipped, 48);

    const selected = response.json.talents.nodes.find((node) => node.id === 105708);
    assert.equal(selected.isAvailable, true);
    assert.equal(selected.meetsEdgeRequirements, true);
    assert.equal(selected.conditions[0].isMet, true);
    assert.equal(selected.entries[0].name, "Improved Eviscerate");
    assert.equal(selected.entries[0].description, "Increases the damage done by Eviscerate.");
    assert.equal(selected.entries[0].spellLink, "|Hspell:14162|h[Improved Eviscerate]|h");
    assert.equal(selected.entries[0].tooltipLines[1].left, "Rank 1/3");
    assert.equal(selected.entries[0].isAvailable, true);
    assert.equal(selected.entries[0].isActiveEntry, true);

    const locked = response.json.talents.nodes.find((node) => node.id === 105709);
    assert.equal(locked.isAvailable, false);
    assert.equal(locked.meetsEdgeRequirements, false);
    assert.equal(locked.conditions[0].isMet, false);
    assert.equal(response.json.talents.edges[0].active, false);
  });
});
