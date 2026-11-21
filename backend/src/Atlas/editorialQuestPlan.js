// The one integration point for the quest planner (Worktree B,
// docs/dungeon-quest-planner.md "Editorial quest data contract (schema 1)"):
// the active published editorial quest document of a dungeon, or null.
//
// Read-only: it changes nothing and returns a fresh object each call. Only
// published content is served; drafts never reach the planner. Fields the
// editor left empty are absent, so the planner inherits the catalog.

import { withGuildDatabase } from "../Data/database.js";
import { readActiveInDatabase } from "./Editorial/editorialRepository.js";

export const EDITORIAL_QUEST_PLAN_SCHEMA = 1;

// The contract document from a stored editorial document and its revision.
export function editorialQuestPlanOf(instanceId, document, revisionId) {
  const plan = document?.questPlan || {};
  const hasContent = plan.entrance || plan.instructions?.length || plan.quests?.length;
  if (!hasContent) return null;
  return {
    schemaVersion: EDITORIAL_QUEST_PLAN_SCHEMA,
    instanceId,
    revision: revisionId === null || revisionId === undefined ? null : String(revisionId),
    ...(plan.entrance ? { entrance: { ...plan.entrance } } : {}),
    ...(plan.instructions?.length ? { instructions: plan.instructions.map((entry) => ({ ...entry })) } : {}),
    quests: (plan.quests || []).map((quest) => structuredClone(quest)),
  };
}

export function publishedEditorialQuestPlanInDatabase(db, instanceId) {
  const id = Number(instanceId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const active = readActiveInDatabase(db, id);
  return active ? editorialQuestPlanOf(id, active.document, active.revision.id) : null;
}

export function publishedEditorialQuestPlan(instanceId) {
  try {
    return withGuildDatabase((db) => publishedEditorialQuestPlanInDatabase(db, instanceId));
  } catch (error) {
    // The planner runs on the catalog alone without it.
    console.error("Unable to read the published editorial quest plan", error);
    return null;
  }
}
