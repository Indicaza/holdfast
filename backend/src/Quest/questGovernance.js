import {
  questScopeAllowsMember,
  rewardLimitsFor,
} from "../Guild/authorityPolicy.js";
import {
  rewardFingerprint,
  rewardIsApproved,
  rewardNeedsApproval,
} from "./questSchema.js";

export class QuestGovernanceError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "QuestGovernanceError";
    this.code = code;
    this.status = status;
  }
}

function json(value) {
  return JSON.stringify(value);
}

function blankApproval() {
  return {
    approvedByMemberId: "",
    approvedByName: "",
    approvedAt: "",
    fingerprint: "",
  };
}

function objectiveEditableSnapshot(objective) {
  return {
    id: objective.id,
    title: objective.title,
    description: objective.description,
    priority: objective.priority,
    need: objective.need,
    reward: objective.reward,
    assignments: objective.assignments,
  };
}

function questEditableSnapshot(quest) {
  return {
    id: quest.id,
    mode: quest.mode,
    title: quest.title,
    summary: quest.summary,
    objectives: quest.objectives.map(objectiveEditableSnapshot),
  };
}

function questOrder(document) {
  return document.quests.map((quest) => quest.id);
}

function canAct(authority, permission, quest, actorMemberId) {
  return questScopeAllowsMember(
    authority,
    permission,
    quest,
    actorMemberId,
  );
}

function assertCanAct(
  authority,
  permission,
  quest,
  actorMemberId,
  message,
) {
  if (!canAct(authority, permission, quest, actorMemberId)) {
    throw new QuestGovernanceError(
      "quest_scope_forbidden",
      message,
      403,
    );
  }
}

function objectiveById(quest, objectiveId) {
  return quest?.objectives?.find(
    (objective) => objective.id === objectiveId,
  );
}

function totalMarksForQuest(quest) {
  return (quest?.objectives || []).reduce(
    (total, objective) =>
      total + (Number(objective?.reward?.marks) || 0),
    0,
  );
}

function assertAmountWithinPolicy(currency, amount, range) {
  if (amount === 0) return;

  if (amount < range.min || amount > range.max) {
    const label = currency === "rep" ? "Rep" : "Marks";
    throw new QuestGovernanceError(
      "reward_policy_exceeded",
      `${label} rewards must be 0 or between ${range.min} and ${range.max}.`,
      400,
    );
  }
}

export function assertChangedRewardsWithinPolicy(next, current) {
  const currentById = new Map(
    current.quests.map((quest) => [quest.id, quest]),
  );

  for (const nextQuest of next.quests) {
    const currentQuest = currentById.get(nextQuest.id);
    const currentObjectives = new Map(
      (currentQuest?.objectives || []).map((objective) => [
        objective.id,
        objective,
      ]),
    );

    for (const nextObjective of nextQuest.objectives) {
      const currentObjective = currentObjectives.get(nextObjective.id);

      for (const currency of ["rep", "marks"]) {
        const nextAmount = Number(nextObjective.reward?.[currency]) || 0;
        const currentAmount = currentObjective
          ? Number(currentObjective.reward?.[currency]) || 0
          : null;

        if (currentAmount === nextAmount) continue;

        assertAmountWithinPolicy(
          currency,
          nextAmount,
          next.rewardLimits[currency],
        );
      }
    }

    const nextMarks = totalMarksForQuest(nextQuest);
    const currentMarks = currentQuest ? totalMarksForQuest(currentQuest) : 0;

    if (nextMarks !== currentMarks) {
      const allowedMarks = Math.max(
        Number(next.rewardLimits.marksPerQuestMax) || 0,
        currentMarks,
      );

      if (nextMarks > allowedMarks) {
        throw new QuestGovernanceError(
          "reward_policy_exceeded",
          `This quest proposes ${nextMarks} Marks, above the ${next.rewardLimits.marksPerQuestMax} Marks per quest limit.`,
          400,
        );
      }
    }
  }

  return true;
}

