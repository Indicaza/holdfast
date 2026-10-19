import { questScopeAllowsMember } from "../Guild/authorityPolicy.js";
import { resolveMemberAuthorityFromDatabase } from "../Guild/authorityRepository.js";
import { requireGuildId } from "../Guild/guildScope.js";

// The guild's active members who may review this quest.
export function questReviewerMemberIdsInDatabase(
  db,
  guildId,
  quest,
  { permission = "rewards.issue", excludeMemberIds = [] } = {},
) {
  const excluded = new Set(excludeMemberIds.map(String));
  const rows = db
    .prepare(
      `
        SELECT member_id AS id FROM guild_memberships
        WHERE guild_id = ? AND status = 'active'
        ORDER BY member_id
      `,
    )
    .all(requireGuildId(guildId));

  return rows
    .map((row) => String(row.id))
    .filter((memberId) => {
      if (excluded.has(memberId)) return false;

      const authority = resolveMemberAuthorityFromDatabase(db, guildId, memberId);
      return (
        authority.permissions.includes(permission) &&
        questScopeAllowsMember(authority, permission, quest, memberId)
      );
    });
}
