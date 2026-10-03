import { Router } from "express";

import {
  requireAuthenticated,
  requirePermission,
} from "../Auth/permissions.js";
import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { readGuildMembersFromDatabase } from "../Guild/memberRepository.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import { readQuestsFromDatabase } from "./questRepository.js";
import {
  QuestCompletionError,
  assertObjectiveCompletionApprovedInDatabase,
  readCompletionStatesFromDatabase,
  requestObjectiveCompletionInDatabase,
  reviewObjectiveCompletionInDatabase,
  withdrawObjectiveCompletionInDatabase,
} from "./questCompletion.js";

function sendCompletionError(res, error) {
  if (!(error instanceof QuestCompletionError)) return false;

  res.status(error.status).json({
    error: error.code,
    message: error.message,
  });
  return true;
}

function targetFromBody(body) {
  return {
    questId: String(body?.questId || ""),
    objectiveId: String(body?.objectiveId || ""),
  };
}

function requireTarget(res, target) {
  if (target.questId && target.objectiveId) return true;

  res.status(400).json({
    error: "completion_target_required",
    message: "Choose an objective first.",
  });
  return false;
}

export function createQuestCompletionRouter() {
  const router = Router();
  const writeRateLimit = createRateLimiter({
    name: "quest-completion-write",
    windowMs: 10 * 60 * 1000,
    max: 90,
  });

  router.get(
    "/member/completions",
    requireAuthenticated,
    (req, res) => {
      try {
        const questId = String(req.query?.questId || "");
        const completions = withGuildDatabase((db) => {
          const document = readQuestsFromDatabase(db);
          return readCompletionStatesFromDatabase(db, document, {
            questId,
            publishedOnly: true,
          });
        });

        res.set("Cache-Control", "no-store");
        res.json({ completions });
      } catch (error) {
        if (sendCompletionError(res, error)) return;

        console.error("Unable to read quest completion requests", error);
        res.status(500).json({
          error: "quest_completions_unavailable",
          message: "Holdfast could not load completion status.",
        });
      }
    },
  );

  router.post(
    "/member/request-completion",
    requireAuthenticated,
    writeRateLimit,
    (req, res) => {
      const target = targetFromBody(req.body);
      if (!requireTarget(res, target)) return;

      try {
        const completion = withGuildTransaction((db) => {
          const document = readQuestsFromDatabase(db);
          const member = readGuildMembersFromDatabase(db).find(
            (item) => item.id === req.auth.user.id,
          );

          if (!member) {
            throw new QuestCompletionError(
              "member_not_found",
              "Your Holdfast member profile could not be found.",
              403,
            );
          }

          const saved = requestObjectiveCompletionInDatabase({
            db,
            document,
            ...target,
            member,
            note: req.body?.note,
          });

          recordAuditEventInDatabase({
            db,
            actorMemberId: member.id,
            eventType: "quest.completion_requested",
            entityType: "objective",
            entityId: target.objectiveId,
            payload: {
              ...target,
              requestNote: saved.requestNote,
            },
          });

          return saved;
        });

        res.set("Cache-Control", "no-store");
        res.status(201).json({ completion });
      } catch (error) {
        if (sendCompletionError(res, error)) return;

        console.error("Unable to request objective completion", error);
        res.status(500).json({
          error: "completion_request_failed",
          message: "Holdfast could not request completion. Try again.",
        });
      }
    },
  );

  router.post(
    "/member/withdraw-completion",
    requireAuthenticated,
    writeRateLimit,
    (req, res) => {
      const target = targetFromBody(req.body);
      if (!requireTarget(res, target)) return;

      try {
        withGuildTransaction((db) => {
          const document = readQuestsFromDatabase(db);

          withdrawObjectiveCompletionInDatabase({
            db,
            document,
            ...target,
            memberId: req.auth.user.id,
          });

          recordAuditEventInDatabase({
            db,
            actorMemberId: req.auth.user.id,
            eventType: "quest.completion_withdrawn",
            entityType: "objective",
            entityId: target.objectiveId,
            payload: target,
          });
        });

        res.set("Cache-Control", "no-store");
        res.json({ completion: null });
      } catch (error) {
        if (sendCompletionError(res, error)) return;

        console.error("Unable to withdraw objective completion", error);
        res.status(500).json({
          error: "completion_withdraw_failed",
          message: "Holdfast could not withdraw that request. Try again.",
        });
      }
    },
  );

  router.post(
    "/manage/review-completion",
    requirePermission("rewards.issue"),
    writeRateLimit,
    (req, res) => {
      const target = targetFromBody(req.body);
      if (!requireTarget(res, target)) return;

      try {
        const completion = withGuildTransaction((db) => {
          const document = readQuestsFromDatabase(db);
          const saved = reviewObjectiveCompletionInDatabase({
            db,
            document,
            ...target,
            decision: req.body?.decision,
            note: req.body?.note,
            authority: req.auth.authority,
            actorMemberId: req.auth.user.id,
            actor: req.auth.user,
          });

          recordAuditEventInDatabase({
            db,
            actorMemberId: req.auth.user.id,
            eventType:
              saved.status === "approved"
                ? "quest.completion_approved"
                : "quest.completion_rejected",
            entityType: "objective",
            entityId: target.objectiveId,
            payload: {
              ...target,
              decision: saved.status,
              reviewNote: saved.reviewNote,
              requestedByMemberId: saved.requestedByMemberId,
            },
          });

          return saved;
        });

        res.set("Cache-Control", "no-store");
        res.json({ completion });
      } catch (error) {
        if (sendCompletionError(res, error)) return;

        console.error("Unable to review objective completion", error);
        res.status(500).json({
          error: "completion_review_failed",
          message: "Holdfast could not save that review. Try again.",
        });
      }
    },
  );

  // This middleware intentionally runs before the existing authoritative
  // completion/reward endpoint. Once work is approved, the normal quest route
  // still performs revision checks, reward authority checks, contribution
  // writes, and objective completion atomically.
  router.post(
    "/manage/complete-objective",
    requirePermission("rewards.issue"),
    (req, res, next) => {
      const target = targetFromBody(req.body);
      if (!requireTarget(res, target)) return;

      try {
        withGuildDatabase((db) => {
          const document = readQuestsFromDatabase(db);
          assertObjectiveCompletionApprovedInDatabase(
            db,
            document,
            target.questId,
            target.objectiveId,
          );
        });
        next();
      } catch (error) {
        if (sendCompletionError(res, error)) return;
        next(error);
      }
    },
  );

  return router;
}
