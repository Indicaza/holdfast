import { HOLDFAST_GUILD_ID } from "../Guild/Directory/guildDirectoryMigration.js";
import {
  DEFAULT_GUILD_TOP_RANK,
  seedGuildOperationsInDatabase,
} from "../Guild/guildDefaults.js";
import { HOLDFAST_RANK_DEFINITIONS } from "../Guild/rankSystem.js";

// Quests, contributions, ranks, billets, audit and notifications belong to a
// guild. Every guild-owned table is rebuilt with a NOT NULL guild_id that
// references guilds, and every existing row is Holdfast's.
//
// Quest, objective and reward-item ids come from the client ("quest-1"), and
// contribution ids are derived from objective ids, so two guilds will reuse
// them: their keys become (guild_id, id). Billet ids are server-generated
// and stay globally unique, so member_billets can still point at one billet.
//
// SQLite cannot add a NOT NULL foreign key column in place, so each table is
// copied into a <name>__v13 table, the old one dropped (children first, so
// no cascade reaches the copies), and the copy renamed. Renaming rewrites the
// copies' references to the final names.
//
// A member's rank becomes per guild: guild_memberships.rank. members.rank is
// kept, and still mirrors the Holdfast rank, for the armory and for the
// pre-migration snapshot.

const TABLES = `
  CREATE TABLE quest_settings__v13 (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
    focused_quest_id TEXT NOT NULL DEFAULT '',
    reward_policy TEXT NOT NULL DEFAULT '',
    rep_min INTEGER NOT NULL DEFAULT 0,
    rep_max INTEGER NOT NULL DEFAULT 1000,
    marks_min INTEGER NOT NULL DEFAULT 0,
    marks_max INTEGER NOT NULL DEFAULT 1000,
    marks_quest_max INTEGER NOT NULL DEFAULT 1000,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  );

  CREATE TABLE quests__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    publication TEXT NOT NULL
      CHECK (publication IN ('draft', 'published', 'archived')),
    mode TEXT NOT NULL CHECK (mode IN ('rotating', 'permanent')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by_member_id TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, id)
  );

  CREATE TABLE objectives__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL CHECK (priority IN ('Main', 'High', 'Medium', 'Low')),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    need TEXT NOT NULL DEFAULT '',
    reward_rep INTEGER NOT NULL DEFAULT 0,
    reward_marks INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    reward_approved_by_member_id TEXT,
    reward_approved_by_name TEXT NOT NULL DEFAULT '',
    reward_approved_at TEXT NOT NULL DEFAULT '',
    reward_approved_fingerprint TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, id),
    FOREIGN KEY (guild_id, quest_id)
      REFERENCES quests__v13(guild_id, id) ON DELETE CASCADE
  );

  CREATE TABLE reward_items__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    objective_id TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, id),
    FOREIGN KEY (guild_id, objective_id)
      REFERENCES objectives__v13(guild_id, id) ON DELETE CASCADE
  );

  CREATE TABLE assignments__v13 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    objective_id TEXT NOT NULL,
    member_id TEXT,
    name TEXT NOT NULL,
    responsibility TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    initials TEXT NOT NULL,
    avatar TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (guild_id, objective_id)
      REFERENCES objectives__v13(guild_id, id) ON DELETE CASCADE
  );

  CREATE TABLE contribution_transactions__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    quest_title TEXT NOT NULL,
    objective_id TEXT NOT NULL,
    objective_title TEXT NOT NULL,
    rep INTEGER NOT NULL DEFAULT 0,
    marks INTEGER NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    awarded_by_member_id TEXT,
    awarded_by_username TEXT NOT NULL DEFAULT '',
    awarded_by_display_name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, id)
  );

  CREATE TABLE quest_completion_requests__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    objective_id TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    objective_fingerprint TEXT NOT NULL,
    requested_by_member_id TEXT NOT NULL,
    requested_by_name TEXT NOT NULL DEFAULT '',
    requested_at TEXT NOT NULL,
    request_note TEXT NOT NULL DEFAULT '',
    reviewed_by_member_id TEXT,
    reviewed_by_name TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL DEFAULT '',
    review_note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, objective_id)
  );

  CREATE TABLE billets__v13 (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    responsibility TEXT NOT NULL DEFAULT '',
    discord_role_id TEXT,
    discord_managed INTEGER NOT NULL DEFAULT 0 CHECK (discord_managed IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    max_managed_rank TEXT,
    quest_scope TEXT NOT NULL DEFAULT 'own' CHECK (quest_scope IN ('own', 'all')),
    reward_rep_max INTEGER NOT NULL DEFAULT 0,
    reward_marks_max INTEGER NOT NULL DEFAULT 0,
    reward_marks_quest_max INTEGER NOT NULL DEFAULT 0,
    UNIQUE (guild_id, id)
  );

  CREATE TABLE member_billets__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    billet_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    assigned_by_member_id TEXT,
    PRIMARY KEY (member_id, billet_id),
    FOREIGN KEY (guild_id, billet_id)
      REFERENCES billets__v13(guild_id, id) ON DELETE CASCADE
  );

  CREATE TABLE rank_authority__v13 (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    rank TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'member'
      CHECK (category IN ('member', 'enlisted', 'officer')),
    leadership INTEGER NOT NULL DEFAULT 0 CHECK (leadership IN (0, 1)),
    permissions_json TEXT NOT NULL DEFAULT '[]',
    max_managed_rank TEXT,
    quest_scope TEXT NOT NULL DEFAULT 'own' CHECK (quest_scope IN ('own', 'all')),
    reward_rep_max INTEGER NOT NULL DEFAULT 0,
    reward_marks_max INTEGER NOT NULL DEFAULT 0,
    reward_marks_quest_max INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, rank),
    UNIQUE (guild_id, sort_order)
  );

  CREATE TABLE audit_events__v13 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_member_id TEXT,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE notifications__v13 (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    recipient_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('action', 'update')),
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    href TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}',
    dedupe_key TEXT,
    read_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE guild_bank_snapshots__v13 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
`;

