import {
  guildDatabaseFile,
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import { requireGuildId } from "../Guild/guildScope.js";
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

// Each guild's quest workspace has its own revision, kept on its
// quest_settings row.
export function questRevisionFromDatabase(db, guildId) {
  const row = db
    .prepare("SELECT revision FROM quest_settings WHERE guild_id = ?")
    .get(requireGuildId(guildId));
  const revision = Number(row?.revision || 0);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function ensureQuestSettings(db, guildId) {
  db.prepare("INSERT OR IGNORE INTO quest_settings (guild_id) VALUES (?)").run(
    guildId,
  );
}

function advanceQuestRevision(db, guildId) {
  ensureQuestSettings(db, guildId);
  db.prepare(
    "UPDATE quest_settings SET revision = revision + 1 WHERE guild_id = ?",
  ).run(guildId);

  return questRevisionFromDatabase(db, guildId);
}

export function assertQuestRevision(db, guildId, expectedRevision) {
  const currentRevision = questRevisionFromDatabase(db, guildId);

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

function settingsFromDatabase(db, guildId) {
  return (
    db
      .prepare("SELECT * FROM quest_settings WHERE guild_id = ?")
      .get(guildId) || {
      focused_quest_id: "",
      reward_policy: "",
      rep_min: 0,
      rep_max: 1000,
      marks_min: 0,
      marks_max: 1000,
      marks_quest_max: 1000,
    }
  );
}

function rewardLimitsFromSettings(settings) {
  return {
    rep: {
      min: Number(settings.rep_min) || 0,
      max: Number(settings.rep_max) || 0,
    },
    marks: {
      min: Number(settings.marks_min) || 0,
      max: Number(settings.marks_max) || 0,
    },
    marksPerQuestMax: Number(settings.marks_quest_max) || 0,
  };
}

function assignmentsForObjective(db, guildId, objectiveId) {
  return db
    .prepare(
      `
        SELECT *
        FROM assignments
        WHERE guild_id = ? AND objective_id = ?
        ORDER BY sort_order, id
      `,
    )
    .all(guildId, objectiveId)
    .map((row) => ({
      memberId: row.member_id || "",
      name: row.name,
      responsibility: row.responsibility || "",
      detail: row.detail || "",
      initials: row.initials,
      ...(row.avatar ? { avatar: row.avatar } : {}),
    }));
}

function rewardItemsForObjective(db, guildId, objectiveId) {
  return db
    .prepare(
      `
        SELECT *
        FROM reward_items
        WHERE guild_id = ? AND objective_id = ?
        ORDER BY sort_order, id
      `,
    )
    .all(guildId, objectiveId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      quantity: Number(row.quantity),
    }));
}

function objectivesForQuest(db, guildId, questId) {
  return db
    .prepare(
      `
        SELECT *
        FROM objectives
        WHERE guild_id = ? AND quest_id = ?
        ORDER BY sort_order, id
      `,
    )
    .all(guildId, questId)
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
        items: rewardItemsForObjective(db, guildId, row.id),
      },
      rewardApproval: {
        approvedByMemberId: row.reward_approved_by_member_id || "",
        approvedByName: row.reward_approved_by_name || "",
        approvedAt: row.reward_approved_at || "",
        fingerprint: row.reward_approved_fingerprint || "",
      },
      assignments: assignmentsForObjective(db, guildId, row.id),
    }));
}

export function readQuestsFromDatabase(db, guildId) {
  const id = requireGuildId(guildId);

  try {
    const settings = settingsFromDatabase(db, id);
    const quests = db
      .prepare("SELECT * FROM quests WHERE guild_id = ? ORDER BY sort_order, id")
      .all(id)
      .map((row) => ({
        id: row.id,
        publication: row.publication,
        mode: row.mode,
        title: row.title,
        summary: row.summary || "",
        createdByMemberId: row.created_by_member_id || "",
        createdAt: row.created_at || "",
        objectives: objectivesForQuest(db, id, row.id),
        completed: Boolean(row.completed),
      }));

    return normalizeQuestDocument(
      {
        version: 1,
        focusedQuestId: settings.focused_quest_id || "",
        rewardPolicy: settings.reward_policy || "",
        rewardLimits: rewardLimitsFromSettings(settings),
        quests,
      },
      { enforceRewardLimits: false },
    );
  } catch (error) {
    if (error instanceof QuestStorageError) {
      throw error;
    }

    throw storedQuestError(error);
  }
}

