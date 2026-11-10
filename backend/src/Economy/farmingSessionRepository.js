import { withGuildDatabase } from "../Data/database.js";
import { FARMING_MIN_GATHERS, FARMING_MIN_SECONDS, farmingSessionQuality } from "./farmingSessionModel.js";
import { serverKeySql } from "../Player/playerServers.js";

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

// A player's own farming sessions. Sessions are personal activity (when and
// where someone played), so every read names the account whose sessions it
// returns; there is no "everyone's sessions" read.
export function readFarmingSessions({ memberId, server = "", realm = "", build = "", mode = "", limit = 30 } = {}) {
  return withGuildDatabase((db) => {
    const clauses = ["member_id = ?"];
    const params = [text(memberId)];
    if (server) {
      clauses.push(`${serverKeySql("farming_sessions")} = ?`);
      params.push(server);
    }
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
    // Each map's name for the hotspot view: the zone most often recorded on
    // it, and how many observations it holds overall (points are capped).
    const maps = new Map();
    for (const row of db.prepare(`
      SELECT map_id, zone, COUNT(*) AS observations
      FROM economic_observations WHERE ${clauses.join(" AND ")}
      GROUP BY map_id, zone ORDER BY observations DESC, map_id
    `).all(...params)) {
      const entry = maps.get(row.map_id) || { mapId: row.map_id, zone: row.zone || null, observations: 0 };
      entry.zone = entry.zone || row.zone || null;
      entry.observations += row.observations;
      maps.set(row.map_id, entry);
    }
    return {
      sourceKey: text(sourceKey, 240), coordinateSystem: "ui_map_normalized", truncated: points.length > cappedLimit,
      maps: [...maps.values()].sort((a, b) => b.observations - a.observations || a.mapId - b.mapId),
      points: points.slice(0, cappedLimit).map((p) => ({ mapId: p.map_id, x: p.px, y: p.py,
        realm: p.realm, region: p.region, build: p.game_build, positionKind: p.position_kind, observations: p.observations })),
    };
  });
}

const MAP_GRID = 200;

// The resource map: where every source was gathered, across all zones.
// Points are binned to a 0.5% grid per zone and source so the whole world
// fits in one response; zones and sources summarise the same filter for the
// map's legend.
export function readFarmingMap({ discipline = "", source = "", item = "", realm = "", region = "", build = "", limit = 8000 } = {}) {
  return withGuildDatabase((db) => {
    const clauses = ["map_id > 0", "x IS NOT NULL", "y IS NOT NULL", "x BETWEEN 0 AND 1", "y BETWEEN 0 AND 1"];
    const params = [];
    for (const [column, value] of [["discipline", discipline], ["realm", realm], ["region", region], ["game_build", build]]) {
      if (text(value)) { clauses.push(`${column} = ?`); params.push(text(value)); }
    }
    const sourceKeys = String(source || "").split(",").map((value) => text(value, 240)).filter(Boolean).slice(0, 50);
    if (sourceKeys.length) {
      clauses.push(`source_key IN (${sourceKeys.map(() => "?").join(", ")})`);
      params.push(...sourceKeys);
    }
    if (text(item, 200)) {
      clauses.push("id IN (SELECT observation_id FROM economic_observation_outputs WHERE item_key = ?)");
      params.push(text(item, 200));
    }
    const where = clauses.join(" AND ");
    const cappedLimit = Math.min(20000, Math.max(1, Math.trunc(Number(limit)) || 8000));

    const points = db.prepare(`
      SELECT map_id, source_key, ROUND(x * ${MAP_GRID}) / ${MAP_GRID}.0 AS px, ROUND(y * ${MAP_GRID}) / ${MAP_GRID}.0 AS py, COUNT(*) AS observations
      FROM economic_observations WHERE ${where}
      GROUP BY map_id, source_key, px, py
      ORDER BY observations DESC, map_id, source_key, px, py LIMIT ?
    `).all(...params, cappedLimit + 1);

    const zones = new Map();
    for (const row of db.prepare(`
      SELECT map_id, zone, COUNT(*) AS observations, COUNT(DISTINCT source_key) AS sources
      FROM economic_observations WHERE ${where}
      GROUP BY map_id, zone ORDER BY observations DESC, map_id
    `).all(...params)) {
      const entry = zones.get(row.map_id) || { mapId: row.map_id, zone: row.zone || null, observations: 0, sources: 0 };
      entry.zone = entry.zone || row.zone || null;
      entry.observations += row.observations;
      entry.sources = Math.max(entry.sources, row.sources);
      zones.set(row.map_id, entry);
    }

    const icons = new Map();
    for (const row of db.prepare(`
      SELECT o.source_key, i.item_key, i.item_id, i.item_name, i.quality_id, i.icon_file_data_id, COUNT(*) AS drops
      FROM economic_observations o JOIN economic_observation_outputs i ON i.observation_id = o.id
      WHERE ${clauses.map((clause) => clause.replace(/^(id|map_id|x|y|discipline|realm|region|game_build|source_key) /, "o.$1 ")).join(" AND ")}
      GROUP BY o.source_key, i.item_key ORDER BY drops DESC
    `).all(...params)) {
      if (icons.has(row.source_key)) continue;
      icons.set(row.source_key, {
        itemKey: row.item_key, itemId: row.item_id, name: row.item_name || null,
        qualityId: row.quality_id, iconFileDataId: row.icon_file_data_id,
      });
    }
    const sources = db.prepare(`
      SELECT source_key, MAX(source_name) AS name, MAX(discipline) AS discipline, COUNT(*) AS observations, COUNT(DISTINCT map_id) AS zones
      FROM economic_observations WHERE ${where}
      GROUP BY source_key ORDER BY observations DESC, source_key
    `).all(...params).map((row) => ({
      sourceKey: row.source_key, name: row.name || "Unknown source", discipline: row.discipline,
      observations: row.observations, zones: row.zones, icon: icons.get(row.source_key) || null,
    }));

    return {
      coordinateSystem: "ui_map_normalized",
      grid: 1 / MAP_GRID,
      truncated: points.length > cappedLimit,
      zones: [...zones.values()].sort((a, b) => b.observations - a.observations || a.mapId - b.mapId),
      sources,
      points: points.slice(0, cappedLimit).map((p) => ({ mapId: p.map_id, sourceKey: p.source_key, x: p.px, y: p.py, observations: p.observations })),
    };
  });
}
