import { readGuildMembers } from "../Guild/memberRepository.js";
import {
  readQuestWorkspace,
  updateQuests,
} from "./questRepository.js";
import { projectQuests } from "./questSchema.js";
import {
  QuestSignupError,
  leaveObjective,
  signupForObjective,
} from "./questSignup.js";

const PRIORITY_ORDER = {
  Main: 1,
  High: 2,
  Medium: 3,
  Low: 4,
};

function questPriority(objectives) {
  let selected = "Low";
  let selectedOrder = PRIORITY_ORDER[selected];

  for (const objective of objectives || []) {
    const order = PRIORITY_ORDER[objective.priority] || 99;
    if (order < selectedOrder) {
      selected = objective.priority;
      selectedOrder = order;
    }
  }

  return selected;
}

function questRewards(objectives) {
  let rep = 0;
  let marks = 0;
  const items = new Map();

  for (const objective of objectives || []) {
    rep += Number(objective.reward?.rep) || 0;
    marks += Number(objective.reward?.marks) || 0;

    for (const item of objective.reward?.items || []) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      items.set(name, (items.get(name) || 0) + (Number(item.quantity) || 0));
    }
  }

  const rewards = [];
  if (rep > 0) rewards.push({ type: "rep", label: "Rep", amount: rep });
  if (marks > 0) rewards.push({ type: "marks", label: "Marks", amount: marks });

  for (const [name, quantity] of items) {
    rewards.push({
      type: "item",
      label: name,
      amount: quantity > 0 ? quantity : 1,
    });
  }

  return rewards;
}

function guildweaverObjective(objective) {
  const assignments = objective.assignments || [];
  const isSelf = assignments.some((assignment) => assignment.isSelf === true);

  return {
    id: objective.id,
    title: objective.title,
    description: objective.description || objective.need || "",
    priority: objective.priority,
    completed: objective.completed === true,
    assignment: {
      status: objective.completed
        ? "complete"
        : isSelf
          ? "assigned"
          : "available",
      me: isSelf,
      members: assignments.map((assignment) => assignment.name).filter(Boolean),
    },
  };
}

function guildweaverQuest(quest) {
  const objectives = (quest.objectives || []).map(guildweaverObjective);

  return {
    id: quest.id,
    campaign: quest.mode === "permanent" ? "Standing Orders" : "Guild Quests",
    mode: quest.mode,
    title: quest.title,
    description: quest.summary || "",
    priority: questPriority(quest.objectives),
    status: quest.completed ? "complete" : "active",
    rewards: questRewards(quest.objectives),
    objectives,
  };
}

export async function readGuildweaverQuestSnapshot(memberId) {
  const workspace = await readQuestWorkspace();
  const catalog = projectQuests(workspace, memberId);

  return {
    schemaVersion: 1,
    revision: Number(workspace.revision) || 0,
    updatedAt: new Date().toISOString(),
    synced: true,
    items: catalog.quests.map(guildweaverQuest),
  };
}

function normalizeAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = String(value.id || "").trim();
  const action = String(value.action || "").trim().toLowerCase();
  const questId = String(value.questId || "").trim();
  const objectiveId = String(value.objectiveId || "").trim();

  if (!id || !questId || !objectiveId || !["join", "leave"].includes(action)) {
    return null;
  }

  return { id, action, questId, objectiveId };
}

function idempotentSignupError(action, error) {
  return (
    (action === "join" && error.code === "already_assigned_to_objective") ||
    (action === "leave" && error.code === "not_assigned_to_objective")
  );
}

export async function applyGuildweaverQuestActions({ memberId, actions }) {
  if (!Array.isArray(actions) || actions.length > 50) {
    return { status: "invalid", results: [] };
  }

  const members = await readGuildMembers();
  const member = members.find((item) => item.id === memberId);

  if (!member) {
    return { status: "member-not-found", results: [] };
  }

  const results = [];

  for (const rawAction of actions) {
    const action = normalizeAction(rawAction);

    if (!action) {
      results.push({
        id: String(rawAction?.id || ""),
        status: "rejected",
        error: "invalid_quest_action",
      });
      continue;
    }

    try {
      await updateQuests(
        (current) =>
          action.action === "join"
            ? signupForObjective(
                current,
                member,
                action.questId,
                action.objectiveId,
              ).document
            : leaveObjective(
                current,
                member.id,
                action.questId,
                action.objectiveId,
              ).document,
        {
          enforceRewardLimits: false,
          audit: {
            actorMemberId: member.id,
            eventType:
              action.action === "join"
                ? "quest.objective_joined"
                : "quest.objective_left",
            entityType: "objective",
            entityId: action.objectiveId,
            payload: {
              questId: action.questId,
              objectiveId: action.objectiveId,
              source: "guildweaver",
              actionId: action.id,
            },
          },
        },
      );

      results.push({ id: action.id, status: "applied" });
    } catch (error) {
      if (error instanceof QuestSignupError) {
        if (idempotentSignupError(action.action, error)) {
          results.push({ id: action.id, status: "already-applied" });
          continue;
        }

        results.push({
          id: action.id,
          status: "rejected",
          error: error.code,
          message: error.message,
        });
        continue;
      }

      throw error;
    }
  }

  return { status: "ok", results };
}