export function assertRewardWithinAuthority(
  authority,
  permission,
  quest,
  objective,
) {
  const limits = rewardLimitsFor(authority, permission);
  const rep = Number(objective?.reward?.rep) || 0;
  const marks = Number(objective?.reward?.marks) || 0;
  const questMarks = totalMarksForQuest(quest);

  if (rep > limits.repPerObjective) {
    throw new QuestGovernanceError(
      "reward_authority_exceeded",
      `This reward proposes ${rep} Rep. Your limit is ${limits.repPerObjective} Rep per objective.`,
      403,
    );
  }

  if (marks > limits.marksPerObjective) {
    throw new QuestGovernanceError(
      "reward_authority_exceeded",
      `This reward proposes ${marks} Marks. Your limit is ${limits.marksPerObjective} Marks per objective.`,
      403,
    );
  }

  if (questMarks > limits.marksPerQuest) {
    throw new QuestGovernanceError(
      "reward_authority_exceeded",
      `This quest proposes ${questMarks} Marks. Your limit is ${limits.marksPerQuest} Marks per quest.`,
      403,
    );
  }

  return true;
}

export function preserveQuestServerState(
  next,
  current,
  actorMemberId,
  now = new Date().toISOString(),
) {
  const currentQuests = new Map(
    current.quests.map((quest) => [quest.id, quest]),
  );

  return {
    ...next,
    quests: next.quests.map((quest) => {
      const existingQuest = currentQuests.get(quest.id);
      const currentObjectives = new Map(
        (existingQuest?.objectives || []).map((objective) => [
          objective.id,
          objective,
        ]),
      );

      return {
        ...quest,
        createdByMemberId:
          existingQuest?.createdByMemberId || actorMemberId || "",
        createdAt: existingQuest?.createdAt || now,
        objectives: quest.objectives.map((objective) => {
          const existingObjective = currentObjectives.get(objective.id);
          const sameReward =
            existingObjective &&
            rewardFingerprint(existingObjective.reward) ===
              rewardFingerprint(objective.reward);

          return {
            ...objective,
            completed: existingObjective?.completed === true,
            rewardApproval: sameReward
              ? existingObjective.rewardApproval || blankApproval()
              : blankApproval(),
          };
        }),
      };
    }),
  };
}

function assertCompletedObjectivesUnchanged(nextQuest, currentQuest) {
  if (!currentQuest) return;

  const nextObjectives = new Map(
    nextQuest.objectives.map((objective) => [objective.id, objective]),
  );

  for (const currentObjective of currentQuest.objectives) {
    if (!currentObjective.completed) continue;

    const nextObjective = nextObjectives.get(currentObjective.id);

    if (
      !nextObjective ||
      json(objectiveEditableSnapshot(nextObjective)) !==
        json(objectiveEditableSnapshot(currentObjective))
    ) {
      throw new QuestGovernanceError(
        "completed_objective_locked",
        "Completed objectives are locked after their rewards are recorded.",
        409,
      );
    }
  }
}

