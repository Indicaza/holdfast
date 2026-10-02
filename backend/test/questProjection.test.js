import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeQuestDocument,
  projectFeaturedQuest,
  projectQuests,
} from "../src/Quest/questSchema.js";

const document = {
  version: 1,
  focusedQuestId: "quest-public",
  rewardPolicy: "Internal policy text",
  rewardLimits: {
    rep: { min: 0, max: 1000 },
    marks: { min: 0, max: 1000 },
  },
  quests: [
    {
      id: "quest-public",
      publication: "published",
      mode: "rotating",
      title: "Public Quest",
      summary: "Help the guild.",
      objectives: [
        {
          id: "objective-public",
          title: "Gather supplies",
          description: "Bring useful materials.",
          priority: "High",
          completed: false,
          need: "Materials",
          reward: {
            rep: 100,
            marks: 25,
            items: [
              {
                id: "internal-reward-id",
                name: "Guild Cache",
                quantity: 1,
              },
            ],
          },
          assignments: [
            {
              memberId: "372578806763880458",
              name: "Rook",
              responsibility: "Coordinate",
              detail: "Keep the group moving.",
              initials: "RO",
              avatar: "https://cdn.example.test/avatar.png",
            },
          ],
        },
      ],
    },
    {
      id: "quest-secondary",
      publication: "published",
      mode: "rotating",
      title: "Member-only Published Quest",
      summary: "Visible on the signed-in quest board.",
      objectives: [],
    },
    {
      id: "quest-draft",
      publication: "draft",
      mode: "rotating",
      title: "Private Draft",
      summary: "",
      objectives: [],
    },
  ],
};

test("public quest projection strips private/internal assignment identifiers", () => {
  const normalized = normalizeQuestDocument(document);

  assert.equal(
    normalized.quests[0].objectives[0].assignments[0].memberId,
    "372578806763880458",
  );
  assert.equal(
    normalized.quests[0].objectives[0].reward.items[0].id,
    "internal-reward-id",
  );

  const projected = projectQuests(document);

  assert.equal(projected.quests.length, 2);
  assert.equal(projected.quests[0].id, "quest-public");
  assert.equal(projected.quests[1].id, "quest-secondary");

  const objective = projected.quests[0].objectives[0];
  const assignment = objective.assignments[0];
  const rewardItem = objective.reward.items[0];

  assert.deepEqual(assignment, {
    name: "Rook",
    responsibility: "Coordinate",
    detail: "Keep the group moving.",
    initials: "RO",
    avatar: "https://cdn.example.test/avatar.png",
  });
  assert.equal("memberId" in assignment, false);
  assert.deepEqual(objective.rewardApproval, {
    status: "pending",
    approvedBy: "",
    approvedAt: "",
  });

  assert.deepEqual(rewardItem, {
    name: "Guild Cache",
    quantity: 1,
  });
  assert.equal("id" in rewardItem, false);

  assert.equal("publication" in projected.quests[0], false);
  assert.equal("rewardPolicy" in projected, false);
});


test("public featured projection exposes only the focused published quest", () => {
  const projected = projectFeaturedQuest(document);

  assert.equal(projected.focusedQuestId, "quest-public");
  assert.equal(projected.quests.length, 1);
  assert.equal(projected.quests[0].id, "quest-public");
  assert.equal(
    projected.quests.some((quest) => quest.id === "quest-secondary"),
    false,
  );
  assert.equal(
    projected.quests.some((quest) => quest.id === "quest-draft"),
    false,
  );
});

test("public featured projection is empty when nothing is featured", () => {
  const projected = projectFeaturedQuest({
    ...document,
    focusedQuestId: "",
    quests: document.quests.map((quest) => ({
      ...quest,
      publication:
        quest.id === "quest-public" || quest.id === "quest-secondary"
          ? "draft"
          : quest.publication,
    })),
  });

  assert.equal(projected.focusedQuestId, "");
  assert.deepEqual(projected.quests, []);
});


test("member quest projection marks only the viewer's own assignment", () => {
  const projected = projectQuests(document, "372578806763880458");
  const assignment = projected.quests[0].objectives[0].assignments[0];

  assert.equal(assignment.isSelf, true);
  assert.equal("memberId" in assignment, false);

  const otherViewer = projectQuests(document, "different-member");
  assert.equal(
    "isSelf" in otherViewer.quests[0].objectives[0].assignments[0],
    false,
  );
});
