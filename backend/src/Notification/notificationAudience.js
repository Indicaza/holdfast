import { questScopeAllowsMember } from "../Guild/authorityPolicy.js";
import { resolveMemberAuthorityFromDatabase } from "../Guild/authorityRepository.js";

export function questReviewerMemberIdsInDatabase(
  db,
  quest,
  { permission = "rewards.issue", excludeMemberIds = [] } = {},
) {
  const excluded = new Set(excludeMemberIds.map(String));
  const rows = db
    .prepare("SELECT id FROM members WHERE status = 'active' ORDER BY id")
    .all();

  return rows
    .map((row) => String(row.id))
    .filter((memberId) => {
      if (excluded.has(memberId)) return false;

      const authority = resolveMemberAuthorityFromDatabase(db, memberId);
      return (
        authority.permissions.includes(permission) &&
        questScopeAllowsMember(authority, permission, quest, memberId)
      );
    });
}
