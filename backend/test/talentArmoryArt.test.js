import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTalentDefinitionArt } from "../src/Character/talentArmoryArt.js";

test("talent art keeps safe Blizzard asset identifiers and tree version metadata", () => {
  const result = normalizeTalentDefinitionArt({
    schemaVersion: 4,
    treeId: 1117,
    treeHash: "d4383d8c88abbb31cc65594c33ac945d",
    locale: "enUS",
    metadata: { status: "complete", entryCount: 34, incompleteEntryCount: 0 },
    art: {
      schemaVersion: 1,
      specialization: {
        id: 1491,
        index: 1,
        name: "Warrior",
        iconFileDataId: 132355,
        background: "Warrior",
      },
      talentTabs: [
        {
          id: 71,
          index: 1,
          name: "Arms",
          iconFileDataId: 132355,
          pointsSpent: 5,
          background: "WarriorArms",
          backgroundTextures: {
            topLeft: { path: "Interface\\TalentFrame\\WarriorArms-TopLeft", fileDataId: 900001 },
            topRight: { path: "Interface\\TalentFrame\\WarriorArms-TopRight", fileDataId: 900002 },
            bottomLeft: { path: "Interface\\TalentFrame\\WarriorArms-BottomLeft", fileDataId: 900003 },
            bottomRight: { path: "Interface\\TalentFrame\\WarriorArms-BottomRight", fileDataId: 900004 },
          },
        },
      ],
      tree: { treeId: 1117, uiTextureKit: "warrior-talents", titleText: "Warrior" },
    },
  });

  assert.equal(result.treeId, 1117);
  assert.equal(result.treeHash, "d4383d8c88abbb31cc65594c33ac945d");
  assert.equal(result.metadata.status, "complete");
  assert.equal(result.art.specialization.iconFileDataId, 132355);
  assert.equal(result.art.talentTabs[0].background, "WarriorArms");
  assert.equal(result.art.talentTabs[0].backgroundTextures.topLeft.fileDataId, 900001);
  assert.equal(result.art.talentTabs[0].backgroundTextures.bottomRight.path, "Interface\\TalentFrame\\WarriorArms-BottomRight");
  assert.equal(result.art.tree.uiTextureKit, "warrior-talents");
});

test("talent art drops malformed texture IDs without dropping the client path", () => {
  const result = normalizeTalentDefinitionArt({
    treeId: 1117,
    art: {
      talentTabs: [{
        name: "Arms",
        backgroundTextures: {
          topLeft: { path: "Interface\\TalentFrame\\WarriorArms-TopLeft", fileDataId: "nope" },
        },
      }],
    },
  });

  assert.equal(result.art.talentTabs[0].backgroundTextures.topLeft.fileDataId, null);
  assert.equal(result.art.talentTabs[0].backgroundTextures.topLeft.path, "Interface\\TalentFrame\\WarriorArms-TopLeft");
});
