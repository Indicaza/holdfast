import { randomUUID } from "node:crypto";

import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { createNotificationInDatabase } from "../Notification/notificationRepository.js";
import {
  normalizeCapabilityList,
  normalizeManagedRank,
  normalizeQuestScope,
} from "./authorityPolicy.js";
import { readRankLadderFromDatabase } from "./authorityRepository.js";
import { isHoldfastGuild, requireGuildId } from "./guildScope.js";

// A billet may not share a name with one of the guild's ranks (Holdfast's
// ranks and billets are both Discord roles).
function reservedBilletNames(db, guildId) {
  return new Set(
    ["@everyone", ...readRankLadderFromDatabase(db, guildId).names].map(
      (name) => name.toLowerCase(),
    ),
  );
}

function activeGuildMember(db, guildId, memberId) {
  return db
    .prepare(
      `
        SELECT members.id, members.billets_managed
        FROM guild_memberships
        JOIN members ON members.id = guild_memberships.member_id
        WHERE guild_memberships.guild_id = ?
          AND guild_memberships.member_id = ?
          AND guild_memberships.status = 'active'
      `,
    )
    .get(guildId, memberId);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parsePermissions(value) {
  try {
    return normalizeCapabilityList(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function billetFromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    responsibility: row.responsibility || "",
    discordRoleId: row.discord_role_id || null,
    discordManaged: Boolean(row.discord_managed),
    permissions: parsePermissions(row.permissions_json),
    maxManagedRank: normalizeManagedRank(row.max_managed_rank),
    questScope: normalizeQuestScope(row.quest_scope),
    rewardLimits: {
      repPerObjective: Number(row.reward_rep_max) || 0,
      marksPerObjective: Number(row.reward_marks_max) || 0,
      marksPerQuest: Number(row.reward_marks_quest_max) || 0,
    },
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBilletInput({ name, responsibility }, reservedNames) {
  const normalizedName = normalizeText(name);
  const normalizedResponsibility = normalizeText(responsibility);

  if (normalizedName.length < 2 || normalizedName.length > 48) {
    return {
      valid: false,
      error: "invalid_name",
    };
  }

  if (reservedNames.has(normalizedName.toLowerCase())) {
    return {
      valid: false,
      error: "reserved_name",
    };
  }

  if (normalizedResponsibility.length > 600) {
    return {
      valid: false,
      error: "invalid_responsibility",
    };
  }

  return {
    valid: true,
    value: {
      name: normalizedName,
      responsibility: normalizedResponsibility,
    },
  };
}

function readBilletById(db, guildId, billetId) {
  return billetFromRow(
    db
      .prepare("SELECT * FROM billets WHERE guild_id = ? AND id = ?")
      .get(requireGuildId(guildId), billetId),
  );
}

export async function readBillet(guildId, billetId) {
  return withGuildDatabase((db) => readBilletById(db, guildId, billetId));
}

export function readBilletsFromDatabase(
  db,
  guildId,
  { includeInactive = false } = {},
) {
  const id = requireGuildId(guildId);
  const rows = includeInactive
    ? db
        .prepare(
          "SELECT * FROM billets WHERE guild_id = ? ORDER BY name COLLATE NOCASE",
        )
        .all(id)
    : db
        .prepare(
          "SELECT * FROM billets WHERE guild_id = ? AND active = 1 ORDER BY name COLLATE NOCASE",
        )
        .all(id);

  return rows.map(billetFromRow);
}

export function readMemberBilletsFromDatabase(db, guildId, memberId) {
  return db
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
        ORDER BY billets.name COLLATE NOCASE
      `,
    )
    .all(requireGuildId(guildId), memberId)
    .map(billetFromRow);
}

export async function readBillets(guildId, options = {}) {
  return withGuildDatabase((db) =>
    readBilletsFromDatabase(db, guildId, options),
  );
}

export async function createBillet(
  input,
  { guildId, actorMemberId = null } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const validation = validateBilletInput(
      input || {},
      reservedBilletNames(db, id),
    );

    if (!validation.valid) {
      return { status: validation.error, billet: null };
    }

    const existing = db
      .prepare(
        "SELECT id FROM billets WHERE guild_id = ? AND name = ? COLLATE NOCASE",
      )
      .get(id, validation.value.name);

    if (existing) {
      return { status: "duplicate_name", billet: null };
    }

    const now = new Date().toISOString();
    const billetId = `billet-${randomUUID()}`;

    db.prepare(
      `
        INSERT INTO billets (
          id,
          guild_id,
          name,
          responsibility,
          discord_role_id,
          active,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, NULL, 1, ?, ?)
      `,
    ).run(
      billetId,
      id,
      validation.value.name,
      validation.value.responsibility,
      now,
      now,
    );

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: "billet.created",
      entityType: "billet",
      entityId: billetId,
      payload: {
        name: validation.value.name,
        responsibility: validation.value.responsibility,
      },
    });

    return {
      status: "created",
      billet: readBilletById(db, id, billetId),
    };
  });
}

export async function updateBillet(
  billetId,
  input,
  { guildId, actorMemberId = null } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const validation = validateBilletInput(
      input || {},
      reservedBilletNames(db, id),
    );

    if (!validation.valid) {
      return { status: validation.error, billet: null };
    }

    const existing = readBilletById(db, id, billetId);

    if (!existing) {
      return { status: "not-found", billet: null };
    }

    if (
      existing.discordManaged &&
      existing.name !== validation.value.name
    ) {
      return { status: "name_locked", billet: existing };
    }

    const duplicate = db
      .prepare(
        "SELECT id FROM billets WHERE guild_id = ? AND name = ? COLLATE NOCASE AND id <> ?",
      )
      .get(id, validation.value.name, billetId);

    if (duplicate) {
      return { status: "duplicate_name", billet: existing };
    }

    if (
      existing.name === validation.value.name &&
      existing.responsibility === validation.value.responsibility
    ) {
      return { status: "unchanged", billet: existing };
    }

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE billets
        SET name = ?, responsibility = ?, updated_at = ?
        WHERE guild_id = ? AND id = ?
      `,
    ).run(
      validation.value.name,
      validation.value.responsibility,
      now,
      id,
      billetId,
    );

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: "billet.updated",
      entityType: "billet",
      entityId: billetId,
      payload: {
        before: {
          name: existing.name,
          responsibility: existing.responsibility,
        },
        after: validation.value,
      },
    });

    return {
      status: "updated",
      billet: readBilletById(db, id, billetId),
    };
  });
}

