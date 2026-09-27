import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readAuditEvents } from "../src/Audit/auditRepository.js";
import {
  QuestRevisionConflict,
  readQuestWorkspace,
  updateQuests,
  writeQuests,
} from "../src/Quest/questRepository.js";

function questDocument() {
  return {
    version: 1,
    focusedQuestId: "",
    rewardPolicy: "",
    rewardLimits: {
      rep: { min: 0, max: 1000 },
      marks: { min: 0, max: 1000 },
    },
    quests: [],
  };
}

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

test("quest revisions reject stale admin writes and retain audit history", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-revision-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;

    await writeQuests(questDocument());
    const opened = await readQuestWorkspace();

    assert.equal(opened.revision, 1);

    const saved = await updateQuests(
      (current) => ({ ...current, rewardPolicy: "Keep rewards useful." }),
      {
        expectedRevision: opened.revision,
        includeRevision: true,
        audit: {
          actorMemberId: "officer-one",
          eventType: "quest.workspace_saved",
          entityType: "quest_workspace",
          entityId: "primary",
          includeDocuments: true,
        },
      },
    );

    assert.equal(saved.revision, 2);
    assert.equal(saved.rewardPolicy, "Keep rewards useful.");

    await assert.rejects(
      () =>
        updateQuests(
          (current) => ({ ...current, rewardPolicy: "Stale overwrite" }),
          {
            expectedRevision: opened.revision,
            includeRevision: true,
          },
        ),
      (error) =>
        error instanceof QuestRevisionConflict &&
        error.currentRevision === 2,
    );

    const afterConflict = await readQuestWorkspace();
    assert.equal(afterConflict.revision, 2);
    assert.equal(afterConflict.rewardPolicy, "Keep rewards useful.");

    const events = readAuditEvents(100, { includeSnapshots: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "quest.workspace_saved");
    assert.equal(events[0].actorMemberId, "officer-one");
    assert.equal(events[0].payload.revisionBefore, 1);
    assert.equal(events[0].payload.revisionAfter, 2);
    assert.equal(events[0].payload.before.rewardPolicy, "");
    assert.equal(events[0].payload.after.rewardPolicy, "Keep rewards useful.");
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
