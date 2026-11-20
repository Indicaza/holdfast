// Dungeon quest preparation planner (docs/dungeon-quest-planner.md): for
// one character and one dungeon (or wing), an ordered checklist of what to
// collect, from whom and where, what a group member could share, when the
// character is ready to enter, and what to turn in afterwards.
//
// Pure and deterministic: the same input gives a byte-identical plan (no
// clock, no randomness, every list in a fixed order). Every quest state
// comes from Atlas/atlasReadiness.js (questState, prerequisiteStatus,
// evaluateReadiness); nothing here decides a state on its own. Nothing is
// invented: a location no source gives stays "not in our data", a
// shareability the data does not state is never "yes", and a turn-in
// location comes only from editorial data.
//
// The add-on runs the same rules (Systems/DungeonQuestPlan.lua) and checks
// them against plans this file computed (scripts/questPlanParity.mjs).

import { emptyCharacterState, evaluateReadiness, prerequisiteStatus, questState } from "./atlasReadiness.js";

export const QUEST_PLAN_SCHEMA = 1;
export const EDITORIAL_SCHEMA = 1;
export const STEP_STATUSES = Object.freeze(["done", "todo", "blocked", "unknown", "ineligible"]);
export const SECTIONS = Object.freeze(["collect", "share", "enter", "optional", "repeatable", "unknown", "turnIn"]);
const INSTRUCTION_SECTIONS = new Set(["collect", "share", "enter", "turnIn"]);
const EDITORIAL_RELEVANCE = new Set(["dungeon", "optional"]);
const SHAREABLE = new Set(["yes", "no", "unknown"]);
const NOT_IN_DATA = "not-in-our-data";

const isId = (value) => Number.isSafeInteger(value) && value > 0;
const isFraction = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const permille = (value) => Math.round(value * 1000);

// A location usable for a waypoint: a UiMap id and 0-1 coordinates. Anything
// else is not a location (never guessed or clamped).
export function validLocation(location) {
  if (!location || typeof location !== "object") return null;
  if (!isId(location.mapId) || !isFraction(location.x) || !isFraction(location.y)) return null;
  return { mapId: location.mapId, x: location.x, y: location.y, zoneName: text(location.zoneName, 60) };
}

// ------------------------------------------------------------ Editorial (contract schema 1)

function editorialPerson(raw, label, problems) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") { problems.push({ code: "editorial-invalid-field", detail: label }); return null; }
  const person = { name: text(raw.name, 80), location: null };
  if (raw.location !== null && raw.location !== undefined) {
    person.location = validLocation(raw.location);
    if (!person.location) problems.push({ code: "editorial-location-dropped", detail: label });
  }
  return person.name || person.location ? person : null;
}

