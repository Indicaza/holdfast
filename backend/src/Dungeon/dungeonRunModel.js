// Validation of the addon's dungeon_run event. Optional numbers may be
// missing (the client could not read them) but never wrong: a run that
// fails here is kept as a raw record only.
//
// Payload schema 1 (add-ons before Dungeon V2) and 2 (Dungeon V2) are both accepted.
// Schema 2 only adds: `checkpoints` (boss kills and manual splits with a
// stable id, kept apart from the bounded timeline so a long run never loses
// them), `completion.basis` (what proved the clear), a `complete` timeline
// marker and `bosses.duplicatesIgnored`. A schema 1 run reads exactly as
// before; its checkpoints are derived from its timeline.
export const DUNGEON_SCHEMA_VERSIONS = Object.freeze([1, 2]);
export const MAX_CHECKPOINTS = 40;
export const COMPLETION_BASES = Object.freeze(["lockout", "encounters", "manual", "none"]);
export const DUNGEON_STATUSES = ["open", "completed", "interrupted", "abandoned"];
export const FINAL_DUNGEON_STATUSES = new Set(["completed", "interrupted", "abandoned"]);
export const MAX_TIMELINE = 60;
// XP/hour is shown only for runs at least this long.
export const XP_RATE_MIN_SECONDS = 300;

const TIMELINE_KINDS = new Set(["enter", "leave", "reenter", "resume", "boss_kill", "encounter_start",
  "encounter_failed", "death", "level_up", "manual_split", "complete"]);
const CHECKPOINT_KINDS = new Set(["boss", "split"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function optionalInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return value === undefined || value === null || integer(value, min, max);
}

function optionalText(value, max = 160) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= max);
}

// Lua writes an empty table as {} and a list as an array (or as an object
// keyed "1", "2"…). Both are accepted.
export function luaList(value) {
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [];
    if (keys.every((key, index) => key === String(index + 1))) return keys.map((key) => value[key]);
  }
  return null;
}

function validTimelineEntry(entry) {
  return isObject(entry) && TIMELINE_KINDS.has(entry.kind) && integer(entry.at, 0, 604800)
    && optionalText(entry.name) && optionalInteger(entry.encounterId, 1) && optionalInteger(entry.level, 1, 1000)
    && optionalText(entry.source, 40) && optionalText(entry.reason, 60);
}

function validCheckpoint(entry) {
  return isObject(entry) && typeof entry.id === "string" && /^[\w:.'-]{1,80}$/.test(entry.id) && CHECKPOINT_KINDS.has(entry.kind)
    && integer(entry.at, 0, 604800) && optionalText(entry.name) && optionalInteger(entry.encounterId, 1) && optionalText(entry.source, 40);
}

export function validDungeonRun(record) {
  const envelope = record?.envelope;
  const p = envelope?.payload;
  if (record?.kind !== "event" || !isObject(p) || !DUNGEON_SCHEMA_VERSIONS.includes(p.schemaVersion)) return false;
  if (Number(record.payloadSchemaVersion ?? envelope.payloadSchemaVersion ?? p.schemaVersion) !== p.schemaVersion) return false;
  if (typeof p.runId !== "string" || !/^[\w:-]{1,160}$/.test(p.runId)) return false;
  if (!integer(p.sequence, 1)) return false;
  if (!DUNGEON_STATUSES.includes(p.status)) return false;
  if (!integer(p.startedAt, 1)) return false;
  if (!integer(p.durationSeconds, 0, 604800)) return false;
  if (!optionalInteger(p.insideSeconds, 0, p.durationSeconds + 5)) return false;
  if (p.status !== "open") {
    if (!integer(p.endedAt, p.startedAt) || p.durationSeconds > p.endedAt - p.startedAt + 60) return false;
    if (typeof p.endReason !== "string" || !/^[a-z_]{1,60}$/.test(p.endReason)) return false;
  }
  const instance = p.instance;
  if (!isObject(instance) || !["party", "raid"].includes(instance.type) || !optionalText(instance.name)
    || !optionalInteger(instance.instanceId) || !optionalInteger(instance.difficultyId)
    || !optionalText(instance.difficultyName, 60) || !optionalInteger(instance.maxPlayers, 0, 100)) return false;
  const character = isObject(p.character) ? p.character : {};
  if (!optionalInteger(character.levelAtEntry, 1, 1000) || !optionalInteger(character.levelAtExit, 1, 1000)) return false;
  const group = isObject(p.group) ? p.group : {};
  if (!optionalInteger(group.sizeAtEntry, 1, 100) || !optionalInteger(group.maxSize, 1, 100)) return false;
  const xp = p.xp;
  if (!isObject(xp) || typeof xp.available !== "boolean" || typeof xp.atLevelCap !== "boolean") return false;
  if (!optionalInteger(xp.gained, 0, 100000000) || !optionalInteger(xp.levelUps, 0, 100)) return false;
  // XP at the level cap or without readings is not a number.
  if ((xp.atLevelCap || !xp.available) && xp.gained !== undefined && xp.gained !== null) return false;
  const wallet = p.wallet;
  if (!isObject(wallet) || wallet.basis !== "wallet_delta" || typeof wallet.available !== "boolean") return false;
  if (wallet.netCopper !== undefined && wallet.netCopper !== null
    && (!wallet.available || !Number.isSafeInteger(wallet.netCopper) || Math.abs(wallet.netCopper) > 1e11)) return false;
  if (!integer(p.deaths, 0, 100000)) return false;
  const bosses = p.bosses;
  if (!isObject(bosses) || !integer(bosses.defeated, 0, 1000) || !optionalInteger(bosses.total, 1, 1000)
    || !optionalInteger(bosses.manualSplits, 0, 1000) || typeof bosses.encounterEvents !== "boolean") return false;
  const timeline = luaList(p.timeline ?? []);
  if (!timeline || timeline.length > MAX_TIMELINE || !timeline.every(validTimelineEntry)) return false;
  if (p.loot !== undefined && !(isObject(p.loot) && optionalInteger(p.loot.observations, 0, 1000000))) return false;
  if (p.schemaVersion >= 2) {
    const checkpoints = luaList(p.checkpoints ?? []);
    if (!checkpoints || checkpoints.length > MAX_CHECKPOINTS || !checkpoints.every(validCheckpoint)) return false;
    if (new Set(checkpoints.map((entry) => entry.id)).size !== checkpoints.length) return false;
    if (p.completion !== undefined && !(isObject(p.completion) && COMPLETION_BASES.includes(p.completion.basis))) return false;
    if (!optionalInteger(bosses.duplicatesIgnored, 0, 1000)) return false;
  } else if (p.checkpoints !== undefined || p.completion !== undefined) {
    // Schema 2 fields on a schema 1 payload: a mixed-up writer.
    return false;
  }
  return Boolean(String(envelope.characterId || "").trim() && String(envelope.installationId || "").trim());
}

// The canonical key of a run: one per account, addon installation and run.
export function dungeonRunKey(memberId, installationId, runId) {
  return JSON.stringify([String(memberId || "").slice(0, 160), String(installationId || "").slice(0, 160), String(runId || "").slice(0, 160)]);
}

// XP per hour only when it means something: XP was read, the character was
// not at the level cap, and the run lasted long enough.
export function xpPerHour({ xpAvailable, atLevelCap, xpGained, durationSeconds }) {
  if (!xpAvailable || atLevelCap || !Number.isFinite(xpGained) || durationSeconds < XP_RATE_MIN_SECONDS) return null;
  return Math.round(xpGained * 3600 / durationSeconds);
}