export async function deleteBillet(
  billetId,
  { guildId, actorMemberId = null } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const existing = readBilletById(db, id, billetId);

    if (!existing) {
      return { status: "not-found", billet: null, assignmentCount: 0 };
    }

    if (existing.discordManaged) {
      return {
        status: "protected",
        billet: existing,
        assignmentCount: 0,
      };
    }

    const assignmentCount = Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM member_billets WHERE guild_id = ? AND billet_id = ?",
        )
        .get(id, billetId)?.count || 0,
    );

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: "billet.deleted",
      entityType: "billet",
      entityId: billetId,
      payload: {
        name: existing.name,
        responsibility: existing.responsibility,
        discordRoleId: existing.discordRoleId,
        permissions: existing.permissions,
        maxManagedRank: existing.maxManagedRank,
        assignmentCount,
      },
    });

    db.prepare("DELETE FROM billets WHERE guild_id = ? AND id = ?").run(
      id,
      billetId,
    );

    return {
      status: "deleted",
      billet: existing,
      assignmentCount,
    };
  });
}

export async function setBilletDiscordRoleId(
  billetId,
  discordRoleId,
  { guildId } = {},
) {
  const id = requireGuildId(guildId);
  const roleId = normalizeText(discordRoleId);

  if (!roleId) {
    throw new Error("Discord role ID is required");
  }

  return withGuildTransaction((db) => {
    const existing = readBilletById(db, id, billetId);

    if (!existing) {
      return null;
    }

    db.prepare(
      `
        UPDATE billets
        SET discord_role_id = ?, updated_at = ?
        WHERE guild_id = ? AND id = ?
      `,
    ).run(roleId, new Date().toISOString(), id, billetId);

    return readBilletById(db, id, billetId);
  });
}

