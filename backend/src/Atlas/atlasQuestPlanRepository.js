// Serves the dungeon quest planner (Atlas/atlasQuestPlan.js) for the API:
// the dungeon from the atlas, its quests from the quest catalog, the
// character state from the caller (POST) or from what the add-on last
// synced (GET), and the dungeon's editorial quest data when there is any.
// Read-only and local.

import { loadAtlas, loadQuestCatalog } from "./atlasData.js";
import { buildQuestPlan } from "./atlasQuestPlan.js";
import { readCharacterState } from "./atlasReadiness.js";
import { resolveDungeonId } from "./atlasRepository.js";
import { parentKeyFor, wingsOf } from "./atlasWings.js";

// The one place the planner reads published editorial quest data from.
// Null for now: the Dungeon Content Studio (CMS branch) adds
// `publishedEditorialQuestPlan(instanceId)` in Atlas/editorialQuestPlan.js,
// and wiring it is this one line:
//   return publishedEditorialQuestPlan(instanceId);
// Its document follows docs/dungeon-quest-planner.md (schema 1); the
// planner checks it and reports problems, so a bad document never breaks a plan.
export function loadEditorialQuestPlan(_instanceId) {
  return null;
}

// A quest is the same quest in every dungeon that lists it, but a few
// dungeon entries lack the giver another entry names (Blackrock Depths and
// Blackrock Spire share the Windsor chain). Such an entry takes the first
// named giver in catalog order; the add-on's exporter does the same.
let giverCache = null;
function namedGivers() {
  if (!giverCache) {
    giverCache = new Map();
    for (const entry of loadQuestCatalog().catalog.dungeons) {
      for (const quest of entry.quests) {
        if (quest.relevance !== "zone" && quest.giver?.name && !giverCache.has(quest.questId)) giverCache.set(quest.questId, quest.giver);
      }
    }
  }
  return giverCache;
}
const withGiver = (quest) => (quest.giver?.name || !namedGivers().has(quest.questId) ? quest : { ...quest, giver: namedGivers().get(quest.questId) });

// What the planner needs of the dungeon (or wing) an id names, or null.
function planInput(id) {
  const target = resolveDungeonId(id);
  if (!target) return null;
  const dungeon = loadAtlas().byId.get(target.instanceId);
  const entry = loadQuestCatalog().byId.get(target.instanceId);
  if (!dungeon || !entry) return null;
  const wing = target.wingKey ? wingsOf(dungeon).find((candidate) => candidate.dungeonKey === target.wingKey) : null;
  return {
    target,
    dungeon: { instanceId: dungeon.instanceId, dungeonKey: wing?.dungeonKey || parentKeyFor(dungeon), name: wing?.name || dungeon.name,
      zoneName: dungeon.zoneName ?? null, entrance: dungeon.entrance ?? null },
    quests: entry.quests.map(withGiver),
    questList: entry.curated ? "curated" : "unknown",
  };
}

function plan(input, { state, questLog, editorial, party }) {
  const result = buildQuestPlan({ dungeon: input.dungeon, quests: input.quests, state, questLog, wingKey: input.target.wingKey, party,
    editorial: editorial === undefined || editorial === null ? loadEditorialQuestPlan(input.target.instanceId) : editorial });
  return { ...result, questList: input.questList };
}

// A plan from the quest state the caller sends (docs/dungeon-quest-readiness.md).
// The state may carry the quest log's entries ({ questId, isComplete }) as
// the add-on reports them. { status: "ok", result } | { status: "invalid", problems } | null.
export function atlasQuestPlanFromState(id, { state: rawState, editorial = null, party = null } = {}) {
  const input = planInput(id);
  if (!input) return null;
  const entries = Array.isArray(rawState?.questLog?.entries) ? rawState.questLog.entries : null;
  const normalized = entries && !Array.isArray(rawState.questLog.questIds)
    ? { ...rawState, questLog: { ...rawState.questLog, questIds: entries.map((entry) => entry?.questId) } } : rawState;
  const { state, problems } = readCharacterState(normalized);
  if (!state) return { status: "invalid", problems };
  if (editorial !== null && (typeof editorial !== "object" || Array.isArray(editorial))) return { status: "invalid", problems: ["editorial must be an object or null"] };
  if (party !== null && (typeof party !== "object" || Array.isArray(party))) return { status: "invalid", problems: ["party must be an object or null"] };
  return { status: "ok", result: plan(input, { state, questLog: entries ? { entries } : null, editorial, party }) };
}

// A character's plan from the quest state the add-on last synced (`stored`
// is readCharacterQuestStateInDatabase's result, or null when nothing was
// synced: then every quest that depends on the character is unknown).
export function atlasCharacterQuestPlan(id, stored) {
  const input = planInput(id);
  if (!input) return null;
  const result = plan(input, { state: stored?.state || null, questLog: stored?.questLog || null, editorial: null, party: null });
  return {
    ...result,
    character: stored ? { capturedAt: stored.capturedAt, receivedAt: stored.receivedAt,
      completedCoverage: stored.state.completed.coverage, questLogCoverage: stored.state.questLog.coverage } : null,
  };
}
