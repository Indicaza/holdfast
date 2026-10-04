import { recordAuditEventInDatabase } from "../Audit/auditRepository.js";
import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { createNotificationInDatabase } from "../Notification/notificationRepository.js";
import {
  emptyMemberProfile,
  isValidTimeZone,
  normalizeMemberProfile,
} from "./memberProfile.js";
import { isGuildRank, normalizeGuildRank } from "./rankSystem.js";
import { readMemberBilletsFromDatabase } from "./billetRepository.js";

function displayName(user) {
  return user.guildNickname || user.globalName || user.username;
}

function idSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function memberRank(userId, existingRank) {
  const ownerIds = idSet(process.env.GUILD_OWNER_DISCORD_IDS);

  if (ownerIds.has(userId)) {
    return "Commander";
  }

  return normalizeGuildRank(existingRank || "Recruit");
}

function sameStringArray(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];

  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function memberStatus(value) {
  return value === "departed" ? "departed" : "active";
}

function sameMemberIdentity(existing, next) {
  if (!existing) {
    return false;
  }

  return (
    existing.username === next.username &&
    existing.displayName === next.displayName &&
    existing.initials === next.initials &&
    (existing.avatarUrl || "") === next.avatarUrl &&
    (existing.guildJoinedAt || null) === next.guildJoinedAt &&
    normalizeGuildRank(existing.rank) === next.rank &&
    Boolean(existing.rankManaged) === Boolean(next.rankManaged) &&
    Boolean(existing.billetsManaged) === Boolean(next.billetsManaged) &&
    memberStatus(existing.status) === next.status &&
    (existing.departedAt || null) === next.departedAt &&
    sameStringArray(existing.permissions, next.permissions)
  );
}

function initials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function jsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function profileFromRows(profileRow, characterRows) {
  return normalizeMemberProfile({
    battleTag: profileRow?.battle_tag || "",
    timezone: profileRow?.timezone || "",
    timezoneSource: profileRow?.timezone_source || "detected",
    availability: profileRow?.availability || "",
    bio: profileRow?.bio || "",
    characters: characterRows.map((row) => ({
      id: row.id,
      name: row.name,
      race: row.race,
      className: row.class_name,
      spec: row.spec,
      professions: jsonArray(row.professions_json),
      isMain: Boolean(row.is_main),
    })),
  });
}

