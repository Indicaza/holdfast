import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { withGuildDatabase } from "../src/Data/database.js";
import { readGuildMembers } from "../src/Guild/memberRepository.js";
import { resolveMemberAuthority } from "../src/Guild/authorityRepository.js";
import { readContributionTotals } from "../src/Contribution/contributionRepository.js";
import { readQuests } from "../src/Quest/questRepository.js";

function preserveEnvironment() {
  return {
    dataDir: process.env.GUILD_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
    ownerIds: process.env.GUILD_OWNER_DISCORD_IDS,
  };
}

function restoreEnvironment(previous) {
  if (previous.dataDir === undefined) delete process.env.GUILD_DATA_DIR;
  else process.env.GUILD_DATA_DIR = previous.dataDir;

  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;

  if (previous.ownerIds === undefined) delete process.env.GUILD_OWNER_DISCORD_IDS;
  else process.env.GUILD_OWNER_DISCORD_IDS = previous.ownerIds;
}

test("invalid quest data cannot take member and contribution systems down with it", async () => {
  const previous = preserveEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-fault-isolation-"));

  try {
    process.env.NODE_ENV = "test";
    process.env.GUILD_DATA_DIR = directory;
    process.env.GUILD_OWNER_DISCORD_IDS = "isolation-commander";

    const now = "2026-10-03T20:45:00.000Z";

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
          ) VALUES (?, ?, ?, ?, 'Commander', 'active', ?, ?)
        `,
      ).run(
        "isolation-commander",
        "commander",
        "Isolation Commander",
        "IC",
        now,
        now,
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
          ) VALUES (?, 'objective_reward', ?, ?, ?, ?, ?, ?, 125, 10, '[]', ?)
        `,
      ).run(
        "isolation-contribution",
        "isolation-commander",
        "Isolation Commander",
        "historical-quest",
        "Historical Quest",
        "historical-objective",
        "Historical Objective",
        now,
      );

      // SQLite allows this shape, but the quest domain rejects an empty title.
      // This deliberately simulates semantically corrupt legacy/manual data.
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
            created_at
          ) VALUES (?, 'published', 'rotating', '', '', 0, 0, ?)
        `,
      ).run("broken-quest", now);
    });

    await assert.rejects(
      () => readQuests(),
      /Stored quest data is invalid/,
      "quest reads should clearly fail for the deliberately corrupt quest",
    );

    const members = await readGuildMembers();
    assert.equal(members.length, 1);
    assert.equal(members[0].id, "isolation-commander");
    assert.equal(members[0].displayName, "Isolation Commander");

    const totals = await readContributionTotals();
    assert.deepEqual(totals.get("isolation-commander"), {
      rep: 125,
      marks: 10,
      completedObjectives: 1,
    });

    const authority = resolveMemberAuthority("isolation-commander");
    assert.equal(authority.rank, "Commander");
    assert.ok(authority.permissions.includes("site.admin"));
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
