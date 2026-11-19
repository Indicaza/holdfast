import { parseTelemetryJson } from "./Telemetry/telemetryJson.js";
import { QUEST_STATE_EVENT } from "./Telemetry/handlers/questState.js";
import { readCharacterState } from "../Atlas/atlasReadiness.js";

// A character's latest World of Warcraft quest state, as the add-on last
// reported it through the quest_state telemetry stream, in the readiness
// model's shape (docs/dungeon-quest-readiness.md). Read only for the
// account that owns the character: the caller checks ownership, and the
// query is narrowed to that account's own rows.

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

// The stored payload as the readiness model's character state.
export function characterStateFromQuestPayload(payload) {
  if (!payload || payload.schemaVersion !== 1) return null;
  const { state } = readCharacterState({
    schemaVersion: 1,
    faction: payload.faction ?? null,
    race: payload.race ?? null,
    classToken: payload.classToken ?? null,
    level: payload.level ?? null,
    completed: payload.completed,
    questLog: { coverage: payload.questLog?.coverage, questIds: (payload.questLog?.entries || []).map((entry) => entry.questId) },
  });
  return state;
}

function isoTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// { state, questLog, capturedAt, receivedAt } for the newest report among
// the character's add-on ids (one per installation), or null when the
// add-on has not reported one.
//   rawCharacterIds: the character's own id and its add-on aliases
export function readCharacterQuestStateInDatabase(db, { memberId, characterId, rawCharacterIds = [] }) {
  if (!memberId || !characterId || !tableExists(db, "guildweaver_telemetry_latest_state")) return null;
  const raw = [...new Set([characterId, ...rawCharacterIds].map(String).filter(Boolean))];
  const row = db.prepare(`
    SELECT payload_json, captured_at, received_at
    FROM guildweaver_telemetry_latest_state
    WHERE member_id = ? AND event_type = ?
      AND (canonical_character_id = ? OR raw_character_id IN (${raw.map(() => "?").join(", ")}))
    ORDER BY captured_at DESC, received_at DESC
    LIMIT 1
  `).get(String(memberId), QUEST_STATE_EVENT, String(characterId), ...raw);
  if (!row) return null;
  const payload = parseTelemetryJson(row.payload_json, null);
  const state = characterStateFromQuestPayload(payload);
  if (!state) return null;
  return { state, questLog: payload.questLog, capturedAt: isoTime(row.captured_at), receivedAt: isoTime(row.received_at) };
}
