import test from "node:test";
import assert from "node:assert/strict";

import { resolvePermissions } from "../src/Auth/permissionResolver.js";

function preserve() {
  return {
    owners: process.env.GUILD_OWNER_DISCORD_IDS,
    admins: process.env.DISCORD_SITE_ADMIN_ROLE_IDS,
    questEditors: process.env.DISCORD_QUEST_EDITOR_ROLE_IDS,
    rewardEditors: process.env.DISCORD_REWARD_POLICY_ROLE_IDS,
  };
}

function restore(previous) {
  const values = [
    ["GUILD_OWNER_DISCORD_IDS", previous.owners],
    ["DISCORD_SITE_ADMIN_ROLE_IDS", previous.admins],
    ["DISCORD_QUEST_EDITOR_ROLE_IDS", previous.questEditors],
    ["DISCORD_REWARD_POLICY_ROLE_IDS", previous.rewardEditors],
  ];

  for (const [key, value] of values) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("owner receives all current GuildOS permissions", () => {
  const previous = preserve();

  try {
    process.env.GUILD_OWNER_DISCORD_IDS = "owner-one";
    process.env.DISCORD_SITE_ADMIN_ROLE_IDS = "";
    process.env.DISCORD_QUEST_EDITOR_ROLE_IDS = "";
    process.env.DISCORD_REWARD_POLICY_ROLE_IDS = "";

    assert.deepEqual(
      new Set(resolvePermissions("owner-one", [])),
      new Set([
        "site.admin",
        "quests.edit",
        "rewards.policy.edit",
      ]),
    );
  } finally {
    restore(previous);
  }
});

test("role permissions remain independent", () => {
  const previous = preserve();

  try {
    process.env.GUILD_OWNER_DISCORD_IDS = "";
    process.env.DISCORD_SITE_ADMIN_ROLE_IDS = "admin-role";
    process.env.DISCORD_QUEST_EDITOR_ROLE_IDS = "quest-role";
    process.env.DISCORD_REWARD_POLICY_ROLE_IDS = "reward-role";

    assert.deepEqual(
      resolvePermissions("member-one", ["quest-role"]),
      ["quests.edit"],
    );

    assert.deepEqual(
      resolvePermissions("member-one", ["reward-role"]),
      ["rewards.policy.edit"],
    );

    assert.deepEqual(
      new Set(resolvePermissions("member-one", ["admin-role"])),
      new Set(["site.admin", "quests.edit"]),
    );
  } finally {
    restore(previous);
  }
});

test("unrelated Discord roles grant no GuildOS permissions", () => {
  const previous = preserve();

  try {
    process.env.GUILD_OWNER_DISCORD_IDS = "";
    process.env.DISCORD_SITE_ADMIN_ROLE_IDS = "admin-role";
    process.env.DISCORD_QUEST_EDITOR_ROLE_IDS = "quest-role";
    process.env.DISCORD_REWARD_POLICY_ROLE_IDS = "reward-role";

    assert.deepEqual(resolvePermissions("member-one", ["other-role"]), []);
  } finally {
    restore(previous);
  }
});
