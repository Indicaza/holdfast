import { Router } from "express";

import {
  requireAnyPermission,
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
  approveObjectiveReward,
  assertObjectiveCanIssue,
  enforceQuestWorkspaceAuthority,
  preserveQuestServerState,
  QuestGovernanceError,
} from "./questGovernance.js";
import {
  QuestValidationError,
  normalizeQuestDocument,
  projectFeaturedQuest,
  projectQuests,
  rewardNeedsApproval,
} from "./questSchema.js";
import {
  QuestSignupError,
  leaveObjective,
  signupForObjective,
} from "./questSignup.js";

const QUEST_MANAGEMENT_PERMISSIONS = [
  "quests.create",
  "quests.edit",
  "quests.publish",
  "rewards.approve",
  "rewards.issue",
  "rewards.policy.edit",
];

const QUEST_WRITE_PERMISSIONS = [
  "quests.create",
  "quests.edit",
  "quests.publish",
  "rewards.policy.edit",
];

function preserveRestrictedEconomy(raw, current) {
  return {
    ...raw,
    rewardPolicy: current.rewardPolicy,
    rewardLimits: current.rewardLimits,
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
  return rewardNeedsApproval(objective?.reward);
}

function actorDisplayName(user) {
  return (
    user?.guildNickname ||
    user?.globalName ||
    user?.displayName ||
    user?.username ||
    "Officer"
  );
}

function policyChanged(next, current) {
  return (
    next.rewardPolicy !== current.rewardPolicy ||
    JSON.stringify(next.rewardLimits) !==
      JSON.stringify(current.rewardLimits)
  );
}

function assertEconomyPolicyChangeAllowed(next, current, auth) {
  if (!policyChanged(next, current)) return;

  if (!auth.permissions.includes("rewards.policy.edit")) {
    throw new QuestGovernanceError(
      "reward_policy_forbidden",
      "You do not have permission to change guild economy policy.",
      403,
    );
  }

  if (auth.authority?.isOwner) return;

  const available = [
    auth.authority?.rewardLimits?.approve,
    auth.authority?.rewardLimits?.issue,
  ].filter(Boolean);

  const ceiling = {
    repPerObjective: Math.max(
      0,
      ...available.map((limits) => Number(limits.repPerObjective) || 0),
    ),
    marksPerObjective: Math.max(
      0,
      ...available.map((limits) => Number(limits.marksPerObjective) || 0),
    ),
    marksPerQuest: Math.max(
      0,
      ...available.map((limits) => Number(limits.marksPerQuest) || 0),
    ),
  };

  if (
    next.rewardLimits.rep.max > ceiling.repPerObjective ||
    next.rewardLimits.marks.max > ceiling.marksPerObjective ||
    next.rewardLimits.marksPerQuestMax > ceiling.marksPerQuest
  ) {
    throw new QuestGovernanceError(
      "economy_ceiling_exceeded",
      "Guild economy guardrails cannot be raised above your own reward authority.",
      403,
    );
  }
}

function governedIncomingDocument(raw, current, req) {
  const source = req.auth.permissions.includes("rewards.policy.edit")
    ? raw
    : preserveRestrictedEconomy(raw, current);

  let next = normalizeQuestDocument(source);
  next = preserveQuestServerState(
    next,
    current,
    req.auth.user.id,
  );
  next = normalizeQuestDocument(next);

  assertEconomyPolicyChangeAllowed(next, current, req.auth);

  return enforceQuestWorkspaceAuthority(next, current, {
    authority: req.auth.authority,
    actorMemberId: req.auth.user.id,
  });
}

function sendQuestError(res, error) {
  if (error instanceof QuestRevisionConflict) {
    res.status(409).json({
      error: error.code,
      message: error.message,
      currentRevision: error.currentRevision,
    });
    return true;
  }

  if (error instanceof QuestValidationError) {
    res.status(400).json({
      error: "invalid_quest_document",
      message: error.message,
    });
    return true;
  }

  if (error instanceof QuestGovernanceError) {
    res.status(error.status).json({
      error: error.code,
      message: error.message,
    });
    return true;
  }

  if (error?.status && error?.code) {
    res.status(error.status).json({
      error: error.code,
      message: error.message,
    });
    return true;
  }

  return false;
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

        if (sendQuestError(res, error)) return;

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

        if (sendQuestError(res, error)) return;

        console.error("Unable to remove member from objective", error);
        res.status(500).json({
          error: "quest_unassign_failed",
          message: "Holdfast could not remove that assignment. Try again.",
        });
      }
    },
  );

  router.get(
    "/manage",
    requireAnyPermission(QUEST_MANAGEMENT_PERMISSIONS),
    async (req, res) => {
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
    },
  );

  router.put(
    "/manage",
    requireAnyPermission(QUEST_WRITE_PERMISSIONS),
    adminWriteRateLimit,
    async (req, res) => {
      try {
        const saved = await updateQuests(
          (current) =>
            governedIncomingDocument(req.body, current, req),
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
        if (sendQuestError(res, error)) return;

        console.error("Unable to save quest workspace", error);
        res.status(500).json({ error: "quests_save_failed" });
      }
    },
  );

  router.post(
    "/manage/approve-reward",
    requirePermission("rewards.approve"),
    adminWriteRateLimit,
    async (req, res) => {
      try {
        const questId = String(req.body?.questId || "");
        const objectiveId = String(req.body?.objectiveId || "");

        const result = withGuildTransaction((db) => {
          const current = readQuestsFromDatabase(db);
          const revisionBefore = assertQuestRevision(
            db,
            Number(req.body?.revision),
          );

          const approved = approveObjectiveReward(
            current,
            questId,
            objectiveId,
            {
              authority: req.auth.authority,
              actorMemberId: req.auth.user.id,
              actorName: actorDisplayName(req.auth.user),
            },
          );

          const saved = writeQuestsToDatabase(db, approved);
          const revisionAfter = questRevisionFromDatabase(db);

          recordAuditEventInDatabase({
            db,
            actorMemberId: req.auth.user.id,
            eventType: "quest.reward_approved",
            entityType: "objective",
            entityId: objectiveId,
            payload: {
              questId,
              objectiveId,
              revisionBefore,
              revisionAfter,
              before: current,
              after: saved,
            },
          });

          return { ...saved, revision: revisionAfter };
        });

        res.set("Cache-Control", "no-store");
        res.json(result);
      } catch (error) {
        if (sendQuestError(res, error)) return;

        console.error("Unable to approve objective reward", error);
        res.status(500).json({ error: "reward_approval_failed" });
      }
    },
  );

  router.post(
    "/manage/complete-objective",
    requirePermission("rewards.issue"),
    adminWriteRateLimit,
    async (req, res) => {
      try {
        const questId = String(req.body?.questId || "");
        const objectiveId = String(req.body?.objectiveId || "");

        const result = withGuildTransaction((db) => {
          const current = readQuestsFromDatabase(db);
          const revisionBefore = assertQuestRevision(
            db,
            Number(req.body?.revision),
          );
          const currentTarget = findObjective(
            current,
            questId,
            objectiveId,
          );

          if (!currentTarget.quest || !currentTarget.objective) {
            throw new QuestGovernanceError(
              "objective_not_found",
              "That objective no longer exists.",
              404,
            );
          }

          if (currentTarget.quest.publication !== "published") {
            throw new QuestGovernanceError(
              "quest_not_published",
              "Publish the quest before completing objectives.",
              400,
            );
          }

          if (currentTarget.objective.completed) {
            throw new QuestGovernanceError(
              "objective_already_completed",
              "That objective has already been completed and rewarded.",
              409,
            );
          }

          const { quest, objective } = assertObjectiveCanIssue(
            current,
            questId,
            objectiveId,
            {
              authority: req.auth.authority,
              actorMemberId: req.auth.user.id,
            },
          );

          const memberIds = [
            ...new Set(
              objective.assignments
                .map((assignment) => assignment.memberId)
                .filter(Boolean),
            ),
          ];

          if (hasReward(objective) && !memberIds.length) {
            throw new QuestGovernanceError(
              "objective_unassigned",
              "Assign at least one guild member before issuing this reward.",
              400,
            );
          }

          const guildMembers = readGuildMembersFromDatabase(db);
          const memberById = new Map(
            guildMembers.map((member) => [member.id, member]),
          );
          const assignedMembers = memberIds
            .map((id) => memberById.get(id))
            .filter(Boolean);

          if (assignedMembers.length !== memberIds.length) {
            throw new QuestGovernanceError(
              "unknown_assignee",
              "One or more assigned members are no longer in the Holdfast member directory.",
              400,
            );
          }

          const awards = awardObjectiveInDatabase({
            db,
            quest,
            objective,
            members: assignedMembers,
            awardedBy: req.auth.user,
          });

          const saved = writeQuestsToDatabase(
            db,
            completeObjective(current, questId, objectiveId),
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
        if (sendQuestError(res, error)) return;

        console.error("Unable to complete objective", error);
        res.status(500).json({ error: "objective_completion_failed" });
      }
    },
  );

  return router;
}
