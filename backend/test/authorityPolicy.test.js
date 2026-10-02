import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAuthorityScopes,
  canDelegateScope,
} from "../src/Guild/authorityPolicy.js";

test("authority merging is additive across rank and billets", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: ["quests.edit", "members.rank.manage"],
      maxManagedRank: "Sergeant",
    },
    {
      permissions: ["rewards.policy.edit"],
      maxManagedRank: null,
    },
    {
      permissions: ["audit.view", "quests.edit"],
      maxManagedRank: "Corporal",
    },
  ]);

  assert.deepEqual(
    new Set(merged.permissions),
    new Set([
      "quests.edit",
      "members.rank.manage",
      "rewards.policy.edit",
      "audit.view",
    ]),
  );
  assert.equal(merged.maxManagedRank, "Sergeant");
});

test("a less powerful billet never removes rank permissions or lowers its ceiling", () => {
  const rank = {
    permissions: [
      "site.admin",
      "quests.edit",
      "members.rank.manage",
    ],
    maxManagedRank: "Master Sergeant",
  };
  const billet = {
    permissions: ["quests.edit"],
    maxManagedRank: "Private",
  };

  const merged = mergeAuthorityScopes([rank, billet]);

  assert.deepEqual(
    new Set(merged.permissions),
    new Set([
      "site.admin",
      "quests.edit",
      "members.rank.manage",
    ]),
  );
  assert.equal(merged.maxManagedRank, "Master Sergeant");
});

test("a more powerful billet adds authority on top of rank", () => {
  const rank = {
    permissions: ["quests.edit"],
    maxManagedRank: null,
  };
  const billet = {
    permissions: [
      "members.billet.assign",
      "rewards.issue",
    ],
    maxManagedRank: "Corporal",
  };

  const merged = mergeAuthorityScopes([rank, billet]);

  assert.deepEqual(
    new Set(merged.permissions),
    new Set([
      "quests.edit",
      "members.billet.assign",
      "rewards.issue",
    ]),
  );
  assert.equal(merged.maxManagedRank, "Corporal");
});

test("delegation requires every permission and the ceiling to fit inside actor authority", () => {
  const actor = {
    permissions: [
      "quests.edit",
      "members.billet.assign",
      "rewards.issue",
    ],
    maxManagedRank: "Sergeant",
  };

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["quests.edit", "rewards.issue"],
      maxManagedRank: "Corporal",
    }),
    true,
  );

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["discord.manage"],
      maxManagedRank: null,
    }),
    false,
  );

  assert.equal(
    canDelegateScope(actor, {
      permissions: ["quests.edit"],
      maxManagedRank: "Lieutenant",
    }),
    false,
  );
});


test("a ceiling without a member-management permission cannot elevate another scope", () => {
  const merged = mergeAuthorityScopes([
    {
      permissions: ["members.rank.manage"],
      maxManagedRank: "Corporal",
    },
    {
      permissions: ["quests.edit"],
      maxManagedRank: "Commander",
    },
  ]);

  assert.deepEqual(
    new Set(merged.permissions),
    new Set(["members.rank.manage", "quests.edit"]),
  );
  assert.equal(merged.maxManagedRank, "Corporal");
});
