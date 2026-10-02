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

    const defaults = await readBillets();
    assert.deepEqual(
      defaults.map((billet) => billet.name).sort(),
      ["PvP Lead", "Quartermaster", "Raid Leader", "Steward"].sort(),
    );

    const created = await createBillet(
      {
        name: "Recruiter",
        responsibility: "Welcomes prospects and helps new members get settled.",
      },
      { actorMemberId: "member-one" },
    );

    assert.equal(created.status, "created");
    assert.equal(created.billet.name, "Recruiter");

    const duplicate = await createBillet({
      name: "recruiter",
      responsibility: "",
    });
    assert.equal(duplicate.status, "duplicate_name");

    const assigned = await setMemberBilletAssignment(
      "member-one",
      created.billet.id,
      true,
      { actorMemberId: "member-one" },
    );

    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.billets[0].name, "Recruiter");

    let members = await readGuildMembers();
    assert.equal(members[0].billets[0].name, "Recruiter");

    const updated = await updateBillet(
      created.billet.id,
      {
        name: "Recruit Lead",
        responsibility: "Owns recruiting and new-member onboarding.",
      },
      { actorMemberId: "member-one" },
    );

    assert.equal(updated.status, "updated");
    assert.equal(updated.billet.name, "Recruit Lead");

    const removed = await setMemberBilletAssignment(
      "member-one",
      created.billet.id,
      false,
      { actorMemberId: "member-one" },
    );

    assert.equal(removed.status, "removed");

    members = await readGuildMembers();
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

    const created = await createBillet({
      name: "Dungeon Master",
      responsibility: "Builds dungeon groups.",
    });

    await setMemberBilletAssignment(
      "member-one",
      created.billet.id,
      true,
      { actorMemberId: "member-one" },
    );

    const deleted = await deleteBillet(
      created.billet.id,
      { actorMemberId: "member-one" },
    );

    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.assignmentCount, 1);
    assert.equal(
      (await readBillets()).some((billet) => billet.id === created.billet.id),
      false,
    );

    const members = await readGuildMembers();
    assert.deepEqual(members[0].billets, []);

    const steward = (await readBillets()).find(
      (billet) => billet.name === "Steward",
    );
    const protectedResult = await deleteBillet(steward.id, {
      actorMemberId: "member-one",
    });

    assert.equal(protectedResult.status, "protected");
    assert.ok(
      (await readBillets()).some((billet) => billet.id === steward.id),
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
      (await createBillet({ name: " ", responsibility: "" })).status,
      "invalid_name",
    );
    assert.equal(
      (
        await createBillet({
          name: "Recruiter",
          responsibility: "x".repeat(601),
        })
      ).status,
      "invalid_responsibility",
    );
    assert.equal(
      (
        await createBillet({
          name: "Commander",
          responsibility: "Definitely not a billet.",
        })
      ).status,
      "reserved_name",
    );
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
