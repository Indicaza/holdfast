// Validation before a draft can be published. Errors block publishing;
// warnings are shown and do not. Pure: everything it needs is passed in.

import { ADDON_LIMITS, addonEditorialEntry, luaEntryBytes } from "./addonTransform.js";
import { resolveEditorial } from "./editorialResolve.js";
import { mediaReferences } from "./editorialSchema.js";

const issue = (path, code, message) => ({ path, code, message });

function duplicates(values) {
  const seen = new Set();
  const twice = new Set();
  for (const value of values) {
    if (seen.has(value)) twice.add(value);
    seen.add(value);
  }
  return [...twice];
}

// Cycles in the prerequisite graph the document and the catalog make
// together (the document's list replaces the catalog's for its quests).
function chainCycles(graph) {
  const state = new Map();
  const cycles = [];
  const visit = (id, path) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "open") {
      cycles.push([...path.slice(path.indexOf(id)), id]);
      return;
    }
    state.set(id, "open");
    for (const next of graph.get(id) || []) visit(next, [...path, id]);
    state.set(id, "done");
  };
  for (const id of graph.keys()) visit(id, []);
  return cycles;
}

// { errors, warnings, luaBytes, resolution }
export function validateEditorial({ document, problems = [], imported, catalogEntry = null, knownQuestIds = new Set(), mediaExists = () => false,
  otherPublishedBytes = 0, revision = null }) {
  const errors = problems.map((problem) => ({ ...problem }));
  const warnings = [];
  if (!document) return { errors, warnings, luaBytes: 0, resolution: null };
  if (!imported) {
    errors.push(issue("instanceId", "unknown-dungeon", "The atlas has no such dungeon."));
    return { errors, warnings, luaBytes: 0, resolution: null };
  }
  const resolution = resolveEditorial(imported, document);
  const bossKeys = new Set(resolution.bosses.map((boss) => boss.key));

  // Duplicate ids.
  const order = document.dungeon.bossOrder?.value || [];
  for (const key of duplicates(order)) errors.push(issue("dungeon.bossOrder", "duplicate-id", `Boss ${key} is listed twice in the boss order.`));
  for (const key of order) if (!bossKeys.has(key)) errors.push(issue("dungeon.bossOrder", "unknown-boss", `The boss order names ${key}, which the atlas does not list.`));
  for (const [key, boss] of Object.entries(document.bosses)) {
    for (const id of duplicates((boss.mechanics?.value || []).map((mechanic) => mechanic.id))) {
      errors.push(issue(`bosses.${key}.mechanics`, "duplicate-id", `Mechanic id ${id} is used twice.`));
    }
    for (const id of duplicates((boss.lootNotes?.value || []).map((note) => note.itemId))) {
      errors.push(issue(`bosses.${key}.lootNotes`, "duplicate-id", `Item ${id} has two loot annotations.`));
    }
  }
  for (const key of resolution.orphans) warnings.push(issue(`bosses.${key}`, "orphan", `Boss ${key} is no longer in the imported atlas. Its edits are kept but not shown.`));
  const quests = document.questPlan.quests || [];
  for (const id of duplicates(quests.map((quest) => quest.questId))) errors.push(issue("questPlan.quests", "duplicate-id", `Quest ${id} is listed twice; only the first entry would be used.`));

  // Quest chains.
  const catalogQuests = catalogEntry?.quests || [];
  const graph = new Map(catalogQuests.map((quest) => [quest.questId, (quest.prerequisites || []).map((entry) => Math.abs(entry.questId))]));
  for (const [index, quest] of quests.entries()) {
    const path = `questPlan.quests[${index}]`;
    if (!knownQuestIds.has(quest.questId) && !graph.has(quest.questId)) warnings.push(issue(path, "unknown-quest", `Quest ${quest.questId} is not in the quest catalog.`));
    for (const id of quest.prerequisites || []) {
      if (Math.abs(id) === quest.questId) errors.push(issue(`${path}.prerequisites`, "broken-chain", `Quest ${quest.questId} cannot be its own prerequisite.`));
      else if (!knownQuestIds.has(Math.abs(id)) && !graph.has(Math.abs(id)) && !quests.some((entry) => entry.questId === Math.abs(id))) {
        errors.push(issue(`${path}.prerequisites`, "broken-chain", `Prerequisite ${Math.abs(id)} of quest ${quest.questId} is not a known quest.`));
      }
    }
    if (quest.prerequisites) graph.set(quest.questId, quest.prerequisites.map(Math.abs));
  }
  for (const cycle of chainCycles(graph)) errors.push(issue("questPlan.quests", "broken-chain", `Prerequisites loop: ${cycle.join(" → ")}.`));

  // Assets.
  for (const id of mediaReferences(document)) if (!mediaExists(id)) errors.push(issue("media", "missing-asset", `Image ${id} is not in the media library.`));

  // Coordinates and level band (shape problems already cover 0–1 and mapId).
  const levelMin = resolution.dungeon.levelMin.effective;
  const levelMax = resolution.dungeon.levelMax.effective;
  if (Number.isFinite(levelMin) && Number.isFinite(levelMax) && levelMin > levelMax) errors.push(issue("dungeon.levelMin", "invalid", "The minimum level is above the maximum."));
  for (const conflict of resolution.conflicts) warnings.push(issue(`${conflict.scope}.${conflict.key}`, "conflict", conflict.reason));
  for (const [key, boss] of Object.entries(document.bosses)) {
    if ((boss.mechanics?.value || []).length > ADDON_LIMITS.mechanics) {
      warnings.push(issue(`bosses.${key}.mechanics`, "addon-cut", `The add-on shows the first ${ADDON_LIMITS.mechanics} mechanics by priority.`));
    }
  }

  // Lua size budget.
  const entry = addonEditorialEntry(document.instanceId, resolution, revision);
  const bytes = luaEntryBytes(entry);
  if (bytes > ADDON_LIMITS.dungeonBytes) errors.push(issue("", "lua-budget", `This dungeon would add ${bytes} bytes to the add-on; the budget is ${ADDON_LIMITS.dungeonBytes}.`));
  if (bytes + otherPublishedBytes > ADDON_LIMITS.totalBytes) {
    errors.push(issue("", "lua-budget", `Published editorial content would reach ${bytes + otherPublishedBytes} bytes in the add-on; the budget is ${ADDON_LIMITS.totalBytes}.`));
  }
  return { errors, warnings, luaBytes: bytes, resolution };
}
