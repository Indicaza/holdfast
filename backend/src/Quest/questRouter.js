import { Router } from "express";

import {
  requireAuthenticated,
  requirePermission,
} from "../Auth/permissions.js";
import { awardObjective } from "../Contribution/contributionRepository.js";
import { readGuildMembers } from "../Guild/memberRepository.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import {
  QuestStorageError,
  readQuests,
  writeQuests,
} from "./questRepository.js";
import {
  QuestValidationError,
  normalizeQuestDocument,
  projectFeaturedQuest,
  projectQuests,
} from "./questSchema.js";
import {
  QuestSignupError,
  signupForObjective,
} from "./questSignup.js";

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

export function createQuestRouter() {
  const router = Router();
  const adminWriteRateLimit = createRateLimiter({
    name: "quest-admin-write",
    windowMs: 10 * 60 * 1000,
    max: 120,
  });
  const memberSignupRateLimit = createRateLimiter({
    name: "quest-member-signup",
    windowMs: 10 * 60 * 1000,
    max: 60,
  });

  router.get("/", async (req, res) => {
    try {
      const document = await readQuests();
      res.set("Cache-Control", "no-store");
      res.json(projectFeaturedQuest(document));
    } catch (error) {
      console.error("Unable to read featured quest", error);
      res.status(500).json({ error: "quests_unavailable" });
    }
  });

  router.get("/member", requireAuthenticated, async (req, res) => {
    try {
      const document = await readQuests();
      res.set("Cache-Control", "no-store");
      res.json(projectQuests(document, req.auth.user.id));
    } catch (error) {
      console.error("Unable to read member quest board", error);
      res.status(500).json({ error: "quests_unavailable" });
    }
  });

  router.post(
    "/member/signup",
    requireAuthenticated,
    memberSignupRateLimit,
    async (req, res) => {
      try {
        const questId = String(req.body?.questId || "");
        const objectiveId = String(req.body?.objectiveId || "");

        if (!questId || !objectiveId) {
          res.status(400).json({
            error: "signup_target_required",
            message: "Choose an objective before signing up.",
          });
          return;
        }

        const members = await readGuildMembers();
        const member = members.find((item) => item.id === req.auth.user.id);

        if (!member) {
          res.status(403).json({
            error: "member_not_found",
            message: "Your Holdfast member profile could not be found.",
          });
          return;
        }

        const current = await readQuests();
        const result = signupForObjective(
          current,
          member,
          questId,
          objectiveId,
        );
        const saved = await writeQuests(result.document);

        res.set("Cache-Control", "no-store");
        res.status(201).json({
          catalog: projectQuests(saved, member.id),
          questId,
          objectiveId,
        });
      } catch (error) {
        if (error instanceof QuestSignupError) {
          res.status(error.status).json({
            error: error.code,
            message: error.message,
            ...error.details,
          });
          return;
        }

        if (error instanceof QuestValidationError) {
          res.status(400).json({
            error: "invalid_quest_document",
            message: error.message,
          });
          return;
        }

        console.error("Unable to sign member up for objective", error);
        res.status(500).json({
          error: "quest_signup_failed",
          message: "Holdfast could not save that signup. Try again.",
        });
      }
    },
  );

  router.get("/manage", requirePermission("quests.edit"), async (req, res) => {
    try {
      const document = await readQuests();
      res.set("Cache-Control", "no-store");
      res.json(document);
    } catch (error) {
      console.error("Unable to read quest workspace", error);

      if (error instanceof QuestStorageError) {
        res.status(500).json({
          error: "quest_data_invalid",
          message: error.message,
        });
        return;
      }

      res.status(500).json({ error: "quests_unavailable" });
    }
  });

  router.put(
    "/manage",
    requirePermission("quests.edit"),
    adminWriteRateLimit,
    async (req, res) => {
    try {
      const current = await readQuests();
      let document = normalizeQuestDocument(req.body);
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
  },
  );

  router.post(
    "/manage/complete-objective",
    requirePermission("quests.edit"),
    adminWriteRateLimit,
    async (req, res) => {
      try {
        const current = await readQuests();
        let document = normalizeQuestDocument(req.body.document);
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
