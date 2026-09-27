function idSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function resolvePermissions(
  userId,
  memberRoleIds = [],
  env = process.env,
) {
  const permissions = new Set();
  const normalizedUserId = String(userId || "").trim();
  const roleIds = new Set(
    (Array.isArray(memberRoleIds) ? memberRoleIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );

  const ownerIds = idSet(env.GUILD_OWNER_DISCORD_IDS);
  const adminRoleIds = idSet(env.DISCORD_SITE_ADMIN_ROLE_IDS);
  const questRoleIds = idSet(
    env.DISCORD_QUEST_EDITOR_ROLE_IDS,
  );
  const rewardPolicyRoleIds = idSet(
    env.DISCORD_REWARD_POLICY_ROLE_IDS,
  );

  const isOwner = ownerIds.has(normalizedUserId);
  const isAdmin = [...adminRoleIds].some((id) => roleIds.has(id));
  const canEditQuests = [...questRoleIds].some((id) =>
    roleIds.has(id),
  );
  const canEditRewardPolicy = [...rewardPolicyRoleIds].some((id) =>
    roleIds.has(id),
  );

  if (isOwner || isAdmin) {
    permissions.add("site.admin");
    permissions.add("quests.edit");
  }

  if (canEditQuests) {
    permissions.add("quests.edit");
  }

  if (isOwner || canEditRewardPolicy) {
    permissions.add("rewards.policy.edit");
  }

  return [...permissions];
}
