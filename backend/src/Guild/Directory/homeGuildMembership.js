import { HOLDFAST_GUILD_ID } from "./guildDirectoryMigration.js";

// Members still sign in through Holdfast's Discord server, so a member the
// site has never placed in a guild belongs to Holdfast, and leaving that
// server leaves Holdfast. A player who joined or founded another guild keeps
// that guild. Called wherever a member row is written.
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

  if (db.prepare("SELECT 1 FROM guild_memberships WHERE member_id = ? LIMIT 1").get(member.id)) return;
  db.prepare(`
    INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at) VALUES (?, ?, 'member', 'active', ?)
  `).run(HOLDFAST_GUILD_ID, member.id, member.guildJoinedAt || member.firstSeenAt || now);
}
