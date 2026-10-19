// Holdfast's ladder. Every guild keeps its own ladder in rank_authority;
// this one seeds Holdfast's rows and backs the Holdfast-only helpers below
// (Discord rank sync, legacy callers).
export const HOLDFAST_RANK_DEFINITIONS = Object.freeze([
  { name: "Recruit", category: "enlisted", order: 0, leadership: false },
  { name: "Private", category: "enlisted", order: 1, leadership: false },
  { name: "Corporal", category: "enlisted", order: 2, leadership: false },
  { name: "Sergeant", category: "enlisted", order: 3, leadership: true },
  { name: "Master Sergeant", category: "enlisted", order: 4, leadership: true },
  { name: "Sergeant Major", category: "enlisted", order: 5, leadership: true },
  { name: "Lieutenant", category: "officer", order: 6, leadership: true },
  { name: "Captain", category: "officer", order: 7, leadership: true },
  { name: "Major", category: "officer", order: 8, leadership: true },
  { name: "Commander", category: "officer", order: 9, leadership: true },
]);

const RANK_DEFINITIONS = HOLDFAST_RANK_DEFINITIONS;

const RANK_BY_NAME = new Map(
  RANK_DEFINITIONS.map((rank) => [rank.name, rank]),
);

const NEXT_ENLISTED_REP_FLOOR = {
  Recruit: {
    rank: "Corporal",
    threshold: 3000,
    label: "Corporal contribution breakpoint",
  },
  Private: {
    rank: "Corporal",
    threshold: 3000,
    label: "Corporal contribution breakpoint",
  },
  Corporal: {
    rank: "Sergeant",
    threshold: 9000,
    label: "Sergeant Rep floor",
  },
  Sergeant: {
    rank: "Master Sergeant",
    threshold: 21000,
    label: "Master Sergeant Rep floor",
  },
  "Master Sergeant": {
    rank: "Sergeant Major",
    threshold: 42000,
    label: "Sergeant Major Rep floor",
  },
};

const PREVIOUS_REP_FLOOR = {
  Recruit: 0,
  Private: 0,
  Corporal: 3000,
  Sergeant: 9000,
  "Master Sergeant": 21000,
};

export function isGuildRank(value) {
  return RANK_BY_NAME.has(String(value || "").trim());
}

export function normalizeGuildRank(value) {
  const rank = String(value || "").trim();
  return RANK_BY_NAME.has(rank) ? rank : "Recruit";
}

export function guildRankMetadata(value) {
  const rank = RANK_BY_NAME.get(normalizeGuildRank(value));

  return {
    name: rank.name,
    category: rank.category,
    order: rank.order,
    isOfficer: rank.category === "officer",
    isLeadership: rank.leadership,
  };
}

export function guildRankOrder(value) {
  return guildRankMetadata(value).order;
}

