import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appliedMigrationVersions,
  openGuildDatabase,
  withGuildDatabase,
  withGuildTransaction,
} from "../src/Data/database.js";
import { importLegacyJsonIfNeeded } from "../src/Data/initializeData.js";

const REQUIRED_TABLES = [
  "app_meta",
  "assignments",
  "audit_events",
  "billets",
  "character_snapshots",
  "characters",
  "contribution_transactions",
  "guild_bank_snapshots",
  "member_billets",
  "member_profiles",
  "members",
  "notifications",
  "objectives",
  "quest_completion_requests",
  "quest_settings",
  "quests",
  "rank_authority",
  "reward_items",
  "schema_migrations",
];

function preserveEnvironment() {
  return {
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
  };
}

function restoreEnvironment(previous) {
  if (previous.dataDir === undefined) delete process.env.GUILD_DATA_DIR;
  else process.env.GUILD_DATA_DIR = previous.dataDir;

  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
}

async function withTemporaryGuildDatabase(callback) {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-db-safety-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    return await callback(directory);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
}

function tableNames(db) {
  return db
    .prepare(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all()
    .map((row) => row.name);
}

function criticalCounts(db) {
  const tables = [
    "members",
    "characters",
    "quests",
    "objectives",
    "assignments",
    "contribution_transactions",
    "audit_events",
  ];

  return Object.fromEntries(
    tables.map((table) => [
      table,
      Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]),
  );
}

function seedPersistentState() {
  const now = "2026-10-03T20:00:00.000Z";

  withGuildDatabase((db) => {
    db.prepare(
      `
        INSERT INTO members (
          id,
          username,
          display_name,
          initials,
          rank,
          status,
          first_seen_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `,
    ).run(
      "safety-member",
      "safety",
      "Safety Member",
      "SM",
      "Commander",
      now,
      now,
    );

    db.prepare(
      `
        INSERT INTO characters (
          id,
          member_id,
          name,
          race,
          class_name,
          spec,
          professions_json,
          is_main,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
      `,
    ).run(
      "safety-character",
      "safety-member",
      "Rook",
      "Night Elf",
      "Warrior",
      "Protection",
      JSON.stringify(["Blacksmithing", "Engineering"]),
    );

    db.prepare(
      `
        INSERT INTO quests (
          id,
          publication,
          mode,
          title,
          summary,
          completed,
          sort_order,
          created_by_member_id,
          created_at
        ) VALUES (?, 'published', 'rotating', ?, ?, 0, 0, ?, ?)
      `,
    ).run(
      "safety-quest",
      "Safety Quest",
      "Persistent state must survive deploys.",
      "safety-member",
      now,
    );

    db.prepare(
      `
        INSERT INTO objectives (
          id,
          quest_id,
          title,
          description,
          priority,
          completed,
          need,
          reward_rep,
          reward_marks,
          sort_order
        ) VALUES (?, ?, ?, '', 'Main', 0, ?, 100, 5, 0)
      `,
    ).run(
      "safety-objective",
      "safety-quest",
      "Protect the database",
      "No cowboy casualties",
    );

    db.prepare(
      `
        INSERT INTO assignments (
          objective_id,
          member_id,
          name,
          responsibility,
          detail,
          initials,
          avatar,
          sort_order
        ) VALUES (?, ?, ?, 'Volunteer', '', 'SM', NULL, 0)
      `,
    ).run("safety-objective", "safety-member", "Safety Member");

    db.prepare(
      `
        INSERT INTO contribution_transactions (
          id,
          type,
          member_id,
          member_name,
          quest_id,
          quest_title,
          objective_id,
          objective_title,
          rep,
          marks,
          items_json,
          created_at
        ) VALUES (?, 'objective_reward', ?, ?, ?, ?, ?, ?, 100, 5, '[]', ?)
      `,
    ).run(
      "safety-contribution",
      "safety-member",
      "Safety Member",
      "safety-quest",
      "Safety Quest",
      "safety-objective",
      "Protect the database",
      now,
    );

    db.prepare(
      `
        INSERT INTO audit_events (
          actor_member_id,
          event_type,
          entity_type,
          entity_id,
          created_at,
          payload_json
        ) VALUES (?, 'safety.seeded', 'database', 'holdfast', ?, '{}')
      `,
    ).run("safety-member", now);

    db.prepare(
      `
        INSERT INTO app_meta (key, value, updated_at)
        VALUES ('safety_sentinel', 'leave-it-stronger', ?)
      `,
    ).run(now);
  });
}

test("fresh database applies every migration and satisfies the schema contract", async () => {
  await withTemporaryGuildDatabase(async () => {
    const db = openGuildDatabase();

    try {
      const names = tableNames(db);
      for (const required of REQUIRED_TABLES) {
        assert.ok(names.includes(required), `required table ${required} is missing`);
      }

      assert.deepEqual(appliedMigrationVersions(), [1, 2, 3, 4, 5, 6, 7]);
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally {
      db.close();
    }
  });
});

test("persistent guild state survives repeated close and reopen cycles unchanged", async () => {
  await withTemporaryGuildDatabase(async () => {
    seedPersistentState();

    const before = withGuildDatabase((db) => ({
      counts: criticalCounts(db),
      sentinel: db
        .prepare("SELECT value FROM app_meta WHERE key = 'safety_sentinel'")
        .get().value,
    }));

    for (let restart = 0; restart < 3; restart += 1) {
      const db = openGuildDatabase();
      db.close();
    }

    const after = withGuildDatabase((db) => ({
      counts: criticalCounts(db),
      sentinel: db
        .prepare("SELECT value FROM app_meta WHERE key = 'safety_sentinel'")
        .get().value,
      member: db
        .prepare("SELECT display_name, rank FROM members WHERE id = ?")
        .get("safety-member"),
      quest: db
        .prepare("SELECT title, publication FROM quests WHERE id = ?")
        .get("safety-quest"),
      integrity: db.prepare("PRAGMA quick_check").get().quick_check,
      foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    }));

    assert.deepEqual(after.counts, before.counts);
    assert.equal(after.sentinel, "leave-it-stronger");
    assert.equal(after.member.display_name, "Safety Member");
    assert.equal(after.member.rank, "Commander");
    assert.equal(after.quest.title, "Safety Quest");
    assert.equal(after.quest.publication, "published");
    assert.equal(after.integrity, "ok");
    assert.equal(after.foreignKeyViolations, 0);
  });
});

test("failed guild transactions roll back instead of leaving partial writes", async () => {
  await withTemporaryGuildDatabase(async () => {
    openGuildDatabase().close();

    assert.throws(
      () =>
        withGuildTransaction((db) => {
          db.prepare(
            `
              INSERT INTO app_meta (key, value, updated_at)
              VALUES ('half_written_deploy', 'bad', ?)
            `,
          ).run(new Date().toISOString());
          throw new Error("simulated deploy failure");
        }),
      /simulated deploy failure/,
    );

    const row = withGuildDatabase((db) =>
      db
        .prepare("SELECT value FROM app_meta WHERE key = 'half_written_deploy'")
        .get(),
    );

    assert.equal(row, undefined);
  });
});

test("legacy JSON cannot overwrite a populated SQLite database", async () => {
  await withTemporaryGuildDatabase(async (directory) => {
    seedPersistentState();

    await writeFile(
      path.join(directory, "members.json"),
      JSON.stringify([
        {
          id: "legacy-intruder",
          username: "legacy",
          displayName: "Legacy Intruder",
          initials: "LI",
          rank: "Private",
          status: "active",
          permissions: [],
          profile: { characters: [] },
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
      "utf8",
    );

    const result = importLegacyJsonIfNeeded();
    assert.deepEqual(result, {
      status: "skipped",
      reason: "sqlite-already-has-data",
    });

    const state = withGuildDatabase((db) => ({
      safetyMember: db
        .prepare("SELECT display_name FROM members WHERE id = 'safety-member'")
        .get(),
      legacyMember: db
        .prepare("SELECT display_name FROM members WHERE id = 'legacy-intruder'")
        .get(),
      sentinel: db
        .prepare("SELECT value FROM app_meta WHERE key = 'safety_sentinel'")
        .get(),
    }));

    assert.equal(state.safetyMember.display_name, "Safety Member");
    assert.equal(state.legacyMember, undefined);
    assert.equal(state.sentinel.value, "leave-it-stronger");
  });
});
