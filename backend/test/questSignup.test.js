import test from "node:test";
import assert from "node:assert/strict";

import {
  QuestSignupError,
  signupForObjective,
} from "../src/Quest/questSignup.js";

function document() {
  return {
    version: 1,
    focusedQuestId: "quest-one",
    rewardPolicy: "",
    rewardLimits: {
      rep: { min: 0, max: 1000 },
      marks: { min: 0, max: 1000 },
    },
    quests: [
      {
        id: "quest-one",
        publication: "published",
        mode: "rotating",
        title: "Launch Day",
        summary: "",
        objectives: [
          {
            id: "objective-one",
            title: "Stock the bank",
            description: "",
            priority: "High",
            completed: false,
            need: "",
            reward: { rep: 100, marks: 0, items: [] },
            assignments: [],
          },
          {
            id: "objective-two",
            title: "Make bags",
            description: "",
            priority: "Medium",
            completed: false,
            need: "",
            reward: { rep: 50, marks: 0, items: [] },
            assignments: [],
          },
        ],
      },
    ],
  };
}

const member = {
  id: "member-one",
  username: "rook",
  displayName: "Rook",
  initials: "RO",
  avatarUrl: "https://cdn.example.test/rook.png",
};

test("member can sign themselves up for a published objective", () => {
  const result = signupForObjective(
    document(),
    member,
    "quest-one",
    "objective-one",
  );

  const assignment =
    result.document.quests[0].objectives[0].assignments[0];

  assert.deepEqual(assignment, {
    memberId: "member-one",
    name: "Rook",
    responsibility: "Volunteer",
    detail: "",
    initials: "RO",
    avatar: "https://cdn.example.test/rook.png",
  });
});

test("member cannot sign up twice for the same quest", () => {
  const first = signupForObjective(
    document(),
    member,
    "quest-one",
    "objective-one",
  );

  assert.throws(
    () =>
      signupForObjective(
        first.document,
        member,
        "quest-one",
        "objective-two",
      ),
    (error) =>
      error instanceof QuestSignupError &&
      error.code === "already_assigned_to_quest" &&
      error.status === 409 &&
      error.details.objectiveId === "objective-one",
  );
});

test("member cannot sign up twice for the same objective", () => {
  const first = signupForObjective(
    document(),
    member,
    "quest-one",
    "objective-one",
  );

  assert.throws(
    () =>
      signupForObjective(
        first.document,
        member,
        "quest-one",
        "objective-one",
      ),
    (error) =>
      error instanceof QuestSignupError &&
      error.code === "already_assigned_to_quest" &&
      /already signed up/.test(error.message),
  );
});

test("completed objectives cannot be claimed", () => {
  const input = document();
  input.quests[0].objectives[0].completed = true;

  assert.throws(
    () =>
      signupForObjective(
        input,
        member,
        "quest-one",
        "objective-one",
      ),
    (error) =>
      error instanceof QuestSignupError &&
      error.code === "objective_completed",
  );
});

test("draft quests cannot be claimed", () => {
  const input = document();
  input.quests[0].publication = "draft";

  assert.throws(
    () =>
      signupForObjective(
        input,
        member,
        "quest-one",
        "objective-one",
      ),
    (error) =>
      error instanceof QuestSignupError &&
      error.code === "quest_not_published",
  );
});