export function writeQuestsToDatabase(
  db,
  guildId,
  document,
  { enforceRewardLimits = true } = {},
) {
  const id = requireGuildId(guildId);
  const normalized = normalizeQuestDocument(document, {
    enforceRewardLimits,
  });

  ensureQuestSettings(db, id);
  db.prepare(
    `
      UPDATE quest_settings
      SET
        focused_quest_id = ?,
        reward_policy = ?,
        rep_min = ?,
        rep_max = ?,
        marks_min = ?,
        marks_max = ?,
        marks_quest_max = ?
      WHERE guild_id = ?
    `,
  ).run(
    normalized.focusedQuestId,
    normalized.rewardPolicy,
    normalized.rewardLimits.rep.min,
    normalized.rewardLimits.rep.max,
    normalized.rewardLimits.marks.min,
    normalized.rewardLimits.marks.max,
    normalized.rewardLimits.marksPerQuestMax,
    id,
  );

  db.prepare("DELETE FROM quests WHERE guild_id = ?").run(id);

  const insertQuest = db.prepare(
    `
      INSERT INTO quests (
        guild_id,
        id,
        publication,
        mode,
        title,
        summary,
        created_by_member_id,
        created_at,
        completed,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertObjective = db.prepare(
    `
      INSERT INTO objectives (
        guild_id,
        id,
        quest_id,
        title,
        description,
        priority,
        completed,
        need,
        reward_rep,
        reward_marks,
        reward_approved_by_member_id,
        reward_approved_by_name,
        reward_approved_at,
        reward_approved_fingerprint,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertRewardItem = db.prepare(
    `
      INSERT INTO reward_items (
        guild_id,
        id,
        objective_id,
        name,
        quantity,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  );
  const insertAssignment = db.prepare(
    `
      INSERT INTO assignments (
        guild_id,
        objective_id,
        member_id,
        name,
        responsibility,
        detail,
        initials,
        avatar,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  normalized.quests.forEach((quest, questIndex) => {
    insertQuest.run(
      id,
      quest.id,
      quest.publication,
      quest.mode,
      quest.title,
      quest.summary,
      quest.createdByMemberId || null,
      quest.createdAt || "",
      quest.completed ? 1 : 0,
      questIndex,
    );

    quest.objectives.forEach((objective, objectiveIndex) => {
      insertObjective.run(
        id,
        objective.id,
        quest.id,
        objective.title,
        objective.description,
        objective.priority,
        objective.completed ? 1 : 0,
        objective.need,
        objective.reward.rep,
        objective.reward.marks,
        objective.rewardApproval?.approvedByMemberId || null,
        objective.rewardApproval?.approvedByName || "",
        objective.rewardApproval?.approvedAt || "",
        objective.rewardApproval?.fingerprint || "",
        objectiveIndex,
      );

      objective.reward.items.forEach((item, itemIndex) => {
        insertRewardItem.run(
          id,
          item.id,
          objective.id,
          item.name,
          item.quantity,
          itemIndex,
        );
      });

      objective.assignments.forEach((assignment, assignmentIndex) => {
        insertAssignment.run(
          id,
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

  advanceQuestRevision(db, id);

  return normalized;
}

export function writeQuestEconomyToDatabase(
  db,
  guildId,
  { rewardPolicy, rewardLimits },
) {
  const id = requireGuildId(guildId);
  const normalized = normalizeQuestDocument({
    version: 1,
    focusedQuestId: "",
    rewardPolicy: rewardPolicy ?? "",
    rewardLimits,
    quests: [],
  });

  ensureQuestSettings(db, id);
  db.prepare(
    `
      UPDATE quest_settings
      SET
        reward_policy = ?,
        rep_min = ?,
        rep_max = ?,
        marks_min = ?,
        marks_max = ?,
        marks_quest_max = ?
      WHERE guild_id = ?
    `,
  ).run(
    normalized.rewardPolicy,
    normalized.rewardLimits.rep.min,
    normalized.rewardLimits.rep.max,
    normalized.rewardLimits.marks.min,
    normalized.rewardLimits.marks.max,
    normalized.rewardLimits.marksPerQuestMax,
    id,
  );

  advanceQuestRevision(db, id);

  return {
    rewardPolicy: normalized.rewardPolicy,
    rewardLimits: normalized.rewardLimits,
  };
}

export function importQuestsIntoDatabase(db, guildId, document) {
  return writeQuestsToDatabase(db, guildId, document);
}

export async function readQuests(guildId) {
  return withGuildDatabase((db) => readQuestsFromDatabase(db, guildId));
}

export async function readQuestWorkspace(guildId) {
  return withGuildDatabase((db) => ({
    ...readQuestsFromDatabase(db, guildId),
    revision: questRevisionFromDatabase(db, guildId),
  }));
}

export async function writeQuests(guildId, document) {
  return withGuildTransaction((db) =>
    writeQuestsToDatabase(db, guildId, document),
  );
}

export async function updateQuests(guildId, mutator, options = {}) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const current = readQuestsFromDatabase(db, id);
    const revisionBefore = questRevisionFromDatabase(db, id);

    if (options.expectedRevision !== undefined) {
      assertQuestRevision(db, id, options.expectedRevision);
    }

    const next = mutator(current);

    if (next && typeof next.then === "function") {
      throw new Error("Quest mutations must be synchronous");
    }

    const saved = writeQuestsToDatabase(db, id, next, {
      enforceRewardLimits: options.enforceRewardLimits !== false,
    });
    const revisionAfter = questRevisionFromDatabase(db, id);

    if (options.audit) {
      recordAuditEventInDatabase({
        db,
        ...options.audit,
        guildId: id,
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