// The editorial document, checked against the contract. Invalid parts are
// dropped and named in problems; a document that is not schema 1 or names
// another dungeon is not used at all. Returns { editorial | null, problems }.
export function readEditorialQuestPlan(raw, instanceId) {
  const problems = [];
  if (raw === null || raw === undefined) return { editorial: null, problems };
  if (typeof raw !== "object" || Array.isArray(raw)) return { editorial: null, problems: [{ code: "editorial-invalid", detail: "not an object" }] };
  if (raw.schemaVersion !== EDITORIAL_SCHEMA) return { editorial: null, problems: [{ code: "editorial-schema", detail: `schemaVersion must be ${EDITORIAL_SCHEMA}` }] };
  if (raw.instanceId !== instanceId) return { editorial: null, problems: [{ code: "editorial-instance", detail: `instanceId must be ${instanceId}` }] };
  const editorial = { revision: typeof raw.revision === "string" || Number.isSafeInteger(raw.revision) ? raw.revision : null,
    entrance: null, instructions: [], quests: new Map() };
  if (raw.entrance !== null && raw.entrance !== undefined) {
    const location = validLocation(raw.entrance);
    if (location) editorial.entrance = { ...location, verified: raw.entrance.verified === true, source: text(raw.entrance.source, 200) };
    else problems.push({ code: "editorial-location-dropped", detail: "entrance" });
  }
  for (const [index, instruction] of (Array.isArray(raw.instructions) ? raw.instructions : []).entries()) {
    const body = text(instruction?.text, 400);
    if (!instruction || !INSTRUCTION_SECTIONS.has(instruction.section) || !body || body.length > 200) {
      problems.push({ code: "editorial-instruction-dropped", detail: `instructions[${index}]` });
      continue;
    }
    editorial.instructions.push({ section: instruction.section, text: body, verified: instruction.verified === true, source: text(instruction.source, 200) });
  }
  if (raw.quests !== undefined && !Array.isArray(raw.quests)) problems.push({ code: "editorial-invalid-field", detail: "quests" });
  for (const [index, entry] of (Array.isArray(raw.quests) ? raw.quests : []).entries()) {
    if (!entry || typeof entry !== "object" || !isId(entry.questId)) { problems.push({ code: "editorial-quest-dropped", detail: `quests[${index}]` }); continue; }
    const questId = entry.questId;
    if (editorial.quests.has(questId)) { problems.push({ code: "editorial-duplicate-quest", questId }); continue; }
    const label = `quest ${questId}`;
    const quest = { questId, verified: entry.verified === true, source: text(entry.source, 200) };
    if (entry.relevance !== null && entry.relevance !== undefined) {
      if (EDITORIAL_RELEVANCE.has(entry.relevance)) quest.relevance = entry.relevance;
      else problems.push({ code: "editorial-invalid-field", questId, detail: "relevance" });
    }
    if (entry.shareable !== null && entry.shareable !== undefined) {
      if (SHAREABLE.has(entry.shareable)) quest.shareable = entry.shareable;
      else problems.push({ code: "editorial-invalid-field", questId, detail: "shareable" });
    }
    if (entry.prerequisites !== null && entry.prerequisites !== undefined) {
      if (Array.isArray(entry.prerequisites) && entry.prerequisites.every((id) => Number.isSafeInteger(id) && id !== 0)) {
        quest.prerequisites = entry.prerequisites.map((id) => ({ questId: Math.abs(id), ...(id < 0 ? { mustBeActive: true } : {}) }));
      } else problems.push({ code: "editorial-invalid-field", questId, detail: "prerequisites" });
    }
    const giver = editorialPerson(entry.giver, `${label} giver`, problems);
    if (giver) quest.giver = giver;
    const turnIn = editorialPerson(entry.turnIn, `${label} turnIn`, problems);
    if (turnIn) quest.turnIn = turnIn;
    const steps = [];
    for (const step of Array.isArray(entry.steps) ? entry.steps : []) {
      const body = text(step?.text, 400);
      if (body && body.length <= 200) steps.push(body);
      else problems.push({ code: "editorial-invalid-field", questId, detail: "steps" });
    }
    if (steps.length) quest.steps = steps;
    const notes = text(entry.notes, 600);
    if (notes && notes.length <= 500) quest.notes = notes;
    else if (entry.notes !== null && entry.notes !== undefined) problems.push({ code: "editorial-invalid-field", questId, detail: "notes" });
    editorial.quests.set(questId, quest);
  }
  return { editorial, problems };
}

