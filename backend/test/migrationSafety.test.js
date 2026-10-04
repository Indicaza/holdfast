import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  guildDatabaseFile,
  migrateGuildDatabase,
  openGuildDatabase,
} from "../src/Data/database.js";
import { ensureQuestCompletionSchema } from "../src/Quest/questCompletion.js";

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

async function withTemporaryDatabase(callback) {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-migration-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    return await callback(directory);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
}

function appliedVersions(db) {
  return db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number(row.version));
}

function seedVersionFiveDatabase({ withLegacyCompletionTable = false } = {}) {
  const db = new DatabaseSync(guildDatabaseFile());
  const now = "2026-10-03T21:00:00.000Z";

  try {
    migrateGuildDatabase(db, { throughVersion: 5 });
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5]);

    db.prepare(
      `
        INSERT INTO members (
          id,
          username,
          display_name,
          initials,
          rank,
          rank_managed,
          billets_managed,
          status,
          first_seen_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'Commander', 1, 1, 'active', ?, ?)
      `,
    ).run(
      "migration-member",
      "migration",
      "Migration Commander",
      "MC",
      now,
      now,
    );

    db.prepare(
      `
        INSERT INTO member_billets (
          member_id,
          billet_id,
          assigned_at,
          assigned_by_member_id
        ) VALUES (?, 'billet-steward', ?, ?)
      `,
    ).run("migration-member", now, "migration-member");

    db.prepare(
      `
        INSERT INTO quests (
          id,
          publication,
          mode,
          title,
          summary,
          created_by_member_id,
          created_at,
          completed,
          sort_order
        ) VALUES (?, 'published', 'rotating', ?, ?, ?, ?, 0, 0)
      `,
    ).run(
      "migration-quest",
      "Migration Fixture",
      "Pretend this is the live database before completion review shipped.",
      "migration-member",
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
        ) VALUES (?, ?, ?, '', 'High', 0, ?, 125, 10, 0)
      `,
    ).run(
      "migration-objective",
      "migration-quest",
      "Preserve this objective",
      "Migration must not eat it",
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
          sort_order
        ) VALUES (?, ?, ?, 'Volunteer', '', 'MC', 0)
      `,
    ).run(
      "migration-objective",
      "migration-member",
      "Migration Commander",
    );

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
        ) VALUES (?, 'objective_reward', ?, ?, ?, ?, ?, ?, 50, 5, '[]', ?)
      `,
    ).run(
      "migration-contribution",
      "migration-member",
      "Migration Commander",
      "historical-quest",
      "Historical Quest",
      "historical-objective",
      "Historical Objective",
      now,
    );

    db.prepare(
      `
        INSERT INTO app_meta (key, value, updated_at)
        VALUES ('migration_sentinel', 'do-not-delete-me', ?)
      `,
    ).run(now);

    if (withLegacyCompletionTable) {
      // #111 originally created this lazily before it became a versioned migration.
      // Migration 6 must adopt that live table rather than replacing it.
      ensureQuestCompletionSchema(db);
      db.prepare(
        `
          INSERT INTO quest_completion_requests (
            objective_id,
            quest_id,
            status,
            objective_fingerprint,
            requested_by_member_id,
            requested_by_name,
            requested_at,
            request_note,
            reviewed_by_member_id,
            reviewed_by_name,
            reviewed_at,
            review_note,
            updated_at
          ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NULL, '', '', '', ?)
        `,
      ).run(
        "migration-objective",
        "migration-quest",
        "legacy-fingerprint",
        "migration-member",
        "Migration Commander",
        now,
        "Already waiting for review before migration 6 existed.",
        now,
      );
    }
  } finally {
    db.close();
  }
}

function persistentState(db) {
  return {
    member: db
      .prepare("SELECT display_name, rank FROM members WHERE id = ?")
      .get("migration-member"),
    billet: db
      .prepare(
        "SELECT billet_id FROM member_billets WHERE member_id = ?",
      )
      .get("migration-member"),
    quest: db
      .prepare("SELECT title, publication FROM quests WHERE id = ?")
      .get("migration-quest"),
    objective: db
      .prepare(
        "SELECT title, reward_rep, reward_marks FROM objectives WHERE id = ?",
      )
      .get("migration-objective"),
    assignment: db
      .prepare(
        "SELECT member_id, name FROM assignments WHERE objective_id = ?",
      )
      .get("migration-objective"),
    contributionCount: Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM contribution_transactions WHERE id = 'migration-contribution'",
        )
        .get().count,
    ),
    sentinel: db
      .prepare("SELECT value FROM app_meta WHERE key = 'migration_sentinel'")
      .get()?.value,
  };
}

for (const withLegacyCompletionTable of [false, true]) {
  const label = withLegacyCompletionTable
    ? "adopts the pre-migration completion table without losing requests"
    : "upgrades a schema-v5 production database without losing guild state";

  test(label, async () => {
    await withTemporaryDatabase(async () => {
      seedVersionFiveDatabase({ withLegacyCompletionTable });

      const beforeDb = new DatabaseSync(guildDatabaseFile());
      const before = persistentState(beforeDb);
      beforeDb.close();

      const upgraded = openGuildDatabase();

      try {
        assert.deepEqual(appliedVersions(upgraded), [1, 2, 3, 4, 5, 6]);
        assert.deepEqual(persistentState(upgraded), before);
        assert.equal(upgraded.prepare("PRAGMA quick_check").get().quick_check, "ok");
        assert.equal(upgraded.prepare("PRAGMA foreign_key_check").all().length, 0);

        const migration = upgraded
          .prepare("SELECT name FROM schema_migrations WHERE version = 6")
          .get();
        assert.equal(migration.name, "quest_completion_review");

        const completionCount = Number(
          upgraded
            .prepare("SELECT COUNT(*) AS count FROM quest_completion_requests")
            .get().count,
        );
        assert.equal(completionCount, withLegacyCompletionTable ? 1 : 0);

        if (withLegacyCompletionTable) {
          const request = upgraded
            .prepare(
              `
                SELECT status, request_note
                FROM quest_completion_requests
                WHERE objective_id = 'migration-objective'
              `,
            )
            .get();
          assert.equal(request.status, "pending");
          assert.equal(
            request.request_note,
            "Already waiting for review before migration 6 existed.",
          );
        }
      } finally {
        upgraded.close();
      }
    });
  });
}

test("a failed migration rolls back and is never marked applied", async () => {
  await withTemporaryDatabase(async () => {
    seedVersionFiveDatabase();

    const db = new DatabaseSync(guildDatabaseFile());

    try {
      // Simulate schema drift/corruption: the table name exists, but the columns
      // required by migration 6's index do not. CREATE TABLE IF NOT EXISTS is a
      // no-op and CREATE INDEX must fail inside the migration transaction.
      db.exec(`
        CREATE TABLE quest_completion_requests (
          objective_id TEXT PRIMARY KEY
        );
      `);

      assert.throws(
        () => migrateGuildDatabase(db),
        /no such column|has no column/i,
      );

      assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5]);
      assert.equal(
        db
          .prepare("SELECT value FROM app_meta WHERE key = 'migration_sentinel'")
          .get().value,
        "do-not-delete-me",
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM members WHERE id = 'migration-member'",
          )
          .get().count,
        1,
      );
      assert.equal(
        db
          .prepare(
            `
              SELECT name
              FROM sqlite_schema
              WHERE type = 'index'
                AND name = 'quest_completion_requests_quest_status_idx'
            `,
          )
          .get(),
        undefined,
      );
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    } finally {
      db.close();
    }
  });
});
