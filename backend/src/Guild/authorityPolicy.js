import {
  GUILD_RANKS,
  guildRankOrder,
  isGuildRank,
  normalizeGuildRank,
} from "./rankSystem.js";

export const QUEST_SCOPES = ["own", "all"];

export const REWARD_LIMIT_KEYS = [
  "repPerObjective",
  "marksPerObjective",
  "marksPerQuest",
];

export const CAPABILITY_DEFINITIONS = [
  {
    id: "site.admin",
    label: "Website admin",
    description:
      "Reserved for general website administration controls as they are added.",
    status: "reserved",
  },
  {
    id: "quests.create",
    label: "Create quests",
    description: "Create new guild quests.",
  },
  {
    id: "quests.edit",
    label: "Edit quests",
    description: "Edit quest content within the configured quest scope.",
  },
  {
    id: "quests.publish",
    label: "Publish quests",
    description:
      "Publish, archive, restore, and feature quests within the configured quest scope.",
  },
  {
    id: "rewards.approve",
    label: "Approve rewards",
    description:
      "Approve proposed Rep, Marks, and item rewards within the configured reward bracket.",
  },
  {
    id: "rewards.issue",
    label: "Issue rewards",
    description:
      "Complete objectives and issue approved rewards within the configured reward bracket.",
  },
  {
    id: "rewards.policy.edit",
    label: "Guild economy policy",
    description:
      "Change the guild-wide reward policy and absolute Rep/Marks guardrails.",
  },
  {
    id: "members.rank.manage",
    label: "Promote & demote",
    description:
      "Change member rank, limited by the configured member-management ceiling.",
  },
  {
    id: "members.billet.assign",
    label: "Assign billets",
    description:
      "Assign or remove billets within the holder's authority and member-management ceiling.",
  },
  {
    id: "billets.create",
    label: "Create billets",
    description:
      "Create new Holdfast billets and their corresponding Discord roles.",
  },
  {
    id: "billets.edit",
    label: "Edit billet details",
    description:
      "Change billet names and responsibility descriptions. Infrastructure billet names remain protected.",
  },
  {
    id: "billets.delete",
    label: "Delete billets",
    description:
      "Delete custom billets and remove their Holdfast Discord roles.",
  },
  {
    id: "audit.view",
    label: "Audit history",
    description: "View administrative audit history.",
  },
  {
    id: "discord.manage",
    label: "Discord admin",
    description:
      "Reserved for future Holdfast-controlled Discord configuration from the website.",
    status: "reserved",
  },
  {
    id: "authority.manage",
    label: "Authority design",
    description:
      "Define rank and billet permission scopes without granting more authority than you possess.",
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

export const QUEST_SCOPED_CAPABILITIES = [
  "quests.create",
  "quests.edit",
  "quests.publish",
  "rewards.approve",
  "rewards.issue",
];

export const REWARD_CAPABILITIES = [
  "rewards.approve",
  "rewards.issue",
];

const MEMBER_MANAGEMENT_CAPABILITY_SET = new Set(
  MEMBER_MANAGEMENT_CAPABILITIES,
);
const QUEST_SCOPED_CAPABILITY_SET = new Set(QUEST_SCOPED_CAPABILITIES);
const REWARD_CAPABILITY_SET = new Set(REWARD_CAPABILITIES);

const ZERO_REWARD_LIMITS = Object.freeze({
  repPerObjective: 0,
  marksPerObjective: 0,
  marksPerQuest: 0,
});

function scope(
  permissions = [],
  {
    maxManagedRank = null,
    questScope = "own",
    rewardLimits = ZERO_REWARD_LIMITS,
  } = {},
) {
  return {
    permissions,
    maxManagedRank,
    questScope,
    rewardLimits,
  };
}

export const DEFAULT_RANK_AUTHORITY = {
  Recruit: scope(),
  Private: scope(),
  Corporal: scope(["quests.create", "quests.edit"]),
  Sergeant: scope(["quests.create", "quests.edit"]),
  "Master Sergeant": scope(["quests.create", "quests.edit"]),
  "Sergeant Major": scope(["quests.create", "quests.edit"]),
  Lieutenant: scope(
    [
      "site.admin",
      "quests.create",
      "quests.edit",
      "quests.publish",
      "rewards.approve",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
    ],
    {
      maxManagedRank: "Sergeant",
      questScope: "all",
      rewardLimits: {
        repPerObjective: 250,
        marksPerObjective: 10,
        marksPerQuest: 50,
      },
    },
  ),
  Captain: scope(
    [
      "site.admin",
      "quests.create",
      "quests.edit",
      "quests.publish",
      "rewards.approve",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
    ],
    {
      maxManagedRank: "Master Sergeant",
      questScope: "all",
      rewardLimits: {
        repPerObjective: 500,
        marksPerObjective: 25,
        marksPerQuest: 100,
      },
    },
  ),
  Major: scope(
    [
      "site.admin",
      "quests.create",
      "quests.edit",
      "quests.publish",
      "rewards.approve",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
    ],
    {
      maxManagedRank: "Sergeant Major",
      questScope: "all",
      rewardLimits: {
        repPerObjective: 750,
        marksPerObjective: 50,
        marksPerQuest: 250,
      },
    },
  ),
  Commander: scope(CAPABILITY_IDS, {
    maxManagedRank: "Commander",
    questScope: "all",
    rewardLimits: {
      repPerObjective: 1000,
      marksPerObjective: 1000,
      marksPerQuest: 1000,
    },
  }),
};

export const DEFAULT_BILLET_AUTHORITY = {
  Steward: scope(
    [
      "site.admin",
      "quests.create",
      "quests.edit",
      "quests.publish",
      "rewards.approve",
      "rewards.issue",
      "rewards.policy.edit",
      "members.rank.manage",
      "members.billet.assign",
      "audit.view",
      "discord.manage",
    ],
    {
      maxManagedRank: "Sergeant Major",
      questScope: "all",
      rewardLimits: {
        repPerObjective: 500,
        marksPerObjective: 25,
        marksPerQuest: 100,
      },
    },
  ),
  Quartermaster: scope(["rewards.policy.edit"]),
  "Raid Leader": scope(["quests.create", "quests.edit"]),
  "PvP Lead": scope(["quests.create", "quests.edit"]),
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

export function normalizeQuestScope(value) {
  return value === "all" ? "all" : "own";
}

export function normalizeRewardLimits(value) {
  const input = value && typeof value === "object" ? value : {};

  return {
    repPerObjective: nonNegativeInteger(input.repPerObjective),
    marksPerObjective: nonNegativeInteger(input.marksPerObjective),
    marksPerQuest: nonNegativeInteger(input.marksPerQuest),
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

export function rewardLimitsAreValid(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return REWARD_LIMIT_KEYS.every((key) => {
    const number = Number(value[key]);
    return (
      Number.isInteger(number) &&
      number >= 0 &&
      number <= 1000000
    );
  });
}

export function scopeProvidesMemberManagement(scopeValue) {
  return normalizeCapabilityList(scopeValue?.permissions).some((permission) =>
    MEMBER_MANAGEMENT_CAPABILITY_SET.has(permission),
  );
}

export function scopeProvidesQuestAuthority(scopeValue) {
  return normalizeCapabilityList(scopeValue?.permissions).some((permission) =>
    QUEST_SCOPED_CAPABILITY_SET.has(permission),
  );
}

export function scopeProvidesRewardAuthority(scopeValue) {
  return normalizeCapabilityList(scopeValue?.permissions).some((permission) =>
    REWARD_CAPABILITY_SET.has(permission),
  );
}

export function authorityScope(
  permissions,
  maxManagedRank = null,
  options = {},
) {
  return {
    permissions: normalizeCapabilityList(permissions),
    maxManagedRank: normalizeManagedRank(maxManagedRank),
    questScope: normalizeQuestScope(options.questScope),
    rewardLimits: normalizeRewardLimits(options.rewardLimits),
  };
}

function widerQuestScope(left, right) {
  return left === "all" || right === "all" ? "all" : "own";
}

function maxRewardLimits(left, right) {
  const a = normalizeRewardLimits(left);
  const b = normalizeRewardLimits(right);

  return {
    repPerObjective: Math.max(a.repPerObjective, b.repPerObjective),
    marksPerObjective: Math.max(a.marksPerObjective, b.marksPerObjective),
    marksPerQuest: Math.max(a.marksPerQuest, b.marksPerQuest),
  };
}

function emptyQuestScopes() {
  return Object.fromEntries(
    QUEST_SCOPED_CAPABILITIES.map((permission) => [permission, null]),
  );
}

export function mergeAuthorityScopes(scopes) {
  const permissions = new Set();
  let ceiling = null;
  let ceilingOrder = -1;
  const questScopes = emptyQuestScopes();
  const rewardLimits = {
    approve: { ...ZERO_REWARD_LIMITS },
    issue: { ...ZERO_REWARD_LIMITS },
  };

  for (const scopeValue of Array.isArray(scopes) ? scopes : []) {
    const scopePermissions = normalizeCapabilityList(scopeValue?.permissions);

    for (const permission of scopePermissions) {
      permissions.add(permission);

      if (QUEST_SCOPED_CAPABILITY_SET.has(permission)) {
        questScopes[permission] = questScopes[permission]
          ? widerQuestScope(
              questScopes[permission],
              normalizeQuestScope(scopeValue?.questScope),
            )
          : normalizeQuestScope(scopeValue?.questScope);
      }
    }

    const candidate = scopeProvidesMemberManagement(scopeValue)
      ? normalizeManagedRank(scopeValue?.maxManagedRank)
      : null;

    if (candidate && guildRankOrder(candidate) > ceilingOrder) {
      ceiling = candidate;
      ceilingOrder = guildRankOrder(candidate);
    }

    if (scopePermissions.includes("rewards.approve")) {
      rewardLimits.approve = maxRewardLimits(
        rewardLimits.approve,
        scopeValue?.rewardLimits,
      );
    }

    if (scopePermissions.includes("rewards.issue")) {
      rewardLimits.issue = maxRewardLimits(
        rewardLimits.issue,
        scopeValue?.rewardLimits,
      );
    }
  }

  return {
    permissions: [...permissions].sort(),
    maxManagedRank: ceiling,
    questScopes,
    rewardLimits,
  };
}

export function fullOwnerAuthority(globalRewardLimits = {}) {
  const limits = normalizeRewardLimits(globalRewardLimits);

  return {
    permissions: [...CAPABILITY_IDS],
    maxManagedRank: "Commander",
    questScopes: Object.fromEntries(
      QUEST_SCOPED_CAPABILITIES.map((permission) => [permission, "all"]),
    ),
    rewardLimits: {
      approve: limits,
      issue: limits,
    },
    isOwner: true,
  };
}

function questScopeAllows(actorScope, requestedScope) {
  if (requestedScope !== "all") return true;
  return actorScope === "all";
}

function limitsWithin(candidate, available) {
  const requested = normalizeRewardLimits(candidate);
  const ceiling = normalizeRewardLimits(available);

  return REWARD_LIMIT_KEYS.every(
    (key) => requested[key] <= ceiling[key],
  );
}

export function canDelegateScope(actorAuthority, candidateScope) {
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

  if (requestedCeiling) {
    const actorCeiling = normalizeManagedRank(actorAuthority?.maxManagedRank);

    if (
      !actorCeiling ||
      guildRankOrder(requestedCeiling) > guildRankOrder(actorCeiling)
    ) {
      return false;
    }
  }

  const requestedQuestScope = normalizeQuestScope(candidateScope?.questScope);

  for (const permission of candidatePermissions) {
    if (
      QUEST_SCOPED_CAPABILITY_SET.has(permission) &&
      !questScopeAllows(
        actorAuthority?.questScopes?.[permission],
        requestedQuestScope,
      )
    ) {
      return false;
    }
  }

  const candidateLimits = normalizeRewardLimits(candidateScope?.rewardLimits);

  if (
    candidatePermissions.includes("rewards.approve") &&
    !limitsWithin(candidateLimits, actorAuthority?.rewardLimits?.approve)
  ) {
    return false;
  }

  if (
    candidatePermissions.includes("rewards.issue") &&
    !limitsWithin(candidateLimits, actorAuthority?.rewardLimits?.issue)
  ) {
    return false;
  }

  return true;
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

export function questScopeAllowsMember(
  authority,
  permission,
  quest,
  memberId,
) {
  if (!authority?.permissions?.includes(permission)) {
    return false;
  }

  const scopeValue = authority?.questScopes?.[permission];

  return (
    scopeValue === "all" ||
    (scopeValue === "own" &&
      Boolean(memberId) &&
      quest?.createdByMemberId === memberId)
  );
}

export function rewardLimitsFor(authority, permission) {
  if (permission === "rewards.approve") {
    return normalizeRewardLimits(authority?.rewardLimits?.approve);
  }

  if (permission === "rewards.issue") {
    return normalizeRewardLimits(authority?.rewardLimits?.issue);
  }

  return { ...ZERO_REWARD_LIMITS };
}

export const zeroRewardLimits = ZERO_REWARD_LIMITS;
