import { Router } from "express";

import { requireAuthenticated, requirePermission } from "../Auth/permissions.js";
import {
  readContributionTotals,
  readMemberContributionHistory,
} from "../Contribution/contributionRepository.js";
import { readQuests } from "../Quest/questRepository.js";
import { readGuildMembers } from "./memberRepository.js";

function emptyContribution() {
  return {
    rep: 0,
    marks: 0,
    completedObjectives: 0,
  };
}

function memberRole(member) {
  return member.permissions?.includes("site.admin") ? "Leadership" : "Member";
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

  return {
    id: member.id,
    username: member.username,
    displayName: member.displayName,
    initials: member.initials,
    avatarUrl: member.avatarUrl,
    guildJoinedAt: member.guildJoinedAt || null,
    firstSeenAt: member.firstSeenAt,
    updatedAt: member.updatedAt,
    role: memberRole(member),
    contribution,
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
        res.json({ members: enriched });
      } catch (error) {
        console.error("Unable to read guild member management directory", error);
        res.status(500).json({ error: "members_unavailable" });
      }
    },
  );

  return router;
}
