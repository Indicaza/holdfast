import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createBillet,
  deleteBillet,
  readBillets,
  setMemberBilletAssignment,
  updateBillet,
} from "../src/Guild/billetRepository.js";
import {
  readGuildMembers,
  upsertGuildMember,
} from "../src/Guild/memberRepository.js";
import { HOLDFAST_GUILD_ID } from "../src/Guild/guildScope.js";

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

test("billets can be created, described, edited, and assigned to members", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-billet-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "";

    await upsertGuildMember({
      id: "member-one",
      username: "rook",
    });

    const defaults = await readBillets(HOLDFAST_GUILD_ID);
    assert.deepEqual(
      defaults.map((billet) => billet.name).sort(),
      ["PvP Lead", "Quartermaster", "Raid Leader", "Steward"].sort(),
    );

    const created = await createBillet(
      {
        name: "Recruiter",
        responsibility: "Welcomes prospects and helps new members get settled.",
      },
      { guildId: HOLDFAST_GUILD_ID, actorMemberId: "member-one" },
    );

    assert.equal(created.status, "created");
    assert.equal(created.billet.name, "Recruiter");

    const duplicate = await createBillet(
      { name: "recruiter", responsibility: "" },
      { guildId: HOLDFAST_GUILD_ID },
    );
    assert.equal(duplicate.status, "duplicate_name");

    const assigned = await setMemberBilletAssignment(
      "member-one",
      created.billet.id,
      true,
      { guildId: HOLDFAST_GUILD_ID, actorMemberId: "member-one" },
    );

    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.billets[0].name, "Recruiter");

    let members = await readGuildMembers(HOLDFAST_GUILD_ID);
    assert.equal(members[0].billets[0].name, "Recruiter");

    const updated = await updateBillet(
      created.billet.id,
      {
        name: "Recruit Lead",
        responsibility: "Owns recruiting and new-member onboarding.",
      },
      { guildId: HOLDFAST_GUILD_ID, actorMemberId: "member-one" },
    );

    assert.equal(updated.status, "updated");
    assert.equal(updated.billet.name, "Recruit Lead");

    const removed = await setMemberBilletAssignment(
      "member-one",
      created.billet.id,
      false,
      { guildId: HOLDFAST_GUILD_ID, actorMemberId: "member-one" },
    );

    assert.equal(removed.status, "removed");

    members = await readGuildMembers(HOLDFAST_GUILD_ID);
    assert.deepEqual(members[0].billets, []);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("custom billets delete cleanly while infrastructure billets stay protected", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-billet-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "";

    await upsertGuildMember({
      id: "member-one",
      username: "rook",
    });

    const created = await createBillet(
      {
        name: "Dungeon Master",
        responsibility: "Builds dungeon groups.",
      },
      { guildId: HOLDFAST_GUILD_ID },
    );

    await setMemberBilletAssignment(
      "member-one",
      created.billet.id,
      true,
      { guildId: HOLDFAST_GUILD_ID, actorMemberId: "member-one" },
    );

    const deleted = await deleteBillet(
      created.billet.id,
      { guildId: HOLDFAST_GUILD_ID, actorMemberId: "member-one" },
    );

    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.assignmentCount, 1);
    assert.equal(
      (await readBillets(HOLDFAST_GUILD_ID)).some((billet) => billet.id === created.billet.id),
      false,
    );

    const members = await readGuildMembers(HOLDFAST_GUILD_ID);
    assert.deepEqual(members[0].billets, []);

    const steward = (await readBillets(HOLDFAST_GUILD_ID)).find(
      (billet) => billet.name === "Steward",
    );
    const protectedResult = await deleteBillet(steward.id, {
      guildId: HOLDFAST_GUILD_ID,
      actorMemberId: "member-one",
    });

    assert.equal(protectedResult.status, "protected");
    assert.ok(
      (await readBillets(HOLDFAST_GUILD_ID)).some((billet) => billet.id === steward.id),
    );
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("billet validation rejects empty names and oversized responsibility text", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-billet-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    assert.equal(
      (await createBillet({ name: " ", responsibility: "" }, { guildId: HOLDFAST_GUILD_ID })).status,
      "invalid_name",
    );
    assert.equal(
      (
        await createBillet(
          {
            name: "Recruiter",
            responsibility: "x".repeat(601),
          },
          { guildId: HOLDFAST_GUILD_ID },
        )
      ).status,
      "invalid_responsibility",
    );
    assert.equal(
      (
        await createBillet(
          {
            name: "Commander",
            responsibility: "Definitely not a billet.",
          },
          { guildId: HOLDFAST_GUILD_ID },
        )
      ).status,
      "reserved_name",
    );
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
