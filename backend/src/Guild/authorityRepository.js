import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import {
  canDelegateScope,
  capabilityDefinitionsForGuild,
  capabilityIdsForGuild,
  capabilityListIsValid,
  fullOwnerAuthority,
  mergeAuthorityScopes,
  normalizeCapabilityList,
  normalizeManagedRank,
  normalizeQuestScope,
  normalizeRewardLimits,
  rewardLimitsAreValid,
  scopeProvidesMemberManagement,
  scopeProvidesQuestAuthority,
  scopeProvidesRewardAuthority,
} from "./authorityPolicy.js";
import { createRankLadder, HOLDFAST_RANK_LADDER } from "./rankSystem.js";
import { DEFAULT_GUILD_RANKS } from "./guildDefaults.js";
import { isHoldfastGuild, requireGuildId } from "./guildScope.js";

function idSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function isHoldfastOwner(memberId, env = process.env) {
  return idSet(env.GUILD_OWNER_DISCORD_IDS).has(String(memberId || "").trim());
}

function parsePermissions(value) {
  try {
    return normalizeCapabilityList(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function rankScopeFromRow(row, ladder) {
  if (!row) return null;

  return {
    rank: ladder.normalize(row.rank),
    permissions: parsePermissions(row.permissions_json),
    maxManagedRank: normalizeManagedRank(row.max_managed_rank, ladder),
    questScope: normalizeQuestScope(row.quest_scope),
    rewardLimits: {
      repPerObjective: Number(row.reward_rep_max) || 0,
      marksPerObjective: Number(row.reward_marks_max) || 0,
      marksPerQuest: Number(row.reward_marks_quest_max) || 0,
    },
  };
}

function billetScopeFromRow(row, ladder) {
  if (!row) return null;

  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    responsibility: row.responsibility || "",
    discordRoleId: row.discord_role_id || null,
    discordManaged: Boolean(row.discord_managed),
    active: Boolean(row.active),
    permissions: parsePermissions(row.permissions_json),
    maxManagedRank: normalizeManagedRank(row.max_managed_rank, ladder),
    questScope: normalizeQuestScope(row.quest_scope),
    rewardLimits: {
      repPerObjective: Number(row.reward_rep_max) || 0,
      marksPerObjective: Number(row.reward_marks_max) || 0,
      marksPerQuest: Number(row.reward_marks_quest_max) || 0,
    },
  };
}

// The guild's ranks, lowest first. A guild always has rows (migration 13 and
// registration seed them); the fallbacks only cover a database mid-repair.
export function readRankLadderFromDatabase(db, guildId) {
  const id = requireGuildId(guildId);
  const rows = db
    .prepare(
      `
        SELECT rank AS name, category, sort_order AS "order", leadership
        FROM rank_authority
        WHERE guild_id = ?
        ORDER BY sort_order
      `,
    )
    .all(id);

  if (!rows.length) {
    return isHoldfastGuild(id)
      ? HOLDFAST_RANK_LADDER
      : createRankLadder(DEFAULT_GUILD_RANKS);
  }

  return createRankLadder(rows, { holdfast: isHoldfastGuild(id) });
}

export function readRankLadder(guildId) {
  return withGuildDatabase((db) => readRankLadderFromDatabase(db, guildId));
}

export function readRankAuthorityFromDatabase(db, guildId) {
  const id = requireGuildId(guildId);
  const ladder = readRankLadderFromDatabase(db, id);
  const rows = db
    .prepare("SELECT * FROM rank_authority WHERE guild_id = ? ORDER BY sort_order")
    .all(id);
  const byRank = new Map(
    rows.map((row) => [row.rank, rankScopeFromRow(row, ladder)]),
  );

  return ladder.names.map((rank) => ({
    ...ladder.metadata(rank),
    ...(byRank.get(rank) || {
      rank,
      permissions: [],
      maxManagedRank: null,
    }),
  }));
}

export function readBilletAuthorityFromDatabase(db, guildId) {
  const id = requireGuildId(guildId);
  const ladder = readRankLadderFromDatabase(db, id);

  return db
    .prepare(
      `
        SELECT *
        FROM billets
        WHERE guild_id = ? AND active = 1
        ORDER BY name COLLATE NOCASE
      `,
    )
    .all(id)
    .map((row) => billetScopeFromRow(row, ladder));
}

export function readEconomyPolicyFromDatabase(db, guildId) {
  const row =
    db
      .prepare("SELECT * FROM quest_settings WHERE guild_id = ?")
      .get(requireGuildId(guildId)) || {};

  return {
    repPerObjective: Number(row.rep_max) || 0,
    marksPerObjective: Number(row.marks_max) || 0,
    marksPerQuest: Number(row.marks_quest_max) || 0,
  };
}

function noAuthority(ladder) {
  return {
    permissions: [],
    maxManagedRank: null,
    questScopes: {},
    rewardLimits: {
      approve: { repPerObjective: 0, marksPerObjective: 0, marksPerQuest: 0 },
      issue: { repPerObjective: 0, marksPerObjective: 0, marksPerQuest: 0 },
    },
    memberRank: ladder.entry,
    isOwner: false,
  };
}

// What a member may do in one guild: the rank they hold there, their active
// billets there, and full authority for the guild's owner. Holdfast's owners
// are also configured by GUILD_OWNER_DISCORD_IDS. Nothing here reads another
// guild's ranks, billets or memberships.
export function resolveMemberAuthorityFromDatabase(
  db,
  guildId,
  memberId,
  env = process.env,
) {
  const id = requireGuildId(guildId);
  const holdfast = isHoldfastGuild(id);
  const ladder = readRankLadderFromDatabase(db, id);
  const normalizedMemberId = String(memberId || "").trim();

  if (!normalizedMemberId) {
    return noAuthority(ladder);
  }

  const member = db
    .prepare("SELECT id, rank, status FROM members WHERE id = ?")
    .get(normalizedMemberId);
  const membership = db
    .prepare(
      `
        SELECT role, rank FROM guild_memberships
        WHERE guild_id = ? AND member_id = ? AND status = 'active'
      `,
    )
    .get(id, normalizedMemberId);

  if (holdfast && idSet(env.GUILD_OWNER_DISCORD_IDS).has(normalizedMemberId)) {
    const heldRank = membership?.rank || member?.rank;
    return {
      ...fullOwnerAuthority(readEconomyPolicyFromDatabase(db, id), ladder),
      memberRank: heldRank ? ladder.normalize(heldRank) : ladder.top,
    };
  }

  // A player holds rank only in the guild they are an active member of.
  // Holdfast also requires the player to still be in its Discord server.
  if (!member || !membership || (holdfast && member.status !== "active")) {
    return noAuthority(ladder);
  }

  const memberRank = ladder.normalize(membership.rank);

  if (membership.role === "owner") {
    return {
      ...fullOwnerAuthority(readEconomyPolicyFromDatabase(db, id), ladder),
      memberRank,
    };
  }

  const rankRow = db
    .prepare("SELECT * FROM rank_authority WHERE guild_id = ? AND rank = ?")
    .get(id, memberRank);

  const billetRows = db
    .prepare(
      `
        SELECT billets.*
        FROM billets
        JOIN member_billets
          ON member_billets.guild_id = billets.guild_id
         AND member_billets.billet_id = billets.id
        WHERE member_billets.guild_id = ?
          AND member_billets.member_id = ?
          AND billets.active = 1
      `,
    )
    .all(id, normalizedMemberId);

  const merged = mergeAuthorityScopes(
    [
      rankScopeFromRow(rankRow, ladder),
      ...billetRows.map((row) => billetScopeFromRow(row, ladder)),
    ],
    ladder,
  );
  const economy = readEconomyPolicyFromDatabase(db, id);

  for (const bucket of ["approve", "issue"]) {
    merged.rewardLimits[bucket] = {
      repPerObjective: Math.min(
        merged.rewardLimits[bucket].repPerObjective,
        economy.repPerObjective,
      ),
      marksPerObjective: Math.min(
        merged.rewardLimits[bucket].marksPerObjective,
        economy.marksPerObjective,
      ),
      marksPerQuest: Math.min(
        merged.rewardLimits[bucket].marksPerQuest,
        economy.marksPerQuest,
      ),
    };
  }

  return {
    ...merged,
    memberRank,
    isOwner: false,
  };
}

export function resolveMemberAuthority(guildId, memberId, env = process.env) {
  return withGuildDatabase((db) =>
    resolveMemberAuthorityFromDatabase(db, guildId, memberId, env),
  );
}

export function readAuthorityCatalog(guildId) {
  return withGuildDatabase((db) => {
    const ladder = readRankLadderFromDatabase(db, guildId);
    return {
      capabilities: capabilityDefinitionsForGuild(ladder),
      ranks: readRankAuthorityFromDatabase(db, guildId),
      billets: readBilletAuthorityFromDatabase(db, guildId),
      economyPolicy: readEconomyPolicyFromDatabase(db, guildId),
    };
  });
}

function validatedScopeInput(input, ladder) {
  const permissions = input?.permissions;
  const maxManagedRank = input?.maxManagedRank;
  const questScope = input?.questScope ?? "own";
  const rewardLimits = input?.rewardLimits ?? {
    repPerObjective: 0,
    marksPerObjective: 0,
    marksPerQuest: 0,
  };

  const guildCapabilities = new Set(capabilityIdsForGuild(ladder));

  if (
    !capabilityListIsValid(permissions) ||
    permissions.some((permission) => !guildCapabilities.has(permission.trim()))
  ) {
    return { valid: false, error: "invalid_permissions" };
  }

  if (
    maxManagedRank !== null &&
    maxManagedRank !== undefined &&
    maxManagedRank !== "" &&
    !ladder.isRank(maxManagedRank)
  ) {
    return { valid: false, error: "invalid_rank_ceiling" };
  }

  if (!["own", "all"].includes(questScope)) {
    return { valid: false, error: "invalid_quest_scope" };
  }

  if (!rewardLimitsAreValid(rewardLimits)) {
    return { valid: false, error: "invalid_reward_limits" };
  }

  const scope = {
    permissions: normalizeCapabilityList(permissions),
    maxManagedRank: normalizeManagedRank(maxManagedRank, ladder),
    questScope: normalizeQuestScope(questScope),
    rewardLimits: normalizeRewardLimits(rewardLimits),
  };

  if (scope.maxManagedRank && !scopeProvidesMemberManagement(scope)) {
    return {
      valid: false,
      error: "ceiling_requires_member_management",
    };
  }

  if (!scopeProvidesQuestAuthority(scope)) {
    scope.questScope = "own";
  }

  if (!scopeProvidesRewardAuthority(scope)) {
    scope.rewardLimits = {
      repPerObjective: 0,
      marksPerObjective: 0,
      marksPerQuest: 0,
    };
  }

  return {
    valid: true,
    scope,
  };
}

function actorCanDesignAuthority(actorAuthority) {
  return (
    actorAuthority?.isOwner ||
    actorAuthority?.permissions?.includes("authority.manage")
  );
}

function rankScopeByName(db, guildId, rank, ladder) {
  return rankScopeFromRow(
    db
      .prepare("SELECT * FROM rank_authority WHERE guild_id = ? AND rank = ?")
      .get(guildId, rank),
    ladder,
  );
}

function billetScopeById(db, guildId, billetId, ladder) {
  return billetScopeFromRow(
    db
      .prepare("SELECT * FROM billets WHERE guild_id = ? AND id = ?")
      .get(guildId, billetId),
    ladder,
  );
}

export async function updateRankAuthority(
  rankValue,
  input,
  { guildId, actorMemberId = null, env = process.env } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const ladder = readRankLadderFromDatabase(db, id);

    if (!ladder.isRank(rankValue)) {
      return { status: "not-found", scope: null };
    }

    const rank = ladder.normalize(rankValue);
    const validation = validatedScopeInput(input, ladder);

    if (!validation.valid) {
      return { status: validation.error, scope: null };
    }

    const actor = resolveMemberAuthorityFromDatabase(db, id, actorMemberId, env);
    const existing = rankScopeByName(db, id, rank, ladder);

    if (!existing) {
      return { status: "not-found", scope: null };
    }

    if (!actorCanDesignAuthority(actor)) {
      return { status: "forbidden", scope: existing };
    }

    if (
      !actor.isOwner &&
      ladder.order(rank) >= ladder.order(actor.memberRank)
    ) {
      return { status: "scope_above_actor", scope: existing };
    }

    if (
      (!actor.isOwner && !canDelegateScope(actor, existing, ladder)) ||
      !canDelegateScope(actor, validation.scope, ladder)
    ) {
      return { status: "scope_above_actor", scope: existing };
    }

    db.prepare(
      `
        UPDATE rank_authority
        SET
          permissions_json = ?,
          max_managed_rank = ?,
          quest_scope = ?,
          reward_rep_max = ?,
          reward_marks_max = ?,
          reward_marks_quest_max = ?
        WHERE guild_id = ? AND rank = ?
      `,
    ).run(
      JSON.stringify(validation.scope.permissions),
      validation.scope.maxManagedRank,
      validation.scope.questScope,
      validation.scope.rewardLimits.repPerObjective,
      validation.scope.rewardLimits.marksPerObjective,
      validation.scope.rewardLimits.marksPerQuest,
      id,
      rank,
    );

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: "authority.rank.updated",
      entityType: "rank",
      entityId: rank,
      payload: {
        before: existing,
        after: validation.scope,
      },
    });

    return {
      status: "updated",
      scope: rankScopeByName(db, id, rank, ladder),
    };
  });
}

