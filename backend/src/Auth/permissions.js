function idSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function resolvePermissions(userId, memberRoleIds = []) {
  const permissions = new Set();
  const roleIds = new Set(memberRoleIds);

  const ownerIds = idSet(process.env.GUILD_OWNER_DISCORD_IDS);
  const adminRoleIds = idSet(process.env.DISCORD_SITE_ADMIN_ROLE_IDS);
  const questRoleIds = idSet(
    process.env.DISCORD_QUEST_EDITOR_ROLE_IDS,
  );
  const rewardPolicyRoleIds = idSet(
    process.env.DISCORD_REWARD_POLICY_ROLE_IDS,
  );

  const isOwner = ownerIds.has(userId);
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

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    if (!req.auth.permissions.includes(permission)) {
      res.status(403).json({ error: "permission_required" });
      return;
    }

    next();
  };
}