// A catalog quest with its editorial entry laid over it (an absent field
// inherits the catalog).
function mergeQuest(quest, entry) {
  if (!entry) return quest;
  const merged = { ...quest, editorial: { verified: entry.verified, source: entry.source } };
  if (entry.relevance) merged.relevance = entry.relevance;
  if (entry.shareable) merged.shareable = entry.shareable;
  if (entry.prerequisites) {
    const names = new Map((quest.prerequisites || []).map((prerequisite) => [prerequisite.questId, prerequisite.name]));
    merged.prerequisites = entry.prerequisites.map((prerequisite) => ({ ...prerequisite, name: names.get(prerequisite.questId) ?? null }));
    merged.prerequisitesKnown = true;
  }
  if (entry.giver) {
    merged.giver = { kind: quest.giver?.kind ?? null, id: quest.giver?.id ?? null, name: entry.giver.name ?? quest.giver?.name ?? null,
      location: entry.giver.location ?? quest.giver?.location ?? null, editorial: true };
  }
  if (entry.turnIn) merged.turnIn = entry.turnIn;
  if (entry.steps) merged.steps = entry.steps;
  if (entry.notes) merged.notes = entry.notes;
  return merged;
}

// ------------------------------------------------------------ The plan

const STATUS_OF = { completed: "done", available: "todo", prerequisites: "blocked", unknown: "unknown", ineligible: "ineligible" };

function emptyCounts() {
  return Object.fromEntries([["total", 0], ...STEP_STATUSES.map((name) => [name, 0])]);
}

// Sort key pieces shared with the add-on: a quest's zone (none last), its
// minimum level (none = 0), its id.
const zoneOf = (quest) => quest.giver?.location?.zoneName ?? null;
function compareQuests(a, b) {
  const za = zoneOf(a), zb = zoneOf(b);
  if (za !== zb) {
    if (za === null) return 1;
    if (zb === null) return -1;
    return za < zb ? -1 : 1;
  }
  const la = a.minLevel ?? 0, lb = b.minLevel ?? 0;
  if (la !== lb) return la - lb;
  return a.questId - b.questId;
}

// Who to talk to and where, as one comparable key (the add-on keeps
// coordinates in permille, so the key does too).
function giverKey(quest) {
  if (!quest.giver?.name) return null;
  const location = validLocation(quest.giver.location);
  return location ? `${quest.giver.name}|${location.mapId}|${permille(location.x)}|${permille(location.y)}` : `${quest.giver.name}|`;
}

function coordinatesText(location) {
  return `${(location.x * 100).toFixed(1)}, ${(location.y * 100).toFixed(1)}`;
}

