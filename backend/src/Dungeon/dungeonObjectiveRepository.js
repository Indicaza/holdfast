import { withGuildDatabase } from "../Data/database.js";

// A small per-character checklist for dungeon runs: "Kill Mr. Smite",
// "Get the Cruel Barb". Personal: every row names its account, and a
// character is only accepted when it is one of that account's.
//
// An objective with a boss target completes on its own only from proof: a
// boss kill the client reported (ENCOUNTER_END or BOSS_KILL) with that
// boss's name, in a run of the same character that started after the
// objective was written. A manual split never counts, and loot never
// counts (a group loot window is not proof the item was won).
//
// The add-on keeps its own checklist (/gw obj); sending this one into the
// game needs bridge support that does not exist yet.

export const MAX_OBJECTIVES = 30;
const MAX_TEXT = 140;

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

// The raw add-on character ids behind a website character id (or the raw id
// itself), when the character is this account's. Null otherwise.
function ownedRawIds(db, memberId, character) {
  const wanted = text(character, 240);
  if (!wanted) return null;
  const raw = new Set();
  if (tableExists(db, "guildweaver_character_aliases")) {
    for (const row of db.prepare("SELECT raw_character_id FROM guildweaver_character_aliases WHERE member_id = ? AND (character_id = ? OR raw_character_id = ?)")
      .all(memberId, wanted, wanted)) raw.add(row.raw_character_id);
  }
  if (tableExists(db, "dungeon_runs") && db.prepare("SELECT 1 FROM dungeon_runs WHERE member_id = ? AND raw_character_id = ? LIMIT 1").get(memberId, wanted)) raw.add(wanted);
  return raw.size ? [...raw] : null;
}

