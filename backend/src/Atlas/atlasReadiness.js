// Dungeon quest readiness: for one character and one dungeon (or wing),
// where each of its quests stands and whether the character has every
// dungeon quest it can have before going in. Pure and deterministic: it
// reads only the quest catalog (Atlas/atlasQuests.js) and the character
// state it is given (the contract below), and never guesses a state the
// client did not report.
//
// Character state, schema 1 (docs/dungeon-quest-readiness.md):
//   {
//     schemaVersion: 1,
//     faction: "alliance" | "horde" | null,
//     race: client race token ("NightElf", "Scourge", ...) | null,
//     classToken: "WARRIOR" | ... | null,
//     level: integer | null,
//     completed: { coverage: "full" | "checked" | "none", questIds: [id], checkedQuestIds: [id] },
//     questLog:  { coverage: "full" | "none", questIds: [id] }
//   }
// coverage "full": the list is the client's whole list (GetQuestsCompleted,
// a full quest-log scan), so an id missing from it is known not to be
// there. "checked": only checkedQuestIds were asked (IsQuestFlaggedCompleted)
// and questIds are the ones that answered yes. "none": nothing is known.
// A quest missing from a list proves nothing unless the list says so.
//
// Quest states:
//   completed       the client reports it completed
//   accepted        it is in the quest log
//   available       the character can take it now
//   prerequisites   a prerequisite is known not to be done
//   ineligible      faction, race, class or level rules it out
//   unknown         the state the client gave cannot settle it
// Readiness (over the "dungeon" quests that apply to the character):
//   ready     every one is completed or accepted
//   missing   at least one is available and not yet taken
//   blocked   none is available, but at least one waits on a prerequisite
//   unknown   at least one cannot be settled (and none is missing or blocked)
//   none      no dungeon quest applies (or the catalog lists none)
// Optional, prerequisite and repeatable quests are reported but never
// change readiness; "zone" quests are left out.

export const READINESS_SCHEMA = 1;
export const QUEST_STATES = Object.freeze(["completed", "accepted", "available", "prerequisites", "ineligible", "unknown"]);
export const READINESS = Object.freeze(["ready", "missing", "blocked", "unknown", "none"]);

const FACTIONS = new Set(["alliance", "horde"]);
const COVERAGE = new Set(["full", "checked", "none"]);
const CLASS_TOKENS = new Set(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"]);
const MAX_IDS = 20000;

const ids = (value) => (Array.isArray(value) ? value.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, MAX_IDS) : []);

// The character state, checked against the contract; problems say what is
// wrong (the caller answers 400). Unknown fields are ignored.
export function readCharacterState(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") return { state: null, problems: ["state must be an object"] };
  if (raw.schemaVersion !== READINESS_SCHEMA) problems.push(`schemaVersion must be ${READINESS_SCHEMA}`);
  const faction = raw.faction ?? null;
  if (faction !== null && !FACTIONS.has(faction)) problems.push("faction must be alliance, horde or null");
  const classToken = raw.classToken ?? null;
  if (classToken !== null && !CLASS_TOKENS.has(classToken)) problems.push("classToken is not a class token");
  const level = raw.level ?? null;
  if (level !== null && !(Number.isSafeInteger(level) && level >= 1 && level <= 100)) problems.push("level must be 1-100 or null");
  const race = raw.race ?? null;
  if (race !== null && !(typeof race === "string" && /^[A-Za-z]{2,20}$/.test(race))) problems.push("race must be a client race token or null");
  const list = (name, allowed) => {
    const value = raw[name] ?? { coverage: "none" };
    if (!value || typeof value !== "object" || !allowed.has(value.coverage)) {
      problems.push(`${name}.coverage must be one of ${[...allowed].join(", ")}`);
      return { coverage: "none", questIds: new Set(), checked: new Set() };
    }
    return { coverage: value.coverage, questIds: new Set(ids(value.questIds)), checked: new Set(ids(value.checkedQuestIds)) };
  };
  const completed = list("completed", COVERAGE);
  const questLog = list("questLog", new Set(["full", "none"]));
  return { state: problems.length ? null : { faction, race, classToken, level, completed, questLog }, problems };
}

// Is a quest known to be done, known not to be, or unknown?
function doneState(state, questId) {
  const { completed } = state;
  if (completed.questIds.has(questId)) return true;
  if (completed.coverage === "full") return false;
  if (completed.coverage === "checked" && completed.checked.has(questId)) return false;
  return null;
}

function inLog(state, questId) {
  if (state.questLog.questIds.has(questId)) return true;
  return state.questLog.coverage === "full" ? false : null;
}

