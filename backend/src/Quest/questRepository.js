import {
  guildDatabaseFile,
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  QuestValidationError,
  normalizeQuestDocument,
} from "./questSchema.js";

export class QuestStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "QuestStorageError";
  }
}

export class QuestRevisionConflict extends Error {
  constructor(expectedRevision, currentRevision) {
    super("Quest data changed after this workspace was loaded.");
    this.name = "QuestRevisionConflict";
    this.code = "quest_revision_conflict";
    this.status = 409;
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export function questRevisionFromDatabase(db) {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = 'quest_revision'")
    .get();
  const revision = Number(row?.value || 0);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function advanceQuestRevision(db) {
  const revision = questRevisionFromDatabase(db) + 1;

  db.prepare(
    `
      INSERT INTO app_meta (key, value, updated_at)
      VALUES ('quest_revision', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
  ).run(String(revision), new Date().toISOString());

  return revision;
}

export function assertQuestRevision(db, expectedRevision) {
  const currentRevision = questRevisionFromDatabase(db);

  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision !== currentRevision
  ) {
    throw new QuestRevisionConflict(expectedRevision, currentRevision);
  }

  return currentRevision;
}

function storedQuestError(error) {
  const detail =
    error instanceof QuestValidationError
      ? error.message
      : error.message || "Unknown quest data error.";

  return new QuestStorageError(
    `Stored quest data is invalid in ${guildDatabaseFile()}: ${detail}`,
    error,
  );
}

function settingsFromDatabase(db) {
  return (
    db.prepare("SELECT * FROM quest_settings WHERE id = 1").get() || {
      focused_quest_id: "",
      reward_policy: "",
      rep_min: 0,
      rep_max: 1000,
      marks_min: 0,
      marks_max: 1000,
    }
  );
}

function assignmentsForObjective(db, objectiveId) {
  return db
    .prepare(
      `
        SELECT *
        FROM assignments
        WHERE objective_id = ?
        ORDER BY sort_order, id
      `,
    )
    .all(objectiveId)
    .map((row) => ({
      memberId: row.member_id || "",
      name: row.name,
      responsibility: row.responsibility || "",
      detail: row.detail || "",
      initials: row.initials,
      ...(row.avatar ? { avatar: row.avatar } : {}),
    }));
}

function rewardItemsForObjective(db, objectiveId) {
  return db
    .prepare(
      `
        SELECT *
        FROM reward_items
        WHERE objective_id = ?
        ORDER BY sort_order, id
      `,
    )
    .all(objectiveId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      quantity: Number(row.quantity),
    }));
}

function objectivesForQuest(db, questId) {
  return db
    .prepare(
      `
        SELECT *
        FROM objectives
        WHERE quest_id = ?
        ORDER BY sort_order, id
      `,
    )
    .all(questId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || "",
      priority: row.priority,
      completed: Boolean(row.completed),
      need: row.need || "",
      reward: {
        rep: Number(row.reward_rep) || 0,
        marks: Number(row.reward_marks) || 0,
        items: rewardItemsForObjective(db, row.id),
      },
      assignments: assignmentsForObjective(db, row.id),
    }));
}

export function readQuestsFromDatabase(db) {
  try {
    const settings = settingsFromDatabase(db);
    const quests = db
      .prepare("SELECT * FROM quests ORDER BY sort_order, id")
      .all()
      .map((row) => ({
        id: row.id,
        publication: row.publication,
        mode: row.mode,
        title: row.title,
        summary: row.summary || "",
        objectives: objectivesForQuest(db, row.id),
        completed: Boolean(row.completed),
      }));

    return normalizeQuestDocument({
      version: 1,
      focusedQuestId: settings.focused_quest_id || "",
      rewardPolicy: settings.reward_policy || "",
      rewardLimits: {
        rep: {
          min: Number(settings.rep_min) || 0,
          max: Number(settings.rep_max) || 0,
        },
        marks: {
          min: Number(settings.marks_min) || 0,
          max: Number(settings.marks_max) || 0,
        },
      },
      quests,
    });
  } catch (error) {
    if (error instanceof QuestStorageError) {
      throw error;
    }

    throw storedQuestError(error);
  }
}

export function writeQuestsToDatabase(db, document) {
  const normalized = normalizeQuestDocument(document);

  db.prepare(
    `
      UPDATE quest_settings
      SET
        focused_quest_id = ?,
        reward_policy = ?,
        rep_min = ?,
        rep_max = ?,
        marks_min = ?,
        marks_max = ?
      WHERE id = 1
    `,
  ).run(
    normalized.focusedQuestId,
    normalized.rewardPolicy,
    normalized.rewardLimits.rep.min,
    normalized.rewardLimits.rep.max,
    normalized.rewardLimits.marks.min,
    normalized.rewardLimits.marks.max,
  );

  db.prepare("DELETE FROM quests").run();

  const insertQuest = db.prepare(
    `
      INSERT INTO quests (
        id,
        publication,
        mode,
        title,
        summary,
        completed,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertObjective = db.prepare(
    `
      INSERT INTO objectives (
        id,
        quest_id,
        title,
        description,
        priority,
        completed,
        need,
        reward_rep,
        reward_marks,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertRewardItem = db.prepare(
    `
      INSERT INTO reward_items (
        id,
        objective_id,
        name,
        quantity,
        sort_order
      ) VALUES (?, ?, ?, ?, ?)
    `,
  );
  const insertAssignment = db.prepare(
    `
      INSERT INTO assignments (
        objective_id,
        member_id,
        name,
        responsibility,
        detail,
        initials,
        avatar,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  normalized.quests.forEach((quest, questIndex) => {
    insertQuest.run(
      quest.id,
      quest.publication,
      quest.mode,
      quest.title,
      quest.summary,
      quest.completed ? 1 : 0,
      questIndex,
    );

    quest.objectives.forEach((objective, objectiveIndex) => {
      insertObjective.run(
        objective.id,
        quest.id,
        objective.title,
        objective.description,
        objective.priority,
        objective.completed ? 1 : 0,
        objective.need,
        objective.reward.rep,
        objective.reward.marks,
        objectiveIndex,
      );

      objective.reward.items.forEach((item, itemIndex) => {
        insertRewardItem.run(
          item.id,
          objective.id,
          item.name,
          item.quantity,
          itemIndex,
        );
      });

      objective.assignments.forEach((assignment, assignmentIndex) => {
        insertAssignment.run(
          objective.id,
          assignment.memberId || null,
          assignment.name,
          assignment.responsibility,
          assignment.detail,
          assignment.initials,
          assignment.avatar || null,
          assignmentIndex,
        );
      });
    });
  });

  advanceQuestRevision(db);

  return normalized;
}

export function importQuestsIntoDatabase(db, document) {
  return writeQuestsToDatabase(db, document);
}

export async function readQuests() {
  return withGuildDatabase((db) => readQuestsFromDatabase(db));
}

export async function readQuestWorkspace() {
  return withGuildDatabase((db) => ({
    ...readQuestsFromDatabase(db),
    revision: questRevisionFromDatabase(db),
  }));
}

export async function writeQuests(document) {
  return withGuildTransaction((db) =>
    writeQuestsToDatabase(db, document),
  );
}

export async function updateQuests(mutator, options = {}) {
  return withGuildTransaction((db) => {
    const current = readQuestsFromDatabase(db);
    const revisionBefore = questRevisionFromDatabase(db);

    if (options.expectedRevision !== undefined) {
      assertQuestRevision(db, options.expectedRevision);
    }

    const next = mutator(current);

    if (next && typeof next.then === "function") {
      throw new Error("Quest mutations must be synchronous");
    }

    const saved = writeQuestsToDatabase(db, next);
    const revisionAfter = questRevisionFromDatabase(db);

    if (options.audit) {
      recordAuditEventInDatabase({
        db,
        ...options.audit,
        payload: {
          ...(options.audit.payload || {}),
          revisionBefore,
          revisionAfter,
          ...(options.audit.includeDocuments
            ? { before: current, after: saved }
            : {}),
        },
      });
    }

    return options.includeRevision
      ? { ...saved, revision: revisionAfter }
      : saved;
  });
}
