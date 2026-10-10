import { questScopeAllowsMember } from "../Guild/authorityPolicy.js";

export class QuestCompletionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "QuestCompletionError";
    this.code = code;
    this.status = status;
  }
}

const REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);

function cleanText(value, maxLength, label, { required = false } = {}) {
  const normalized = String(value || "").trim();

  if (required && !normalized) {
    throw new QuestCompletionError(
      "completion_note_required",
      `${label} is required.`,
      400,
    );
  }

  if (normalized.length > maxLength) {
    throw new QuestCompletionError(
      "completion_note_too_long",
      `${label} must be ${maxLength} characters or fewer.`,
      400,
    );
  }

  return normalized;
}

function actorName(value, fallback = "Guild member") {
  return (
    value?.displayName ||
    value?.guildNickname ||
    value?.globalName ||
    value?.username ||
    fallback
  );
}

function findTarget(document, questId, objectiveId) {
  const quest = document.quests.find((item) => item.id === questId);
  const objective = quest?.objectives.find((item) => item.id === objectiveId);

  if (!quest || !objective) {
    throw new QuestCompletionError(
      "objective_not_found",
      "That objective no longer exists.",
      404,
    );
  }

  return { quest, objective };
}

function assertPublished(quest) {
  if (quest.publication !== "published") {
    throw new QuestCompletionError(
      "quest_not_published",
      "Publish the quest before completion can be requested or reviewed.",
      400,
    );
  }
}

function normalizedReward(reward) {
  return {
    rep: Number(reward?.rep) || 0,
    marks: Number(reward?.marks) || 0,
    items: (Array.isArray(reward?.items) ? reward.items : [])
      .map((item) => ({
        name: String(item?.name || "").trim(),
        quantity: Number(item?.quantity) || 0,
      }))
      .sort((left, right) =>
        `${left.name}\u0000${left.quantity}`.localeCompare(
          `${right.name}\u0000${right.quantity}`,
        ),
      ),
  };
}

export function completionFingerprint(objective) {
  const assignees = (Array.isArray(objective?.assignments)
    ? objective.assignments
    : []
  )
    .map((assignment) => ({
      memberId: String(assignment?.memberId || ""),
      name: String(assignment?.name || "").trim(),
    }))
    .sort((left, right) =>
      `${left.memberId}\u0000${left.name}`.localeCompare(
        `${right.memberId}\u0000${right.name}`,
      ),
    );

  return JSON.stringify({
    title: String(objective?.title || "").trim(),
    description: String(objective?.description || "").trim(),
    priority: String(objective?.priority || "Medium"),
    need: String(objective?.need || "").trim(),
    reward: normalizedReward(objective?.reward),
    assignees,
  });
}

function rowForObjective(db, objectiveId) {
  return db
    .prepare(
      "SELECT * FROM quest_completion_requests WHERE objective_id = ?",
    )
    .get(objectiveId);
}

function effectiveState(row, objective) {
  if (!row) return null;

  if (objective?.completed) {
    return "issued";
  }

  if (
    (row.status === "pending" || row.status === "approved") &&
    row.objective_fingerprint !== completionFingerprint(objective)
  ) {
    return "stale";
  }

  return REVIEW_STATUSES.has(row.status) ? row.status : null;
}

function projectState(row, objective) {
  if (!row) return null;

  const status = effectiveState(row, objective);
  if (!status) return null;

  return {
    objectiveId: row.objective_id,
    questId: row.quest_id,
    status,
    requestedByMemberId: row.requested_by_member_id,
    requestedByName: row.requested_by_name || "Guild member",
    requestedAt: row.requested_at,
    requestNote: row.request_note || "",
    reviewedByMemberId: row.reviewed_by_member_id || "",
    reviewedByName: row.reviewed_by_name || "",
    reviewedAt: row.reviewed_at || "",
    reviewNote: row.review_note || "",
  };
}

export function readCompletionStatesFromDatabase(
  db,
  document,
  { questId = "", publishedOnly = true } = {},
) {

  const quests = new Map(
    document.quests
      .filter(
        (quest) =>
          (!questId || quest.id === questId) &&
          (!publishedOnly || quest.publication === "published"),
      )
      .map((quest) => [quest.id, quest]),
  );
  const objectives = new Map();

  for (const quest of quests.values()) {
    for (const objective of quest.objectives) {
      objectives.set(objective.id, objective);
    }
  }

  const rows = questId
    ? db
        .prepare(
          "SELECT * FROM quest_completion_requests WHERE quest_id = ? ORDER BY updated_at DESC",
        )
        .all(questId)
    : db
        .prepare(
          "SELECT * FROM quest_completion_requests ORDER BY updated_at DESC",
        )
        .all();

  return Object.fromEntries(
    rows
      .filter(
        (row) => quests.has(row.quest_id) && objectives.has(row.objective_id),
      )
      .map((row) => [
        row.objective_id,
        projectState(row, objectives.get(row.objective_id)),
      ]),
  );
}

