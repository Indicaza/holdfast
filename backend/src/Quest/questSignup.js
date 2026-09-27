import { normalizeQuestDocument } from "./questSchema.js";

export class QuestSignupError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "QuestSignupError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assignmentInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function memberAssignment(member) {
  const name = member.displayName || member.username || "Member";

  return {
    memberId: member.id,
    name,
    responsibility: "Volunteer",
    detail: "",
    initials: member.initials || assignmentInitials(name),
    ...(member.avatarUrl ? { avatar: member.avatarUrl } : {}),
  };
}

function signupTarget(document, questId, objectiveId) {
  const quest = document.quests.find((item) => item.id === questId);
  const objective = quest?.objectives.find((item) => item.id === objectiveId);

  if (!quest || !objective) {
    throw new QuestSignupError(
      "objective_not_found",
      "That objective is no longer available.",
      404,
    );
  }

  return { quest, objective };
}

function selfAssignment(objective, memberId) {
  return objective.assignments.find(
    (assignment) => assignment.memberId === memberId,
  );
}

export function signupForObjective(document, member, questId, objectiveId) {
  if (!member?.id) {
    throw new QuestSignupError(
      "member_not_found",
      "Your Holdfast member profile could not be found.",
      403,
    );
  }

  const { quest, objective } = signupTarget(
    document,
    questId,
    objectiveId,
  );

  if (quest.publication !== "published") {
    throw new QuestSignupError(
      "quest_not_published",
      "That quest is not open for signup.",
      409,
    );
  }

  if (objective.completed) {
    throw new QuestSignupError(
      "objective_completed",
      "That objective is already complete.",
      409,
    );
  }

  if (selfAssignment(objective, member.id)) {
    throw new QuestSignupError(
      "already_assigned_to_objective",
      `You're already signed up for “${objective.title}”.`,
      409,
      {
        questId: quest.id,
        objectiveId: objective.id,
        objectiveTitle: objective.title,
      },
    );
  }

  if (objective.assignments.length >= 20) {
    throw new QuestSignupError(
      "objective_full",
      "That objective already has the maximum number of assignees.",
      409,
    );
  }

  const next = {
    ...document,
    quests: document.quests.map((questItem) =>
      questItem.id !== quest.id
        ? questItem
        : {
            ...questItem,
            objectives: questItem.objectives.map((objectiveItem) =>
              objectiveItem.id !== objective.id
                ? objectiveItem
                : {
                    ...objectiveItem,
                    assignments: [
                      ...objectiveItem.assignments,
                      memberAssignment(member),
                    ],
                  },
            ),
          },
    ),
  };

  return {
    document: normalizeQuestDocument(next),
    quest,
    objective,
  };
}

export function leaveObjective(document, memberId, questId, objectiveId) {
  if (!memberId) {
    throw new QuestSignupError(
      "member_not_found",
      "Your Holdfast member profile could not be found.",
      403,
    );
  }

  const { quest, objective } = signupTarget(
    document,
    questId,
    objectiveId,
  );

  if (objective.completed) {
    throw new QuestSignupError(
      "objective_completed",
      "Completed objectives cannot be left.",
      409,
    );
  }

  if (!selfAssignment(objective, memberId)) {
    throw new QuestSignupError(
      "not_assigned_to_objective",
      `You're not signed up for “${objective.title}”.`,
      409,
      {
        questId: quest.id,
        objectiveId: objective.id,
        objectiveTitle: objective.title,
      },
    );
  }

  const next = {
    ...document,
    quests: document.quests.map((questItem) =>
      questItem.id !== quest.id
        ? questItem
        : {
            ...questItem,
            objectives: questItem.objectives.map((objectiveItem) =>
              objectiveItem.id !== objective.id
                ? objectiveItem
                : {
                    ...objectiveItem,
                    assignments: objectiveItem.assignments.filter(
                      (assignment) => assignment.memberId !== memberId,
                    ),
                  },
            ),
          },
    ),
  };

  return {
    document: normalizeQuestDocument(next),
    quest,
    objective,
  };
}