function memberFromRow(db, row) {
  if (!row) {
    return null;
  }

  const profileRow = db
    .prepare("SELECT * FROM member_profiles WHERE member_id = ?")
    .get(row.id);
  const characterRows = db
    .prepare(
      "SELECT * FROM characters WHERE member_id = ? ORDER BY sort_order, id",
    )
    .all(row.id);

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    initials: row.initials,
    avatarUrl: row.avatar_url || "",
    guildJoinedAt: row.guild_joined_at || null,
    rank: normalizeGuildRank(row.rank),
    rankManaged: Boolean(row.rank_managed),
    billetsManaged: Boolean(row.billets_managed),
    status: memberStatus(row.status),
    departedAt: row.departed_at || null,
    permissions: jsonArray(row.permissions_json),
    billets: readMemberBilletsFromDatabase(db, row.id),
    profile: profileFromRows(profileRow, characterRows),
    profileUpdatedAt: row.profile_updated_at || null,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

function readMemberById(db, memberId) {
  const row = db.prepare("SELECT * FROM members WHERE id = ?").get(memberId);
  return memberFromRow(db, row);
}

export function readGuildMembersFromDatabase(
  db,
  { includeDeparted = false } = {},
) {
  const rows = includeDeparted
    ? db
        .prepare("SELECT * FROM members ORDER BY display_name COLLATE NOCASE")
        .all()
    : db
        .prepare(
          "SELECT * FROM members WHERE status = 'active' ORDER BY display_name COLLATE NOCASE",
        )
        .all();

  return rows.map((row) => memberFromRow(db, row));
}

function writeProfile(db, memberId, profile) {
  const normalized = normalizeMemberProfile(profile);

  db.prepare(
    `
      INSERT INTO member_profiles (
        member_id,
        battle_tag,
        timezone,
        timezone_source,
        availability,
        bio
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id) DO UPDATE SET
        battle_tag = excluded.battle_tag,
        timezone = excluded.timezone,
        timezone_source = excluded.timezone_source,
        availability = excluded.availability,
        bio = excluded.bio
    `,
  ).run(
    memberId,
    normalized.battleTag,
    normalized.timezone,
    normalized.timezoneSource,
    normalized.availability,
    normalized.bio,
  );

  db.prepare("DELETE FROM characters WHERE member_id = ?").run(memberId);

  const insertCharacter = db.prepare(
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  normalized.characters.forEach((character, index) => {
    insertCharacter.run(
      character.id,
      memberId,
      character.name,
      character.race,
      character.className,
      character.spec,
      JSON.stringify(character.professions),
      character.isMain ? 1 : 0,
      index,
    );
  });

  return normalized;
}

function writeMemberRow(db, member) {
  db.prepare(
    `
      INSERT INTO members (
        id,
        username,
        display_name,
        initials,
        avatar_url,
        guild_joined_at,
        rank,
        rank_managed,
        billets_managed,
        status,
        departed_at,
        permissions_json,
        profile_updated_at,
        first_seen_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        initials = excluded.initials,
        avatar_url = excluded.avatar_url,
        guild_joined_at = excluded.guild_joined_at,
        rank = excluded.rank,
        rank_managed = excluded.rank_managed,
        billets_managed = excluded.billets_managed,
        status = excluded.status,
        departed_at = excluded.departed_at,
        permissions_json = excluded.permissions_json,
        profile_updated_at = excluded.profile_updated_at,
        first_seen_at = excluded.first_seen_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    member.id,
    member.username,
    member.displayName,
    member.initials,
    member.avatarUrl || "",
    member.guildJoinedAt || null,
    normalizeGuildRank(member.rank),
    member.rankManaged ? 1 : 0,
    member.billetsManaged ? 1 : 0,
    memberStatus(member.status),
    member.departedAt || null,
    JSON.stringify(Array.isArray(member.permissions) ? member.permissions : []),
    member.profileUpdatedAt || null,
    member.firstSeenAt,
    member.updatedAt,
  );
}

export function importMembersIntoDatabase(db, members) {
  if (!Array.isArray(members)) {
    return 0;
  }

  let imported = 0;

  for (const rawMember of members) {
    if (!rawMember?.id || !rawMember?.username) {
      continue;
    }

    const now = new Date().toISOString();
    const name = rawMember.displayName || rawMember.username;
    const member = {
      id: String(rawMember.id),
      username: String(rawMember.username),
      displayName: String(name),
      initials: rawMember.initials || initials(name),
      avatarUrl: rawMember.avatarUrl || "",
      guildJoinedAt: rawMember.guildJoinedAt || null,
      rank: normalizeGuildRank(rawMember.rank || "Recruit"),
      rankManaged: Boolean(rawMember.rankManaged),
      billetsManaged: Boolean(rawMember.billetsManaged),
      status: memberStatus(rawMember.status),
      departedAt: rawMember.departedAt || null,
      permissions: Array.isArray(rawMember.permissions)
        ? rawMember.permissions
        : [],
      profile: normalizeMemberProfile(
        rawMember.profile || emptyMemberProfile(),
      ),
      profileUpdatedAt: rawMember.profileUpdatedAt || null,
      firstSeenAt: rawMember.firstSeenAt || now,
      updatedAt: rawMember.updatedAt || now,
    };

    writeMemberRow(db, member);
    writeProfile(db, member.id, member.profile);
    imported += 1;
  }

  return imported;
}

export async function readGuildMembers(options = {}) {
  return withGuildDatabase((db) =>
    readGuildMembersFromDatabase(db, options),
  );
}

export async function markGuildMemberDeparted(memberId) {
  return withGuildTransaction((db) => {
    const existing = readMemberById(db, memberId);

    if (!existing) {
      return null;
    }

    if (existing.status === "departed") {
      return existing;
    }

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE members
        SET
          status = 'departed',
          departed_at = ?,
          permissions_json = '[]',
          updated_at = ?
        WHERE id = ?
      `,
    ).run(now, now, memberId);

    return readMemberById(db, memberId);
  });
}