export function guildRanksThrough(value) {
  const ceiling = guildRankOrder(value);
  return RANK_DEFINITIONS
    .filter((rank) => rank.order <= ceiling)
    .map((rank) => rank.name);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function repProgressionForRank(rankValue, lifetimeRepValue) {
  const rank = normalizeGuildRank(rankValue);
  const meta = guildRankMetadata(rank);
  const lifetimeRep = Math.max(0, Number(lifetimeRepValue) || 0);

  if (meta.isOfficer) {
    const scale = 42000;

    return {
      mode: "lifetime",
      lifetimeRep,
      currentRank: rank,
      nextRank: null,
      label: "Lifetime Rep",
      detail: "Officer progression is separate from Rep.",
      segmentStart: 0,
      segmentEnd: scale,
      segmentEarned: Math.min(lifetimeRep, scale),
      segmentSize: scale,
      remaining: null,
      progress: clamp(lifetimeRep / scale, 0, 1),
      thresholdMet: lifetimeRep >= scale,
    };
  }

  if (rank === "Sergeant Major") {
    return {
      mode: "lifetime",
      lifetimeRep,
      currentRank: rank,
      nextRank: null,
      label: "Lifetime Rep",
      detail: "All enlisted Rep floors are met. Rep continues accumulating.",
      segmentStart: 0,
      segmentEnd: 42000,
      segmentEarned: Math.min(lifetimeRep, 42000),
      segmentSize: 42000,
      remaining: null,
      progress: clamp(lifetimeRep / 42000, 0, 1),
      thresholdMet: lifetimeRep >= 42000,
    };
  }

  const target = NEXT_ENLISTED_REP_FLOOR[rank];
  const segmentStart = PREVIOUS_REP_FLOOR[rank] || 0;
  const segmentEnd = target.threshold;
  const segmentSize = Math.max(1, segmentEnd - segmentStart);
  const segmentEarned = clamp(lifetimeRep - segmentStart, 0, segmentSize);
  const thresholdMet = lifetimeRep >= segmentEnd;

  return {
    mode: "eligibility",
    lifetimeRep,
    currentRank: rank,
    nextRank: target.rank,
    label: target.label,
    detail: thresholdMet
      ? "Rep requirement met. Promotion is still a leadership decision."
      : `${Math.max(0, segmentEnd - lifetimeRep).toLocaleString()} Rep remaining.`,
    segmentStart,
    segmentEnd,
    segmentEarned,
    segmentSize,
    remaining: Math.max(0, segmentEnd - lifetimeRep),
    progress: clamp(segmentEarned / segmentSize, 0, 1),
    thresholdMet,
  };
}

export const GUILD_RANKS = RANK_DEFINITIONS.map((rank) => rank.name);

// A guild's rank ladder: ranks ordered from entry (lowest) to top. Unknown or
// empty rank names normalize to the entry rank, the way Holdfast's
// unknown ranks become Recruit.
export function createRankLadder(definitions, { holdfast = false } = {}) {
  const ranks = [...(Array.isArray(definitions) ? definitions : [])]
    .map((rank) => ({
      name: String(rank.name),
      category: rank.category || "member",
      order: Number(rank.order) || 0,
      leadership: Boolean(rank.leadership),
    }))
    .sort((left, right) => left.order - right.order);

  if (!ranks.length) {
    throw new Error("A guild rank ladder needs at least one rank");
  }

  const byName = new Map(ranks.map((rank) => [rank.name, rank]));
  const entry = ranks[0].name;
  const top = ranks[ranks.length - 1].name;

  const isRank = (value) => byName.has(String(value || "").trim());
  const normalize = (value) => {
    const rank = String(value || "").trim();
    return byName.has(rank) ? rank : entry;
  };
  const metadata = (value) => {
    const rank = byName.get(normalize(value));
    return {
      name: rank.name,
      category: rank.category,
      order: rank.order,
      isOfficer: rank.category === "officer",
      isLeadership: rank.leadership,
    };
  };
  const order = (value) => byName.get(normalize(value)).order;

  return Object.freeze({
    holdfast,
    names: ranks.map((rank) => rank.name),
    definitions: ranks,
    entry,
    top,
    isRank,
    normalize,
    metadata,
    order,
    through: (value) =>
      ranks.filter((rank) => rank.order <= order(value)).map((rank) => rank.name),
  });
}

export const HOLDFAST_RANK_LADDER = createRankLadder(RANK_DEFINITIONS, {
  holdfast: true,
});

// Holdfast's Rep floors only describe Holdfast's ladder. Other guilds show
// lifetime Rep against their own ranks.
export function repProgressionForLadder(ladder, rankValue, lifetimeRepValue) {
  if (!ladder || ladder.holdfast) {
    return repProgressionForRank(rankValue, lifetimeRepValue);
  }

  const rank = ladder.normalize(rankValue);
  const lifetimeRep = Math.max(0, Number(lifetimeRepValue) || 0);
  const scale = 10000;

  return {
    mode: "lifetime",
    lifetimeRep,
    currentRank: rank,
    nextRank: null,
    label: "Lifetime Rep",
    detail: "Promotion is a leadership decision.",
    segmentStart: 0,
    segmentEnd: scale,
    segmentEarned: Math.min(lifetimeRep, scale),
    segmentSize: scale,
    remaining: null,
    progress: clamp(lifetimeRep / scale, 0, 1),
    thresholdMet: lifetimeRep >= scale,
  };
}
