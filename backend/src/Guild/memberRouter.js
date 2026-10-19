import { Router } from "express";

import {
  requireAuthenticated,
  requireGuildMember,
  requirePermission,
} from "../Auth/permissions.js";
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
import {
  claimMemberBilletAuthority,
  readBillets,
  setMemberBilletAssignment,
} from "./billetRepository.js";
import {
  authorityCanGrantBillet,
  authorityCanGrantRank,
  authorityCanManageTargetRank,
  readRankLadder,
} from "./authorityRepository.js";
import { isHoldfastGuild } from "./guildScope.js";
import { primaryCharacter } from "./memberProfile.js";
import { repProgressionForLadder } from "./rankSystem.js";
import { syncDiscordMemberRank } from "../Discord/rankSync.js";
import { syncDiscordMemberBillets } from "../Discord/billetSync.js";

// Ranks and billets are Discord roles only in Holdfast's server.
const NO_DISCORD_SYNC = Object.freeze({ status: "not-applicable" });

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

function projectMember(member, totals, assignments, ladder) {
  const contribution = totals.get(member.id) || emptyContribution();
  const activeAssignments = assignments.get(member.id) || [];
  const rank = ladder.normalize(member.rank);
  const rankMeta = ladder.metadata(rank);

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
    guildRole: member.guildRole || null,
    rankManaged: Boolean(member.rankManaged),
    billetsManaged: Boolean(member.billetsManaged),
    rankMeta,
    role: rankMeta.isLeadership ? "Leadership" : "Member",
    billets: Array.isArray(member.billets) ? member.billets : [],
    profile: member.profile,
    mainCharacter: primaryCharacter(member.profile),
    contribution,
    repProgression: repProgressionForLadder(ladder, rank, contribution.rep),
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

async function memberWorkspace(guildId) {
  const [members, totals] = await Promise.all([
    readGuildMembers(guildId),
    readContributionTotals(guildId),
  ]);
  const ladder = readRankLadder(guildId);

  let assignments = new Map();

  try {
    assignments = activeAssignmentsByMember(await readQuests(guildId));
  } catch (error) {
    console.error(
      "Quest data is unavailable; serving member directory without active quest assignments",
      error,
    );
  }

  return {
    members,
    totals,
    assignments,
    ladder,
  };
}

async function profileFor(guildId, memberId) {
  const workspace = await memberWorkspace(guildId);
  const member = workspace.members.find((item) => item.id === memberId);

  if (!member) {
    return null;
  }

  const history = await readMemberContributionHistory(guildId, member.id);
  const projected = projectMember(
    member,
    workspace.totals,
    workspace.assignments,
    workspace.ladder,
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

  router.get("/", requireGuildMember, async (req, res) => {
    try {
      const workspace = await memberWorkspace(req.guild.id);
      const members = workspace.members.map((member) =>
        projectMember(
          member,
          workspace.totals,
          workspace.assignments,
          workspace.ladder,
        ),
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

  router.get("/me", requireGuildMember, async (req, res) => {
    try {
      const profile = await profileFor(req.guild.id, req.auth.user.id);

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

  // Every signed-in account keeps a timezone; the rest of the roster and
  // profiles here are Holdfast's.
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

      res.locals.unchanged = result.status !== "updated";
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
    requireGuildMember,
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

      const profile = await profileFor(req.guild.id, req.auth.user.id);

      res.set("Cache-Control", "no-store");
      res.json({ member: profile });
    } catch (error) {
      console.error("Unable to update member profile", error);
      res.status(500).json({ error: "member_profile_update_failed" });
    }
  },
  );

  router.get("/:memberId", requireGuildMember, async (req, res) => {
    try {
      const profile = await profileFor(req.guild.id, req.params.memberId);

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
          readGuildMembers(req.guild.id),
          readContributionTotals(req.guild.id),
        ]);

        const enriched = members.map((member) => ({
          ...member,
          contribution: totals.get(member.id) || emptyContribution(),
        }));

        res.set("Cache-Control", "no-store");
        res.json({
          members: enriched,
          ranks: readRankLadder(req.guild.id).names,
        });
      } catch (error) {
        console.error("Unable to read guild member management directory", error);
        res.status(500).json({ error: "members_unavailable" });
      }
    },
  );

  router.patch(
    "/manage/:memberId/rank",
    requirePermission("members.rank.manage"),
    rankWriteRateLimit,
    async (req, res) => {
      try {
        const members = await readGuildMembers(req.guild.id);
        const target = members.find(
          (member) => member.id === req.params.memberId,
        );
        const requestedRank = String(req.body?.rank || "").trim();

        if (!target) {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        if (
          !req.auth.authority?.isOwner &&
          req.params.memberId === req.auth.user.id
        ) {
          res.status(403).json({ error: "self_authority_change_forbidden" });
          return;
        }

        const ladder = readRankLadder(req.guild.id);

        if (
          !authorityCanManageTargetRank(req.auth.authority, target.rank, ladder) ||
          !authorityCanManageTargetRank(req.auth.authority, requestedRank, ladder) ||
          !authorityCanGrantRank(req.auth.authority, requestedRank, {
            guildId: req.guild.id,
          })
        ) {
          res.status(403).json({ error: "rank_ceiling_exceeded" });
          return;
        }

        const result = await updateGuildMemberRank(
          req.params.memberId,
          requestedRank,
          { guildId: req.guild.id, actorMemberId: req.auth.user.id },
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

        let discordSync = isHoldfastGuild(req.guild.id)
          ? { status: "pending" }
          : NO_DISCORD_SYNC;

        try {
          if (isHoldfastGuild(req.guild.id)) {
            discordSync = await syncDiscordMemberRank(result.member);
          }
        } catch (error) {
          console.error(
            `Unable to sync Discord rank for member ${req.params.memberId}`,
            error,
          );
        }

        const projectedMember =
          (await profileFor(req.guild.id, req.params.memberId)) || result.member;

        res.set("Cache-Control", "no-store");
        res.json({
          member: projectedMember,
          status: result.status,
          discordSync,
        });
      } catch (error) {
        console.error("Unable to update guild member rank", error);
        res.status(500).json({ error: "member_rank_update_failed" });
      }
    },
  );

  async function updateBilletAssignment(req, res, assigned) {
    try {
      const [members, billets] = await Promise.all([
        readGuildMembers(req.guild.id),
        readBillets(req.guild.id),
      ]);
      const ladder = readRankLadder(req.guild.id);
      const target = members.find(
        (member) => member.id === req.params.memberId,
      );
      const billet = billets.find(
        (item) => item.id === req.params.billetId,
      );

      if (!target) {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      if (!billet) {
        res.status(404).json({ error: "billet_not_found" });
        return;
      }

      if (
        !req.auth.authority?.isOwner &&
        req.params.memberId === req.auth.user.id
      ) {
        res.status(403).json({ error: "self_authority_change_forbidden" });
        return;
      }

      if (
        !authorityCanManageTargetRank(req.auth.authority, target.rank, ladder) ||
        !authorityCanGrantBillet(req.auth.authority, billet, ladder)
      ) {
        res.status(403).json({ error: "authority_scope_exceeded" });
        return;
      }

      const result = await setMemberBilletAssignment(
        req.params.memberId,
        req.params.billetId,
        assigned,
        { guildId: req.guild.id, actorMemberId: req.auth.user.id },
      );

      if (result.status === "member-not-found") {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      if (result.status === "billet-not-found") {
        res.status(404).json({ error: "billet_not_found" });
        return;
      }

      const updatedMembers = await readGuildMembers(req.guild.id);
      const member = updatedMembers.find(
        (candidate) => candidate.id === req.params.memberId,
      );

      let discordSync = isHoldfastGuild(req.guild.id)
        ? { status: "pending" }
        : NO_DISCORD_SYNC;

      if (member && isHoldfastGuild(req.guild.id)) {
        try {
          discordSync = await syncDiscordMemberBillets(member);
        } catch (error) {
          console.error(
            `Unable to sync Discord billets for member ${req.params.memberId}`,
            error,
          );
        }
      }

      const projectedMember =
        (await profileFor(req.guild.id, req.params.memberId)) || member;

      res.set("Cache-Control", "no-store");
      res.json({
        member: projectedMember,
        status: result.status,
        discordSync,
      });
    } catch (error) {
      console.error("Unable to update member billet assignment", error);
      res.status(500).json({ error: "member_billet_update_failed" });
    }
  }

  router.post(
    "/manage/:memberId/billets/claim",
    requirePermission("members.billet.assign"),
    rankWriteRateLimit,
    async (req, res) => {
      try {
        const members = await readGuildMembers(req.guild.id);
        const target = members.find(
          (member) => member.id === req.params.memberId,
        );

        if (!target) {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        if (
          !req.auth.authority?.isOwner &&
          req.params.memberId === req.auth.user.id
        ) {
          res.status(403).json({ error: "self_authority_change_forbidden" });
          return;
        }

        if (
          !authorityCanManageTargetRank(
            req.auth.authority,
            target.rank,
            readRankLadder(req.guild.id),
          )
        ) {
          res.status(403).json({ error: "rank_ceiling_exceeded" });
          return;
        }

        const result = await claimMemberBilletAuthority(
          req.params.memberId,
          { guildId: req.guild.id, actorMemberId: req.auth.user.id },
        );

        if (result.status === "member-not-found") {
          res.status(404).json({ error: "member_not_found" });
          return;
        }

        const updatedMembers = await readGuildMembers(req.guild.id);
        const member = updatedMembers.find(
          (candidate) => candidate.id === req.params.memberId,
        );

        let discordSync = isHoldfastGuild(req.guild.id)
          ? { status: "pending" }
          : NO_DISCORD_SYNC;

        if (member && isHoldfastGuild(req.guild.id)) {
          try {
            discordSync = await syncDiscordMemberBillets(member);
          } catch (error) {
            console.error(
              `Unable to claim Discord billet authority for member ${req.params.memberId}`,
              error,
            );
          }
        }

        const projectedMember =
          (await profileFor(req.guild.id, req.params.memberId)) || member;

        res.set("Cache-Control", "no-store");
        res.json({
          member: projectedMember,
          status: result.status,
          discordSync,
        });
      } catch (error) {
        console.error("Unable to claim member billet authority", error);
        res.status(500).json({ error: "member_billet_claim_failed" });
      }
    },
  );

  router.put(
    "/manage/:memberId/billets/:billetId",
    requirePermission("members.billet.assign"),
    rankWriteRateLimit,
    (req, res) => updateBilletAssignment(req, res, true),
  );

  router.delete(
    "/manage/:memberId/billets/:billetId",
    requirePermission("members.billet.assign"),
    rankWriteRateLimit,
    (req, res) => updateBilletAssignment(req, res, false),
  );



  return router;
}