export async function setMemberBilletAssignment(
  memberId,
  billetId,
  assigned,
  { guildId, actorMemberId = null } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const member = activeGuildMember(db, id, memberId);

    if (!member) {
      return { status: "member-not-found", billets: [] };
    }

    const billet = readBilletById(db, id, billetId);

    if (!billet || !billet.active) {
      return { status: "billet-not-found", billets: [] };
    }

    const current = db
      .prepare(
        "SELECT 1 FROM member_billets WHERE guild_id = ? AND member_id = ? AND billet_id = ?",
      )
      .get(id, memberId, billetId);

    const now = new Date().toISOString();

    // billets_managed hands Holdfast's Discord billet roles to the website.
    if (isHoldfastGuild(id)) {
      db.prepare(
        `
          UPDATE members
          SET billets_managed = 1, updated_at = ?
          WHERE id = ?
        `,
      ).run(now, memberId);
    }

    if (assigned && current) {
      return {
        status: "unchanged",
        billets: readMemberBilletsFromDatabase(db, id, memberId),
      };
    }

    if (!assigned && !current) {
      return {
        status: "unchanged",
        billets: readMemberBilletsFromDatabase(db, id, memberId),
      };
    }

    if (assigned) {
      db.prepare(
        `
          INSERT INTO member_billets (
            guild_id,
            member_id,
            billet_id,
            assigned_at,
            assigned_by_member_id
          ) VALUES (?, ?, ?, ?, ?)
        `,
      ).run(
        id,
        memberId,
        billetId,
        now,
        actorMemberId || null,
      );
    } else {
      db.prepare(
        `
          DELETE FROM member_billets
          WHERE guild_id = ? AND member_id = ? AND billet_id = ?
        `,
      ).run(id, memberId, billetId);
    }

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: assigned ? "member.billet.assigned" : "member.billet.removed",
      entityType: "member",
      entityId: memberId,
      payload: {
        billetId,
        billetName: billet.name,
      },
    });

    if (actorMemberId !== memberId) {
      createNotificationInDatabase({
        db,
        guildId: id,
        recipientMemberId: memberId,
        type: "billet_changed",
        kind: "update",
        title: assigned ? "Billet assigned" : "Billet removed",
        message: assigned
          ? `You were assigned the ${billet.name} billet.`
          : `The ${billet.name} billet was removed from your profile.`,
        href: "/members/me",
        entityType: "billet",
        entityId: billetId,
        data: {
          billetId,
          billetName: billet.name,
          assigned,
        },
        dedupeKey: `member-billet:${billetId}`,
        now,
      });
    }

    return {
      status: assigned ? "assigned" : "removed",
      billets: readMemberBilletsFromDatabase(db, id, memberId),
    };
  });
}

// Takes a Holdfast member's billets over from Discord. Other guilds' billets
// are always the website's.
export async function claimMemberBilletAuthority(
  memberId,
  { guildId, actorMemberId = null } = {},
) {
  const id = requireGuildId(guildId);

  return withGuildTransaction((db) => {
    const member = activeGuildMember(db, id, memberId);

    if (!member) {
      return { status: "member-not-found", billets: [] };
    }

    if (!isHoldfastGuild(id) || Boolean(member.billets_managed)) {
      return {
        status: "unchanged",
        billets: readMemberBilletsFromDatabase(db, id, memberId),
      };
    }

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE members
        SET billets_managed = 1, updated_at = ?
        WHERE id = ?
      `,
    ).run(now, memberId);

    recordAuditEventInDatabase({
      db,
      guildId: id,
      actorMemberId,
      eventType: "member.billet.authority_enabled",
      entityType: "member",
      entityId: memberId,
      payload: {},
    });

    return {
      status: "claimed",
      billets: readMemberBilletsFromDatabase(db, id, memberId),
    };
  });
}
