import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  awardObjectiveInDatabase,
  readContributionTotals,
} from "../src/Contribution/contributionRepository.js";
import { withGuildTransaction } from "../src/Data/database.js";
import {
  readQuests,
  readQuestsFromDatabase,
  writeQuests,
  writeQuestsToDatabase,
} from "../src/Quest/questRepository.js";

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

function questDocument() {
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
            title: "Open the bank",
            description: "",
            priority: "Main",
            completed: false,
            need: "",
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
  };
}

test("reward and objective completion roll back together", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-atomic-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    await writeQuests(questDocument());

    assert.throws(
      () =>
        withGuildTransaction((db) => {
          const current = readQuestsFromDatabase(db);
          const quest = current.quests[0];
          const objective = quest.objectives[0];

          awardObjectiveInDatabase({
            db,
            quest,
            objective,
            members: [{ id: "member-one", displayName: "Rook" }],
            awardedBy: {
              id: "officer-one",
              username: "officer",
              guildNickname: "Officer",
            },
          });

          writeQuestsToDatabase(db, {
            ...current,
            quests: current.quests.map((item) => ({
              ...item,
              objectives: item.objectives.map((candidate) => ({
                ...candidate,
                completed: true,
              })),
            })),
          });

          throw new Error("simulate failure after both writes");
        }),
      /simulate failure/,
    );

    const afterRollback = await readQuests();
    assert.equal(afterRollback.quests[0].objectives[0].completed, false);
    assert.equal((await readContributionTotals()).size, 0);

    withGuildTransaction((db) => {
      const current = readQuestsFromDatabase(db);
      const quest = current.quests[0];
      const objective = quest.objectives[0];

      awardObjectiveInDatabase({
        db,
        quest,
        objective,
        members: [{ id: "member-one", displayName: "Rook" }],
        awardedBy: {
          id: "officer-one",
          username: "officer",
          guildNickname: "Officer",
        },
      });

      writeQuestsToDatabase(db, {
        ...current,
        quests: current.quests.map((item) => ({
          ...item,
          objectives: item.objectives.map((candidate) => ({
            ...candidate,
            completed: true,
          })),
        })),
      });
    });

    const committed = await readQuests();
    assert.equal(committed.quests[0].objectives[0].completed, true);
    assert.deepEqual((await readContributionTotals()).get("member-one"), {
      rep: 250,
      marks: 75,
      completedObjectives: 1,
    });
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
