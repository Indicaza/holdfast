import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import {
  CAPABILITY_DEFINITIONS,
  canDelegateScope,
  capabilityListIsValid,
  fullOwnerAuthority,
  mergeAuthorityScopes,
  normalizeCapabilityList,
  normalizeManagedRank,
} from "./authorityPolicy.js";
import {
  GUILD_RANKS,
  guildRankMetadata,
  guildRankOrder,
  isGuildRank,
  normalizeGuildRank,
} from "./rankSystem.js";

function idSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function parsePermissions(value) {
  try {
    return normalizeCapabilityList(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function rankScopeFromRow(row) {
  if (!row) return null;

  return {
    rank: normalizeGuildRank(row.rank),
    permissions: parsePermissions(row.permissions_json),
    maxManagedRank: normalizeManagedRank(row.max_managed_rank),
  };
}

function billetScopeFromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    responsibility: row.responsibility || "",
    discordRoleId: row.discord_role_id || null,
    discordManaged: Boolean(row.discord_managed),
    active: Boolean(row.active),
    permissions: parsePermissions(row.permissions_json),
    maxManagedRank: normalizeManagedRank(row.max_managed_rank),
  };
}

export function readRankAuthorityFromDatabase(db) {
  const rows = db
    .prepare("SELECT * FROM rank_authority ORDER BY rowid")
    .all();
  const byRank = new Map(rows.map((row) => [row.rank, rankScopeFromRow(row)]));

  return GUILD_RANKS.map((rank) => ({
    ...guildRankMetadata(rank),
    ...(byRank.get(rank) || {
      rank,
      permissions: [],
      maxManagedRank: null,
    }),
  }));
}

export function readBilletAuthorityFromDatabase(db) {
  return db
    .prepare(
      `
        SELECT *
        FROM billets
        WHERE active = 1
        ORDER BY name COLLATE NOCASE
      `,
    )
    .all()
    .map(billetScopeFromRow);
}

export function resolveMemberAuthorityFromDatabase(
  db,
  memberId,
  env = process.env,
) {
  const normalizedMemberId = String(memberId || "").trim();

  if (!normalizedMemberId) {
    return {
      permissions: [],
      maxManagedRank: null,
      memberRank: "Recruit",
      isOwner: false,
    };
  }

  const ownerIds = idSet(env.GUILD_OWNER_DISCORD_IDS);
  const member = db
    .prepare(
      "SELECT id, rank, status FROM members WHERE id = ?",
    )
    .get(normalizedMemberId);

  if (ownerIds.has(normalizedMemberId)) {
    const authority = fullOwnerAuthority();
    return {
      ...authority,
      memberRank: member?.rank
        ? normalizeGuildRank(member.rank)
        : "Commander",
    };
  }

  if (!member || member.status !== "active") {
    return {
      permissions: [],
      maxManagedRank: null,
      memberRank: "Recruit",
      isOwner: false,
    };
  }

  const rankRow = db
    .prepare("SELECT * FROM rank_authority WHERE rank = ?")
    .get(normalizeGuildRank(member.rank));

  const billetRows = db
    .prepare(
      `
        SELECT billets.*
        FROM billets
        JOIN member_billets
          ON member_billets.billet_id = billets.id
        WHERE member_billets.member_id = ?
          AND billets.active = 1
      `,
    )
    .all(normalizedMemberId);

  const merged = mergeAuthorityScopes([
    rankScopeFromRow(rankRow),
    ...billetRows.map(billetScopeFromRow),
  ]);

  return {
    ...merged,
    memberRank: normalizeGuildRank(member.rank),
    isOwner: false,
  };
}

export function resolveMemberAuthority(memberId, env = process.env) {
  return withGuildDatabase((db) =>
    resolveMemberAuthorityFromDatabase(db, memberId, env),
  );
}

export function readAuthorityCatalog() {
  return withGuildDatabase((db) => ({
    capabilities: CAPABILITY_DEFINITIONS,
    ranks: readRankAuthorityFromDatabase(db),
    billets: readBilletAuthorityFromDatabase(db),
  }));
}

function validatedScopeInput(input) {
  const permissions = input?.permissions;
  const maxManagedRank = input?.maxManagedRank;

  if (!capabilityListIsValid(permissions)) {
    return { valid: false, error: "invalid_permissions" };
  }

  if (
    maxManagedRank !== null &&
    maxManagedRank !== undefined &&
    maxManagedRank !== "" &&
    !isGuildRank(maxManagedRank)
  ) {
    return { valid: false, error: "invalid_rank_ceiling" };
  }

  return {
    valid: true,
    scope: {
      permissions: normalizeCapabilityList(permissions),
      maxManagedRank: normalizeManagedRank(maxManagedRank),
    },
  };
}

function actorCanDesignAuthority(actorAuthority) {
  return (
    actorAuthority?.isOwner ||
    actorAuthority?.permissions?.includes("authority.manage")
  );
}

function rankScopeByName(db, rank) {
  return rankScopeFromRow(
    db.prepare("SELECT * FROM rank_authority WHERE rank = ?").get(rank),
  );
}

function billetScopeById(db, billetId) {
  return billetScopeFromRow(
    db.prepare("SELECT * FROM billets WHERE id = ?").get(billetId),
  );
}

export async function updateRankAuthority(
  rankValue,
  input,
  { actorMemberId = null, env = process.env } = {},
) {
  if (!isGuildRank(rankValue)) {
    return { status: "not-found", scope: null };
  }

  const rank = normalizeGuildRank(rankValue);
  const validation = validatedScopeInput(input);

  if (!validation.valid) {
    return { status: validation.error, scope: null };
  }

  return withGuildTransaction((db) => {
    const actor = resolveMemberAuthorityFromDatabase(db, actorMemberId, env);
    const existing = rankScopeByName(db, rank);

    if (!existing) {
      return { status: "not-found", scope: null };
    }

    if (!actorCanDesignAuthority(actor)) {
      return { status: "forbidden", scope: existing };
    }

    if (
      !actor.isOwner &&
      guildRankOrder(rank) >= guildRankOrder(actor.memberRank)
    ) {
      return { status: "scope_above_actor", scope: existing };
    }

    if (
      !canDelegateScope(actor, existing) ||
      !canDelegateScope(actor, validation.scope)
    ) {
      return { status: "scope_above_actor", scope: existing };
    }

    db.prepare(
      `
        UPDATE rank_authority
        SET permissions_json = ?, max_managed_rank = ?
        WHERE rank = ?
      `,
    ).run(
      JSON.stringify(validation.scope.permissions),
      validation.scope.maxManagedRank,
      rank,
    );

    recordAuditEventInDatabase({
      db,
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
      scope: rankScopeByName(db, rank),
    };
  });
}

export async function updateBilletAuthority(
  billetId,
  input,
  { actorMemberId = null, env = process.env } = {},
) {
  const validation = validatedScopeInput(input);

  if (!validation.valid) {
    return { status: validation.error, scope: null };
  }

  return withGuildTransaction((db) => {
    const actor = resolveMemberAuthorityFromDatabase(db, actorMemberId, env);
    const existing = billetScopeById(db, billetId);

    if (!existing || !existing.active) {
      return { status: "not-found", scope: null };
    }

    if (!actorCanDesignAuthority(actor)) {
      return { status: "forbidden", scope: existing };
    }

    if (
      !canDelegateScope(actor, existing) ||
      !canDelegateScope(actor, validation.scope)
    ) {
      return { status: "scope_above_actor", scope: existing };
    }

    db.prepare(
      `
        UPDATE billets
        SET permissions_json = ?, max_managed_rank = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(
      JSON.stringify(validation.scope.permissions),
      validation.scope.maxManagedRank,
      new Date().toISOString(),
      billetId,
    );

    recordAuditEventInDatabase({
      db,
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
      scope: billetScopeById(db, billetId),
    };
  });
}

export function authorityCanGrantBillet(
  actorAuthority,
  billetScope,
) {
  return canDelegateScope(actorAuthority, billetScope);
}

export function authorityCanManageTargetRank(
  actorAuthority,
  targetRank,
) {
  if (actorAuthority?.isOwner) return true;

  const ceiling = normalizeManagedRank(actorAuthority?.maxManagedRank);

  if (!ceiling || !isGuildRank(targetRank)) {
    return false;
  }

  return guildRankOrder(targetRank) <= guildRankOrder(ceiling);
}