export function enforceQuestWorkspaceAuthority(
  next,
  current,
  {
    authority,
    actorMemberId,
  },
) {
  const currentById = new Map(
    current.quests.map((quest) => [quest.id, quest]),
  );
  const nextById = new Map(next.quests.map((quest) => [quest.id, quest]));

  for (const currentQuest of current.quests) {
    const nextQuest = nextById.get(currentQuest.id);

    if (!nextQuest) {
      assertCanAct(
        authority,
        "quests.edit",
        currentQuest,
        actorMemberId,
        "You can only delete quests inside your quest scope.",
      );
      continue;
    }

    assertCompletedObjectivesUnchanged(nextQuest, currentQuest);

    if (
      json(questEditableSnapshot(nextQuest)) !==
      json(questEditableSnapshot(currentQuest))
    ) {
      assertCanAct(
        authority,
        "quests.edit",
        currentQuest,
        actorMemberId,
        "You can only edit quests inside your quest scope.",
      );
    }

    if (nextQuest.publication !== currentQuest.publication) {
      assertCanAct(
        authority,
        "quests.publish",
        currentQuest,
        actorMemberId,
        "You do not have permission to publish or archive this quest.",
      );
    }
  }

  for (const nextQuest of next.quests) {
    if (currentById.has(nextQuest.id)) continue;

    if (!authority?.permissions?.includes("quests.create")) {
      throw new QuestGovernanceError(
        "quest_create_forbidden",
        "You do not have permission to create quests.",
        403,
      );
    }

    if (nextQuest.createdByMemberId !== actorMemberId) {
      throw new QuestGovernanceError(
        "quest_creator_invalid",
        "New quests must be owned by their creator.",
        403,
      );
    }

    if (nextQuest.publication !== "draft") {
      assertCanAct(
        authority,
        "quests.publish",
        nextQuest,
        actorMemberId,
        "You do not have permission to publish new quests.",
      );
    }
  }

  const survivingIds = new Set(
    current.quests
      .filter((quest) => nextById.has(quest.id))
      .map((quest) => quest.id),
  );
  const currentSurvivorOrder = questOrder(current).filter((id) =>
    survivingIds.has(id),
  );
  const nextSurvivorOrder = questOrder(next).filter((id) =>
    survivingIds.has(id),
  );

  if (json(nextSurvivorOrder) !== json(currentSurvivorOrder)) {
    if (
      !authority?.permissions?.includes("quests.edit") ||
      authority?.questScopes?.["quests.edit"] !== "all"
    ) {
      throw new QuestGovernanceError(
        "quest_order_forbidden",
        "Reordering the global quest board requires All quest scope.",
        403,
      );
    }
  }

  if (next.focusedQuestId !== current.focusedQuestId) {
    if (
      !authority?.permissions?.includes("quests.publish") ||
      authority?.questScopes?.["quests.publish"] !== "all"
    ) {
      throw new QuestGovernanceError(
        "quest_focus_forbidden",
        "Changing the featured quest requires All publish scope.",
        403,
      );
    }
  }

  return next;
}

export function approveObjectiveReward(
  document,
  questId,
  objectiveId,
  {
    authority,
    actorMemberId,
    actorName,
    now = new Date().toISOString(),
  },
) {
  const quest = document.quests.find((item) => item.id === questId);
  const objective = objectiveById(quest, objectiveId);

  if (!quest || !objective) {
    throw new QuestGovernanceError(
      "objective_not_found",
      "That objective no longer exists.",
      404,
    );
  }

  assertCanAct(
    authority,
    "rewards.approve",
    quest,
    actorMemberId,
    "You cannot approve rewards for this quest.",
  );

  if (!rewardNeedsApproval(objective.reward)) {
    throw new QuestGovernanceError(
      "reward_not_required",
      "This objective has no reward that needs approval.",
      400,
    );
  }

  assertRewardWithinAuthority(
    authority,
    "rewards.approve",
    quest,
    objective,
  );

  return {
    ...document,
    quests: document.quests.map((item) =>
      item.id !== questId
        ? item
        : {
            ...item,
            objectives: item.objectives.map((candidate) =>
              candidate.id !== objectiveId
                ? candidate
                : {
                    ...candidate,
                    rewardApproval: {
                      approvedByMemberId: actorMemberId || "",
                      approvedByName: actorName || "Officer",
                      approvedAt: now,
                      fingerprint: rewardFingerprint(candidate.reward),
                    },
                  },
            ),
          },
    ),
  };
}

export function assertObjectiveCanIssue(
  document,
  questId,
  objectiveId,
  {
    authority,
    actorMemberId,
  },
) {
  const quest = document.quests.find((item) => item.id === questId);
  const objective = objectiveById(quest, objectiveId);

  if (!quest || !objective) {
    throw new QuestGovernanceError(
      "objective_not_found",
      "That objective no longer exists.",
      404,
    );
  }

  assertCanAct(
    authority,
    "rewards.issue",
    quest,
    actorMemberId,
    "You cannot issue rewards for this quest.",
  );

  if (rewardNeedsApproval(objective.reward) && !rewardIsApproved(objective)) {
    throw new QuestGovernanceError(
      "reward_approval_required",
      "This reward must be approved before it can be issued.",
      409,
    );
  }

  assertRewardWithinAuthority(
    authority,
    "rewards.issue",
    quest,
    objective,
  );

  return { quest, objective };
}

export function rewardApprovalState(objective) {
  if (!rewardNeedsApproval(objective?.reward)) return "not-required";
  return rewardIsApproved(objective) ? "approved" : "pending";
}