// One quest's state for the character, with the reasons behind it.
export function questState(quest, state) {
  const reasons = [];
  // Done or in the log first: that is what the client says outright.
  const done = doneState(state, quest.questId);
  if (done === true && !quest.repeatable) return { state: "completed", reasons: ["completed"] };
  const logged = inLog(state, quest.questId);
  if (logged === true) return { state: "accepted", reasons: ["in-quest-log"] };
  // Eligibility: only rules the catalog states, checked against what the
  // character reported; an unreported fact leaves the rule open.
  let eligibilityUnknown = false;
  if (quest.faction === "alliance" || quest.faction === "horde") {
    if (state.faction === null) eligibilityUnknown = true;
    else if (state.faction !== quest.faction) return { state: "ineligible", reasons: ["faction"] };
  } else if (quest.faction === null) eligibilityUnknown = true;
  if (quest.races) {
    if (state.race === null) eligibilityUnknown = true;
    else if (!quest.races.includes(state.race)) return { state: "ineligible", reasons: ["race"] };
  }
  if (quest.classes) {
    if (state.classToken === null) eligibilityUnknown = true;
    else if (!quest.classes.includes(state.classToken)) return { state: "ineligible", reasons: ["class"] };
  }
  if (quest.minLevel) {
    if (state.level === null) eligibilityUnknown = true;
    else if (state.level < quest.minLevel) return { state: "ineligible", reasons: ["level-below-minimum"] };
  }
  if (quest.maxLevel && state.level !== null && state.level > quest.maxLevel) return { state: "ineligible", reasons: ["level-above-maximum"] };
  if (quest.requiresReputation) { eligibilityUnknown = true; reasons.push("reputation-not-reported"); }
  // Prerequisites: each must be known done (or, for mustBeActive, in the log).
  let prerequisitesUnknown = false;
  for (const prerequisite of quest.prerequisites || []) {
    const met = prerequisite.mustBeActive ? inLog(state, prerequisite.questId) : doneState(state, prerequisite.questId);
    if (met === false) return { state: "prerequisites", reasons: [`prerequisite:${prerequisite.questId}`] };
    if (met === null) prerequisitesUnknown = true;
  }
  // A quest whose chain no source records: its prerequisites are not known.
  if (quest.prerequisitesKnown === false && !prerequisitesUnknown) prerequisitesUnknown = true;
  if (eligibilityUnknown) reasons.push("eligibility-not-reported");
  if (prerequisitesUnknown) reasons.push(quest.prerequisitesKnown === false ? "prerequisites-not-known" : "prerequisite-state-not-reported");
  // Not done and not in the log, both known: it can be taken.
  if (done === null && !quest.repeatable) reasons.push("completion-not-reported");
  if (logged === null) reasons.push("quest-log-not-reported");
  if (reasons.length) return { state: "unknown", reasons };
  return { state: "available", reasons: [] };
}

// Readiness for a dungeon's (or wing's) catalog entries.
//   quests: the catalog's quests (zone quests are dropped here)
//   wingKey: a wing's key, to leave out quests attributed to sibling wings
export function evaluateReadiness(quests, state, { wingKey = null } = {}) {
  const applicable = (quests || []).filter((quest) => quest.relevance !== "zone" && (!wingKey || !quest.wing || quest.wing === wingKey));
  const entries = applicable.map((quest) => ({ questId: quest.questId, name: quest.name, relevance: quest.relevance, wing: quest.wing ?? null,
    ...questState(quest, state) }));
  const required = entries.filter((entry) => entry.relevance === "dungeon" && entry.state !== "ineligible");
  const count = (name) => required.filter((entry) => entry.state === name).length;
  let readiness;
  if (!required.length) readiness = "none";
  else if (count("available")) readiness = "missing";
  else if (count("prerequisites")) readiness = "blocked";
  else if (count("unknown")) readiness = "unknown";
  else readiness = "ready";
  const group = (relevance) => entries.filter((entry) => entry.relevance === relevance);
  return {
    schemaVersion: READINESS_SCHEMA,
    readiness,
    counts: Object.fromEntries(QUEST_STATES.map((name) => [name, count(name)])),
    required: required.length,
    quests: group("dungeon"),
    optional: group("optional"),
    prerequisites: group("prerequisite"),
    repeatable: group("repeatable"),
    unknownRelevance: group("unknown"),
  };
}

// Where one prerequisite stands for the character: "done" (completed),
// "accepted" (in the quest log), "missing" (known to be neither), or
// "unknown". A mustBeActive prerequisite counts only from the quest log.
export function prerequisiteStatus(prerequisite, state) {
  const logged = inLog(state, prerequisite.questId);
  if (prerequisite.mustBeActive) return logged === true ? "accepted" : logged === false ? "missing" : "unknown";
  const done = doneState(state, prerequisite.questId);
  if (done === true) return "done";
  if (logged === true) return "accepted";
  return done === false ? "missing" : "unknown";
}

// A character state that reports nothing: every quest that depends on the
// character is unknown, so readiness can never be "ready" from it.
export function emptyCharacterState() {
  return readCharacterState({ schemaVersion: READINESS_SCHEMA, completed: { coverage: "none" }, questLog: { coverage: "none" } }).state;
}
