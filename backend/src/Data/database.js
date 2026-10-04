import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { runtimeDataDirectory, runtimeDataFile } from "./runtimeData.js";
import {
  DEFAULT_BILLET_AUTHORITY,
  DEFAULT_RANK_AUTHORITY,
} from "../Guild/authorityPolicy.js";

const DATABASE_FILE = "holdfast.sqlite";

const migrations = [
  {
    version: 1,
    name: "core_guildos_schema",
    up(db) {
      db.exec(`
        CREATE TABLE app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE members (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL,
          initials TEXT NOT NULL,
          avatar_url TEXT NOT NULL DEFAULT '',
          guild_joined_at TEXT,
          rank TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'departed')),
          departed_at TEXT,
          permissions_json TEXT NOT NULL DEFAULT '[]',
          profile_updated_at TEXT,
          first_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX members_status_display_name_idx
          ON members(status, display_name COLLATE NOCASE);

        CREATE TABLE member_profiles (
          member_id TEXT PRIMARY KEY
            REFERENCES members(id) ON DELETE CASCADE,
          battle_tag TEXT NOT NULL DEFAULT '',
          timezone TEXT NOT NULL DEFAULT '',
          timezone_source TEXT NOT NULL DEFAULT 'detected'
            CHECK (timezone_source IN ('detected', 'manual')),
          availability TEXT NOT NULL DEFAULT '',
          bio TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE characters (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL
            REFERENCES members(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          race TEXT NOT NULL DEFAULT '',
          class_name TEXT NOT NULL DEFAULT '',
          spec TEXT NOT NULL DEFAULT '',
          professions_json TEXT NOT NULL DEFAULT '[]',
          is_main INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX characters_member_idx
          ON characters(member_id, sort_order);

        CREATE INDEX characters_name_idx
          ON characters(name COLLATE NOCASE);

        CREATE UNIQUE INDEX characters_one_main_per_member_idx
          ON characters(member_id)
          WHERE is_main = 1;

        CREATE TABLE quest_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          focused_quest_id TEXT NOT NULL DEFAULT '',
          reward_policy TEXT NOT NULL DEFAULT '',
          rep_min INTEGER NOT NULL DEFAULT 0,
          rep_max INTEGER NOT NULL DEFAULT 1000,
          marks_min INTEGER NOT NULL DEFAULT 0,
          marks_max INTEGER NOT NULL DEFAULT 1000
        );

        INSERT INTO quest_settings (
          id,
          focused_quest_id,
          reward_policy,
          rep_min,
          rep_max,
          marks_min,
          marks_max
        ) VALUES (1, '', '', 0, 1000, 0, 1000);

        CREATE TABLE quests (
          id TEXT PRIMARY KEY,
          publication TEXT NOT NULL
            CHECK (publication IN ('draft', 'published', 'archived')),
          mode TEXT NOT NULL
            CHECK (mode IN ('rotating', 'permanent')),
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX quests_publication_order_idx
          ON quests(publication, sort_order);

        CREATE TABLE objectives (
          id TEXT PRIMARY KEY,
          quest_id TEXT NOT NULL
            REFERENCES quests(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL
            CHECK (priority IN ('Main', 'High', 'Medium', 'Low')),
          completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          need TEXT NOT NULL DEFAULT '',
          reward_rep INTEGER NOT NULL DEFAULT 0,
          reward_marks INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX objectives_quest_order_idx
          ON objectives(quest_id, sort_order);

        CREATE TABLE reward_items (
          id TEXT PRIMARY KEY,
          objective_id TEXT NOT NULL
            REFERENCES objectives(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity >= 1),
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX reward_items_objective_order_idx
          ON reward_items(objective_id, sort_order);

        CREATE TABLE assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          objective_id TEXT NOT NULL
            REFERENCES objectives(id) ON DELETE CASCADE,
          member_id TEXT,
          name TEXT NOT NULL,
          responsibility TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          initials TEXT NOT NULL,
          avatar TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX assignments_objective_order_idx
          ON assignments(objective_id, sort_order);

        CREATE INDEX assignments_member_idx
          ON assignments(member_id)
          WHERE member_id IS NOT NULL;

        CREATE UNIQUE INDEX assignments_objective_member_unique_idx
          ON assignments(objective_id, member_id)
          WHERE member_id IS NOT NULL;

        CREATE TABLE contribution_transactions (
          id TEXT PRIMARY KEY,
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
          awarded_by_display_name TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX contributions_member_created_idx
          ON contribution_transactions(member_id, created_at DESC);

        CREATE INDEX contributions_objective_idx
          ON contribution_transactions(objective_id);

        CREATE TABLE character_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          source TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
        );

        CREATE INDEX character_snapshots_character_time_idx
          ON character_snapshots(character_id, captured_at DESC);

        CREATE TABLE guild_bank_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX guild_bank_snapshots_time_idx
          ON guild_bank_snapshots(captured_at DESC);

        CREATE TABLE audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_member_id TEXT,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          created_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX audit_events_entity_time_idx
          ON audit_events(entity_type, entity_id, created_at DESC);

        CREATE INDEX audit_events_actor_time_idx
          ON audit_events(actor_member_id, created_at DESC);
      `);
    },
  },
  {
    version: 2,
    name: "website_authoritative_member_ranks",
    up(db) {
      db.exec(`
        ALTER TABLE members
          ADD COLUMN rank_managed INTEGER NOT NULL DEFAULT 0
          CHECK (rank_managed IN (0, 1));
      `);
    },
  },
  {
    version: 3,
    name: "billets_and_assignments",
    up(db) {
      const now = new Date().toISOString();

      db.exec(`
        ALTER TABLE members
          ADD COLUMN billets_managed INTEGER NOT NULL DEFAULT 0
          CHECK (billets_managed IN (0, 1));

        CREATE TABLE billets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          responsibility TEXT NOT NULL DEFAULT '',
          discord_role_id TEXT,
          discord_managed INTEGER NOT NULL DEFAULT 0
            CHECK (discord_managed IN (0, 1)),
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX billets_name_unique_idx
          ON billets(name COLLATE NOCASE);

        CREATE UNIQUE INDEX billets_discord_role_unique_idx
          ON billets(discord_role_id)
          WHERE discord_role_id IS NOT NULL;

        CREATE TABLE member_billets (
          member_id TEXT NOT NULL
            REFERENCES members(id) ON DELETE CASCADE,
          billet_id TEXT NOT NULL
            REFERENCES billets(id) ON DELETE CASCADE,
          assigned_at TEXT NOT NULL,
          assigned_by_member_id TEXT,
          PRIMARY KEY(member_id, billet_id)
        );

        CREATE INDEX member_billets_billet_idx
          ON member_billets(billet_id, member_id);
      `);

      const insertBillet = db.prepare(
        `
          INSERT INTO billets (
            id,
            name,
            responsibility,
            discord_role_id,
            discord_managed,
            active,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, NULL, 1, 1, ?, ?)
        `,
      );

      for (const [id, name, responsibility] of [
        [
          "billet-steward",
          "Steward",
          "Helps administer Holdfast, coordinate leadership work, and keep guild operations moving.",
        ],
        [
          "billet-quartermaster",
          "Quartermaster",
          "Manages guild supplies, crafting logistics, procurement, and shared resources.",
        ],
        [
          "billet-raid-leader",
          "Raid Leader",
          "Organizes raid groups, preparation, strategy, and execution.",
        ],
        [
          "billet-pvp-lead",
          "PvP Lead",
          "Organizes battlegrounds, world PvP, premades, and coordinated PvP response.",
        ],
      ]) {
        insertBillet.run(id, name, responsibility, now, now);
      }
    },
  },
  {
    version: 4,
    name: "authority_scopes",
    up(db) {
      db.exec(`
        CREATE TABLE rank_authority (
          rank TEXT PRIMARY KEY,
          permissions_json TEXT NOT NULL DEFAULT '[]',
          max_managed_rank TEXT
        );

        ALTER TABLE billets
          ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';

        ALTER TABLE billets
          ADD COLUMN max_managed_rank TEXT;
      `);

      const insertRankAuthority = db.prepare(
        `
          INSERT INTO rank_authority (
            rank,
            permissions_json,
            max_managed_rank
          ) VALUES (?, ?, ?)
        `,
      );

      const legacyRankAuthorityV4 = {
        Recruit: { permissions: [], maxManagedRank: null },
        Private: { permissions: [], maxManagedRank: null },
        Corporal: {
          permissions: ["quests.edit", "rewards.issue"],
          maxManagedRank: null,
        },
        Sergeant: {
          permissions: ["quests.edit", "rewards.issue"],
          maxManagedRank: null,
        },
        "Master Sergeant": {
          permissions: ["quests.edit", "rewards.issue"],
          maxManagedRank: null,
        },
        "Sergeant Major": {
          permissions: ["quests.edit", "rewards.issue"],
          maxManagedRank: null,
        },
        Lieutenant: {
          permissions: [
            "site.admin",
            "quests.edit",
            "rewards.issue",
            "rewards.policy.edit",
            "members.rank.manage",
            "members.billet.assign",
            "audit.view",
          ],
          maxManagedRank: "Sergeant",
        },
        Captain: {
          permissions: [
            "site.admin",
            "quests.edit",
            "rewards.issue",
            "rewards.policy.edit",
            "members.rank.manage",
            "members.billet.assign",
            "audit.view",
          ],
          maxManagedRank: "Master Sergeant",
        },
        Major: {
          permissions: [
            "site.admin",
            "quests.edit",
            "rewards.issue",
            "rewards.policy.edit",
            "members.rank.manage",
            "members.billet.assign",
            "audit.view",
          ],
          maxManagedRank: "Sergeant Major",
        },
        Commander: {
          permissions: [
            "site.admin",
            "quests.edit",
            "rewards.issue",
            "rewards.policy.edit",
            "members.rank.manage",
            "members.billet.assign",
            "billets.create",
            "billets.edit",
            "billets.delete",
            "audit.view",
            "discord.manage",
            "authority.manage",
          ],
          maxManagedRank: "Commander",
        },
      };

      for (const [rank, scope] of Object.entries(legacyRankAuthorityV4)) {
        insertRankAuthority.run(
          rank,
          JSON.stringify(scope.permissions || []),
          scope.maxManagedRank || null,
        );
      }

      const updateBilletAuthority = db.prepare(
        `
          UPDATE billets
          SET permissions_json = ?, max_managed_rank = ?
          WHERE name = ?
        `,
      );

      const legacyBilletAuthorityV4 = {
        Steward: {
          permissions: [
            "site.admin",
            "quests.edit",
            "rewards.issue",
            "rewards.policy.edit",
            "members.rank.manage",
            "members.billet.assign",
            "audit.view",
            "discord.manage",
          ],
          maxManagedRank: "Sergeant Major",
        },
        Quartermaster: {
          permissions: ["rewards.policy.edit"],
          maxManagedRank: null,
        },
        "Raid Leader": {
          permissions: ["quests.edit", "rewards.issue"],
          maxManagedRank: null,
        },
        "PvP Lead": {
          permissions: ["quests.edit", "rewards.issue"],
          maxManagedRank: null,
        },
      };

      for (const [name, scope] of Object.entries(legacyBilletAuthorityV4)) {
        updateBilletAuthority.run(
          JSON.stringify(scope.permissions || []),
          scope.maxManagedRank || null,
          name,
        );
      }
    },
  },
  {
    version: 5,
    name: "quest_governance_and_economy",
    up(db) {
      db.exec(`
        ALTER TABLE rank_authority
          ADD COLUMN quest_scope TEXT NOT NULL DEFAULT 'own'
          CHECK (quest_scope IN ('own', 'all'));
        ALTER TABLE rank_authority
          ADD COLUMN reward_rep_max INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE rank_authority
          ADD COLUMN reward_marks_max INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE rank_authority
          ADD COLUMN reward_marks_quest_max INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE billets
          ADD COLUMN quest_scope TEXT NOT NULL DEFAULT 'own'
          CHECK (quest_scope IN ('own', 'all'));
        ALTER TABLE billets
          ADD COLUMN reward_rep_max INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE billets
          ADD COLUMN reward_marks_max INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE billets
          ADD COLUMN reward_marks_quest_max INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE quests
          ADD COLUMN created_by_member_id TEXT;
        ALTER TABLE quests
          ADD COLUMN created_at TEXT NOT NULL DEFAULT '';

        ALTER TABLE objectives
          ADD COLUMN reward_approved_by_member_id TEXT;
        ALTER TABLE objectives
          ADD COLUMN reward_approved_by_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE objectives
          ADD COLUMN reward_approved_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE objectives
          ADD COLUMN reward_approved_fingerprint TEXT NOT NULL DEFAULT '';

        ALTER TABLE quest_settings
          ADD COLUMN marks_quest_max INTEGER NOT NULL DEFAULT 1000;
      `);

      const legacyRankPermissions = {
        Corporal: ["quests.edit", "rewards.issue"],
        Sergeant: ["quests.edit", "rewards.issue"],
        "Master Sergeant": ["quests.edit", "rewards.issue"],
        "Sergeant Major": ["quests.edit", "rewards.issue"],
        Lieutenant: [
          "site.admin",
          "quests.edit",
          "rewards.issue",
          "rewards.policy.edit",
          "members.rank.manage",
          "members.billet.assign",
          "audit.view",
        ],
        Captain: [
          "site.admin",
          "quests.edit",
          "rewards.issue",
          "rewards.policy.edit",
          "members.rank.manage",
          "members.billet.assign",
          "audit.view",
        ],
        Major: [
          "site.admin",
          "quests.edit",
          "rewards.issue",
          "rewards.policy.edit",
          "members.rank.manage",
          "members.billet.assign",
          "audit.view",
        ],
        Commander: [
          "site.admin",
          "quests.edit",
          "rewards.issue",
          "rewards.policy.edit",
          "members.rank.manage",
          "members.billet.assign",
          "billets.create",
          "billets.edit",
          "billets.delete",
          "audit.view",
          "discord.manage",
          "authority.manage",
        ],
      };

      const samePermissionSet = (left, right) => {
        const a = [...new Set(left)].sort();
        const b = [...new Set(right)].sort();
        return (
          a.length === b.length &&
          a.every((permission, index) => permission === b[index])
        );
      };

      const readPermissions = (value) => {
        try {
          const parsed = JSON.parse(value || "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      const writeAuthority = db.prepare(
        `
          UPDATE rank_authority
          SET
            permissions_json = ?,
            quest_scope = ?,
            reward_rep_max = ?,
            reward_marks_max = ?,
            reward_marks_quest_max = ?
          WHERE rank = ?
        `,
      );

      for (const [rank, defaults] of Object.entries(DEFAULT_RANK_AUTHORITY)) {
        const row = db
          .prepare("SELECT permissions_json FROM rank_authority WHERE rank = ?")
          .get(rank);

        if (!row) continue;

        const currentPermissions = readPermissions(row.permissions_json);
        const legacyPermissions = legacyRankPermissions[rank];

        if (
          legacyPermissions &&
          samePermissionSet(currentPermissions, legacyPermissions)
        ) {
          writeAuthority.run(
            JSON.stringify(defaults.permissions || []),
            defaults.questScope || "own",
            defaults.rewardLimits?.repPerObjective || 0,
            defaults.rewardLimits?.marksPerObjective || 0,
            defaults.rewardLimits?.marksPerQuest || 0,
            rank,
          );
          continue;
        }

        const upgraded = new Set(currentPermissions);
        if (upgraded.has("quests.edit")) upgraded.add("quests.create");

        writeAuthority.run(
          JSON.stringify([...upgraded]),
          defaults.questScope || "own",
          0,
          0,
          0,
          rank,
        );
      }

      const legacyBilletPermissions = {
        Steward: [
          "site.admin",
          "quests.edit",
          "rewards.issue",
          "rewards.policy.edit",
          "members.rank.manage",
          "members.billet.assign",
          "audit.view",
          "discord.manage",
        ],
        Quartermaster: ["rewards.policy.edit"],
        "Raid Leader": ["quests.edit", "rewards.issue"],
        "PvP Lead": ["quests.edit", "rewards.issue"],
      };

      const writeBilletAuthority = db.prepare(
        `
          UPDATE billets
          SET
            permissions_json = ?,
            quest_scope = ?,
            reward_rep_max = ?,
            reward_marks_max = ?,
            reward_marks_quest_max = ?,
            updated_at = ?
          WHERE name = ?
        `,
      );

      for (const row of db
        .prepare("SELECT name, permissions_json FROM billets")
        .all()) {
        const defaults = DEFAULT_BILLET_AUTHORITY[row.name];
        const currentPermissions = readPermissions(row.permissions_json);
        const legacyPermissions = legacyBilletPermissions[row.name];
        const now = new Date().toISOString();

        if (
          defaults &&
          legacyPermissions &&
          samePermissionSet(currentPermissions, legacyPermissions)
        ) {
          writeBilletAuthority.run(
            JSON.stringify(defaults.permissions || []),
            defaults.questScope || "own",
            defaults.rewardLimits?.repPerObjective || 0,
            defaults.rewardLimits?.marksPerObjective || 0,
            defaults.rewardLimits?.marksPerQuest || 0,
            now,
            row.name,
          );
          continue;
        }

        const upgraded = new Set(currentPermissions);
        if (upgraded.has("quests.edit")) upgraded.add("quests.create");

        writeBilletAuthority.run(
          JSON.stringify([...upgraded]),
          defaults?.questScope || "own",
          0,
          0,
          0,
          now,
          row.name,
        );
      }

      const rewardItems = db.prepare(
        `
          SELECT name, quantity
          FROM reward_items
          WHERE objective_id = ?
          ORDER BY sort_order, id
        `,
      );
      const approveLegacyObjective = db.prepare(
        `
          UPDATE objectives
          SET
            reward_approved_by_name = 'Pre-governance reward',
            reward_approved_at = ?,
            reward_approved_fingerprint = ?
          WHERE id = ?
        `,
      );
      const migratedAt = new Date().toISOString();

      for (const objective of db
        .prepare(
          "SELECT id, reward_rep, reward_marks FROM objectives",
        )
        .all()) {
        const items = rewardItems.all(objective.id).map((item) => ({
          name: item.name,
          quantity: Number(item.quantity),
        }));
        const hasReward =
          Number(objective.reward_rep) > 0 ||
          Number(objective.reward_marks) > 0 ||
          items.length > 0;

        if (!hasReward) continue;

        const fingerprint = JSON.stringify({
          rep: Number(objective.reward_rep) || 0,
          marks: Number(objective.reward_marks) || 0,
          items,
        });

        approveLegacyObjective.run(
          migratedAt,
          fingerprint,
          objective.id,
        );
      }
    },
  },
  {
    version: 6,
    name: "quest_completion_review",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quest_completion_requests (
          objective_id TEXT PRIMARY KEY,
          quest_id TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('pending', 'approved', 'rejected')),
          objective_fingerprint TEXT NOT NULL,
          requested_by_member_id TEXT NOT NULL,
          requested_by_name TEXT NOT NULL DEFAULT '',
          requested_at TEXT NOT NULL,
          request_note TEXT NOT NULL DEFAULT '',
          reviewed_by_member_id TEXT,
          reviewed_by_name TEXT NOT NULL DEFAULT '',
          reviewed_at TEXT NOT NULL DEFAULT '',
          review_note TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS quest_completion_requests_quest_status_idx
          ON quest_completion_requests(quest_id, status, updated_at DESC);
      `);
    },
  },
];

function configureDatabase(db) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
}

export function migrateGuildDatabase(db, { throughVersion = Infinity } = {}) {
  configureDatabase(db);
  runMigrations(db, { throughVersion });
}

function runMigrations(db, { throughVersion = Infinity } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
  );

  for (const migration of migrations) {
    if (migration.version > throughVersion || applied.has(migration.version)) {
      continue;
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      migration.up(db);
      db
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function guildDatabaseFile() {
  return runtimeDataFile(DATABASE_FILE);
}

export function openGuildDatabase() {
  mkdirSync(runtimeDataDirectory(), { recursive: true });

  const db = new DatabaseSync(guildDatabaseFile());
  migrateGuildDatabase(db);
  return db;
}

export function withGuildDatabase(callback) {
  const db = openGuildDatabase();

  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function withGuildTransaction(callback) {
  return withGuildDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");

    try {
      const result = callback(db);

      if (result && typeof result.then === "function") {
        throw new Error("Guild database transactions must be synchronous");
      }

      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

export function appliedMigrationVersions() {
  return withGuildDatabase((db) =>
    db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
  );
}
