import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readAuthorityCatalog,
  resolveMemberAuthority,
  updateBilletAuthority,
  updateRankAuthority,
} from "../src/Guild/authorityRepository.js";
import {
  readBillets,
  setMemberBilletAssignment,
} from "../src/Guild/billetRepository.js";
import {
  updateGuildMemberRank,
  upsertGuildMember,
} from "../src/Guild/memberRepository.js";

function preserveEnvironment() {
  return {
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
    owners: process.env.GUILD_OWNER_DISCORD_IDS,
  };
}

function restoreEnvironment(previous) {
  if (previous.dataDir === undefined) delete process.env.GUILD_DATA_DIR;
  else process.env.GUILD_DATA_DIR = previous.dataDir;

  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;

  if (previous.owners === undefined) delete process.env.GUILD_OWNER_DISCORD_IDS;
  else process.env.GUILD_OWNER_DISCORD_IDS = previous.owners;
}

test("rank and billet scopes merge into effective website authority", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-authority-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "owner-one";

    await upsertGuildMember({ id: "owner-one", username: "rook" });
    await upsertGuildMember({ id: "member-one", username: "finch" });
    await updateGuildMemberRank("member-one", "Corporal", {
      actorMemberId: "owner-one",
    });

    const before = resolveMemberAuthority("member-one");
    assert.deepEqual(
      new Set(before.permissions),
      new Set(["quests.edit", "rewards.issue"]),
    );
    assert.equal(before.maxManagedRank, null);

    const quartermaster = (await readBillets()).find(
      (billet) => billet.name === "Quartermaster",
    );
    await setMemberBilletAssignment(
      "member-one",
      quartermaster.id,
      true,
      { actorMemberId: "owner-one" },
    );

    const after = resolveMemberAuthority("member-one");
    assert.deepEqual(
      new Set(after.permissions),
      new Set([
        "quests.edit",
        "rewards.issue",
        "rewards.policy.edit",
      ]),
    );
    assert.equal(after.maxManagedRank, null);

    const owner = resolveMemberAuthority("owner-one");
    assert.equal(owner.isOwner, true);
    assert.equal(owner.maxManagedRank, "Commander");
    assert.ok(owner.permissions.includes("authority.manage"));
    assert.ok(owner.permissions.includes("discord.manage"));
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("authority designers cannot edit or grant scope above their own authority", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-authority-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "owner-one";

    await upsertGuildMember({ id: "owner-one", username: "rook" });
    await upsertGuildMember({ id: "major-one", username: "major" });
    await updateGuildMemberRank("major-one", "Major", {
      actorMemberId: "owner-one",
    });

    const majorDefault = resolveMemberAuthority("major-one");

    const empowerMajor = await updateRankAuthority(
      "Major",
      {
        permissions: [...majorDefault.permissions, "authority.manage"],
        maxManagedRank: majorDefault.maxManagedRank,
      },
      { actorMemberId: "owner-one" },
    );
    assert.equal(empowerMajor.status, "updated");

    const major = resolveMemberAuthority("major-one");
    assert.ok(major.permissions.includes("authority.manage"));
    assert.equal(major.maxManagedRank, "Sergeant Major");

    const higherRank = await updateRankAuthority(
      "Commander",
      {
        permissions: [],
        maxManagedRank: null,
      },
      { actorMemberId: "major-one" },
    );
    assert.equal(higherRank.status, "scope_above_actor");

    const excessivePermission = await updateRankAuthority(
      "Lieutenant",
      {
        permissions: ["discord.manage"],
        maxManagedRank: null,
      },
      { actorMemberId: "major-one" },
    );
    assert.equal(excessivePermission.status, "scope_above_actor");

    const excessiveCeiling = await updateRankAuthority(
      "Lieutenant",
      {
        permissions: ["quests.edit"],
        maxManagedRank: "Major",
      },
      { actorMemberId: "major-one" },
    );
    assert.equal(excessiveCeiling.status, "scope_above_actor");

    const allowed = await updateRankAuthority(
      "Lieutenant",
      {
        permissions: ["quests.edit"],
        maxManagedRank: "Sergeant",
      },
      { actorMemberId: "major-one" },
    );
    assert.equal(allowed.status, "updated");
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("billet authority can be customized and appears in the catalog", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-authority-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "owner-one";

    await upsertGuildMember({ id: "owner-one", username: "rook" });

    const raidLead = (await readBillets()).find(
      (billet) => billet.name === "Raid Leader",
    );

    const updated = await updateBilletAuthority(
      raidLead.id,
      {
        permissions: [
          "quests.edit",
          "rewards.issue",
          "members.billet.assign",
        ],
        maxManagedRank: "Corporal",
      },
      { actorMemberId: "owner-one" },
    );

    assert.equal(updated.status, "updated");
    assert.equal(updated.scope.maxManagedRank, "Corporal");
    assert.ok(updated.scope.permissions.includes("members.billet.assign"));

    const catalog = readAuthorityCatalog();
    const catalogRaidLead = catalog.billets.find(
      (billet) => billet.id === raidLead.id,
    );

    assert.equal(catalogRaidLead.maxManagedRank, "Corporal");
    assert.ok(
      catalogRaidLead.permissions.includes("members.billet.assign"),
    );
    assert.ok(
      catalog.capabilities.some(
        (capability) => capability.id === "authority.manage",
      ),
    );
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
