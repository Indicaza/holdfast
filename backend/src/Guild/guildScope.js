import { HOLDFAST_GUILD_ID } from "./Directory/guildDirectoryMigration.js";

// Every guild-owned read and write names its guild. A missing guild is a
// programming error, never a quiet fallback to Holdfast.
export function requireGuildId(guildId) {
  const id = String(guildId || "").trim();

  if (!id) {
    throw new TypeError("A guild id is required for guild-owned data");
  }

  return id;
}

export function isHoldfastGuild(guildId) {
  return guildId === HOLDFAST_GUILD_ID;
}

export { HOLDFAST_GUILD_ID };
