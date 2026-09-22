import { Router } from "express";

import { requirePermission } from "../Auth/permissions.js";
import { readContributionTotals } from "../Contribution/contributionRepository.js";
import { readGuildMembers } from "./memberRepository.js";

export function createMemberRouter() {
  const router = Router();

  router.get("/", requirePermission("quests.edit"), async (req, res) => {
    try {
      const [members, totals] = await Promise.all([
        readGuildMembers(),
        readContributionTotals(),
      ]);
      const enriched = members.map((member) => ({
        ...member,
        contribution: totals.get(member.id) || {
          rep: 0,
          marks: 0,
          completedObjectives: 0,
        },
      }));
      res.set("Cache-Control", "no-store");
      res.json({ members: enriched });
    } catch (error) {
      console.error("Unable to read guild members", error);
      res.status(500).json({ error: "members_unavailable" });
    }
  });

  return router;
}
