import { Router } from "express";

import { requirePermission } from "../Auth/permissions.js";
import { awardObjective } from "../Contribution/contributionRepository.js";
import { readGuildMembers } from "../Guild/memberRepository.js";
import { readQuests, writeQuests } from "./questRepository.js";
import {
  QuestValidationError,
  normalizeQuestDocument,
  projectQuests,
} from "./questSchema.js";

function preserveRestrictedEconomy(next, current) {
  return {
    ...next,
    rewardPolicy: current.rewardPolicy,
    rewardLimits: current.rewardLimits,
  };
}

function completionByObjective(document) {
  const completion = new Map();

  for (const quest of document.quests) {
    for (const objective of quest.objectives) {
      completion.set(objective.id, objective.completed === true);
    }
  }

  return completion;
}

function preserveObjectiveCompletion(next, current) {
  const completion = completionByObjective(current);

  return {
    ...next,
    quests: next.quests.map((quest) => ({
      ...quest,
      objectives: quest.objectives.map((objective) => ({
        ...objective,
        completed: completion.get(objective.id) === true,
      })),
    })),
  };
}

function findObjective(document, questId, objectiveId) {
  const quest = document.quests.find((item) => item.id === questId);
  const objective = quest?.objectives.find((item) => item.id === objectiveId);

  return { quest, objective };
}

function completeObjective(document, questId, objectiveId) {
  return {
    ...document,
    quests: document.quests.map((quest) =>
      quest.id !== questId
        ? quest
        : {
            ...quest,
            objectives: quest.objectives.map((objective) =>
              objective.id === objectiveId
                ? { ...objective, completed: true }
                : objective,
            ),
          },
    ),
  };
}

function hasReward(objective) {
  return (
    objective.reward.rep > 0 ||
    objective.reward.marks > 0 ||
    objective.reward.items.length > 0
  );
}

function assertUniqueAssignees(document) {
  for (const quest of document.quests) {
    for (const objective of quest.objectives) {
      const seen = new Set();

      for (const assignment of objective.assignments) {
        if (!assignment.memberId) continue;

        if (seen.has(assignment.memberId)) {
          throw new QuestValidationError(
            `“${assignment.name}” is assigned more than once to “${objective.title}”.`,
          );
        }

        seen.add(assignment.memberId);
      }
    }
  }
}

export function createQuestRouter() {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const document = await readQuests();
      res.set("Cache-Control", "no-store");
      res.json(projectQuests(document));
    } catch (error) {
      console.error("Unable to read quests", error);
      res.status(500).json({ error: "quests_unavailable" });
    }
  });

  router.get("/manage", requirePermission("quests.edit"), async (req, res) => {
    try {
      const document = await readQuests();
      res.set("Cache-Control", "no-store");
      res.json(document);
    } catch (error) {
      console.error("Unable to read quest workspace", error);
      res.status(500).json({ error: "quests_unavailable" });
    }
  });

  router.put("/manage", requirePermission("quests.edit"), async (req, res) => {
    try {
      const current = await readQuests();
      let document = normalizeQuestDocument(req.body);
      assertUniqueAssignees(document);
      document = preserveObjectiveCompletion(document, current);

      if (!req.auth.permissions.includes("rewards.policy.edit")) {
        document = preserveRestrictedEconomy(document, current);
      }

      const saved = await writeQuests(document);
      res.set("Cache-Control", "no-store");
      res.json(saved);
    } catch (error) {
      if (error instanceof QuestValidationError) {
        res.status(400).json({
          error: "invalid_quest_document",
          message: error.message,
        });
        return;
      }

      console.error("Unable to save quest workspace", error);
      res.status(500).json({ error: "quests_save_failed" });
    }
  });

  router.post(
    "/manage/complete-objective",
    requirePermission("quests.edit"),
    async (req, res) => {
      try {
        const current = await readQuests();
        let document = normalizeQuestDocument(req.body.document);
        assertUniqueAssignees(document);
        document = preserveObjectiveCompletion(document, current);

        if (!req.auth.permissions.includes("rewards.policy.edit")) {
          document = preserveRestrictedEconomy(document, current);
        }

        document = normalizeQuestDocument(document);

        const questId = String(req.body.questId || "");
        const objectiveId = String(req.body.objectiveId || "");
        const target = findObjective(document, questId, objectiveId);
        const currentTarget = findObjective(current, questId, objectiveId);

        if (!target.quest || !target.objective) {
          res.status(404).json({
            error: "objective_not_found",
            message: "That objective no longer exists.",
          });
          return;
        }

        if (target.quest.publication !== "published") {
          res.status(400).json({
            error: "quest_not_published",
            message: "Publish the quest before completing objectives.",
          });
          return;
        }

        if (currentTarget.objective?.completed) {
          res.status(409).json({
            error: "objective_already_completed",
            message: "That objective has already been completed and rewarded.",
          });
          return;
        }

        const memberIds = [
          ...new Set(
            target.objective.assignments
              .map((assignment) => assignment.memberId)
              .filter(Boolean),
          ),
        ];

        if (hasReward(target.objective) && !memberIds.length) {
          res.status(400).json({
            error: "objective_unassigned",
            message: "Assign at least one guild member before issuing this reward.",
          });
          return;
        }

        const guildMembers = await readGuildMembers();
        const memberById = new Map(guildMembers.map((member) => [member.id, member]));
        const assignedMembers = memberIds.map((id) => memberById.get(id)).filter(Boolean);

        if (assignedMembers.length !== memberIds.length) {
          res.status(400).json({
            error: "unknown_assignee",
            message: "One or more assigned members are no longer in the GuildOS member directory.",
          });
          return;
        }

        const awards = await awardObjective({
          quest: target.quest,
          objective: target.objective,
          members: assignedMembers,
          awardedBy: req.auth.user,
        });

        const saved = await writeQuests(
          completeObjective(document, questId, objectiveId),
        );

        res.set("Cache-Control", "no-store");
        res.json({ document: saved, awards });
      } catch (error) {
        if (error instanceof QuestValidationError) {
          res.status(400).json({
            error: "invalid_quest_document",
            message: error.message,
          });
          return;
        }

        console.error("Unable to complete objective", error);
        res.status(500).json({ error: "objective_completion_failed" });
      }
    },
  );

  return router;
}
