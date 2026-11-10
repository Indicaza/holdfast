// A signed-in player's own data: their characters, devices, sync health,
// professions and farming. Every read takes the player's account id from the
// session (Player/playerRouter.js) and returns only rows owned by that
// account. Nothing here reads another account's data, and a character or
// device that belongs to someone else is reported exactly like one that does
// not exist.

import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { searchCraftFinderWithSkill } from "../Character/craftFinderRepository.js";
import { readPlayerCharacterCards } from "../Character/ReadModel/readModelReader.js";
import { ensureTelemetryProjectionSchema } from "../Character/telemetryProjection.js";
import { readFarmingSessions } from "../Economy/farmingSessionRepository.js";
import { groupServers, onServer, serverKeySql } from "./playerServers.js";

// Uploads older than this make the sync look stale on the dashboard.
export const STALE_SYNC_MS = 7 * 24 * 60 * 60 * 1000;

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function latest(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

// --- Characters and servers ----------------------------------------------

export function readPlayerCharacters(memberId, { server = "" } = {}) {
  const all = readPlayerCharacterCards(memberId);
  return {
    servers: groupServers(all),
    characters: all.filter((character) => onServer(character, server)),
  };
}

// --- Devices and sync -----------------------------------------------------

function deviceRows(db, memberId) {
  const records = tableExists(db, "guildweaver_telemetry_records")
    ? "(SELECT MAX(r.received_at) FROM guildweaver_telemetry_records r WHERE r.device_id = d.id AND r.member_id = d.member_id)"
    : "NULL";
  const states = tableExists(db, "guildweaver_telemetry_latest_state")
    ? "(SELECT MAX(s.received_at) FROM guildweaver_telemetry_latest_state s WHERE s.device_id = d.id AND s.member_id = d.member_id)"
    : "NULL";
  const snapshots = tableExists(db, "character_snapshot_ingests")
    ? "(SELECT MAX(i.received_at) FROM character_snapshot_ingests i WHERE i.device_id = d.id)"
    : "NULL";
  const characters = tableExists(db, "guildweaver_character_aliases")
    ? "(SELECT COUNT(DISTINCT a.character_id) FROM guildweaver_character_aliases a WHERE a.device_id = d.id AND a.member_id = d.member_id)"
    : "0";

  return db.prepare(`
    SELECT d.id, d.name, d.created_at, d.last_seen_at, d.revoked_at,
      ${records} AS last_record_at,
      ${states} AS last_state_at,
      ${snapshots} AS last_snapshot_at,
      ${characters} AS character_count
    FROM guildweaver_devices d
    WHERE d.member_id = ?
    ORDER BY (d.revoked_at IS NULL) DESC, d.last_seen_at DESC, d.created_at DESC
  `).all(text(memberId, 96));
}

function deviceView(row) {
  return {
    id: row.id,
    name: row.name || "Guildweaver Bridge",
    connectedAt: row.created_at,
    // When the bridge last talked to the website with this device's key.
    lastContactAt: row.last_seen_at || null,
    // When the website last stored data uploaded by this device.
    lastUploadAt: latest(row.last_record_at, row.last_state_at, row.last_snapshot_at),
    characterCount: Number(row.character_count) || 0,
    revokedAt: row.revoked_at || null,
    status: row.revoked_at ? "disconnected" : "connected",
  };
}

export function readPlayerDevices(memberId) {
  return withGuildDatabase((db) => deviceRows(db, memberId).map(deviceView));
}

// The dashboard's setup state, from what the website has actually received:
//   no_device         no connected device (none yet, or all disconnected)
//   waiting_for_data  a device is connected but nothing has been uploaded
//   processing        uploads arrived but no character could be built yet
//   synced            characters are here and the last upload is recent
//   stale             the newest upload is older than STALE_SYNC_MS
export function playerSyncState({ devices = [], characters = [], now = Date.now() } = {}) {
  const connected = devices.filter((device) => device.status === "connected");
  const lastUploadAt = latest(...devices.map((device) => device.lastUploadAt));
  const lastCharacterAt = latest(...characters.map((character) => character.lastSeenAt));
  const lastActivityAt = latest(lastUploadAt, lastCharacterAt);
  let state;
  if (!connected.length) state = characters.length ? "stale" : "no_device";
  else if (!lastUploadAt && !characters.length) state = "waiting_for_data";
  else if (!characters.length) state = "processing";
  else if (lastActivityAt && now - Date.parse(lastActivityAt) > STALE_SYNC_MS) state = "stale";
  else state = "synced";

  return {
    state,
    connectedDevices: connected.length,
    disconnectedDevices: devices.length - connected.length,
    lastUploadAt,
    lastCharacterAt,
    staleAfterHours: STALE_SYNC_MS / 3_600_000,
  };
}

// Disconnects one of the player's devices: its key stops working at once.
// Another account's device, or an unknown id, is "not-found".
export function revokePlayerDevice(memberId, deviceId) {
  return withGuildTransaction((db) => {
    const device = db.prepare("SELECT id, revoked_at FROM guildweaver_devices WHERE id = ? AND member_id = ?")
      .get(text(deviceId, 96), text(memberId, 96));
    if (!device) return { status: "not-found" };
    if (device.revoked_at) {
      return { status: "already-disconnected", device: deviceView(deviceRows(db, memberId).find((row) => row.id === device.id)) };
    }
    db.prepare("UPDATE guildweaver_devices SET revoked_at = ? WHERE id = ? AND member_id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), device.id, text(memberId, 96));
    return { status: "disconnected", device: deviceView(deviceRows(db, memberId).find((row) => row.id === device.id)) };
  });
}

// Names one of the player's devices, so several computers can be told
// apart. Another account's device, or an unknown id, is "not-found".
export const DEVICE_NAME_MAX = 40;

export function renamePlayerDevice(memberId, deviceId, name) {
  // Control characters and runs of spaces never make a useful name.
  const clean = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > DEVICE_NAME_MAX) return { status: "invalid" };
  return withGuildTransaction((db) => {
    const owned = db.prepare("SELECT id FROM guildweaver_devices WHERE id = ? AND member_id = ?")
      .get(text(deviceId, 96), text(memberId, 96));
    if (!owned) return { status: "not-found" };
    db.prepare("UPDATE guildweaver_devices SET name = ? WHERE id = ? AND member_id = ?").run(clean, owned.id, text(memberId, 96));
    return { status: "renamed", device: deviceView(deviceRows(db, memberId).find((row) => row.id === owned.id)) };
  });
}

// --- Professions and crafting --------------------------------------------

export function readPlayerProfessions(memberId, { server = "" } = {}) {
  const { servers, characters } = readPlayerCharacters(memberId, { server });
  const ids = characters.map((character) => character.id);
  const byCharacter = new Map(ids.map((id) => [id, []]));
  if (ids.length) {
    withGuildDatabase((db) => {
      ensureTelemetryProjectionSchema(db);
      const rows = db.prepare(`
        SELECT p.character_id, p.profession_key, p.profession_id, p.name, p.icon_file_id,
          p.skill_current, p.skill_max, p.skill_modifier,
          (SELECT COUNT(*) FROM telemetry_recipes r
            WHERE r.character_id = p.character_id AND r.profession_key = p.profession_key AND r.known = 1) AS recipe_count
        FROM telemetry_professions p
        WHERE p.character_id IN (${ids.map(() => "?").join(", ")})
        ORDER BY p.skill_current DESC, p.name COLLATE NOCASE
      `).all(...ids);
      for (const row of rows) {
        byCharacter.get(row.character_id)?.push({
          key: row.profession_key,
          id: row.profession_id === null ? null : Number(row.profession_id),
          name: row.name,
          iconFileId: row.icon_file_id === null ? null : Number(row.icon_file_id),
          skill: Number(row.skill_current) || 0,
          maxSkill: Number(row.skill_max) || 0,
          modifier: Number(row.skill_modifier) || 0,
          recipeCount: Number(row.recipe_count) || 0,
        });
      }
    });
  }
  return {
    servers,
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      className: character.className,
      level: character.level,
      realm: character.realm,
      region: character.region,
      lastSeenAt: character.lastSeenAt,
      professions: byCharacter.get(character.id) || [],
    })),
  };
}

