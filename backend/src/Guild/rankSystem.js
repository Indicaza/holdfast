const RANK_DEFINITIONS = [
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
];

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