// Every column the old table had, copied as-is with guild_id set to Holdfast.
const COPIES = [
  ["quests", "id, publication, mode, title, summary, completed, sort_order, created_by_member_id, created_at"],
  ["objectives", "id, quest_id, title, description, priority, completed, need, reward_rep, reward_marks, sort_order, reward_approved_by_member_id, reward_approved_by_name, reward_approved_at, reward_approved_fingerprint"],
  ["reward_items", "id, objective_id, name, quantity, sort_order"],
  ["assignments", "id, objective_id, member_id, name, responsibility, detail, initials, avatar, sort_order"],
  ["contribution_transactions", "id, type, member_id, member_name, quest_id, quest_title, objective_id, objective_title, rep, marks, items_json, created_at, awarded_by_member_id, awarded_by_username, awarded_by_display_name"],
  ["quest_completion_requests", "objective_id, quest_id, status, objective_fingerprint, requested_by_member_id, requested_by_name, requested_at, request_note, reviewed_by_member_id, reviewed_by_name, reviewed_at, review_note, updated_at"],
  ["billets", "id, name, responsibility, discord_role_id, discord_managed, active, created_at, updated_at, permissions_json, max_managed_rank, quest_scope, reward_rep_max, reward_marks_max, reward_marks_quest_max"],
  ["member_billets", "member_id, billet_id, assigned_at, assigned_by_member_id"],
  ["audit_events", "id, actor_member_id, event_type, entity_type, entity_id, created_at, payload_json"],
  ["notifications", "id, recipient_member_id, event_type, kind, title, message, href, entity_type, entity_id, data_json, dedupe_key, read_at, resolved_at, created_at, updated_at"],
  ["guild_bank_snapshots", "id, source, captured_at, payload_json"],
];

// Children before parents, so dropping a parent cascades into nothing.
const DROP_ORDER = [
  "reward_items",
  "assignments",
  "objectives",
  "quests",
  "member_billets",
  "billets",
  "quest_settings",
  "contribution_transactions",
  "quest_completion_requests",
  "rank_authority",
  "audit_events",
  "notifications",
  "guild_bank_snapshots",
];

// Parents before children, so each rename rewrites its children's references.
const RENAME_ORDER = [
  "quests",
  "objectives",
  "reward_items",
  "assignments",
  "billets",
  "member_billets",
  "quest_settings",
  "contribution_transactions",
  "quest_completion_requests",
  "rank_authority",
  "audit_events",
  "notifications",
  "guild_bank_snapshots",
];

const INDEXES = `
  CREATE INDEX quests_guild_publication_order_idx
    ON quests(guild_id, publication, sort_order);

  CREATE INDEX objectives_guild_quest_order_idx
    ON objectives(guild_id, quest_id, sort_order);

  CREATE INDEX reward_items_guild_objective_order_idx
    ON reward_items(guild_id, objective_id, sort_order);

  CREATE INDEX assignments_guild_objective_order_idx
    ON assignments(guild_id, objective_id, sort_order);
  CREATE INDEX assignments_guild_member_idx
    ON assignments(guild_id, member_id)
    WHERE member_id IS NOT NULL;
  CREATE UNIQUE INDEX assignments_objective_member_unique_idx
    ON assignments(guild_id, objective_id, member_id)
    WHERE member_id IS NOT NULL;

  CREATE INDEX contributions_guild_member_created_idx
    ON contribution_transactions(guild_id, member_id, created_at DESC);
  CREATE INDEX contributions_guild_objective_idx
    ON contribution_transactions(guild_id, objective_id);

  CREATE INDEX quest_completion_requests_quest_status_idx
    ON quest_completion_requests(guild_id, quest_id, status, updated_at DESC);

  CREATE UNIQUE INDEX billets_guild_name_unique_idx
    ON billets(guild_id, name COLLATE NOCASE);
  CREATE UNIQUE INDEX billets_discord_role_unique_idx
    ON billets(discord_role_id)
    WHERE discord_role_id IS NOT NULL;

  CREATE INDEX member_billets_billet_idx
    ON member_billets(billet_id, member_id);
  CREATE INDEX member_billets_guild_member_idx
    ON member_billets(guild_id, member_id);

  CREATE INDEX audit_events_guild_time_idx
    ON audit_events(guild_id, id DESC);
  CREATE INDEX audit_events_entity_time_idx
    ON audit_events(guild_id, entity_type, entity_id, created_at DESC);
  CREATE INDEX audit_events_actor_time_idx
    ON audit_events(actor_member_id, created_at DESC);

  CREATE INDEX notifications_recipient_created_idx
    ON notifications(recipient_member_id, created_at DESC);
  CREATE INDEX notifications_recipient_attention_idx
    ON notifications(recipient_member_id, resolved_at, read_at, created_at DESC);
  CREATE UNIQUE INDEX notifications_open_dedupe_idx
    ON notifications(guild_id, recipient_member_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;

  CREATE INDEX guild_bank_snapshots_guild_time_idx
    ON guild_bank_snapshots(guild_id, captured_at DESC);
`;

