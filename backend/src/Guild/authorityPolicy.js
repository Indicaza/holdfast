import {
  GUILD_RANKS,
  guildRankOrder,
  isGuildRank,
  normalizeGuildRank,
} from "./rankSystem.js";

export const CAPABILITY_DEFINITIONS = [
  {
    id: "site.admin",
    label: "Website admin",
    description: "Manage Holdfast website operations and protected guild controls.",
  },
  {
    id: "quests.edit",
    label: "Quest creation & editing",
    description: "Create, edit, organize, and publish guild quests.",
  },
  {
    id: "rewards.issue",
    label: "Issue quest rewards",
    description: "Complete objectives and issue their configured Rep, Marks, and item rewards.",
  },
  {
    id: "rewards.policy.edit",
    label: "Reward policy",
    description: "Change reward policy text and Rep/Marks limits.",
  },
  {
    id: "members.rank.manage",
    label: "Promote & demote",
    description: "Change member rank, limited by the configured promotion ceiling.",
  },
  {
    id: "members.billet.assign",
    label: "Assign billets",
    description: "Assign or remove billets within the holder's authority and member-management ceiling.",
  },
  {
    id: "audit.view",
    label: "Audit history",
    description: "View administrative audit history.",
  },
  {
    id: "discord.manage",
    label: "Discord admin",
    description: "Manage Holdfast-controlled Discord configuration through the website.",
  },
  {
    id: "authority.manage",
    label: "Authority design",
    description: "Define rank and billet permission scopes without granting more authority than you possess.",
  },
];

export const CAPABILITY_IDS = CAPABILITY_DEFINITIONS.map(
  (capability) => capability.id,
);

const CAPABILITY_SET = new Set(CAPABILITY_IDS);

export const MEMBER_MANAGEMENT_CAPABILITIES = [
  "members.rank.manage",
  "members.billet.assign",
];

const MEMBER_MANAGEMENT_CAPABILITY_SET = new Set(
  MEMBER_MANAGEMENT_CAPABILITIES,
);

export const DEFAULT_RANK_AUTHORITY = {
  Recruit: { permissions: [], maxManagedRank: null },
  Private: { permissions: [], maxManagedRank: null },
  Corporal: {
    permissions: ["quests.edit", "rewards.issue"],
    maxManagedRank: null,
  },
  Sergeant: {
    permissions: ["quests.edit", "rewards.issue"],
    maxManagedRank: null,
  },
  "Master Sergeant": {
    permissions: ["quests.edit", "rewards.issue"],
    maxManagedRank: null,
  },
  "Sergeant Major": {
    permissions: ["quests.edit", "rewards.issue"],
    maxManagedRank: null,
  },
  Lieutenant: {
    permissions: [
      "site.admin",
      "quests.edit",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
    ],
    maxManagedRank: "Sergeant",
  },
  Captain: {
    permissions: [
      "site.admin",
      "quests.edit",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
    ],
    maxManagedRank: "Master Sergeant",
  },
  Major: {
    permissions: [
      "site.admin",
      "quests.edit",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
    ],
    maxManagedRank: "Sergeant Major",
  },
  Commander: {
    permissions: CAPABILITY_IDS,
    maxManagedRank: "Commander",
  },
};

export const DEFAULT_BILLET_AUTHORITY = {
  Steward: {
    permissions: [
      "site.admin",
      "quests.edit",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
      "discord.manage",
    ],
    maxManagedRank: "Sergeant Major",
  },
  Quartermaster: {
    permissions: ["rewards.policy.edit"],
    maxManagedRank: null,
  },
  "Raid Leader": {
    permissions: ["quests.edit", "rewards.issue"],
    maxManagedRank: null,
  },
  "PvP Lead": {
    permissions: ["quests.edit", "rewards.issue"],
    maxManagedRank: null,
  },
};

export function normalizeCapabilityList(value) {
  const source = Array.isArray(value) ? value : [];

  return [
    ...new Set(
      source
        .map((permission) => String(permission || "").trim())
        .filter((permission) => CAPABILITY_SET.has(permission)),
    ),
  ].sort();
}

export function capabilityListIsValid(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (permission) =>
        typeof permission === "string" &&
        CAPABILITY_SET.has(permission.trim()),
    )
  );
}

export function normalizeManagedRank(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return isGuildRank(value) ? normalizeGuildRank(value) : null;
}

export function scopeProvidesMemberManagement(scope) {
  return normalizeCapabilityList(scope?.permissions).some((permission) =>
    MEMBER_MANAGEMENT_CAPABILITY_SET.has(permission),
  );
}

export function authorityScope(permissions, maxManagedRank = null) {
  return {
    permissions: normalizeCapabilityList(permissions),
    maxManagedRank: normalizeManagedRank(maxManagedRank),
  };
}

export function mergeAuthorityScopes(scopes) {
  const permissions = new Set();
  let ceiling = null;
  let ceilingOrder = -1;

  // Authority is additive: no rank or billet can erase a permission granted
  // by another source. The shared member-management ceiling is the highest
  // valid ceiling from a scope that actually grants member-management power.
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    for (const permission of normalizeCapabilityList(scope?.permissions)) {
      permissions.add(permission);
    }

    const candidate = scopeProvidesMemberManagement(scope)
      ? normalizeManagedRank(scope?.maxManagedRank)
      : null;

    if (candidate && guildRankOrder(candidate) > ceilingOrder) {
      ceiling = candidate;
      ceilingOrder = guildRankOrder(candidate);
    }
  }

  return {
    permissions: [...permissions].sort(),
    maxManagedRank: ceiling,
  };
}

export function fullOwnerAuthority() {
  return {
    permissions: [...CAPABILITY_IDS],
    maxManagedRank: "Commander",
    isOwner: true,
  };
}

export function canDelegateScope(actorAuthority, candidateScope) {
  if (actorAuthority?.isOwner) {
    return true;
  }

  const actorPermissions = new Set(
    normalizeCapabilityList(actorAuthority?.permissions),
  );
  const candidatePermissions = normalizeCapabilityList(
    candidateScope?.permissions,
  );

  if (
    candidatePermissions.some(
      (permission) => !actorPermissions.has(permission),
    )
  ) {
    return false;
  }

  const requestedCeiling = normalizeManagedRank(
    candidateScope?.maxManagedRank,
  );

  if (!requestedCeiling) {
    return true;
  }

  const actorCeiling = normalizeManagedRank(actorAuthority?.maxManagedRank);

  if (!actorCeiling) {
    return false;
  }

  return guildRankOrder(requestedCeiling) <= guildRankOrder(actorCeiling);
}

export function canManageRankValue(actorAuthority, rank) {
  if (actorAuthority?.isOwner) {
    return true;
  }

  const ceiling = normalizeManagedRank(actorAuthority?.maxManagedRank);

  if (!ceiling || !isGuildRank(rank)) {
    return false;
  }

  return guildRankOrder(rank) <= guildRankOrder(ceiling);
}

export function manageableRanks(actorAuthority) {
  if (actorAuthority?.isOwner) {
    return [...GUILD_RANKS];
  }

  return GUILD_RANKS.filter((rank) =>
    canManageRankValue(actorAuthority, rank),
  );
}
