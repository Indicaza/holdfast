import { list } from "../luaList.js";

// quest_state: one character's World of Warcraft quest state (not
// Guildweaver's own guild quests), the contract in
// docs/dungeon-quest-readiness.md ("Step 4B"). One state stream per
// character (`quest_state:<characterId>`); only quest ids, coverage and the
// facts the readiness rules read. No names or other text: a payload with a
// field the contract does not name is refused, so nothing else is stored.
// Personal: read only by the owning account (Atlas/characterQuestState.js).

export const QUEST_STATE_EVENT = "quest_state";
export const QUEST_STATE_PAYLOAD_SCHEMA = 1;

const FACTIONS = new Set(["alliance", "horde"]);
const CLASS_TOKENS = new Set(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"]);
const COMPLETED_COVERAGE = new Set(["full", "checked", "none"]);
const LOG_COVERAGE = new Set(["full", "none"]);
const PAYLOAD_FIELDS = new Set(["schemaVersion", "capturedAt", "faction", "race", "classToken", "level", "completed", "questLog"]);
const COMPLETED_FIELDS = new Set(["coverage", "questIds", "checkedQuestIds"]);
const LOG_FIELDS = new Set(["coverage", "entries"]);
const ENTRY_FIELDS = new Set(["questId", "isComplete"]);
// The client's completed list is a few thousand ids at most; a quest log
// holds 20–35 quests. The caps only refuse nonsense.
export const MAX_COMPLETED_IDS = 20000;
export const MAX_LOG_ENTRIES = 100;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const questId = (value) => Number.isSafeInteger(value) && value > 0;
const onlyFields = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
// An empty Lua table arrives as {}: read it as an empty list.
const idList = (value) => {
  if (value === undefined || value === null) return [];
  const values = list(value);
  return Array.isArray(values) ? values : null;
};

// The payload against the contract: null when it holds, else the problem.
export function questStateProblem(payload) {
  if (!isObject(payload)) return "payload must be an object";
  if (!onlyFields(payload, PAYLOAD_FIELDS)) return "payload has a field the contract does not name";
  if (payload.schemaVersion !== QUEST_STATE_PAYLOAD_SCHEMA) return "schemaVersion must be 1";
  if (!(typeof payload.capturedAt === "number" && Number.isFinite(payload.capturedAt) && payload.capturedAt >= 0)) return "capturedAt must be a server time";
  const faction = payload.faction ?? null;
  if (faction !== null && !FACTIONS.has(faction)) return "faction must be alliance, horde or null";
  const race = payload.race ?? null;
  if (race !== null && !(typeof race === "string" && /^[A-Za-z]{2,20}$/.test(race))) return "race must be a client race token or null";
  const classToken = payload.classToken ?? null;
  if (classToken !== null && !CLASS_TOKENS.has(classToken)) return "classToken is not a class token";
  const level = payload.level ?? null;
  if (level !== null && !(Number.isSafeInteger(level) && level >= 1 && level <= 100)) return "level must be 1-100 or null";

  const completed = payload.completed;
  if (!isObject(completed) || !onlyFields(completed, COMPLETED_FIELDS) || !COMPLETED_COVERAGE.has(completed.coverage)) return "completed.coverage must be full, checked or none";
  const done = idList(completed.questIds);
  const checked = idList(completed.checkedQuestIds);
  if (!done || !done.every(questId) || done.length > MAX_COMPLETED_IDS) return "completed.questIds must be quest ids";
  if (!checked || !checked.every(questId) || checked.length > MAX_COMPLETED_IDS) return "completed.checkedQuestIds must be quest ids";
  if (completed.coverage === "none" && (done.length || checked.length)) return "completed.coverage none carries no ids";
  if (completed.coverage === "full" && checked.length) return "completed.checkedQuestIds belongs to coverage checked";
  if (completed.coverage === "checked") {
    // Checked: exactly the ids that were asked, and only those can answer yes.
    if (!checked.length) return "completed.coverage checked must name the ids it asked";
    const asked = new Set(checked);
    if (!done.every((id) => asked.has(id))) return "completed.questIds must be among checkedQuestIds";
  }

  const log = payload.questLog;
  if (!isObject(log) || !onlyFields(log, LOG_FIELDS) || !LOG_COVERAGE.has(log.coverage)) return "questLog.coverage must be full or none";
  const entries = idList(log.entries);
  if (!entries || entries.length > MAX_LOG_ENTRIES) return "questLog.entries must be a list";
  for (const entry of entries) {
    if (!isObject(entry) || !onlyFields(entry, ENTRY_FIELDS) || !questId(entry.questId)) return "questLog.entries must be { questId, isComplete }";
    if (!(entry.isComplete === undefined || entry.isComplete === null || typeof entry.isComplete === "boolean")) return "questLog.entries isComplete must be true, false or null";
  }
  // A log that could not be read is "none", never an empty full list.
  if (log.coverage === "none" && entries.length) return "questLog.coverage none carries no entries";
  return null;
}

const sortedIds = (values) => [...new Set(values)].sort((a, b) => a - b);

// The stored shape: ids sorted and unique, absent facts as null, lists as
// lists (never Lua's {}).
export function canonicalQuestState(payload) {
  const done = idList(payload.completed.questIds);
  const checked = idList(payload.completed.checkedQuestIds);
  const entries = new Map();
  for (const entry of idList(payload.questLog.entries)) {
    entries.set(entry.questId, { questId: entry.questId, isComplete: typeof entry.isComplete === "boolean" ? entry.isComplete : null });
  }
  return {
    schemaVersion: QUEST_STATE_PAYLOAD_SCHEMA,
    capturedAt: payload.capturedAt,
    faction: payload.faction ?? null,
    race: payload.race ?? null,
    classToken: payload.classToken ?? null,
    level: payload.level ?? null,
    completed: payload.completed.coverage === "checked"
      ? { coverage: "checked", questIds: sortedIds(done), checkedQuestIds: sortedIds(checked) }
      : { coverage: payload.completed.coverage, questIds: sortedIds(done) },
    questLog: { coverage: payload.questLog.coverage, entries: [...entries.values()].sort((a, b) => a.questId - b.questId) },
  };
}

export const questStateTelemetryHandler = {
  eventType: QUEST_STATE_EVENT,
  validate({ kind, streamKey, envelope, payloadSchemaVersion }) {
    if (Number(payloadSchemaVersion) !== QUEST_STATE_PAYLOAD_SCHEMA) return { ok: false, error: "unsupported_telemetry_payload_schema" };
    if (kind !== "state") return { ok: false, error: "invalid_quest_state" };
    const characterId = String(envelope?.characterId || "").trim();
    if (!characterId) return { ok: false, error: "telemetry_character_id_required" };
    // One stream per character: a stream can never carry another
    // character's quests.
    if (streamKey !== `${QUEST_STATE_EVENT}:${characterId}`) return { ok: false, error: "invalid_quest_state" };
    return questStateProblem(envelope.payload) ? { ok: false, error: "invalid_quest_state" } : { ok: true };
  },
  canonicalize({ envelope }) {
    return canonicalQuestState(envelope.payload);
  },
};