function normalized(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Verified boss kills of these characters since `since`, as
// [{ name, dungeon, runId, at }]. Read from each run's checkpoints (schema
// 2) or timeline (schema 1); only kills the client reported count.
function verifiedKills(db, memberId, rawIds, since) {
  const kills = [];
  const hasCheckpoints = db.prepare("PRAGMA table_info(dungeon_runs)").all().some((column) => column.name === "checkpoints_json");
  const rows = db.prepare(`SELECT id, instance_name, started_at, timeline_json${hasCheckpoints ? ", checkpoints_json" : ""} FROM dungeon_runs
    WHERE member_id = ? AND raw_character_id IN (${rawIds.map(() => "?").join(", ")}) AND started_at >= ? ORDER BY started_at ASC LIMIT 500`)
    .all(memberId, ...rawIds, since);
  for (const row of rows) {
    let entries = [];
    try { entries = row.checkpoints_json ? JSON.parse(row.checkpoints_json) : JSON.parse(row.timeline_json || "[]"); } catch { entries = []; }
    for (const entry of entries) {
      const boss = entry.kind === "boss" || entry.kind === "boss_kill";
      if (!boss || !entry.name || !["encounter_end", "boss_kill"].includes(entry.source)) continue;
      kills.push({ name: normalized(entry.name), dungeon: normalized(row.instance_name), runId: Number(row.id), at: Number(row.started_at) + Number(entry.at || 0) });
    }
  }
  return kills;
}

function objectiveFromRow(row, kills) {
  const objective = {
    id: Number(row.id), text: row.text, position: Number(row.position),
    target: row.target_kind === "boss" ? { kind: "boss", name: row.target_name, dungeon: row.target_dungeon || null } : null,
    completed: row.completed_at !== null, completedAt: row.completed_at === null ? null : Number(row.completed_at),
    completion: row.completed_at !== null ? { source: "manual" } : null,
    createdAt: Number(row.created_at),
  };
  if (!objective.completed && objective.target) {
    const name = normalized(row.target_name);
    const dungeon = normalized(row.target_dungeon);
    const kill = kills.find((entry) => entry.name === name && (!dungeon || entry.dungeon === dungeon) && entry.at >= objective.createdAt);
    if (kill) {
      objective.completed = true;
      objective.completedAt = kill.at;
      objective.completion = { source: "boss_kill", runId: kill.runId };
    }
  }
  return objective;
}

function readInDatabase(db, memberId, character) {
  const rawIds = ownedRawIds(db, memberId, character);
  if (!rawIds || !tableExists(db, "dungeon_objectives")) return { character: text(character, 240), objectives: [], owned: Boolean(rawIds) };
  const rows = db.prepare("SELECT * FROM dungeon_objectives WHERE member_id = ? AND character_id = ? ORDER BY position ASC, id ASC")
    .all(memberId, text(character, 240));
  const targeted = rows.filter((row) => row.target_kind === "boss" && row.completed_at === null);
  const since = targeted.length ? Math.min(...targeted.map((row) => Number(row.created_at))) - 86400 : 0;
  const kills = targeted.length ? verifiedKills(db, memberId, rawIds, since) : [];
  const objectives = rows.map((row) => objectiveFromRow(row, kills));
  const current = objectives.find((entry) => !entry.completed) || null;
  return { character: text(character, 240), owned: true, objectives, currentId: current?.id ?? null };
}

export function readDungeonObjectives({ memberId, character }) {
  return withGuildDatabase((db) => readInDatabase(db, text(memberId), character));
}

function cleanInput(input = {}) {
  const value = text(input.text, MAX_TEXT + 1);
  if (!value || value.length > MAX_TEXT) return { error: "invalid" };
  const boss = text(input.targetBoss, 120);
  return { text: value, targetKind: boss ? "boss" : "none", targetName: boss, targetDungeon: boss ? text(input.targetDungeon, 120) : "" };
}

export function createDungeonObjective({ memberId, character, ...input }) {
  const member = text(memberId);
  const clean = cleanInput(input);
  if (clean.error) return { status: "invalid" };
  return withGuildDatabase((db) => {
    if (!ownedRawIds(db, member, character)) return { status: "not-found" };
    const key = text(character, 240);
    const count = db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM dungeon_objectives WHERE member_id = ? AND character_id = ?").get(member, key);
    if (Number(count.n) >= MAX_OBJECTIVES) return { status: "full" };
    const now = nowSeconds();
    db.prepare(`INSERT INTO dungeon_objectives (member_id, character_id, text, position, target_kind, target_name, target_dungeon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(member, key, clean.text, Number(count.last) + 1, clean.targetKind, clean.targetName, clean.targetDungeon, now, now);
    return { status: "created", ...readInDatabase(db, member, key) };
  });
}

// Edits text or target, marks done or not done, or moves it up or down.
export function updateDungeonObjective({ memberId, id, text: newText, targetBoss, targetDungeon, completed, move }) {
  const member = text(memberId);
  const objectiveId = Number(id);
  if (!Number.isSafeInteger(objectiveId) || objectiveId < 1) return { status: "not-found" };
  return withGuildDatabase((db) => {
    if (!tableExists(db, "dungeon_objectives")) return { status: "not-found" };
    const row = db.prepare("SELECT * FROM dungeon_objectives WHERE id = ? AND member_id = ?").get(objectiveId, member);
    if (!row) return { status: "not-found" };
    const now = nowSeconds();
    if (newText !== undefined || targetBoss !== undefined) {
      const clean = cleanInput({ text: newText ?? row.text, targetBoss: targetBoss ?? row.target_name, targetDungeon: targetDungeon ?? row.target_dungeon });
      if (clean.error) return { status: "invalid" };
      db.prepare("UPDATE dungeon_objectives SET text = ?, target_kind = ?, target_name = ?, target_dungeon = ?, updated_at = ? WHERE id = ?")
        .run(clean.text, clean.targetKind, clean.targetName, clean.targetDungeon, now, objectiveId);
    }
    if (completed !== undefined) {
      db.prepare("UPDATE dungeon_objectives SET completed_at = ?, updated_at = ? WHERE id = ?").run(completed ? now : null, now, objectiveId);
      // Unticking a boss objective restarts its proof from now.
      if (!completed) db.prepare("UPDATE dungeon_objectives SET created_at = ? WHERE id = ?").run(now, objectiveId);
    }
    if (move === "up" || move === "down") {
      const neighbour = db.prepare(`SELECT id, position FROM dungeon_objectives WHERE member_id = ? AND character_id = ? AND position ${move === "up" ? "<" : ">"} ?
        ORDER BY position ${move === "up" ? "DESC" : "ASC"} LIMIT 1`).get(member, row.character_id, row.position);
      if (neighbour) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("UPDATE dungeon_objectives SET position = ?, updated_at = ? WHERE id = ?").run(neighbour.position, now, objectiveId);
          db.prepare("UPDATE dungeon_objectives SET position = ?, updated_at = ? WHERE id = ?").run(row.position, now, neighbour.id);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
    }
    return { status: "updated", ...readInDatabase(db, member, row.character_id) };
  });
}

export function deleteDungeonObjective({ memberId, id }) {
  const member = text(memberId);
  const objectiveId = Number(id);
  if (!Number.isSafeInteger(objectiveId) || objectiveId < 1) return { status: "not-found" };
  return withGuildDatabase((db) => {
    if (!tableExists(db, "dungeon_objectives")) return { status: "not-found" };
    const row = db.prepare("SELECT character_id FROM dungeon_objectives WHERE id = ? AND member_id = ?").get(objectiveId, member);
    if (!row) return { status: "not-found" };
    db.prepare("DELETE FROM dungeon_objectives WHERE id = ? AND member_id = ?").run(objectiveId, member);
    return { status: "deleted", ...readInDatabase(db, member, row.character_id) };
  });
}
