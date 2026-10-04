import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  guildDatabaseFile,
  withGuildDatabase,
} from "../src/Data/database.js";

const execFileAsync = promisify(execFile);
const BACKEND_DIR = fileURLToPath(new URL("../", import.meta.url));

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

function seedDatabase() {
  const now = "2026-10-03T20:30:00.000Z";

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
      "restore-member",
      "restore",
      "Restore Member",
      "RM",
      "Commander",
      now,
      now,
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
      "restore-quest",
      "Restore Drill",
      "This data must survive a backup and restore.",
      "restore-member",
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
        ) VALUES (?, ?, ?, '', 'Main', 0, ?, 250, 25, 0)
      `,
    ).run(
      "restore-objective",
      "restore-quest",
      "Recover the guild",
      "Verified restore",
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
        ) VALUES (?, ?, ?, 'Volunteer', '', 'RM', NULL, 0)
      `,
    ).run("restore-objective", "restore-member", "Restore Member");

    db.prepare(
      `
        INSERT INTO app_meta (key, value, updated_at)
        VALUES ('restore_sentinel', 'holdfast-survives', ?)
      `,
    ).run(now);
  });
}

function readState() {
  return withGuildDatabase((db) => {
    const member = db
      .prepare("SELECT display_name, rank FROM members WHERE id = ?")
      .get("restore-member");
    const quest = db
      .prepare("SELECT title, publication FROM quests WHERE id = ?")
      .get("restore-quest");
    const objective = db
      .prepare("SELECT title, reward_rep, reward_marks FROM objectives WHERE id = ?")
      .get("restore-objective");
    const assignment = db
      .prepare(
        "SELECT member_id, name FROM assignments WHERE objective_id = ?",
      )
      .get("restore-objective");
    const sentinel = db
      .prepare("SELECT value FROM app_meta WHERE key = 'restore_sentinel'")
      .get();

    return {
      memberDisplayName: member?.display_name,
      memberRank: member?.rank,
      questTitle: quest?.title,
      questPublication: quest?.publication,
      objectiveTitle: objective?.title,
      rewardRep: Number(objective?.reward_rep),
      rewardMarks: Number(objective?.reward_marks),
      assignmentMemberId: assignment?.member_id,
      assignmentName: assignment?.name,
      sentinel: sentinel?.value,
      integrity: db.prepare("PRAGMA quick_check").get().quick_check,
      foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    };
  });
}

test("backup artifact can restore the same persistent guild state", async () => {
  const previous = preserveEnvironment();
  const root = await mkdtemp(path.join(os.tmpdir(), "holdfast-backup-restore-"));
  const dataDir = path.join(root, "live");
  const backupDir = path.join(root, "backups");

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = dataDir;

    seedDatabase();
    const before = readState();

    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/backupData.js"],
      {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          NODE_ENV: "test",
          GUILD_DATA_DIR: dataDir,
          BACKUP_DIR: backupDir,
        },
      },
    );

    assert.match(stdout, /Holdfast backup created at/);

    const backupEntries = await readdir(backupDir, { withFileTypes: true });
    const directories = backupEntries.filter((entry) => entry.isDirectory());
    assert.equal(directories.length, 1, "expected exactly one backup directory");

    const backupPath = path.join(backupDir, directories[0].name);
    const manifest = JSON.parse(
      await readFile(path.join(backupPath, "backup.json"), "utf8"),
    );

    assert.ok(manifest.createdAt);
    assert.equal(manifest.includedProvisioningState, false);

    const liveDatabase = guildDatabaseFile();
    await rm(liveDatabase, { force: true });
    await rm(`${liveDatabase}-wal`, { force: true });
    await rm(`${liveDatabase}-shm`, { force: true });

    await copyFile(path.join(backupPath, "holdfast.sqlite"), liveDatabase);

    const after = readState();
    assert.deepEqual(after, before);
    assert.equal(after.integrity, "ok");
    assert.equal(after.foreignKeyViolations, 0);
  } finally {
    restoreEnvironment(previous);
    await rm(root, { recursive: true, force: true });
  }
});