//   dungeon:  { instanceId, dungeonKey, name, zoneName, entrance: { mapId, x, y } | null }
//   quests:   the dungeon's quest catalog entries (Atlas/atlasQuests.js shape)
//   state:    a character state from readCharacterState (null: nothing reported)
//   questLog: { entries: [{ questId, isComplete }] } as the add-on reported it, or null
//   editorial: an editorial document (contract schema 1), or null
//   wingKey:  a wing's key, to leave out quests attributed to sibling wings
//   party:    { size } or null; only changes wording (no member is assumed to hold a quest)
export function buildQuestPlan({ dungeon, quests, state = null, questLog = null, editorial = null, wingKey = null, party = null } = {}) {
  const problems = [];
  const characterState = state || emptyCharacterState();
  const instanceId = dungeon?.instanceId ?? null;

  // Editorial data, checked.
  const read = readEditorialQuestPlan(editorial, instanceId);
  problems.push(...read.problems);
  const doc = read.editorial;

  // The catalog, deduplicated (first wins), with editorial laid over it.
  const byId = new Map();
  for (const quest of quests || []) {
    if (!quest || !isId(quest.questId)) { problems.push({ code: "invalid-quest" }); continue; }
    if (byId.has(quest.questId)) { problems.push({ code: "duplicate-quest", questId: quest.questId }); continue; }
    byId.set(quest.questId, mergeQuest(quest, doc?.quests.get(quest.questId)));
  }
  for (const questId of doc ? [...doc.quests.keys()].sort((a, b) => a - b) : []) {
    if (!byId.has(questId)) problems.push({ code: "editorial-quest-not-in-catalog", questId });
  }
  const merged = [...byId.values()];
  const applicable = merged.filter((quest) => quest.relevance !== "zone" && (!wingKey || !quest.wing || quest.wing === wingKey));
  const known = new Map(applicable.map((quest) => [quest.questId, quest]));
  const sortedIds = [...known.keys()].sort((a, b) => a - b);

  const states = new Map(applicable.map((quest) => [quest.questId, questState(quest, characterState)]));
  const stateOf = (questId) => states.get(questId).state;
  const logEntries = new Map((questLog?.entries || []).filter((entry) => entry && isId(entry.questId)).map((entry) => [entry.questId, entry]));
  const objectivesComplete = (questId) => {
    if (stateOf(questId) !== "accepted") return null;
    const value = logEntries.get(questId)?.isComplete;
    return value === true ? true : value === false ? false : null;
  };

  // Broken chains: a prerequisite the catalog does not list for this dungeon.
  for (const questId of sortedIds) {
    for (const prerequisite of known.get(questId).prerequisites || []) {
      if (!known.has(prerequisite.questId)) problems.push({ code: "prerequisite-not-in-catalog", questId, prerequisiteId: prerequisite.questId });
    }
  }

  // Cycles: depth-first over the prerequisite edges inside the catalog.
  const color = new Map();
  const inCycle = new Set();
  const visit = (questId, path) => {
    color.set(questId, 1);
    path.push(questId);
    for (const prerequisite of known.get(questId).prerequisites || []) {
      const next = prerequisite.questId;
      if (!known.has(next)) continue;
      if (color.get(next) === 1) {
        const cycle = path.slice(path.indexOf(next));
        cycle.forEach((id) => inCycle.add(id));
        problems.push({ code: "prerequisite-cycle", questIds: [...cycle].sort((a, b) => a - b) });
      } else if (!color.has(next)) visit(next, path);
    }
    path.pop();
    color.set(questId, 2);
  };
  for (const questId of sortedIds) if (!color.has(questId)) visit(questId, []);

  // Waypoints, by id.
  const waypoints = new Map();
  const waypoint = (id, location, target, targetType, source, verified) => {
    const where = validLocation(location);
    if (!where) return null;
    if (!waypoints.has(id)) {
      waypoints.set(id, { id, mapSystem: "uiMap", mapId: where.mapId, x: where.x, y: where.y, zoneName: where.zoneName,
        target: target ?? null, targetType, source, verified: verified === true });
    }
    return id;
  };
  const sourceOf = (quest) => (quest.editorial ? "editorial" : "catalog");
  const verifiedOf = (quest) => quest.editorial?.verified === true;
  const giverSource = (quest) => (quest.giver?.editorial ? "editorial" : "catalog");
  const giverWaypoint = (quest, targetType) => waypoint(`wp:giver:${quest.questId}`, quest.giver?.location, quest.giver?.name, targetType,
    giverSource(quest), quest.giver?.editorial ? verifiedOf(quest) : false);

  const step = (fields) => ({ id: fields.id, kind: fields.kind, questId: fields.questId ?? null, status: fields.status, text: fields.text,
    waypoint: fields.waypoint ?? null, verified: fields.verified === true, source: fields.source ?? "catalog",
    ...(fields.location ? { location: fields.location } : {}), ...(fields.optional ? { optional: true } : {}),
    ...(fields.reasons ? { reasons: fields.reasons } : {}), ...(fields.collapsed ? { collapsed: true } : {}),
    ...(fields.objectivesComplete !== undefined ? { objectivesComplete: fields.objectivesComplete } : {}), children: fields.children || [] });

  // A travel child: to the giver, with a waypoint when a location is known.
  const travel = (quest, id, status, targetType, extra = {}) => {
    const wp = giverWaypoint(quest, targetType);
    const where = validLocation(quest.giver?.location);
    let line;
    if (quest.giver?.name && where) line = `Go to ${quest.giver.name}${where.zoneName ? ` in ${where.zoneName}` : ""} (${coordinatesText(where)})`;
    else if (quest.giver?.name) line = `Find ${quest.giver.name}: location not in our data`;
    else if (quest.startsFromItem) line = `Starts from an item (${quest.startsFromItem}): location not in our data`;
    else line = "Quest giver not in our data";
    return step({ id, kind: "travel", questId: quest.questId, status, text: line, waypoint: wp, location: wp ? null : NOT_IN_DATA,
      source: giverSource(quest), verified: quest.giver?.editorial ? verifiedOf(quest) : false, ...extra });
  };

  // ---- collect: the dungeon quests and their undone chains, in order.
  const done = (questId) => stateOf(questId) === "completed";
  const afterMemo = new Map();
  // Does the quest wait on a dungeon quest that is not done yet (so it can
  // only be had after a run)?
  const afterDungeon = (questId, seen = new Set()) => {
    if (afterMemo.has(questId)) return afterMemo.get(questId);
    if (seen.has(questId) || inCycle.has(questId)) return false;
    seen.add(questId);
    let result = false;
    for (const prerequisite of known.get(questId).prerequisites || []) {
      const id = prerequisite.questId;
      if (!known.has(id) || inCycle.has(id) || done(id)) continue;
      if (known.get(id).relevance === "dungeon" || afterDungeon(id, seen)) { result = true; break; }
    }
    afterMemo.set(questId, result);
    return result;
  };
  const roots = sortedIds.filter((questId) => {
    const quest = known.get(questId);
    if (quest.relevance !== "dungeon" || inCycle.has(questId)) return false;
    const current = stateOf(questId);
    if (current === "ineligible") return false;
    return current === "completed" || current === "accepted" || !afterDungeon(questId);
  });
  // Pull in each root's undone chain (a shared prerequisite once).
  const nodes = new Map();
  const keepInLog = new Set();
  const pull = (questId, role) => {
    if (nodes.has(questId)) { if (role === "quest") nodes.get(questId).role = "quest"; return; }
    nodes.set(questId, { questId, role });
    const current = stateOf(questId);
    if (current === "completed" || current === "accepted" || current === "ineligible") return;
    for (const prerequisite of known.get(questId).prerequisites || []) {
      const id = prerequisite.questId;
      if (!known.has(id) || inCycle.has(id) || done(id)) continue;
      if (prerequisite.mustBeActive) keepInLog.add(id);
      if (prerequisite.mustBeActive && stateOf(id) === "accepted") continue;
      pull(id, "prerequisite");
    }
  };
  roots.forEach((questId) => pull(questId, "quest"));
  // Topological order: a prerequisite before its dependents; among the
  // quests that can come next, one in the zone of the step before, then
  // by (zone, minimum level, id).
  const edges = new Map([...nodes.keys()].map((questId) => [questId, (known.get(questId).prerequisites || [])
    .map((prerequisite) => prerequisite.questId).filter((id) => id !== questId && nodes.has(id))]));
  const placed = new Set();
  const order = [];
  let previousZone;
  while (order.length < nodes.size) {
    const ready = [...nodes.keys()].filter((questId) => !placed.has(questId) && edges.get(questId).every((id) => placed.has(id)));
    if (!ready.length) break; // unreachable: cycles are left out above
    const quests = ready.map((questId) => known.get(questId)).sort(compareQuests);
    const local = order.length ? quests.filter((quest) => zoneOf(quest) === previousZone) : [];
    const chosen = (local.length ? local : quests)[0];
    placed.add(chosen.questId);
    order.push(chosen.questId);
    previousZone = zoneOf(chosen);
  }

  const collect = [];
  let lastGiver = null;
  for (const questId of order) {
    const quest = known.get(questId);
    const node = nodes.get(questId);
    const isQuest = node.role === "quest";
    const current = stateOf(questId);
    const held = current === "accepted" && (isQuest || keepInLog.has(questId));
    const status = held ? "done" : current === "accepted" ? "todo" : STATUS_OF[current];
    const id = `collect:q${questId}`;
    const children = [];
    const targetType = isQuest ? "quest-giver" : "prerequisite-giver";
    if (status !== "done" && status !== "ineligible") {
      // A prerequisite this catalog does not list: shown, never guessed.
      for (const prerequisite of quest.prerequisites || []) {
        if (known.has(prerequisite.questId)) continue;
        const where = prerequisiteStatus(prerequisite, characterState);
        children.push(step({ id: `${id}:pre${prerequisite.questId}`, kind: "complete-prerequisite", questId: prerequisite.questId,
          status: where === "done" ? "done" : where === "unknown" ? "unknown" : "todo",
          text: `Complete quest ${prerequisite.questId} first (not in our data)`, location: NOT_IN_DATA }));
      }
      if (current === "accepted") {
        const complete = objectivesComplete(questId);
        children.push(step({ id: `${id}:complete`, kind: "complete-prerequisite", questId, status: "todo", objectivesComplete: complete,
          text: complete === true ? `Turn in ${quest.name}` : complete === false ? `Finish ${quest.name}, then turn it in` : `Complete and turn in ${quest.name}`,
          source: sourceOf(quest), verified: verifiedOf(quest) }));
      } else {
        const key = giverKey(quest);
        if (!(key && key === lastGiver)) children.push(travel(quest, `${id}:travel`, status, targetType));
        children.push(step({ id: `${id}:accept`, kind: "accept", questId, status,
          text: `Accept ${quest.name}${quest.giver?.name ? ` from ${quest.giver.name}` : ""}`, source: sourceOf(quest), verified: verifiedOf(quest) }));
        if (!isQuest && !keepInLog.has(questId)) {
          children.push(step({ id: `${id}:complete`, kind: "complete-prerequisite", questId, status, text: `Complete and turn in ${quest.name}`,
            source: sourceOf(quest), verified: verifiedOf(quest) }));
        }
        lastGiver = key;
      }
      (quest.steps || []).forEach((line, index) => children.push(step({ id: `${id}:note${index + 1}`, kind: "note", questId, status, text: line,
        source: "editorial", verified: verifiedOf(quest) })));
    }
    const lead = isQuest ? (held ? `${quest.name}: in your quest log` : current === "completed" ? `${quest.name}: completed` : `Get ${quest.name}`)
      : `Prerequisite: ${quest.name}`;
    collect.push(step({ id, kind: isQuest ? "quest" : "prerequisite", questId, status, text: lead, children,
      waypoint: status === "done" || status === "ineligible" ? null : giverWaypoint(quest, targetType),
      source: sourceOf(quest), verified: verifiedOf(quest), collapsed: status === "done",
      reasons: status === "unknown" || status === "blocked" || status === "ineligible" ? states.get(questId).reasons : null }));
  }

  // ---- share: quests a group member could share now. Nobody is assumed to hold one.
  const share = [];
  const grouped = Number.isSafeInteger(party?.size) && party.size > 1;
  for (const questId of order) {
    const quest = known.get(questId);
    if (quest.shareable !== "yes" || stateOf(questId) !== "available") continue;
    const id = `share:q${questId}`;
    share.push(step({ id, kind: "share", questId, status: "todo", text: `${quest.name}: shareable`, source: sourceOf(quest), verified: verifiedOf(quest),
      children: [
        step({ id: `${id}:ask`, kind: "ask-share", questId, status: "todo",
          text: `${grouped ? "Ask your group" : "Once grouped, ask"} whether anyone has ${quest.name} to share`, source: sourceOf(quest) }),
        travel(quest, `${id}:travel`, "todo", nodes.get(questId).role === "quest" ? "quest-giver" : "prerequisite-giver", { optional: true }),
      ] }));
  }

  // ---- enter: every dungeon quest collected, then the entrance.
  const collected = collect.filter((entry) => entry.kind === "quest");
  const has = (name) => collected.some((entry) => entry.status === name);
  const verify = !collected.length || collected.every((entry) => entry.status === "done") ? "done"
    : has("todo") ? "todo" : has("blocked") ? "blocked" : "unknown";
  const entrance = doc?.entrance || (dungeon?.entrance ? { ...dungeon.entrance, zoneName: dungeon.zoneName ?? null, verified: false, source: null } : null);
  const entranceSource = doc?.entrance ? "editorial" : "atlas";
  const entranceWp = entrance ? waypoint("wp:entrance", { ...entrance, zoneName: entrance.zoneName ?? dungeon?.zoneName ?? null },
    dungeon?.name ?? null, "entrance", entranceSource, entrance.verified) : null;
  const doneCount = collected.filter((entry) => entry.status === "done").length;
  const goStatus = verify === "done" ? "todo" : verify === "unknown" ? "unknown" : "blocked";
  const enter = [
    step({ id: "enter:verify", kind: "verify", status: verify,
      text: collected.length ? `Have every dungeon quest (${doneCount} of ${collected.length})` : "No dungeon quests to collect" }),
    step({ id: "enter:travel", kind: "travel", status: goStatus, waypoint: entranceWp, location: entranceWp ? null : NOT_IN_DATA,
      source: entranceSource, verified: entrance?.verified === true,
      text: entranceWp ? `Go to the entrance${waypoints.get(entranceWp).zoneName ? ` in ${waypoints.get(entranceWp).zoneName}` : ""} (${coordinatesText(waypoints.get(entranceWp))})`
        : "Entrance location not in our data" }),
    step({ id: "enter:enter", kind: "enter", status: goStatus, text: verify === "done" ? "Enter the dungeon: you are ready" : "Enter when every quest is collected" }),
  ];

  // ---- optional, repeatable and unknown quests.
  const plain = (relevance, kind) => sortedIds.filter((questId) => known.get(questId).relevance === relevance && !inCycle.has(questId)
    && stateOf(questId) !== "ineligible").map((questId) => {
    const quest = known.get(questId);
    const current = stateOf(questId);
    const status = current === "accepted" ? "done" : STATUS_OF[current];
    return step({ id: `${kind}:q${questId}`, kind, questId, status, text: quest.name, source: sourceOf(quest), verified: verifiedOf(quest),
      waypoint: status === "done" ? null : giverWaypoint(quest, "quest-giver"),
      reasons: status === "unknown" || status === "blocked" ? states.get(questId).reasons : null });
  });
  const optional = plain("optional", "optional");
  const repeatable = plain("repeatable", "repeatable");
  const unknown = sortedIds.filter((questId) => inCycle.has(questId) || (known.get(questId).relevance === "unknown" && stateOf(questId) !== "ineligible"))
    .map((questId) => {
      const quest = known.get(questId);
      const reasons = inCycle.has(questId) ? ["prerequisite-cycle"] : ["relevance-not-known", ...states.get(questId).reasons];
      return step({ id: `unknown:q${questId}`, kind: "unknown", questId, status: "unknown", text: quest.name, reasons,
        source: sourceOf(quest), verified: verifiedOf(quest) });
    });

  // ---- turnIn: what is in the log, then what a dungeon quest unlocks.
  const turnIn = [];
  for (const questId of sortedIds) {
    const quest = known.get(questId);
    if (stateOf(questId) !== "accepted" || quest.relevance === "prerequisite" || inCycle.has(questId)) continue;
    const complete = objectivesComplete(questId);
    const id = `turnin:q${questId}`;
    const ender = quest.turnIn;
    const wp = ender ? waypoint(`wp:turnin:${questId}`, ender.location, ender.name, "turn-in", "editorial", verifiedOf(quest)) : null;
    const where = wp ? waypoints.get(wp) : null;
    const to = ender?.name ? ` to ${ender.name}` : "";
    const line = complete === false ? `Finish ${quest.name}'s objectives`
      : `Turn in ${quest.name}${to}${where ? `${where.zoneName ? ` in ${where.zoneName}` : ""} (${coordinatesText(where)})` : ": turn-in location not in our data"}`;
    turnIn.push(step({ id, kind: complete === false ? "finish-objectives" : "turn-in", questId, status: complete === null ? "unknown" : "todo",
      objectivesComplete: complete, text: line, waypoint: wp, location: complete !== false && !wp ? NOT_IN_DATA : null,
      source: ender ? "editorial" : sourceOf(quest), verified: ender ? verifiedOf(quest) : false }));
  }
  for (const questId of sortedIds) {
    const quest = known.get(questId);
    const current = stateOf(questId);
    if (nodes.has(questId) || inCycle.has(questId) || ["completed", "accepted", "ineligible"].includes(current)) continue;
    const unlockedBy = (quest.prerequisites || []).find((prerequisite) => known.has(prerequisite.questId)
      && known.get(prerequisite.questId).relevance === "dungeon" && !done(prerequisite.questId));
    if (!unlockedBy && !(quest.relevance === "dungeon" && afterDungeon(questId))) continue;
    turnIn.push(step({ id: `followup:q${questId}`, kind: "follow-up", questId, status: STATUS_OF[current],
      text: unlockedBy ? `Follow-up: ${quest.name}, after ${known.get(unlockedBy.questId).name}` : `Follow-up: ${quest.name}, after the dungeon`,
      waypoint: giverWaypoint(quest, "quest-giver"), source: sourceOf(quest), verified: verifiedOf(quest),
      reasons: current === "unknown" ? states.get(questId).reasons : null }));
  }

  // ---- Editorial instructions, per section.
  const notes = Object.fromEntries(SECTIONS.map((name) => [name, (doc?.instructions || []).filter((entry) => entry.section === name)
    .map((entry) => ({ text: entry.text, verified: entry.verified, source: entry.source }))]));

  const sectionSteps = { collect, share, enter, optional, repeatable, unknown, turnIn };
  const sections = SECTIONS.map((key) => ({ key, steps: sectionSteps[key], notes: notes[key] }));
  const counts = Object.fromEntries(SECTIONS.map((key) => {
    const tally = emptyCounts();
    for (const entry of sectionSteps[key]) { tally.total += 1; tally[entry.status] += 1; }
    return [key, tally];
  }));

  // next: the first leaf still to do, in the order a player acts: collect,
  // turn in what is finished, then go in. Notes and optional fallbacks are
  // not actions.
  const firstTodo = (list) => {
    for (const entry of list) {
      if (entry.children.length) {
        const found = firstTodo(entry.children);
        if (found) return found;
      } else if (entry.status === "todo" && entry.kind !== "note" && !entry.optional) return entry.id;
    }
    return null;
  };
  const next = firstTodo(collect) || firstTodo(turnIn.filter((entry) => entry.kind === "turn-in")) || firstTodo(enter);

  const readiness = evaluateReadiness(merged, characterState, { wingKey });
  return {
    schemaVersion: QUEST_PLAN_SCHEMA,
    dungeon: { instanceId, dungeonKey: dungeon?.dungeonKey ?? null, name: dungeon?.name ?? null, wingKey: wingKey ?? null, zoneName: dungeon?.zoneName ?? null },
    editorial: doc ? { used: true, revision: doc.revision } : { used: false, revision: null },
    party: grouped ? { size: party.size } : null,
    readiness: { readiness: readiness.readiness, required: readiness.required, counts: readiness.counts },
    next,
    sections,
    waypoints: [...waypoints.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    counts,
    hidden: { ineligible: sortedIds.filter((questId) => stateOf(questId) === "ineligible" && !nodes.has(questId)).length },
    problems,
  };
}