// "Which of my characters can make this?": the craft finder over the
// player's own characters on the chosen server.
export function searchPlayerCrafts(memberId, query, { server = "" } = {}) {
  const { characters } = readPlayerCharacters(memberId, { server });
  return searchCraftFinderWithSkill(query, { characterIds: characters.map((character) => character.id) })
    .map((result) => ({
      ...result,
      crafters: result.crafters.map(({ memberName: _memberName, ...crafter }) => crafter),
    }));
}

// --- Farming --------------------------------------------------------------

// What the player has gathered, fished and looted themselves. Community
// drop rates live in Economy/farmingRepository.js; this is the player's own
// activity and never mixes in anyone else's observations.
export function readPlayerFarming(memberId, { server = "" } = {}) {
  const member = text(memberId, 96);
  return withGuildDatabase((db) => {
    if (!tableExists(db, "economic_observations")) {
      return { summary: { observations: 0, sources: 0, lastObservedAt: null }, disciplines: [], sources: [], items: [], recent: [], sessions: [] };
    }
    const serverClause = server ? `AND ${serverKeySql("o")} = ?` : "";
    const params = server ? [member, server] : [member];

    const summary = db.prepare(`
      SELECT COUNT(*) AS observations, COUNT(DISTINCT o.source_key) AS sources, MAX(o.captured_at) AS last_observed_at
      FROM economic_observations o WHERE o.member_id = ? ${serverClause}
    `).get(...params);

    const disciplines = db.prepare(`
      SELECT o.discipline, COUNT(*) AS observations, COUNT(DISTINCT o.source_key) AS sources
      FROM economic_observations o WHERE o.member_id = ? ${serverClause}
      GROUP BY o.discipline ORDER BY observations DESC, o.discipline
    `).all(...params).map((row) => ({ discipline: row.discipline, observations: Number(row.observations), sources: Number(row.sources) }));

    const sources = db.prepare(`
      SELECT o.source_key, o.discipline, MAX(o.source_kind) AS source_kind, MAX(o.source_name) AS source_name,
        COUNT(*) AS observations, MAX(o.captured_at) AS last_observed_at,
        (SELECT z.zone FROM economic_observations z
          WHERE z.member_id = o.member_id AND z.source_key = o.source_key AND z.zone <> ''
          GROUP BY z.zone ORDER BY COUNT(*) DESC, z.zone LIMIT 1) AS top_zone
      FROM economic_observations o WHERE o.member_id = ? ${serverClause}
      GROUP BY o.source_key, o.discipline
      ORDER BY observations DESC, last_observed_at DESC
      LIMIT 25
    `).all(...params).map((row) => ({
      sourceKey: row.source_key,
      discipline: row.discipline,
      sourceKind: row.source_kind,
      name: row.source_name || "Unknown source",
      observations: Number(row.observations),
      lastObservedAt: row.last_observed_at,
      zone: row.top_zone || "",
    }));

    const items = db.prepare(`
      SELECT i.item_key, MAX(i.item_id) AS item_id, MAX(i.item_name) AS item_name, MAX(i.quality_id) AS quality_id,
        MAX(i.icon_file_data_id) AS icon_file_data_id, SUM(i.quantity) AS quantity, COUNT(*) AS drops
      FROM economic_observations o JOIN economic_observation_outputs i ON i.observation_id = o.id
      WHERE o.member_id = ? ${serverClause}
      GROUP BY i.item_key ORDER BY quantity DESC, i.item_key LIMIT 25
    `).all(...params).map((row) => ({
      itemKey: row.item_key,
      itemId: row.item_id === null ? null : Number(row.item_id),
      name: row.item_name || (row.item_id ? `Item ${row.item_id}` : "Unknown item"),
      qualityId: row.quality_id === null ? null : Number(row.quality_id),
      iconFileDataId: row.icon_file_data_id === null ? null : Number(row.icon_file_data_id),
      quantity: Number(row.quantity) || 0,
      drops: Number(row.drops) || 0,
    }));

    const recentRows = db.prepare(`
      SELECT o.id, o.discipline, o.source_key, o.source_name, o.zone, o.subzone, o.captured_at, o.realm, o.region,
        c.id AS character_id, c.name AS character_name, c.class_name AS character_class
      FROM economic_observations o
      -- Only the player's own character, never another account's.
      LEFT JOIN characters c ON c.id = o.character_key AND c.member_id = o.member_id
      WHERE o.member_id = ? ${serverClause}
      ORDER BY o.captured_at DESC, o.id DESC LIMIT 15
    `).all(...params);
    const outputs = new Map();
    if (recentRows.length) {
      for (const row of db.prepare(`
        SELECT observation_id, item_key, item_id, item_name, quantity, quality_id, icon_file_data_id
        FROM economic_observation_outputs WHERE observation_id IN (${recentRows.map(() => "?").join(", ")})
      `).all(...recentRows.map((row) => row.id))) {
        const list = outputs.get(row.observation_id) || [];
        list.push({
          itemKey: row.item_key,
          itemId: row.item_id === null ? null : Number(row.item_id),
          name: row.item_name || (row.item_id ? `Item ${row.item_id}` : "Unknown item"),
          quantity: Number(row.quantity) || 0,
          qualityId: row.quality_id === null ? null : Number(row.quality_id),
          iconFileDataId: row.icon_file_data_id === null ? null : Number(row.icon_file_data_id),
        });
        outputs.set(row.observation_id, list);
      }
    }

    return {
      summary: {
        observations: Number(summary?.observations) || 0,
        sources: Number(summary?.sources) || 0,
        lastObservedAt: summary?.last_observed_at || null,
      },
      disciplines,
      sources,
      items,
      recent: recentRows.map((row) => ({
        id: Number(row.id),
        discipline: row.discipline,
        sourceKey: row.source_key,
        sourceName: row.source_name || "Unknown source",
        zone: row.zone,
        subzone: row.subzone,
        capturedAt: row.captured_at,
        character: row.character_id ? { id: row.character_id, name: row.character_name, className: row.character_class || "" } : null,
        outputs: outputs.get(row.id) || [],
      })),
      sessions: readFarmingSessions({ memberId: member, server, limit: 10 }).sessions,
    };
  });
}

// --- Overview -------------------------------------------------------------

export function readPlayerOverview(memberId, { now = Date.now() } = {}) {
  const { servers, characters } = readPlayerCharacters(memberId);
  const devices = readPlayerDevices(memberId);
  return {
    sync: playerSyncState({ devices, characters, now }),
    servers,
    characters,
    devices,
  };
}
