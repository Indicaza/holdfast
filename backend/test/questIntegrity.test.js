import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  QuestValidationError,
  normalizeQuestDocument,
} from "../src/Quest/questSchema.js";
import {
  QuestStorageError,
  readQuests,
  writeQuests,
} from "../src/Quest/questRepository.js";
import { withGuildDatabase } from "../src/Data/database.js";

function validDocument() {
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
        title: "Gather Supplies",
        summary: "",
        objectives: [
          {
            id: "objective-one",
            title: "Bring ore",
            description: "",
            priority: "High",
            completed: false,
            need: "",
            reward: {
              rep: 100,
              marks: 0,
              items: [],
            },
            assignments: [
              {
                memberId: "member-one",
                name: "Rook",
                responsibility: "Lead",
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

test("quest validation rejects the same member twice on one objective", () => {
  const document = validDocument();
  document.quests[0].objectives[0].assignments.push({
    memberId: "member-one",
    name: "Rook",
    responsibility: "Also lead",
    detail: "",
    initials: "RO",
  });

  assert.throws(
    () => normalizeQuestDocument(document),
    (error) =>
      error instanceof QuestValidationError &&
      /assigned more than once/.test(error.message) &&
      /Bring ore/.test(error.message),
  );
});

test("quest validation rejects duplicate quest ids", () => {
  const document = validDocument();
  document.quests.push({
    ...document.quests[0],
    title: "Second quest",
    objectives: [],
  });

  assert.throws(
    () => normalizeQuestDocument(document),
    (error) =>
      error instanceof QuestValidationError &&
      /Duplicate quest id: quest-one/.test(error.message),
  );
});

test("quest validation rejects duplicate objective ids across quests", () => {
  const document = validDocument();
  document.quests.push({
    id: "quest-two",
    publication: "draft",
    mode: "rotating",
    title: "Second quest",
    summary: "",
    objectives: [
      {
        ...document.quests[0].objectives[0],
        assignments: [],
      },
    ],
  });

  assert.throws(
    () => normalizeQuestDocument(document),
    (error) =>
      error instanceof QuestValidationError &&
      /Duplicate objective id: objective-one/.test(error.message),
  );
});

test("quest rewards must stay inside configured limits", () => {
  const document = validDocument();
  document.rewardLimits.rep.max = 200;
  document.quests[0].objectives[0].reward.rep = 201;

  assert.throws(
    () => normalizeQuestDocument(document),
    (error) =>
      error instanceof QuestValidationError &&
      /reward.rep must be 0 or between 0 and 200/.test(error.message),
  );
});

test("the same member may be assigned to different objectives", () => {
  const document = validDocument();
  document.quests[0].objectives.push({
    id: "objective-two",
    title: "Bring cloth",
    description: "",
    priority: "Medium",
    completed: false,
    need: "",
    reward: {
      rep: 50,
      marks: 0,
      items: [],
    },
    assignments: [
      {
        memberId: "member-one",
        name: "Rook",
        responsibility: "Coordinate",
        detail: "",
        initials: "RO",
      },
    ],
  });

  assert.doesNotThrow(() => normalizeQuestDocument(document));
});

test("invalid quest state read from SQLite reports an actionable storage error", async () => {
  const previousDataDir = process.env.GUILD_DATA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-integrity-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    await writeQuests(validDocument());

    withGuildDatabase((db) => {
      db.prepare(
        "UPDATE objectives SET reward_rep = 5000 WHERE id = 'objective-one'",
      ).run();
    });

    await assert.rejects(
      () => readQuests(),
      (error) =>
        error instanceof QuestStorageError &&
        error.message.includes("holdfast.sqlite") &&
        /reward.rep must be 0 or between 0 and 1000/.test(error.message),
    );
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.GUILD_DATA_DIR;
    } else {
      process.env.GUILD_DATA_DIR = previousDataDir;
    }

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    await rm(directory, { recursive: true, force: true });
  }
});
