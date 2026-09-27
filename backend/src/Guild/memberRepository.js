import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  emptyMemberProfile,
  isValidTimeZone,
  normalizeMemberProfile,
} from "./memberProfile.js";
import { normalizeGuildRank } from "./rankSystem.js";

const DEFAULT_DATA_FILE = fileURLToPath(
  new URL("../../data/members.json", import.meta.url),
);

function dataFile() {
  if (!process.env.GUILD_DATA_DIR) {
    return DEFAULT_DATA_FILE;
  }

  return path.join(path.resolve(process.env.GUILD_DATA_DIR), "members.json");
}

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

async function readRawMembers() {
  try {
    const raw = await readFile(dataFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeMembers(members) {
  const target = dataFile();
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(members, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function readGuildMembers({ includeDeparted = false } = {}) {
  const members = await readRawMembers();

  return members
    .map((member) => ({
      ...member,
      status: memberStatus(member.status),
      departedAt: member.departedAt || null,
      profile: normalizeMemberProfile(member.profile || emptyMemberProfile()),
    }))
    .filter((member) => includeDeparted || member.status === "active")
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: "base",
      }),
    );
}

export async function markGuildMemberDeparted(memberId) {
  const members = await readRawMembers();
  const index = members.findIndex((member) => member.id === memberId);

  if (index < 0) {
    return null;
  }

  if (memberStatus(members[index].status) === "departed") {
    return {
      ...members[index],
      status: "departed",
      departedAt: members[index].departedAt || null,
      profile: normalizeMemberProfile(
        members[index].profile || emptyMemberProfile(),
      ),
    };
  }

  const now = new Date().toISOString();

  members[index] = {
    ...members[index],
    status: "departed",
    departedAt: now,
    permissions: [],
    updatedAt: now,
  };

  await writeMembers(members);

  return {
    ...members[index],
    profile: normalizeMemberProfile(
      members[index].profile || emptyMemberProfile(),
    ),
  };
}

export async function updateDetectedTimezone(memberId, timezone) {
  if (!isValidTimeZone(timezone)) {
    return { status: "invalid", member: null };
  }

  const members = await readRawMembers();
  const index = members.findIndex((member) => member.id === memberId);

  if (index < 0) {
    return { status: "not-found", member: null };
  }

  const currentProfile = normalizeMemberProfile(
    members[index].profile || emptyMemberProfile(),
  );

  if (
    currentProfile.timezoneSource === "manual" &&
    currentProfile.timezone
  ) {
    return {
      status: "manual",
      member: {
        ...members[index],
        profile: currentProfile,
      },
    };
  }

  if (
    currentProfile.timezone === timezone &&
    currentProfile.timezoneSource === "detected"
  ) {
    return {
      status: "unchanged",
      member: {
        ...members[index],
        profile: currentProfile,
      },
    };
  }

  const now = new Date().toISOString();
  const nextProfile = normalizeMemberProfile({
    ...currentProfile,
    timezone,
    timezoneSource: "detected",
  });

  members[index] = {
    ...members[index],
    profile: nextProfile,
    profileUpdatedAt: now,
    updatedAt: now,
  };

  await writeMembers(members);

  return {
    status: "updated",
    member: {
      ...members[index],
      profile: nextProfile,
    },
  };
}

export async function updateGuildMemberProfile(memberId, profile) {
  const members = await readRawMembers();
  const index = members.findIndex((member) => member.id === memberId);

  if (index < 0) {
    return null;
  }

  const now = new Date().toISOString();
  const nextProfile = normalizeMemberProfile(profile);

  members[index] = {
    ...members[index],
    profile: nextProfile,
    profileUpdatedAt: now,
    updatedAt: now,
  };

  await writeMembers(members);

  return {
    ...members[index],
    profile: nextProfile,
  };
}

export async function upsertGuildMember(user, permissions = []) {
  if (!user?.id || !user?.username) {
    return null;
  }

  const members = await readRawMembers();
  const existingIndex = members.findIndex((member) => member.id === user.id);
  const existing = existingIndex >= 0 ? members[existingIndex] : null;
  const now = new Date().toISOString();
  const name = displayName(user);
  const identity = {
    id: user.id,
    username: user.username,
    displayName: name,
    initials: initials(name),
    avatarUrl: user.avatarUrl || "",
    guildJoinedAt: user.guildJoinedAt || existing?.guildJoinedAt || null,
    rank: memberRank(user.id, existing?.rank),
    status: "active",
    departedAt: null,
    permissions: Array.isArray(permissions) ? permissions : [],
  };

  if (sameMemberIdentity(existing, identity)) {
    return {
      ...existing,
      profile: normalizeMemberProfile(
        existing.profile || emptyMemberProfile(),
      ),
    };
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

  if (existingIndex >= 0) {
    members[existingIndex] = member;
  } else {
    members.push(member);
  }

  await writeMembers(members);
  return member;
}
