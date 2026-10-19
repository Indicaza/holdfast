// What a player may do in their own guild comes from their
// guild_memberships.role, not from Holdfast's Discord roles or env lists.
// These permissions only ever apply to the guild the membership is in.
const GUILD_ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(["guild.listing.edit", "guild.sisters.manage"]),
  officer: Object.freeze(["guild.listing.edit", "guild.sisters.manage"]),
  member: Object.freeze([]),
});

export function guildRolePermissions(role) {
  return [...(GUILD_ROLE_PERMISSIONS[role] || [])];
}

function hasMembershipTable(db) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'guild_memberships'").get(),
  );
}

// The player's one active guild with their role and the permissions it
// grants there, or null when they are not in a guild.
export function readMemberGuildAuthorityFromDatabase(db, memberId) {
  if (!hasMembershipTable(db)) return null;

  const row = db.prepare(`
    SELECT g.id, g.slug, g.name, gm.role
    FROM guild_memberships gm JOIN guilds g ON g.id = gm.guild_id
    WHERE gm.member_id = ? AND gm.status = 'active'
    LIMIT 1
  `).get(String(memberId || ""));

  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    permissions: guildRolePermissions(row.role),
  };
}

export function memberHasGuildPermissionInDatabase(db, guildId, memberId, permission) {
  const guild = readMemberGuildAuthorityFromDatabase(db, memberId);
  return Boolean(guild && guild.id === guildId && guild.permissions.includes(permission));
}
