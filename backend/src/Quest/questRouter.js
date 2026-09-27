import { Router } from "express";

import {
  requireAuthenticated,
  requirePermission,
} from "../Auth/permissions.js";
import { awardObjectiveInDatabase } from "../Contribution/contributionRepository.js";
import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import { withGuildTransaction } from "../Data/database.js";
import {
  readGuildMembers,
  readGuildMembersFromDatabase,
} from "../Guild/memberRepository.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import {
  QuestStorageError,
  QuestRevisionConflict,
  assertQuestRevision,
  readQuests,
  readQuestsFromDatabase,
  readQuestWorkspace,
  questRevisionFromDatabase,
  updateQuests,
  writeQuestsToDatabase,
} from "./questRepository.js";
import {
  QuestValidationError,
  normalizeQuestDocument,
  projectFeaturedQuest,
  projectQuests,
} from "./questSchema.js";
import {
  QuestSignupError,
  leaveObjective,
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

        const saved = await updateQuests(
          (current) =>
            signupForObjective(
              current,
              member,
              questId,
              objectiveId,
            ).document,
          {
            audit: {
              actorMemberId: member.id,
              eventType: "quest.objective_joined",
              entityType: "objective",
              entityId: objectiveId,
              payload: { questId, objectiveId },
            },
          },
        );

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

  router.post(
    "/member/unassign",
    requireAuthenticated,
    memberSignupRateLimit,
    async (req, res) => {
      try {
        const questId = String(req.body?.questId || "");
        const objectiveId = String(req.body?.objectiveId || "");

        if (!questId || !objectiveId) {
          res.status(400).json({
            error: "signup_target_required",
            message: "Choose an objective before leaving it.",
          });
          return;
        }

        const memberId = req.auth.user.id;
        const saved = await updateQuests(
          (current) =>
            leaveObjective(
              current,
              memberId,
              questId,
              objectiveId,
            ).document,
          {
            audit: {
              actorMemberId: memberId,
              eventType: "quest.objective_left",
              entityType: "objective",
              entityId: objectiveId,
              payload: { questId, objectiveId },
            },
          },
        );

        res.set("Cache-Control", "no-store");
        res.json({
          catalog: projectQuests(saved, memberId),
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

        console.error("Unable to remove member from objective", error);
        res.status(500).json({
          error: "quest_unassign_failed",
          message: "Holdfast could not remove that assignment. Try again.",
        });
      }
    },
  );

  router.get("/manage", requirePermission("quests.edit"), async (req, res) => {
    try {
      const document = await readQuestWorkspace();
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
      const saved = await updateQuests(
        (current) => {
          let document = normalizeQuestDocument(req.body);
          document = preserveObjectiveCompletion(document, current);

          if (!req.auth.permissions.includes("rewards.policy.edit")) {
            document = preserveRestrictedEconomy(document, current);
          }

          return document;
        },
        {
          expectedRevision: Number(req.body?.revision),
          includeRevision: true,
          audit: {
            actorMemberId: req.auth.user.id,
            eventType: "quest.workspace_saved",
            entityType: "quest_workspace",
            entityId: "primary",
            includeDocuments: true,
          },
        },
      );

      res.set("Cache-Control", "no-store");
      res.json(saved);
    } catch (error) {
      if (error instanceof QuestRevisionConflict) {
        res.status(409).json({
          error: error.code,
          message: error.message,
          currentRevision: error.currentRevision,
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
        const questId = String(req.body.questId || "");
        const objectiveId = String(req.body.objectiveId || "");

        const result = withGuildTransaction((db) => {
          const current = readQuestsFromDatabase(db);
          const revisionBefore = assertQuestRevision(
            db,
            Number(req.body.document?.revision),
          );
          let document = normalizeQuestDocument(req.body.document);
          document = preserveObjectiveCompletion(document, current);

          if (!req.auth.permissions.includes("rewards.policy.edit")) {
            document = preserveRestrictedEconomy(document, current);
          }

          document = normalizeQuestDocument(document);

          const target = findObjective(document, questId, objectiveId);
          const currentTarget = findObjective(current, questId, objectiveId);

          if (!target.quest || !target.objective) {
            const error = new Error("That objective no longer exists.");
            error.code = "objective_not_found";
            error.status = 404;
            throw error;
          }

          if (target.quest.publication !== "published") {
            const error = new Error(
              "Publish the quest before completing objectives.",
            );
            error.code = "quest_not_published";
            error.status = 400;
            throw error;
          }

          if (currentTarget.objective?.completed) {
            const error = new Error(
              "That objective has already been completed and rewarded.",
            );
            error.code = "objective_already_completed";
            error.status = 409;
            throw error;
          }

          const memberIds = [
            ...new Set(
              target.objective.assignments
                .map((assignment) => assignment.memberId)
                .filter(Boolean),
            ),
          ];

          if (hasReward(target.objective) && !memberIds.length) {
            const error = new Error(
              "Assign at least one guild member before issuing this reward.",
            );
            error.code = "objective_unassigned";
            error.status = 400;
            throw error;
          }

          const guildMembers = readGuildMembersFromDatabase(db);
          const memberById = new Map(
            guildMembers.map((member) => [member.id, member]),
          );
          const assignedMembers = memberIds
            .map((id) => memberById.get(id))
            .filter(Boolean);

          if (assignedMembers.length !== memberIds.length) {
            const error = new Error(
              "One or more assigned members are no longer in the GuildOS member directory.",
            );
            error.code = "unknown_assignee";
            error.status = 400;
            throw error;
          }

          const awards = awardObjectiveInDatabase({
            db,
            quest: target.quest,
            objective: target.objective,
            members: assignedMembers,
            awardedBy: req.auth.user,
          });

          const saved = writeQuestsToDatabase(
            db,
            completeObjective(document, questId, objectiveId),
          );

          const revisionAfter = questRevisionFromDatabase(db);

          recordAuditEventInDatabase({
            db,
            actorMemberId: req.auth.user.id,
            eventType: "quest.objective_completed",
            entityType: "objective",
            entityId: objectiveId,
            payload: {
              questId,
              objectiveId,
              revisionBefore,
              revisionAfter,
              awards,
              before: current,
              after: saved,
            },
          });

          return {
            document: { ...saved, revision: revisionAfter },
            awards,
          };
        });

        res.set("Cache-Control", "no-store");
        res.json(result);
      } catch (error) {
        if (error instanceof QuestRevisionConflict) {
          res.status(409).json({
            error: error.code,
            message: error.message,
            currentRevision: error.currentRevision,
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

        if (error?.status && error?.code) {
          res.status(error.status).json({
            error: error.code,
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
