import { withGuildDatabase } from "../Data/database.js";
import { describeItems } from "../Items/describeItems.js";
import { serverKeySql } from "../Player/playerServers.js";
import { FINAL_DUNGEON_STATUSES, MAX_TIMELINE, dungeonRunKey, luaList, xpPerHour } from "./dungeonRunModel.js";

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function int(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function flag(value) {
  return value === true ? 1 : 0;
}

// Stores the newest state of a run. Updates are idempotent and ordered by
// the addon's sequence: a retry, an older checkpoint, or anything arriving
// after the run finished changes nothing, so a reload or a re-send can never
// reopen a finished run or create a second row for it.
export function recordDungeonRunInDatabase(db, { envelope, memberId, receivedAt }) {
  const p = envelope.payload;
  const key = dungeonRunKey(memberId, envelope.installationId, p.runId);
  const instance = p.instance || {};
  const character = p.character || {};
  const group = p.group || {};
  const timeline = (luaList(p.timeline ?? []) || []).slice(0, MAX_TIMELINE).map((entry) => ({
    at: entry.at, kind: entry.kind,
    ...(entry.name ? { name: text(entry.name, 120) } : {}),
    ...(int(entry.encounterId) ? { encounterId: entry.encounterId } : {}),
    ...(int(entry.level) ? { level: entry.level } : {}),
    ...(entry.source ? { source: text(entry.source, 40) } : {}),
  }));
  const values = {
    run_key: key, run_id: p.runId, member_id: text(memberId), installation_id: text(envelope.installationId),
    raw_character_id: text(envelope.characterId, 240), sequence: p.sequence, status: p.status,
    end_reason: p.status === "open" ? "" : text(p.endReason, 60), started_at: p.startedAt,
    ended_at: p.status === "open" ? null : p.endedAt, last_active_at: int(p.lastActiveAt),
    duration_seconds: p.durationSeconds, inside_seconds: int(p.insideSeconds),
    instance_name: text(instance.name, 120) || "Unknown instance", instance_id: int(instance.instanceId),
    instance_type: instance.type, difficulty_id: int(instance.difficultyId), difficulty_name: text(instance.difficultyName, 60),
    max_players: int(instance.maxPlayers), level_at_entry: int(character.levelAtEntry), level_at_exit: int(character.levelAtExit),
    class_token: text(character.classToken, 40), group_size: int(group.sizeAtEntry), group_max_size: int(group.maxSize),
    xp_available: flag(p.xp.available), xp_at_level_cap: flag(p.xp.atLevelCap),
    xp_gained: p.xp.available && !p.xp.atLevelCap ? int(p.xp.gained) : null, level_ups: int(p.xp.levelUps) || 0,
    wallet_available: flag(p.wallet.available), net_copper: p.wallet.available ? int(p.wallet.netCopper) : null,
    deaths: p.deaths, bosses_defeated: p.bosses.defeated, bosses_total: int(p.bosses.total),
    manual_splits: int(p.bosses.manualSplits) || 0, encounter_events: flag(p.bosses.encounterEvents),
    loot_observations: int(p.loot?.observations) || 0, timeline_json: JSON.stringify(timeline),
    timeline_truncated: flag(p.timelineTruncated), realm: text(envelope.realm), region: text(envelope.region, 40),
    game_build: text(envelope.gameBuild?.build, 40), captured_at: int(envelope.capturedAt) || 0, received_at: receivedAt,
  };
  const columns = Object.keys(values);
  const updatable = columns.filter((column) => !["run_key", "run_id", "member_id", "installation_id",
    "raw_character_id", "started_at"].includes(column));
  const result = db.prepare(`
    INSERT INTO dungeon_runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT(run_key) DO UPDATE SET ${updatable.map((column) => `${column} = excluded.${column}`).join(", ")}
    WHERE excluded.sequence > dungeon_runs.sequence AND dungeon_runs.status = 'open'
      AND excluded.raw_character_id = dungeon_runs.raw_character_id
      AND excluded.started_at = dungeon_runs.started_at
  `).run(...columns.map((column) => values[column]));
  return { status: result.changes ? "updated" : "duplicate", runChanged: Boolean(result.changes), final: FINAL_DUNGEON_STATUSES.has(p.status) };
}

// Links a loot observation recorded during a run to that run. Only the
// link is stored; the loot itself stays where it already is.
export function linkDungeonRunLootInDatabase(db, { envelope, memberId, source, observationId }) {
  const runId = envelope?.payload?.context?.dungeonRun?.runId;
  if (typeof runId !== "string" || !/^[\w:-]{1,160}$/.test(runId) || !Number.isSafeInteger(observationId)) return false;
  const key = dungeonRunKey(memberId, envelope.installationId, runId);
  return db.prepare(`INSERT OR IGNORE INTO dungeon_run_loot (run_key, member_id, source, observation_id) VALUES (?, ?, ?, ?)`)
    .run(key, text(memberId), source, observationId).changes > 0;
}

// Addon character ids resolve to the website character through the
// account's own aliases, so a run only ever names its owner's character.
function characterNames(db, memberId) {
  const names = new Map();
  if (!tableExists(db, "guildweaver_character_aliases")) return names;
  const cards = tableExists(db, "character_cards");
  for (const row of db.prepare(`
    SELECT a.raw_character_id, a.character_id,
      ${cards ? "COALESCE(NULLIF(k.name, ''), a.character_name)" : "a.character_name"} AS name
    FROM guildweaver_character_aliases a ${cards ? "LEFT JOIN character_cards k ON k.character_id = a.character_id" : ""}
    WHERE a.member_id = ? ORDER BY a.last_seen_at DESC
  `).all(memberId)) {
    if (!names.has(row.raw_character_id)) names.set(row.raw_character_id, { id: row.character_id, name: row.name || null });
  }
  return names;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function runFromRow(row, names) {
  const character = names.get(row.raw_character_id) || { id: null, name: null };
  const durationSeconds = Number(row.duration_seconds);
  const xpAvailable = row.xp_available === 1;
  const atLevelCap = row.xp_at_level_cap === 1;
  const xpGained = row.xp_gained === null ? null : Number(row.xp_gained);
  return {
    id: Number(row.id), runId: row.run_id, status: row.status, endReason: row.end_reason || null,
    startedAt: Number(row.started_at), endedAt: row.ended_at === null ? null : Number(row.ended_at),
    durationSeconds, insideSeconds: row.inside_seconds === null ? null : Number(row.inside_seconds),
    dungeon: { name: row.instance_name, instanceId: row.instance_id, type: row.instance_type,
      difficultyId: row.difficulty_id, difficultyName: row.difficulty_name || null, maxPlayers: row.max_players },
    character: { id: character.id, name: character.name, classToken: row.class_token || null,
      levelAtEntry: row.level_at_entry, levelAtExit: row.level_at_exit },
    realm: row.realm, region: row.region, build: row.game_build, groupSize: row.group_size,
    xp: { available: xpAvailable, atLevelCap, gained: xpGained, levelUps: Number(row.level_ups) || 0,
      perHour: xpPerHour({ xpAvailable, atLevelCap, xpGained, durationSeconds }) },
    wallet: { basis: "wallet_delta", available: row.wallet_available === 1, netCopper: row.net_copper === null ? null : Number(row.net_copper) },
    deaths: Number(row.deaths),
    bosses: { defeated: Number(row.bosses_defeated), total: row.bosses_total, manualSplits: Number(row.manual_splits),
      encounterEvents: row.encounter_events === 1 },
    lootObservations: Number(row.loot_observations),
    receivedAt: row.received_at,
  };
}

// The signed-in player's own runs, newest first. Every read is scoped to
// one account; there is no read of anyone else's runs.
export function readDungeonRuns({ memberId, server = "", character = "", realm = "", dungeon = "", from = "", to = "", limit = 50 } = {}) {
  const member = text(memberId);
  return withGuildDatabase((db) => {
    if (!tableExists(db, "dungeon_runs")) return { runs: [], filters: { characters: [], realms: [], dungeons: [] } };
    const names = characterNames(db, member);
    const clauses = ["member_id = ?"];
    const params = [member];
    if (server) { clauses.push(`${serverKeySql("dungeon_runs")} = ?`); params.push(server); }
    if (text(realm)) { clauses.push("realm = ?"); params.push(text(realm)); }
    if (text(dungeon)) { clauses.push("instance_name = ?"); params.push(text(dungeon, 120)); }
    if (text(character)) {
      // A website character id covers every raw addon id linked to it.
      const raw = [...names.entries()].filter(([, value]) => value.id === text(character, 240)).map(([rawId]) => rawId);
      raw.push(text(character, 240));
      clauses.push(`raw_character_id IN (${raw.map(() => "?").join(", ")})`);
      params.push(...raw);
    }
    const fromSeconds = Date.parse(text(from, 40));
    if (Number.isFinite(fromSeconds)) { clauses.push("started_at >= ?"); params.push(Math.floor(fromSeconds / 1000)); }
    const toSeconds = Date.parse(text(to, 40));
    // A date without a time means the whole day.
    if (Number.isFinite(toSeconds)) { clauses.push("started_at < ?"); params.push(Math.floor(toSeconds / 1000) + (/^\d{4}-\d{2}-\d{2}$/.test(text(to)) ? 86400 : 1)); }
    const cappedLimit = Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 50));
    const rows = db.prepare(`SELECT * FROM dungeon_runs WHERE ${clauses.join(" AND ")} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(...params, cappedLimit);
    const all = db.prepare("SELECT DISTINCT raw_character_id, realm, instance_name FROM dungeon_runs WHERE member_id = ?").all(member);
    const characters = new Map();
    for (const row of all) {
      const known = names.get(row.raw_character_id);
      const id = known?.id || row.raw_character_id;
      if (!characters.has(id)) characters.set(id, { id, name: known?.name || null });
    }
    return {
      runs: rows.map((row) => runFromRow(row, names)),
      filters: {
        characters: [...characters.values()].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))),
        realms: [...new Set(all.map((row) => row.realm).filter(Boolean))].sort(),
        dungeons: [...new Set(all.map((row) => row.instance_name).filter(Boolean))].sort(),
      },
    };
  });
}

// One run with its timeline and the loot linked to it, or null when it is
// not this account's.
export function readDungeonRun({ memberId, id }) {
  const member = text(memberId);
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId < 1) return null;
  return withGuildDatabase((db) => {
    if (!tableExists(db, "dungeon_runs")) return null;
    const row = db.prepare("SELECT * FROM dungeon_runs WHERE id = ? AND member_id = ?").get(runId, member);
    if (!row) return null;
    const run = runFromRow(row, characterNames(db, member));
    run.timeline = JSON.parse(row.timeline_json || "[]");
    run.timelineTruncated = row.timeline_truncated === 1;
    const items = new Map();
    const add = (itemId, name, quantity) => {
      const entry = items.get(itemId) || { itemId, name: name || null, quantity: 0 };
      entry.quantity += Number(quantity) || 0;
      entry.name = entry.name || name || null;
      items.set(itemId, entry);
    };
    for (const item of db.prepare(`
      SELECT o.item_id, SUM(o.quantity) AS quantity,
        (SELECT p.name FROM public_game_items p WHERE p.item_id = o.item_id ORDER BY p.captured_at DESC LIMIT 1) AS name
      FROM dungeon_run_loot l JOIN game_loot_outputs o ON o.observation_id = l.observation_id
      WHERE l.run_key = ? AND l.member_id = ? AND l.source = 'mob_loot' GROUP BY o.item_id
    `).all(row.run_key, member)) add(item.item_id, item.name, item.quantity);
    for (const item of db.prepare(`
      SELECT o.item_id, MAX(o.item_name) AS name, SUM(o.quantity) AS quantity
      FROM dungeon_run_loot l JOIN economic_observation_outputs o ON o.observation_id = l.observation_id
      JOIN economic_observations e ON e.id = l.observation_id AND e.member_id = l.member_id
      WHERE l.run_key = ? AND l.member_id = ? AND l.source = 'gathering' AND o.item_id IS NOT NULL GROUP BY o.item_id
    `).all(row.run_key, member)) add(item.item_id, item.name, item.quantity);
    const linked = db.prepare("SELECT COUNT(*) AS n FROM dungeon_run_loot WHERE run_key = ? AND member_id = ?").get(row.run_key, member).n;
    // Each item with its quality, icon and the game's tooltip, so the run's
    // loot reads like a loot window.
    run.loot = { observations: Number(linked),
      items: describeItems(db, [...items.values()].sort((a, b) => b.quantity - a.quantity || a.itemId - b.itemId).slice(0, 100)) };
    return run;
  });
}
