import { Router } from "express";

import { requireAuthenticated, requirePermission } from "../Auth/permissions.js";
import {
  readContributionTotals,
  readMemberContributionHistory,
} from "../Contribution/contributionRepository.js";
import { readQuests } from "../Quest/questRepository.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import {
  readGuildMembers,
  updateDetectedTimezone,
  updateGuildMemberProfile,
  updateGuildMemberRank,
} from "./memberRepository.js";
import { primaryCharacter } from "./memberProfile.js";
import {
  GUILD_RANKS,
  guildRankMetadata,
  normalizeGuildRank,
  repProgressionForRank,
} from "./rankSystem.js";
import {
  reconcileDiscordMemberRanks,
  syncDiscordMemberRank,
} from "../Discord/rankSync.js";

function emptyContribution() {
  return {
    rep: 0,
    marks: 0,
    completedObjectives: 0,
  };
}

function activeAssignmentsByMember(document) {
  const assignments = new Map();
  const seen = new Set();

  for (const quest of document.quests || []) {
    if (quest.publication !== "published") {
      continue;
    }

    for (const objective of quest.objectives || []) {
      if (objective.completed) {
        continue;
      }

      for (const assignment of objective.assignments || []) {
        if (!assignment.memberId) {
          continue;
        }

        const key = `${assignment.memberId}:${objective.id}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        const current = assignments.get(assignment.memberId) || [];
        current.push({
          questId: quest.id,
          questTitle: quest.title,
          objectiveId: objective.id,
          objectiveTitle: objective.title,
          priority: objective.priority,
          responsibility: assignment.responsibility || "",
          detail: assignment.detail || "",
          reward: {
            rep: Number(objective.reward?.rep) || 0,
            marks: Number(objective.reward?.marks) || 0,
            items: Array.isArray(objective.reward?.items)
              ? objective.reward.items
              : [],
          },
        });
        assignments.set(assignment.memberId, current);
      }
    }
  }

  return assignments;
}

function projectMember(member, totals, assignments) {
  const contribution = totals.get(member.id) || emptyContribution();
  const activeAssignments = assignments.get(member.id) || [];
  const rank = normalizeGuildRank(member.rank);
  const rankMeta = guildRankMetadata(rank);

  return {
    id: member.id,
    username: member.username,
    displayName: member.displayName,
    initials: member.initials,
    avatarUrl: member.avatarUrl,
    guildJoinedAt: member.guildJoinedAt || null,
    firstSeenAt: member.firstSeenAt,
    updatedAt: member.updatedAt,
    rank,
    rankManaged: Boolean(member.rankManaged),
    rankMeta,
    role: rankMeta.isLeadership ? "Leadership" : "Member",
    profile: member.profile,
    mainCharacter: primaryCharacter(member.profile),
    contribution,
    repProgression: repProgressionForRank(rank, contribution.rep),
    activeAssignmentCount: activeAssignments.length,
  };
}

function latestActivityAt(member, history) {
  const candidates = [
    history[0]?.createdAt,
    member.updatedAt,
    member.firstSeenAt,
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (!candidates.length) {
    return null;
  }

  return new Date(Math.max(...candidates)).toISOString();
}

async function memberWorkspace() {
  const [members, totals, quests] = await Promise.all([
    readGuildMembers(),
    readContributionTotals(),
    readQuests(),
  ]);

  return {
    members,
    totals,
    assignments: activeAssignmentsByMember(quests),
  };
}

async function profileFor(memberId) {
  const workspace = await memberWorkspace();
  const member = workspace.members.find((item) => item.id === memberId);

  if (!member) {
    return null;
  }

  const history = await readMemberContributionHistory(member.id);
  const projected = projectMember(
    member,
    workspace.totals,
    workspace.assignments,
  );

  return {
    ...projected,
    lastActivityAt: latestActivityAt(member, history),
    assignments: workspace.assignments.get(member.id) || [],
    activityCount: history.length,
    activity: history.slice(0, 40).map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      questId: transaction.questId,
      questTitle: transaction.questTitle,
      objectiveId: transaction.objectiveId,
      objectiveTitle: transaction.objectiveTitle,
      rep: Number(transaction.rep) || 0,
      marks: Number(transaction.marks) || 0,
      items: Array.isArray(transaction.items) ? transaction.items : [],
      createdAt: transaction.createdAt,
      awardedBy: transaction.awardedBy
        ? {
            memberId: transaction.awardedBy.memberId,
            displayName: transaction.awardedBy.displayName,
          }
        : null,
    })),
  };
}

export function createMemberRouter() {
  const router = Router();
  const profileWriteRateLimit = createRateLimiter({
    name: "member-profile-write",
    windowMs: 10 * 60 * 1000,
    max: 60,
  });
  const rankWriteRateLimit = createRateLimiter({
    name: "member-rank-write",
    windowMs: 10 * 60 * 1000,
    max: 60,
  });

  router.get("/", requireAuthenticated, async (req, res) => {
    try {
      const workspace = await memberWorkspace();
      const members = workspace.members.map((member) =>
        projectMember(member, workspace.totals, workspace.assignments),
      );

      res.set("Cache-Control", "no-store");
      res.json({
        members,
        summary: {
          memberCount: members.length,
          activeAssignmentCount: members.reduce(
            (total, member) => total + member.activeAssignmentCount,
            0,
          ),
        },
      });
    } catch (error) {
      console.error("Unable to read guild members", error);
      res.status(500).json({ error: "members_unavailable" });
    }
  });

  router.get("/me", requireAuthenticated, async (req, res) => {
    try {
      const profile = await profileFor(req.auth.user.id);

      if (!profile) {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      res.set("Cache-Control", "no-store");
      res.json({ member: profile });
    } catch (error) {
      console.error("Unable to read current member profile", error);
      res.status(500).json({ error: "member_unavailable" });
    }
  });

  router.patch(
    "/me/timezone",
    requireAuthenticated,
    profileWriteRateLimit,
    async (req, res) => {
    try {
      const result = await updateDetectedTimezone(
        req.auth.user.id,
        req.body?.timezone,
      );

      if (result.status === "invalid") {
        res.status(400).json({ error: "invalid_timezone" });
        return;
      }

      if (result.status === "not-found") {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      res.set("Cache-Control", "no-store");
      res.json({
        timezone: result.member.profile.timezone,
        source: result.member.profile.timezoneSource,
        status: result.status,
      });
    } catch (error) {
      console.error("Unable to update detected timezone", error);
      res.status(500).json({ error: "timezone_update_failed" });
    }
  },
  );

  router.patch(
    "/me",
    requireAuthenticated,
    profileWriteRateLimit,
    async (req, res) => {
    try {
      const updated = await updateGuildMemberProfile(
        req.auth.user.id,
        req.body?.profile ?? req.body,
      );

      if (!updated) {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      const profile = await profileFor(req.auth.user.id);

      res.set("Cache-Control", "no-store");
      res.json({ member: profile });
    } catch (error) {
      console.error("Unable to update member profile", error);
      res.status(500).json({ error: "member_profile_update_failed" });
    }
  },
  );

  router.get("/:memberId", requireAuthenticated, async (req, res) => {
    try {
      const profile = await profileFor(req.params.memberId);

      if (!profile) {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      res.set("Cache-Control", "no-store");
      res.json({ member: profile });
    } catch (error) {
      console.error("Unable to read member profile", error);
      res.status(500).json({ error: "member_unavailable" });
    }
  });

  router.get(
    "/manage/all",
    requirePermission("quests.edit"),
    async (req, res) => {
      try {
        const [members, totals] = await Promise.all([
          readGuildMembers(),
          readContributionTotals(),
        ]);

        const enriched = members.map((member) => ({
          ...member,
          contribution: totals.get(member.id) || emptyContribution(),
        }));

        res.set("Cache-Control", "no-store");
        res.json({
          members: enriched,
          ranks: GUILD_RANKS,
        });
      } catch (error) {
        console.error("Unable to read guild member management directory", error);
        res.status(500).json({ error: "members_unavailable" });
      }
    },
  );

  router.patch(
    "/manage/:memberId/rank",
    requirePermission("site.admin"),
    rankWriteRateLimit,
    async (req, res) => {
      try {
        const result = await updateGuildMemberRank(
          req.params.memberId,
          req.body?.rank,
          { actorMemberId: req.auth.user.id },
        );

        if (result.status === "invalid") {
          res.status(400).json({ error: "invalid_rank" });
          return;
        }

        if (result.status === "not-found") {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        if (result.status === "owner-locked") {
          res.status(409).json({ error: "owner_rank_locked" });
          return;
        }

        let discordSync = { status: "pending" };

        try {
          discordSync = await syncDiscordMemberRank(result.member);
        } catch (error) {
          console.error(
            `Unable to sync Discord rank for member ${req.params.memberId}`,
            error,
          );
        }

        res.set("Cache-Control", "no-store");
        res.json({
          member: result.member,
          status: result.status,
          discordSync,
        });
      } catch (error) {
        console.error("Unable to update guild member rank", error);
        res.status(500).json({ error: "member_rank_update_failed" });
      }
    },
  );

  router.post(
    "/manage/reconcile-ranks",
    requirePermission("site.admin"),
    rankWriteRateLimit,
    async (req, res) => {
      try {
        const summary = await reconcileDiscordMemberRanks();

        res.set("Cache-Control", "no-store");
        res.json({ summary });
      } catch (error) {
        console.error("Unable to reconcile Discord member ranks", error);
        res.status(503).json({ error: "discord_rank_sync_unavailable" });
      }
    },
  );

  return router;
}
