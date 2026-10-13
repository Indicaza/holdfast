import { withGuildDatabase } from "../Data/database.js";
import { FARMING_MIN_GATHERS, FARMING_MIN_SECONDS, farmingSessionQuality } from "./farmingSessionModel.js";

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

export function recordFarmingSessionInDatabase(db, { envelope, memberId, receivedAt }) {
  const p = envelope.payload;
  const key = JSON.stringify([text(memberId), text(envelope.installationId), p.sessionId]);
  const result = db.prepare(`
    INSERT INTO farming_sessions (
      session_key, member_id, installation_id, raw_character_id, sequence, mode, status, end_reason,
      started_at, ended_at, duration_seconds, afk_seconds, gathering_count, zone, map_id,
      realm, region, game_build, class_token, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      sequence = excluded.sequence, status = excluded.status, end_reason = excluded.end_reason,
      ended_at = excluded.ended_at, duration_seconds = excluded.duration_seconds,
      afk_seconds = excluded.afk_seconds, gathering_count = excluded.gathering_count,
      received_at = excluded.received_at
    WHERE excluded.sequence > farming_sessions.sequence AND farming_sessions.status <> 'complete'
      AND excluded.raw_character_id = farming_sessions.raw_character_id
      AND excluded.started_at = farming_sessions.started_at AND excluded.mode = farming_sessions.mode
      AND excluded.duration_seconds >= farming_sessions.duration_seconds
  `).run(
    key, text(memberId), text(envelope.installationId), text(envelope.characterId, 240),
    p.sequence, p.mode, p.status, text(p.endReason, 60), p.startedAt,
    p.status === "complete" ? p.endedAt : null, p.durationSeconds,
    p.afkAvailable === true ? p.afkSeconds : null, p.gatheringCount,
    text(p.location?.zone), Number.isInteger(p.location?.mapId) && p.location.mapId > 0 ? p.location.mapId : null,
    text(envelope.realm), text(envelope.region, 40), text(envelope.gameBuild?.build, 40), text(p.classToken, 40), receivedAt,
  );
  return { status: result.changes ? "updated" : "duplicate", sessionChanged: Boolean(result.changes) };
}

export function readFarmingSessions({ realm = "", build = "", mode = "", limit = 30 } = {}) {
  return withGuildDatabase((db) => {
    const clauses = [];
    const params = [];
    for (const [column, value] of [["realm", realm], ["game_build", build], ["mode", mode]]) {
      if (text(value)) { clauses.push(`${column} = ?`); params.push(text(value)); }
    }
    const cappedLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 30));
    const rows = db.prepare(`SELECT * FROM farming_sessions ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY started_at DESC, id DESC LIMIT ?`).all(...params, cappedLimit);
    const keys = rows.map((row) => row.session_key);
    const placeholders = keys.map(() => "?").join(", ");
    const counts = new Map();
    const outputsBySession = new Map();
    if (keys.length) {
      for (const row of db.prepare(`SELECT farming_session_key, COUNT(*) AS n FROM economic_observations
        WHERE farming_session_key IN (${placeholders}) GROUP BY farming_session_key`).all(...keys)) {
        counts.set(row.farming_session_key, Number(row.n));
      }
      for (const row of db.prepare(`
        SELECT o.farming_session_key, i.item_key, MAX(i.item_id) AS item_id, MAX(i.item_name) AS name, SUM(i.quantity) AS quantity
        FROM economic_observations o JOIN economic_observation_outputs i ON i.observation_id = o.id
        WHERE o.farming_session_key IN (${placeholders}) GROUP BY o.farming_session_key, i.item_key
        ORDER BY quantity DESC, i.item_key
      `).all(...keys)) {
        const items = outputsBySession.get(row.farming_session_key) || [];
        items.push(row);
        outputsBySession.set(row.farming_session_key, items);
      }
    }
    const sessions = rows.map((row) => {
      const observedGathers = counts.get(row.session_key) || 0;
      const durationSeconds = Number(row.duration_seconds);
      const quality = farmingSessionQuality({ status: row.status, durationSeconds, expectedGathers: row.gathering_count, observedGathers });
      const eligible = quality === "sustained";
      const nonAfkSeconds = row.afk_seconds === null ? null : Math.max(0, durationSeconds - Number(row.afk_seconds));
      const outputs = (outputsBySession.get(row.session_key) || []).map((item) => ({
        itemKey: item.item_key, itemId: item.item_id, name: item.name, quantity: Number(item.quantity),
        perHour: eligible ? Number(item.quantity) * 3600 / durationSeconds : null,
        perNonAfkHour: eligible && nonAfkSeconds >= FARMING_MIN_SECONDS ? Number(item.quantity) * 3600 / nonAfkSeconds : null,
      }));
      return {
        id: Number(row.id), mode: row.mode, timing: row.mode === "manual" ? "measured" : "estimated",
        status: row.status, quality, endReason: row.end_reason,
        startedAt: row.started_at, endedAt: row.ended_at, durationSeconds,
        afkSeconds: row.afk_seconds, nonAfkSeconds, expectedGathers: row.gathering_count, observedGathers,
        zone: row.zone, mapId: row.map_id, realm: row.realm, region: row.region, build: row.game_build,
        classToken: row.class_token, yieldBasis: "loot_window", outputs,
      };
    });
    return {
      thresholds: { minimumSeconds: FARMING_MIN_SECONDS, minimumGathers: FARMING_MIN_GATHERS },
      sessions,
    };
  });
}

export function readFarmingLocations(sourceKey, { mapId = "", realm = "", region = "", build = "", limit = 500 } = {}) {
  return withGuildDatabase((db) => {
    const clauses = ["source_key = ?", "map_id > 0", "x IS NOT NULL", "y IS NOT NULL", "x BETWEEN 0 AND 1", "y BETWEEN 0 AND 1"];
    const params = [text(sourceKey, 240)];
    for (const [column, value] of [["map_id", mapId], ["realm", realm], ["region", region], ["game_build", build]]) {
      if (text(value)) { clauses.push(`${column} = ?`); params.push(text(value)); }
    }
    const cappedLimit = Math.min(2000, Math.max(1, Math.trunc(Number(limit)) || 500));
    const points = db.prepare(`
      SELECT map_id, realm, region, game_build, position_kind, ROUND(x, 4) AS px, ROUND(y, 4) AS py, COUNT(*) AS observations
      FROM economic_observations WHERE ${clauses.join(" AND ")}
      GROUP BY map_id, realm, region, game_build, position_kind, px, py
      ORDER BY observations DESC, map_id, px, py LIMIT ?
    `).all(...params, cappedLimit + 1);
    return {
      sourceKey: text(sourceKey, 240), coordinateSystem: "ui_map_normalized", truncated: points.length > cappedLimit,
      points: points.slice(0, cappedLimit).map((p) => ({ mapId: p.map_id, x: p.px, y: p.py,
        realm: p.realm, region: p.region, build: p.game_build, positionKind: p.position_kind, observations: p.observations })),
    };
  });
}