export async function updateDetectedTimezone(memberId, timezone) {
  if (!isValidTimeZone(timezone)) {
    return { status: "invalid", member: null };
  }

  return withGuildTransaction((db) => {
    const existing = readMemberById(db, memberId);

    if (!existing) {
      return { status: "not-found", member: null };
    }

    const currentProfile = normalizeMemberProfile(
      existing.profile || emptyMemberProfile(),
    );

    if (
      currentProfile.timezoneSource === "manual" &&
      currentProfile.timezone
    ) {
      return {
        status: "manual",
        member: existing,
      };
    }

    if (
      currentProfile.timezone === timezone &&
      currentProfile.timezoneSource === "detected"
    ) {
      return {
        status: "unchanged",
        member: existing,
      };
    }

    const now = new Date().toISOString();
    const nextProfile = normalizeMemberProfile({
      ...currentProfile,
      timezone,
      timezoneSource: "detected",
    });

    writeProfile(db, memberId, nextProfile);
    db.prepare(
      `
        UPDATE members
        SET profile_updated_at = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(now, now, memberId);

    return {
      status: "updated",
      member: readMemberById(db, memberId),
    };
  });
}

export async function updateGuildMemberRank(
  memberId,
  rank,
  { actorMemberId = null } = {},
) {
  const requestedRank = String(rank || "").trim();

  if (!isGuildRank(requestedRank)) {
    return { status: "invalid", member: null };
  }

  return withGuildTransaction((db) => {
    const existing = readMemberById(db, memberId);

    if (!existing) {
      return { status: "not-found", member: null };
    }

    const ownerIds = idSet(process.env.GUILD_OWNER_DISCORD_IDS);

    if (ownerIds.has(memberId) && requestedRank !== "Commander") {
      return { status: "owner-locked", member: existing };
    }

    if (existing.rank === requestedRank && existing.rankManaged) {
      return { status: "unchanged", member: existing };
    }

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE members
        SET rank = ?, rank_managed = 1, updated_at = ?
        WHERE id = ?
      `,
    ).run(requestedRank, now, memberId);

    recordAuditEventInDatabase({
      db,
      actorMemberId,
      eventType: "member.rank.updated",
      entityType: "member",
      entityId: memberId,
      payload: {
        beforeRank: existing.rank,
        afterRank: requestedRank,
        authorityEnabled: !existing.rankManaged,
      },
    });

    if (existing.rank !== requestedRank && actorMemberId !== memberId) {
      createNotificationInDatabase({
        db,
        recipientMemberId: memberId,
        type: "rank_changed",
        kind: "update",
        title: "Rank changed",
        message: `Your Holdfast rank is now ${requestedRank}.`,
        href: "/members/me",
        entityType: "member",
        entityId: memberId,
        data: {
          beforeRank: existing.rank,
          afterRank: requestedRank,
        },
        dedupeKey: `member-rank:${memberId}`,
        now,
      });
    }

    return {
      status: "updated",
      member: readMemberById(db, memberId),
    };
  });
}

export async function updateGuildMemberProfile(memberId, profile) {
  return withGuildTransaction((db) => {
    const existing = readMemberById(db, memberId);

    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    writeProfile(db, memberId, profile);
    db.prepare(
      `
        UPDATE members
        SET profile_updated_at = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(now, now, memberId);

    return readMemberById(db, memberId);
  });
}

export async function upsertGuildMember(user, permissions = []) {
  if (!user?.id || !user?.username) {
    return null;
  }

  return withGuildTransaction((db) => {
    const existing = readMemberById(db, user.id);
    const now = new Date().toISOString();
    const name = displayName(user);
    const ownerIds = idSet(process.env.GUILD_OWNER_DISCORD_IDS);
    const identity = {
      id: user.id,
      username: user.username,
      displayName: name,
      initials: initials(name),
      avatarUrl: user.avatarUrl || "",
      guildJoinedAt: user.guildJoinedAt || existing?.guildJoinedAt || null,
      rank: memberRank(user.id, existing?.rank),
      rankManaged: ownerIds.has(user.id)
        ? true
        : existing
          ? Boolean(existing.rankManaged)
          : true,
      billetsManaged: existing
        ? Boolean(existing.billetsManaged)
        : true,
      status: "active",
      departedAt: null,
      permissions: Array.isArray(permissions) ? permissions : [],
    };

    if (sameMemberIdentity(existing, identity)) {
      return existing;
    }

    const member = {
      ...identity,
      profile: normalizeMemberProfile(
        existing?.profile || emptyMemberProfile(),
      ),
      profileUpdatedAt: existing?.profileUpdatedAt || null,
      firstSeenAt: existing?.firstSeenAt || now,
      updatedAt: now,
    };

    writeMemberRow(db, member);

    if (!existing) {
      writeProfile(db, member.id, member.profile);
    }

    return readMemberById(db, member.id);
  });
}
