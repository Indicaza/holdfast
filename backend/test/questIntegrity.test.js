import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  QuestValidationError,
  normalizeQuestDocument,
  rewardFingerprint,
  rewardIsApproved,
} from "../src/Quest/questSchema.js";
import {
  readQuests,
  writeQuestEconomyToDatabase,
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

test("quest marks are capped across all objectives", () => {
  const document = validDocument();
  document.rewardLimits.marksPerQuestMax = 50;
  document.quests[0].objectives[0].reward.marks = 30;
  document.quests[0].objectives.push({
    id: "objective-two",
    title: "Second reward",
    description: "",
    priority: "Medium",
    completed: false,
    need: "",
    reward: {
      rep: 0,
      marks: 21,
      items: [],
    },
    assignments: [],
  });

  assert.throws(
    () => normalizeQuestDocument(document),
    (error) =>
      error instanceof QuestValidationError &&
      /51 Marks/.test(error.message) &&
      /50 Marks per quest/.test(error.message),
  );
});

test("reward approval is bound to the exact approved reward", () => {
  const document = validDocument();
  const objective = document.quests[0].objectives[0];

  objective.rewardApproval = {
    approvedByMemberId: "officer-one",
    approvedByName: "Rook",
    approvedAt: "2026-10-02T12:00:00.000Z",
    fingerprint: rewardFingerprint(objective.reward),
  };

  const normalized = normalizeQuestDocument(document);
  assert.equal(rewardIsApproved(normalized.quests[0].objectives[0]), true);

  normalized.quests[0].objectives[0].reward.rep += 1;
  assert.equal(rewardIsApproved(normalized.quests[0].objectives[0]), false);
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

test("stored rewards above configured caps remain readable without changing policy", async () => {
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

    const document = await readQuests();

    assert.equal(document.quests[0].objectives[0].reward.rep, 5000);
    assert.equal(document.rewardLimits.rep.max, 1000);
    assert.throws(
      () => normalizeQuestDocument(document),
      (error) =>
        error instanceof QuestValidationError &&
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

test("economy updates do not rewrite quest or assignment rows", async () => {
  const previousDataDir = process.env.GUILD_DATA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-economy-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    await writeQuests(validDocument());

    const before = withGuildDatabase((db) => ({
      questRowId: db
        .prepare("SELECT rowid FROM quests WHERE id = 'quest-one'")
        .get().rowid,
      objectiveRowId: db
        .prepare("SELECT rowid FROM objectives WHERE id = 'objective-one'")
        .get().rowid,
      assignmentId: db
        .prepare(
          "SELECT id FROM assignments WHERE objective_id = 'objective-one'",
        )
        .get().id,
    }));

    withGuildDatabase((db) =>
      writeQuestEconomyToDatabase(db, {
        rewardPolicy: "Keep rewards modest.",
        rewardLimits: {
          rep: { min: 0, max: 250 },
          marks: { min: 0, max: 25 },
          marksPerQuestMax: 50,
        },
      }),
    );

    const after = withGuildDatabase((db) => ({
      questRowId: db
        .prepare("SELECT rowid FROM quests WHERE id = 'quest-one'")
        .get().rowid,
      objectiveRowId: db
        .prepare("SELECT rowid FROM objectives WHERE id = 'objective-one'")
        .get().rowid,
      assignmentId: db
        .prepare(
          "SELECT id FROM assignments WHERE objective_id = 'objective-one'",
        )
        .get().id,
    }));
    const document = await readQuests();

    assert.deepEqual(after, before);
    assert.equal(document.rewardPolicy, "Keep rewards modest.");
    assert.deepEqual(document.rewardLimits, {
      rep: { min: 0, max: 250 },
      marks: { min: 0, max: 25 },
      marksPerQuestMax: 50,
    });
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
