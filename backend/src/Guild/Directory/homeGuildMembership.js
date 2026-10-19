import { HOLDFAST_GUILD_ID } from "./guildDirectoryMigration.js";

// Holdfast's Discord server is Holdfast's roster: an active member row (one
// in that server) the site has never placed in a guild belongs to Holdfast,
// and leaving that server leaves Holdfast. A player who signed in from
// outside the server has a departed row and no guild. A player who joined or
// founded another guild keeps that guild. Called wherever a member row is
// written.
export function syncHomeGuildMembershipInDatabase(db, member, now = new Date().toISOString()) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'guild_memberships'").get();
  if (!exists) return;

  if (member.status === "departed") {
    db.prepare(`
      UPDATE guild_memberships SET status = 'departed', departed_at = ?
      WHERE guild_id = ? AND member_id = ? AND status = 'active'
    `).run(member.departedAt || now, HOLDFAST_GUILD_ID, member.id);
    return;
  }

  // Holdfast's rank arrives with the member row (sign-in or legacy import)
  // and is kept on the Holdfast membership.
  const rank = String(member.rank || "");

  if (db.prepare("SELECT 1 FROM guild_memberships WHERE member_id = ? LIMIT 1").get(member.id)) {
    db.prepare(`
      UPDATE guild_memberships SET rank = ?
      WHERE guild_id = ? AND member_id = ? AND status = 'active'
    `).run(rank, HOLDFAST_GUILD_ID, member.id);
    return;
  }
  db.prepare(`
    INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at, rank) VALUES (?, ?, 'member', 'active', ?, ?)
  `).run(HOLDFAST_GUILD_ID, member.id, member.guildJoinedAt || member.firstSeenAt || now, rank);
}
