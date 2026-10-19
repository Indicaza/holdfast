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
import { HOLDFAST_GUILD_ID } from "../src/Guild/guildScope.js";

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
      // The roster is the guild's memberships, not every account.
      db.prepare(
        `
          INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at, rank)
          VALUES ('guild-holdfast', ?, 'member', 'active', ?, 'Commander')
        `,
      ).run("isolation-commander", now);

      db.prepare(
        `
          INSERT INTO contribution_transactions (
            guild_id,
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
          ) VALUES ('guild-holdfast', ?, 'objective_reward', ?, ?, ?, ?, ?, ?, 125, 10, '[]', ?)
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
            guild_id,
            id,
            publication,
            mode,
            title,
            summary,
            completed,
            sort_order,
            created_at
          ) VALUES ('guild-holdfast', ?, 'published', 'rotating', '', '', 0, 0, ?)
        `,
      ).run("broken-quest", now);
    });

    await assert.rejects(
      () => readQuests(HOLDFAST_GUILD_ID),
      /Stored quest data is invalid/,
      "quest reads should clearly fail for the deliberately corrupt quest",
    );

    const members = await readGuildMembers(HOLDFAST_GUILD_ID);
    assert.equal(members.length, 1);
    assert.equal(members[0].id, "isolation-commander");
    assert.equal(members[0].displayName, "Isolation Commander");

    const totals = await readContributionTotals(HOLDFAST_GUILD_ID);
    assert.deepEqual(totals.get("isolation-commander"), {
      rep: 125,
      marks: 10,
      completedObjectives: 1,
    });

    const authority = resolveMemberAuthority(HOLDFAST_GUILD_ID, "isolation-commander");
    assert.equal(authority.memberRank, "Commander");
    assert.equal(authority.isOwner, true);
    assert.ok(authority.permissions.includes("site.admin"));
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