export async function updateBilletAuthority(
  billetId,
  input,
  { guildId, actorMemberId = null, env = process.env } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const ladder = readRankLadderFromDatabase(db, id);
    const validation = validatedScopeInput(input, ladder);

    if (!validation.valid) {
      return { status: validation.error, scope: null };
    }

    const actor = resolveMemberAuthorityFromDatabase(db, id, actorMemberId, env);
    const existing = billetScopeById(db, id, billetId, ladder);

    if (!existing || !existing.active) {
      return { status: "not-found", scope: null };
    }

    if (!actorCanDesignAuthority(actor)) {
      return { status: "forbidden", scope: existing };
    }

    if (
      (!actor.isOwner && !canDelegateScope(actor, existing, ladder)) ||
      !canDelegateScope(actor, validation.scope, ladder)
    ) {
      return { status: "scope_above_actor", scope: existing };
    }

    db.prepare(
      `
        UPDATE billets
        SET
          permissions_json = ?,
          max_managed_rank = ?,
          quest_scope = ?,
          reward_rep_max = ?,
          reward_marks_max = ?,
          reward_marks_quest_max = ?,
          updated_at = ?
        WHERE guild_id = ? AND id = ?
      `,
    ).run(
      JSON.stringify(validation.scope.permissions),
      validation.scope.maxManagedRank,
      validation.scope.questScope,
      validation.scope.rewardLimits.repPerObjective,
      validation.scope.rewardLimits.marksPerObjective,
      validation.scope.rewardLimits.marksPerQuest,
      new Date().toISOString(),
      id,
      billetId,
    );

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: "authority.billet.updated",
      entityType: "billet",
      entityId: billetId,
      payload: {
        before: existing,
        after: validation.scope,
      },
    });

    return {
      status: "updated",
      scope: billetScopeById(db, id, billetId, ladder),
    };
  });
}

export function authorityCanGrantBillet(
  actorAuthority,
  billetScope,
  ladder = HOLDFAST_RANK_LADDER,
) {
  return canDelegateScope(actorAuthority, billetScope, ladder);
}

export function authorityCanGrantRank(actorAuthority, rank, { guildId } = {}) {
  const id = requireGuildId(guildId);

  return withGuildDatabase((db) => {
    const ladder = readRankLadderFromDatabase(db, id);
    if (!ladder.isRank(rank)) return false;
    const scope = rankScopeByName(db, id, ladder.normalize(rank), ladder);
    return Boolean(scope && canDelegateScope(actorAuthority, scope, ladder));
  });
}

export function authorityCanManageTargetRank(
  actorAuthority,
  targetRank,
  ladder = HOLDFAST_RANK_LADDER,
) {
  if (actorAuthority?.isOwner) return true;

  const ceiling = normalizeManagedRank(actorAuthority?.maxManagedRank, ladder);

  if (!ceiling || !ladder.isRank(targetRank)) {
    return false;
  }

  return ladder.order(targetRank) <= ladder.order(ceiling);
}
