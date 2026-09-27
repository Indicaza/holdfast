import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  QuestValidationError,
  normalizeQuestDocument,
} from "../src/Quest/questSchema.js";
import {
  QuestStorageError,
  readQuests,
} from "../src/Quest/questRepository.js";

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

test("persisted quest corruption reports an actionable storage error", async () => {
  const previousDataDir = process.env.GUILD_DATA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-integrity-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const document = validDocument();
    document.quests[0].objectives[0].assignments.push({
      memberId: "member-one",
      name: "Rook",
      responsibility: "Duplicate",
      detail: "",
      initials: "RO",
    });

    const target = path.join(directory, "quests.json");
    await writeFile(target, JSON.stringify(document, null, 2), "utf8");

    await assert.rejects(
      () => readQuests(),
      (error) =>
        error instanceof QuestStorageError &&
        error.message.includes(target) &&
        /assigned more than once/.test(error.message),
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

test("malformed persisted JSON reports the runtime file path", async () => {
  const previousDataDir = process.env.GUILD_DATA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-integrity-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    const target = path.join(directory, "quests.json");
    await writeFile(target, "{ definitely not json", "utf8");

    await assert.rejects(
      () => readQuests(),
      (error) =>
        error instanceof QuestStorageError &&
        error.message.includes(target) &&
        /not valid JSON/.test(error.message),
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
