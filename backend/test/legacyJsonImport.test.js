import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  importLegacyJsonIfNeeded,
  legacyJsonImportStatus,
} from "../src/Data/initializeData.js";
import { readGuildMembers } from "../src/Guild/memberRepository.js";
import { readQuests } from "../src/Quest/questRepository.js";
import {
  readContributionTotals,
  readMemberContributionHistory,
} from "../src/Contribution/contributionRepository.js";

function preserveEnvironment() {
  return {
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
  };
}

function restoreEnvironment(previous) {
  if (previous.dataDir === undefined) delete process.env.GUILD_DATA_DIR;
  else process.env.GUILD_DATA_DIR = previous.dataDir;

  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
}

test("legacy runtime JSON imports once into a fresh SQLite database", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-import-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const now = "2026-09-27T12:00:00.000Z";

    await writeFile(
      path.join(directory, "members.json"),
      JSON.stringify([
        {
          id: "member-one",
          username: "rook",
          displayName: "Rook",
          initials: "RO",
          avatarUrl: "",
          guildJoinedAt: now,
          rank: "Commander",
          status: "active",
          departedAt: null,
          permissions: ["site.admin", "quests.edit"],
          profile: {
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
          },
          profileUpdatedAt: now,
          firstSeenAt: now,
          updatedAt: now,
        },
      ]),
      "utf8",
    );

    await writeFile(
      path.join(directory, "quests.json"),
      JSON.stringify({
        version: 1,
        focusedQuestId: "quest-one",
        rewardPolicy: "Reward useful work.",
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
            summary: "Get Holdfast moving.",
            objectives: [
              {
                id: "objective-one",
                title: "Open the guild bank",
                description: "",
                priority: "Main",
                completed: false,
                need: "Guild bank operational",
                reward: {
                  rep: 250,
                  marks: 75,
                  items: [],
                },
                assignments: [
                  {
                    memberId: "member-one",
                    name: "Rook",
                    responsibility: "Volunteer",
                    detail: "",
                    initials: "RO",
                  },
                ],
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    await writeFile(
      path.join(directory, "contributions.json"),
      JSON.stringify({
        version: 1,
        transactions: [
          {
            id: "objective:old-objective:member:member-one",
            type: "objective_reward",
            memberId: "member-one",
            memberName: "Rook",
            questId: "old-quest",
            questTitle: "Old Quest",
            objectiveId: "old-objective",
            objectiveTitle: "Old Objective",
            rep: 100,
            marks: 25,
            items: [],
            createdAt: now,
            awardedBy: {
              memberId: "member-one",
              username: "rook",
              displayName: "Rook",
            },
          },
        ],
      }),
      "utf8",
    );

    const first = importLegacyJsonIfNeeded();
    const second = importLegacyJsonIfNeeded();

    assert.equal(first.status, "imported");
    assert.deepEqual(first.imported, {
      members: 1,
      quests: 1,
      contributions: 1,
    });
    assert.equal(second.status, "already-checked");

    const members = await readGuildMembers();
    assert.equal(members.length, 1);
    assert.equal(members[0].rank, "Commander");
    assert.equal(members[0].rankManaged, false);
    assert.equal(members[0].billetsManaged, false);
    assert.deepEqual(members[0].billets, []);
    assert.equal(members[0].profile.characters[0].name, "Rook");

    const quests = await readQuests();
    assert.equal(quests.focusedQuestId, "quest-one");
    assert.equal(quests.quests[0].objectives[0].assignments[0].memberId, "member-one");

    const totals = await readContributionTotals();
    assert.deepEqual(totals.get("member-one"), {
      rep: 100,
      marks: 25,
      completedObjectives: 1,
    });

    const history = await readMemberContributionHistory("member-one");
    assert.equal(history.length, 1);
    assert.equal(legacyJsonImportStatus().status, "imported");
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed legacy JSON aborts migration instead of marking it complete", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-import-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    await writeFile(
      path.join(directory, "quests.json"),
      "{ not valid json",
      "utf8",
    );

    assert.throws(
      () => importLegacyJsonIfNeeded(),
      /Unable to import legacy GuildOS data/,
    );

    assert.equal(legacyJsonImportStatus(), null);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