export function requestObjectiveCompletionInDatabase({
  db,
  document,
  questId,
  objectiveId,
  member,
  note = "",
  now = new Date().toISOString(),
}) {
  const { quest, objective } = findTarget(document, questId, objectiveId);
  assertPublished(quest);

  if (objective.completed) {
    throw new QuestCompletionError(
      "objective_already_completed",
      "That objective has already been completed.",
      409,
    );
  }

  const memberId = String(member?.id || "");
  const assigned = objective.assignments.some(
    (assignment) => assignment.memberId === memberId,
  );

  if (!memberId || !assigned) {
    throw new QuestCompletionError(
      "completion_request_assignment_required",
      "You must be assigned to this objective before requesting completion.",
      403,
    );
  }

  const existing = rowForObjective(db, objectiveId);
  const existingState = effectiveState(existing, objective);

  if (existingState === "pending") {
    throw new QuestCompletionError(
      "completion_already_requested",
      "Completion has already been requested for this objective.",
      409,
    );
  }

  if (existingState === "approved") {
    throw new QuestCompletionError(
      "completion_already_approved",
      "This objective is already approved and waiting for final completion.",
      409,
    );
  }

  const requestNote = cleanText(note, 800, "Completion note");

  db.prepare(
    `
      INSERT INTO quest_completion_requests (
        objective_id,
        quest_id,
        status,
        objective_fingerprint,
        requested_by_member_id,
        requested_by_name,
        requested_at,
        request_note,
        reviewed_by_member_id,
        reviewed_by_name,
        reviewed_at,
        review_note,
        updated_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NULL, '', '', '', ?)
      ON CONFLICT(objective_id) DO UPDATE SET
        quest_id = excluded.quest_id,
        status = 'pending',
        objective_fingerprint = excluded.objective_fingerprint,
        requested_by_member_id = excluded.requested_by_member_id,
        requested_by_name = excluded.requested_by_name,
        requested_at = excluded.requested_at,
        request_note = excluded.request_note,
        reviewed_by_member_id = NULL,
        reviewed_by_name = '',
        reviewed_at = '',
        review_note = '',
        updated_at = excluded.updated_at
    `,
  ).run(
    objectiveId,
    questId,
    completionFingerprint(objective),
    memberId,
    actorName(member),
    now,
    requestNote,
    now,
  );

  return projectState(rowForObjective(db, objectiveId), objective);
}

export function withdrawObjectiveCompletionInDatabase({
  db,
  document,
  questId,
  objectiveId,
  memberId,
}) {
  const { objective } = findTarget(document, questId, objectiveId);
  const row = rowForObjective(db, objectiveId);

  if (!row || row.quest_id !== questId) {
    throw new QuestCompletionError(
      "completion_request_not_found",
      "There is no completion request to withdraw.",
      404,
    );
  }

  const state = effectiveState(row, objective);

  if (row.requested_by_member_id !== memberId) {
    throw new QuestCompletionError(
      "completion_withdraw_forbidden",
      "Only the member who requested completion can withdraw it.",
      403,
    );
  }

  if (state !== "pending" && state !== "stale") {
    throw new QuestCompletionError(
      "completion_withdraw_closed",
      "That completion request has already been reviewed.",
      409,
    );
  }

  db.prepare(
    "DELETE FROM quest_completion_requests WHERE objective_id = ?",
  ).run(objectiveId);

  return null;
}

export function reviewObjectiveCompletionInDatabase({
  db,
  document,
  questId,
  objectiveId,
  decision,
  note = "",
  authority,
  actorMemberId,
  actor,
  now = new Date().toISOString(),
}) {
  const { quest, objective } = findTarget(document, questId, objectiveId);
  assertPublished(quest);

  if (
    !questScopeAllowsMember(
      authority,
      "rewards.issue",
      quest,
      actorMemberId,
    )
  ) {
    throw new QuestCompletionError(
      "completion_review_forbidden",
      "You cannot review completion for this quest.",
      403,
    );
  }

  const row = rowForObjective(db, objectiveId);

  if (!row || row.quest_id !== questId) {
    throw new QuestCompletionError(
      "completion_request_not_found",
      "Nobody has requested completion for this objective yet.",
      404,
    );
  }

  const state = effectiveState(row, objective);

  if (state === "stale") {
    throw new QuestCompletionError(
      "completion_request_stale",
      "The objective changed after completion was requested. Ask the assignee to request completion again.",
      409,
    );
  }

  if (state !== "pending") {
    throw new QuestCompletionError(
      "completion_request_closed",
      "That completion request has already been reviewed.",
      409,
    );
  }

  if (row.requested_by_member_id === actorMemberId) {
    throw new QuestCompletionError(
      "completion_self_review_forbidden",
      "A member cannot approve their own completion request.",
      403,
    );
  }

  const normalizedDecision = String(decision || "").toLowerCase();
  if (!new Set(["approved", "rejected"]).has(normalizedDecision)) {
    throw new QuestCompletionError(
      "completion_decision_invalid",
      "Choose approve or reject.",
      400,
    );
  }

  const reviewNote = cleanText(note, 800, "Review note", {
    required: normalizedDecision === "rejected",
  });

  db.prepare(
    `
      UPDATE quest_completion_requests
      SET
        status = ?,
        reviewed_by_member_id = ?,
        reviewed_by_name = ?,
        reviewed_at = ?,
        review_note = ?,
        updated_at = ?
      WHERE objective_id = ?
    `,
  ).run(
    normalizedDecision,
    actorMemberId || null,
    actorName(actor, "Officer"),
    now,
    reviewNote,
    now,
    objectiveId,
  );

  return projectState(rowForObjective(db, objectiveId), objective);
}

export function assertObjectiveCompletionApprovedInDatabase(
  db,
  document,
  questId,
  objectiveId,
) {
  const { objective } = findTarget(document, questId, objectiveId);
  const row = rowForObjective(db, objectiveId);
  const state = effectiveState(row, objective);

  if (state === "stale") {
    throw new QuestCompletionError(
      "completion_request_stale",
      "The objective changed after completion was approved. A new completion request is required.",
      409,
    );
  }

  if (state !== "approved") {
    throw new QuestCompletionError(
      "completion_approval_required",
      "An assigned member must request completion and an officer must approve the work before rewards can be issued.",
      409,
    );
  }

  return projectState(row, objective);
}
