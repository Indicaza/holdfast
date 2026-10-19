import { randomUUID } from "node:crypto";

// What a newly registered guild starts with. Holdfast keeps its own
// military ladder and billets (seeded by migrations 3-5 and carried into
// its rows by migration 13); every other guild gets this smaller ladder,
// which its owner can then reshape through the authority routes.

const NO_REWARDS = Object.freeze({
  repPerObjective: 0,
  marksPerObjective: 0,
  marksPerQuest: 0,
});

export const DEFAULT_GUILD_RANKS = Object.freeze([
  {
    name: "Initiate",
    category: "member",
    order: 0,
    leadership: false,
    permissions: [],
    maxManagedRank: null,
    questScope: "own",
    rewardLimits: NO_REWARDS,
  },
  {
    name: "Member",
    category: "member",
    order: 1,
    leadership: false,
    permissions: [],
    maxManagedRank: null,
    questScope: "own",
    rewardLimits: NO_REWARDS,
  },
  {
    name: "Veteran",
    category: "member",
    order: 2,
    leadership: true,
    permissions: ["quests.create", "quests.edit"],
    maxManagedRank: null,
    questScope: "own",
    rewardLimits: NO_REWARDS,
  },
  {
    name: "Officer",
    category: "officer",
    order: 3,
    leadership: true,
    permissions: [
      "audit.view",
      "members.billet.assign",
      "members.rank.manage",
      "quests.create",
      "quests.edit",
      "quests.publish",
      "rewards.approve",
      "rewards.issue",
    ],
    maxManagedRank: "Veteran",
    questScope: "all",
    rewardLimits: {
      repPerObjective: 250,
      marksPerObjective: 25,
      marksPerQuest: 100,
    },
  },
  {
    name: "Guild Master",
    category: "officer",
    order: 4,
    leadership: true,
    permissions: [
      "audit.view",
      "authority.manage",
      "billets.create",
      "billets.delete",
      "billets.edit",
      "members.billet.assign",
      "members.rank.manage",
      "quests.create",
      "quests.edit",
      "quests.publish",
      "rewards.approve",
      "rewards.issue",
      "rewards.policy.edit",
    ],
    maxManagedRank: "Guild Master",
    questScope: "all",
    rewardLimits: {
      repPerObjective: 1000,
      marksPerObjective: 1000,
      marksPerQuest: 1000,
    },
  },
]);

export const DEFAULT_GUILD_BILLETS = Object.freeze([
  {
    name: "Quartermaster",
    responsibility:
      "Manages guild supplies, crafting logistics, and shared resources.",
    permissions: ["rewards.policy.edit"],
    questScope: "own",
  },
  {
    name: "Raid Leader",
    responsibility: "Organizes raid groups, preparation, and strategy.",
    permissions: ["quests.create", "quests.edit"],
    questScope: "own",
  },
]);

export const DEFAULT_GUILD_TOP_RANK =
  DEFAULT_GUILD_RANKS[DEFAULT_GUILD_RANKS.length - 1].name;

// Gives a guild its quest settings, rank ladder and starter billets. Safe to
// call twice: rows that already exist are left alone.
export function seedGuildOperationsInDatabase(
  db,
  guildId,
  now = new Date().toISOString(),
) {
  db.prepare(
    "INSERT OR IGNORE INTO quest_settings (guild_id) VALUES (?)",
  ).run(guildId);

  const hasRanks = db
    .prepare("SELECT 1 FROM rank_authority WHERE guild_id = ? LIMIT 1")
    .get(guildId);

  if (!hasRanks) {
    const insertRank = db.prepare(`
      INSERT INTO rank_authority (
        guild_id, rank, sort_order, category, leadership, permissions_json,
        max_managed_rank, quest_scope, reward_rep_max, reward_marks_max,
        reward_marks_quest_max
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rank of DEFAULT_GUILD_RANKS) {
      insertRank.run(
        guildId,
        rank.name,
        rank.order,
        rank.category,
        rank.leadership ? 1 : 0,
        JSON.stringify(rank.permissions),
        rank.maxManagedRank,
        rank.questScope,
        rank.rewardLimits.repPerObjective,
        rank.rewardLimits.marksPerObjective,
        rank.rewardLimits.marksPerQuest,
      );
    }
  }

  const hasBillets = db
    .prepare("SELECT 1 FROM billets WHERE guild_id = ? LIMIT 1")
    .get(guildId);

  if (!hasBillets) {
    const insertBillet = db.prepare(`
      INSERT INTO billets (
        id, guild_id, name, responsibility, discord_role_id, discord_managed,
        active, permissions_json, max_managed_rank, quest_scope,
        reward_rep_max, reward_marks_max, reward_marks_quest_max,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 0, 1, ?, NULL, ?, 0, 0, 0, ?, ?)
    `);

    for (const billet of DEFAULT_GUILD_BILLETS) {
      insertBillet.run(
        `billet-${randomUUID()}`,
        guildId,
        billet.name,
        billet.responsibility,
        JSON.stringify(billet.permissions),
        billet.questScope,
        now,
        now,
      );
    }
  }
}
