import assert from "node:assert/strict";
import test from "node:test";

import {
  canDelegateScope,
  mergeAuthorityScopes,
} from "../src/Guild/authorityPolicy.js";

const ZERO = {
  repPerObjective: 0,
  marksPerObjective: 0,
  marksPerQuest: 0,
};

test("rank and billets combine additively without erasing authority", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: [
        "quests.create",
        "quests.edit",
        "members.rank.manage",
      ],
      maxManagedRank: "Sergeant",
      questScope: "own",
      rewardLimits: ZERO,
    },
    {
      permissions: ["rewards.policy.edit"],
      maxManagedRank: null,
      questScope: "own",
      rewardLimits: ZERO,
    },
    {
      permissions: ["audit.view", "quests.edit"],
      maxManagedRank: null,
      questScope: "all",
      rewardLimits: ZERO,
    },
  ]);

  assert.deepEqual(
    new Set(merged.permissions),
    new Set([
      "quests.create",
      "quests.edit",
      "members.rank.manage",
      "rewards.policy.edit",
      "audit.view",
    ]),
  );
  assert.equal(merged.maxManagedRank, "Sergeant");
  assert.equal(merged.questScopes["quests.create"], "own");
  assert.equal(merged.questScopes["quests.edit"], "all");
});

test("quest scope is composed per capability rather than globally", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: ["quests.create", "quests.edit"],
      questScope: "own",
      rewardLimits: ZERO,
    },
    {
      permissions: ["quests.publish"],
      questScope: "all",
      rewardLimits: ZERO,
    },
  ]);

  assert.equal(merged.questScopes["quests.create"], "own");
  assert.equal(merged.questScopes["quests.edit"], "own");
  assert.equal(merged.questScopes["quests.publish"], "all");
});

test("wider scope for the same quest capability wins", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: ["quests.edit"],
      questScope: "own",
      rewardLimits: ZERO,
    },
    {
      permissions: ["quests.edit"],
      questScope: "all",
      rewardLimits: ZERO,
    },
  ]);

  assert.equal(merged.questScopes["quests.edit"], "all");
});

test("approve and issue reward brackets compose independently", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: ["rewards.approve"],
      questScope: "all",
      rewardLimits: {
        repPerObjective: 250,
        marksPerObjective: 10,
        marksPerQuest: 50,
      },
    },
    {
      permissions: ["rewards.issue"],
      questScope: "all",
      rewardLimits: {
        repPerObjective: 100,
        marksPerObjective: 5,
        marksPerQuest: 20,
      },
    },
    {
      permissions: ["rewards.approve"],
      questScope: "own",
      rewardLimits: {
        repPerObjective: 500,
        marksPerObjective: 25,
        marksPerQuest: 100,
      },
    },
  ]);

  assert.deepEqual(merged.rewardLimits.approve, {
    repPerObjective: 500,
    marksPerObjective: 25,
    marksPerQuest: 100,
  });
  assert.deepEqual(merged.rewardLimits.issue, {
    repPerObjective: 100,
    marksPerObjective: 5,
    marksPerQuest: 20,
  });
  assert.equal(merged.questScopes["rewards.approve"], "all");
  assert.equal(merged.questScopes["rewards.issue"], "all");
});

test("a non-management scope cannot silently elevate member ceiling", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: ["members.rank.manage"],
      maxManagedRank: "Corporal",
      questScope: "own",
      rewardLimits: ZERO,
    },
    {
      permissions: ["quests.edit"],
      maxManagedRank: "Commander",
      questScope: "all",
      rewardLimits: ZERO,
    },
  ]);

  assert.equal(merged.maxManagedRank, "Corporal");
});

test("delegation requires permission subset, quest scope, reward bracket, and member ceiling", () => {
  const actor = {
    permissions: [
      "quests.create",
      "quests.edit",
      "rewards.approve",
      "members.billet.assign",
    ],
    maxManagedRank: "Sergeant",
    questScopes: {
      "quests.create": "own",
      "quests.edit": "all",
      "rewards.approve": "all",
    },
    rewardLimits: {
      approve: {
        repPerObjective: 250,
        marksPerObjective: 10,
        marksPerQuest: 50,
      },
      issue: ZERO,
    },
  };

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["quests.edit", "rewards.approve"],
      maxManagedRank: null,
      questScope: "own",
      rewardLimits: {
        repPerObjective: 100,
        marksPerObjective: 5,
        marksPerQuest: 25,
      },
    }),
    true,
  );

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["quests.create"],
      maxManagedRank: null,
      questScope: "all",
      rewardLimits: ZERO,
    }),
    false,
    "cannot delegate All create scope from Own create scope",
  );

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["rewards.approve"],
      maxManagedRank: null,
      questScope: "all",
      rewardLimits: {
        repPerObjective: 500,
        marksPerObjective: 5,
        marksPerQuest: 25,
      },
    }),
    false,
    "cannot delegate a reward bracket above actor authority",
  );

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["discord.manage"],
      maxManagedRank: null,
      questScope: "own",
      rewardLimits: ZERO,
    }),
    false,
  );

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["members.billet.assign"],
      maxManagedRank: "Lieutenant",
      questScope: "own",
      rewardLimits: ZERO,
    }),
    false,
  );
});