export const guildScopedOperationsMigration = {
  version: 13,
  name: "guild_scoped_operations",
  up(db) {
    const now = new Date().toISOString();

    db.exec(TABLES);

    for (const [table, columns] of COPIES) {
      db.prepare(`
        INSERT INTO ${table}__v13 (guild_id, ${columns})
        SELECT ?, ${columns} FROM ${table}
      `).run(HOLDFAST_GUILD_ID);
    }

    // Holdfast's settings row, with the quest revision moved off app_meta.
    db.prepare(`
      INSERT INTO quest_settings__v13 (
        guild_id, focused_quest_id, reward_policy, rep_min, rep_max,
        marks_min, marks_max, marks_quest_max, revision
      )
      SELECT
        ?, focused_quest_id, reward_policy, rep_min, rep_max,
        marks_min, marks_max, marks_quest_max,
        COALESCE(
          (SELECT MAX(CAST(value AS INTEGER), 0) FROM app_meta WHERE key = 'quest_revision'),
          0
        )
      FROM quest_settings WHERE id = 1
    `).run(HOLDFAST_GUILD_ID);
    db.prepare("INSERT OR IGNORE INTO quest_settings__v13 (guild_id) VALUES (?)")
      .run(HOLDFAST_GUILD_ID);

    // Holdfast's ladder becomes data: its ten ranks, in order, keep the
    // authority each one had.
    const oldRank = db.prepare("SELECT * FROM rank_authority WHERE rank = ?");
    const insertRank = db.prepare(`
      INSERT INTO rank_authority__v13 (
        guild_id, rank, sort_order, category, leadership, permissions_json,
        max_managed_rank, quest_scope, reward_rep_max, reward_marks_max,
        reward_marks_quest_max
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rank of HOLDFAST_RANK_DEFINITIONS) {
      const row = oldRank.get(rank.name) || {};
      insertRank.run(
        HOLDFAST_GUILD_ID,
        rank.name,
        rank.order,
        rank.category,
        rank.leadership ? 1 : 0,
        row.permissions_json || "[]",
        row.max_managed_rank || null,
        row.quest_scope === "all" ? "all" : "own",
        Number(row.reward_rep_max) || 0,
        Number(row.reward_marks_max) || 0,
        Number(row.reward_marks_quest_max) || 0,
      );
    }

    for (const table of DROP_ORDER) db.exec(`DROP TABLE ${table}`);
    for (const table of RENAME_ORDER) {
      db.exec(`ALTER TABLE ${table}__v13 RENAME TO ${table}`);
    }
    db.exec(INDEXES);

    // Ranks live on the membership. Holdfast members keep the rank they had;
    // a founder of another guild tops that guild's ladder; everyone else
    // starts at the bottom (an empty rank reads as the entry rank).
    db.exec("ALTER TABLE guild_memberships ADD COLUMN rank TEXT NOT NULL DEFAULT ''");
    db.prepare(`
      UPDATE guild_memberships
      SET rank = COALESCE(
        (SELECT members.rank FROM members WHERE members.id = guild_memberships.member_id),
        ''
      )
      WHERE guild_id = ?
    `).run(HOLDFAST_GUILD_ID);
    db.prepare(`
      UPDATE guild_memberships SET rank = ? WHERE guild_id <> ? AND role = 'owner'
    `).run(DEFAULT_GUILD_TOP_RANK, HOLDFAST_GUILD_ID);

    // Guilds registered before this migration get the new-guild defaults.
    for (const { id } of db
      .prepare("SELECT id FROM guilds WHERE id <> ? ORDER BY created_at, id")
      .all(HOLDFAST_GUILD_ID)) {
      seedGuildOperationsInDatabase(db, id, now);
    }
  },
};
