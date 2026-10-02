import { randomUUID } from "node:crypto";

import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { normalizeCapabilityList, normalizeManagedRank } from "./authorityPolicy.js";
import { GUILD_RANKS } from "./rankSystem.js";

const RESERVED_BILLET_NAMES = new Set(
  ["@everyone", ...GUILD_RANKS].map((name) => name.toLowerCase()),
);

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
    name: row.name,
    responsibility: row.responsibility || "",
    discordRoleId: row.discord_role_id || null,
    discordManaged: Boolean(row.discord_managed),
    permissions: parsePermissions(row.permissions_json),
    maxManagedRank: normalizeManagedRank(row.max_managed_rank),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBilletInput({ name, responsibility }) {
  const normalizedName = normalizeText(name);
  const normalizedResponsibility = normalizeText(responsibility);

  if (normalizedName.length < 2 || normalizedName.length > 48) {
    return {
      valid: false,
      error: "invalid_name",
    };
  }

  if (RESERVED_BILLET_NAMES.has(normalizedName.toLowerCase())) {
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

function readBilletById(db, billetId) {
  return billetFromRow(
    db.prepare("SELECT * FROM billets WHERE id = ?").get(billetId),
  );
}

export function readBilletsFromDatabase(db, { includeInactive = false } = {}) {
  const rows = includeInactive
    ? db
        .prepare("SELECT * FROM billets ORDER BY name COLLATE NOCASE")
        .all()
    : db
        .prepare(
          "SELECT * FROM billets WHERE active = 1 ORDER BY name COLLATE NOCASE",
        )
        .all();

  return rows.map(billetFromRow);
}

export function readMemberBilletsFromDatabase(db, memberId) {
  return db
    .prepare(
      `
        SELECT billets.*
        FROM billets
        JOIN member_billets
          ON member_billets.billet_id = billets.id
        WHERE member_billets.member_id = ?
          AND billets.active = 1
        ORDER BY billets.name COLLATE NOCASE
      `,
    )
    .all(memberId)
    .map(billetFromRow);
}

export async function readBillets(options = {}) {
  return withGuildDatabase((db) => readBilletsFromDatabase(db, options));
}

export async function createBillet(
  input,
  { actorMemberId = null } = {},
) {
  const validation = validateBilletInput(input || {});

  if (!validation.valid) {
    return { status: validation.error, billet: null };
  }

  return withGuildTransaction((db) => {
    const existing = db
      .prepare(
        "SELECT id FROM billets WHERE name = ? COLLATE NOCASE",
      )
      .get(validation.value.name);

    if (existing) {
      return { status: "duplicate_name", billet: null };
    }

    const now = new Date().toISOString();
    const billetId = `billet-${randomUUID()}`;

    db.prepare(
      `
        INSERT INTO billets (
          id,
          name,
          responsibility,
          discord_role_id,
          active,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, NULL, 1, ?, ?)
      `,
    ).run(
      billetId,
      validation.value.name,
      validation.value.responsibility,
      now,
      now,
    );

    recordAuditEventInDatabase({
      db,
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
      billet: readBilletById(db, billetId),
    };
  });
}

export async function updateBillet(
  billetId,
  input,
  { actorMemberId = null } = {},
) {
  const validation = validateBilletInput(input || {});

  if (!validation.valid) {
    return { status: validation.error, billet: null };
  }

  return withGuildTransaction((db) => {
    const existing = readBilletById(db, billetId);

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
        "SELECT id FROM billets WHERE name = ? COLLATE NOCASE AND id <> ?",
      )
      .get(validation.value.name, billetId);

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
        WHERE id = ?
      `,
    ).run(
      validation.value.name,
      validation.value.responsibility,
      now,
      billetId,
    );

    recordAuditEventInDatabase({
      db,
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
      billet: readBilletById(db, billetId),
    };
  });
}

export async function setBilletDiscordRoleId(billetId, discordRoleId) {
  const roleId = normalizeText(discordRoleId);

  if (!roleId) {
    throw new Error("Discord role ID is required");
  }

  return withGuildTransaction((db) => {
    const existing = readBilletById(db, billetId);

    if (!existing) {
      return null;
    }

    db.prepare(
      `
        UPDATE billets
        SET discord_role_id = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(roleId, new Date().toISOString(), billetId);

    return readBilletById(db, billetId);
  });
}

export async function setMemberBilletAssignment(
  memberId,
  billetId,
  assigned,
  { actorMemberId = null } = {},
) {
  return withGuildTransaction((db) => {
    const member = db
      .prepare("SELECT id FROM members WHERE id = ? AND status = 'active'")
      .get(memberId);

    if (!member) {
      return { status: "member-not-found", billets: [] };
    }

    const billet = readBilletById(db, billetId);

    if (!billet || !billet.active) {
      return { status: "billet-not-found", billets: [] };
    }

    const current = db
      .prepare(
        "SELECT 1 FROM member_billets WHERE member_id = ? AND billet_id = ?",
      )
      .get(memberId, billetId);

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE members
        SET billets_managed = 1, updated_at = ?
        WHERE id = ?
      `,
    ).run(now, memberId);

    if (assigned && current) {
      return {
        status: "unchanged",
        billets: readMemberBilletsFromDatabase(db, memberId),
      };
    }

    if (!assigned && !current) {
      return {
        status: "unchanged",
        billets: readMemberBilletsFromDatabase(db, memberId),
      };
    }

    if (assigned) {
      db.prepare(
        `
          INSERT INTO member_billets (
            member_id,
            billet_id,
            assigned_at,
            assigned_by_member_id
          ) VALUES (?, ?, ?, ?)
        `,
      ).run(
        memberId,
        billetId,
        now,
        actorMemberId || null,
      );
    } else {
      db.prepare(
        `
          DELETE FROM member_billets
          WHERE member_id = ? AND billet_id = ?
        `,
      ).run(memberId, billetId);
    }

    recordAuditEventInDatabase({
      db,
      actorMemberId,
      eventType: assigned ? "member.billet.assigned" : "member.billet.removed",
      entityType: "member",
      entityId: memberId,
      payload: {
        billetId,
        billetName: billet.name,
      },
    });

    return {
      status: assigned ? "assigned" : "removed",
      billets: readMemberBilletsFromDatabase(db, memberId),
    };
  });
}


export async function claimMemberBilletAuthority(
  memberId,
  { actorMemberId = null } = {},
) {
  return withGuildTransaction((db) => {
    const member = db
      .prepare("SELECT id, billets_managed FROM members WHERE id = ? AND status = 'active'")
      .get(memberId);

    if (!member) {
      return { status: "member-not-found", billets: [] };
    }

    if (Boolean(member.billets_managed)) {
      return {
        status: "unchanged",
        billets: readMemberBilletsFromDatabase(db, memberId),
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
      actorMemberId,
      eventType: "member.billet.authority_enabled",
      entityType: "member",
      entityId: memberId,
      payload: {},
    });

    return {
      status: "claimed",
      billets: readMemberBilletsFromDatabase(db, memberId),
    };
  });
}
