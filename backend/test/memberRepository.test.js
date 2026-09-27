import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  markGuildMemberDeparted,
  readGuildMembers,
  updateDetectedTimezone,
  updateGuildMemberProfile,
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

test("member profile and lifecycle survive SQLite upserts", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-member-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "member-one";

    const created = await upsertGuildMember(
      {
        id: "member-one",
        username: "rook",
        globalName: "Rook",
        avatarUrl: "https://cdn.example.test/rook.png",
        guildJoinedAt: "2026-09-27T12:00:00.000Z",
      },
      ["site.admin", "quests.edit"],
    );

    assert.equal(created.rank, "Commander");
    assert.equal(created.status, "active");

    const updated = await updateGuildMemberProfile("member-one", {
      battleTag: "Rook#1234",
      timezone: "America/Detroit",
      timezoneSource: "manual",
      availability: "Evenings",
      bio: "Leave it stronger.",
      characters: [
        {
          id: "char-one",
          name: "Rook",
          race: "Night Elf",
          className: "Warrior",
          spec: "Arms",
          professions: ["Mining", "Blacksmithing"],
          isMain: true,
        },
      ],
    });

    assert.equal(updated.profile.characters[0].id, "char-one");

    const timezone = await updateDetectedTimezone(
      "member-one",
      "America/Chicago",
    );
    assert.equal(timezone.status, "manual");
    assert.equal(timezone.member.profile.timezone, "America/Detroit");

    await markGuildMemberDeparted("member-one");
    assert.equal((await readGuildMembers()).length, 0);

    const departed = await readGuildMembers({ includeDeparted: true });
    assert.equal(departed[0].status, "departed");
    assert.equal(departed[0].profile.battleTag, "Rook#1234");

    const rejoined = await upsertGuildMember(
      {
        id: "member-one",
        username: "rook",
        guildNickname: "Rook",
        avatarUrl: "https://cdn.example.test/rook-new.png",
      },
      ["quests.edit"],
    );

    assert.equal(rejoined.status, "active");
    assert.equal(rejoined.profile.battleTag, "Rook#1234");
    assert.equal(rejoined.profile.characters[0].name, "Rook");
    assert.deepEqual(rejoined.permissions, ["quests.edit"]);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
