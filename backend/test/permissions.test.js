import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolvePermissions } from "../src/Auth/permissionResolver.js";
import {
  requireAuthenticated,
  requirePermission,
} from "../src/Auth/permissions.js";
import {
  updateGuildMemberRank,
  upsertGuildMember,
} from "../src/Guild/memberRepository.js";

function response() {
  return {
    body: null,
    statusCode: 200,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function preserve() {
  return {
    owners: process.env.GUILD_OWNER_DISCORD_IDS,
    admins: process.env.DISCORD_SITE_ADMIN_ROLE_IDS,
    questEditors: process.env.DISCORD_QUEST_EDITOR_ROLE_IDS,
    rewardEditors: process.env.DISCORD_REWARD_POLICY_ROLE_IDS,
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
  };
}

function restore(previous) {
  const values = [
    ["GUILD_OWNER_DISCORD_IDS", previous.owners],
    ["DISCORD_SITE_ADMIN_ROLE_IDS", previous.admins],
    ["DISCORD_QUEST_EDITOR_ROLE_IDS", previous.questEditors],
    ["DISCORD_REWARD_POLICY_ROLE_IDS", previous.rewardEditors],
    ["GUILD_DATA_DIR", previous.dataDir],
    ["NODE_ENV", previous.nodeEnv],
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

test("permission resolution normalizes IDs and ignores malformed role collections", () => {
  const env = {
    GUILD_OWNER_DISCORD_IDS: " 123456789012345678,123456789012345678 ",
    DISCORD_SITE_ADMIN_ROLE_IDS: "223456789012345678",
    DISCORD_QUEST_EDITOR_ROLE_IDS: "323456789012345678",
    DISCORD_REWARD_POLICY_ROLE_IDS: "423456789012345678",
  };

  assert.deepEqual(
    new Set(resolvePermissions(123456789012345678n, [], env)),
    new Set(["site.admin", "quests.edit", "rewards.policy.edit"]),
  );
  assert.deepEqual(
    resolvePermissions("member", "223456789012345678", env),
    [],
  );
  assert.deepEqual(
    resolvePermissions(
      "member",
      [" 323456789012345678 ", "323456789012345678", null],
      env,
    ),
    ["quests.edit"],
  );
});

test("authentication middleware returns a stable 401 response", async () => {
  for (const auth of [null, {}, { user: {} }, { user: { id: " " } }]) {
    const req = { auth };
    const res = response();
    let nextCalls = 0;

    await requireAuthenticated(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "authentication_required" });
  }
});

test("permission middleware rejects permission-shaped data without a user", async () => {
  const req = {
    auth: {
      permissions: ["site.admin"],
      verifiedAt: Date.now(),
    },
  };
  const res = response();

  await requirePermission("site.admin")(req, res, () => {
    throw new Error("request should not continue");
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "authentication_required" });
});

test("permission middleware ignores stale session permissions and fails closed from database authority", async () => {
  const previous = preserve();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-permissions-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "";

    await upsertGuildMember({
      id: "323456789012345678",
      username: "recruit",
    });

    const req = {
      auth: {
        user: { id: "323456789012345678" },
        permissions: ["site.admin"],
        verifiedAt: Date.now(),
      },
    };
    const res = response();
    let nextCalls = 0;

    await requirePermission("site.admin")(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "permission_required" });
    assert.deepEqual(req.auth.permissions, []);
  } finally {
    restore(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("permission middleware admits only authority granted by rank and billets", async () => {
  const previous = preserve();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-permissions-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "owner-one";

    await upsertGuildMember({ id: "owner-one", username: "owner" });
    await upsertGuildMember({
      id: "323456789012345678",
      username: "corporal",
    });
    await updateGuildMemberRank(
      "323456789012345678",
      "Corporal",
      { actorMemberId: "owner-one" },
    );

    const req = {
      auth: {
        user: { id: "323456789012345678" },
        permissions: [],
        verifiedAt: Date.now(),
      },
    };
    const allowed = response();
    let nextCalls = 0;

    await requirePermission("quests.edit")(req, allowed, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 1);
    assert.ok(req.auth.permissions.includes("quests.create"));
    assert.ok(req.auth.permissions.includes("quests.edit"));
    assert.equal(req.auth.permissions.includes("rewards.issue"), false);

    const denied = response();
    await requirePermission("site.admin")(req, denied, () => {
      throw new Error("request should not continue");
    });
    assert.equal(denied.statusCode, 403);
  } finally {
    restore(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
