import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export async function readGuildMembers() {
  const members = await readRawMembers();

  return members.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
    }),
  );
}

export async function upsertGuildMember(user, permissions = []) {
  if (!user?.id || !user?.username) {
    return null;
  }

  const members = await readRawMembers();
  const existingIndex = members.findIndex((member) => member.id === user.id);
  const now = new Date().toISOString();
  const name = displayName(user);
  const member = {
    id: user.id,
    username: user.username,
    displayName: name,
    initials: initials(name),
    avatarUrl: user.avatarUrl || "",
    permissions: Array.isArray(permissions) ? permissions : [],
    firstSeenAt:
      existingIndex >= 0 ? members[existingIndex].firstSeenAt || now : now,
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
