// Where a member stands on Rep: the bar's fill, its scale and the sentence
// under it. Enlisted ranks fill toward the next rank's Rep floor; officers
// (appointed, not promoted by Rep) fill toward service milestones.

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString()
}

function fallbackRepProgression(rank, lifetimeRep) {
  const rep = Math.max(0, Number(lifetimeRep) || 0)
  const floors = {
    Recruit: { start: 0, end: 3000, nextRank: 'Corporal', label: 'Corporal breakpoint' },
    Private: { start: 0, end: 3000, nextRank: 'Corporal', label: 'Corporal breakpoint' },
    Corporal: { start: 3000, end: 9000, nextRank: 'Sergeant', label: 'Sergeant Rep floor' },
    Sergeant: { start: 9000, end: 21000, nextRank: 'Master Sergeant', label: 'Master Sergeant Rep floor' },
    'Master Sergeant': { start: 21000, end: 42000, nextRank: 'Sergeant Major', label: 'Sergeant Major Rep floor' },
  }

  const target = floors[rank]

  if (!target) {
    return {
      mode: 'lifetime',
      lifetimeRep: rep,
      segmentStart: 0,
      segmentEnd: 42000,
      segmentSize: 42000,
      remaining: null,
      progress: Math.min(1, rep / 42000),
      thresholdMet: rep >= 42000,
      nextRank: null,
      label: 'Lifetime Rep',
      detail:
        rank === 'Sergeant Major'
          ? 'All enlisted Rep floors are met. Rep continues accumulating.'
          : 'Officer progression is separate from Rep.',
    }
  }

  const segmentSize = target.end - target.start
  const segmentEarned = Math.min(
    segmentSize,
    Math.max(0, rep - target.start),
  )

  return {
    mode: 'eligibility',
    lifetimeRep: rep,
    segmentStart: target.start,
    segmentEnd: target.end,
    segmentSize,
    remaining: Math.max(0, target.end - rep),
    progress: segmentEarned / segmentSize,
    thresholdMet: rep >= target.end,
    nextRank: target.nextRank,
    label: target.label,
    detail:
      rep >= target.end
        ? 'Rep requirement met. Promotion is still a leadership decision.'
        : `${formatNumber(target.end - rep)} Rep remaining.`,
  }
}


function officerRepMilestone(lifetimeRep) {
  const rep = Math.max(0, Number(lifetimeRep) || 0)
  const milestones = [3000, 9000, 21000, 42000]
  const next = milestones.find((value) => rep < value)

  if (!next) {
    return {
      mode: 'lifetime',
      lifetimeRep: rep,
      segmentStart: 0,
      segmentEnd: 42000,
      segmentSize: 42000,
      remaining: null,
      progress: 1,
      thresholdMet: true,
      nextRank: null,
      label: 'Lifetime Rep',
      detail: 'Officer rank is by appointment. Rep continues recording contribution independently.',
    }
  }

  const previous = milestones.filter((value) => value < next).at(-1) || 0
  const segmentSize = next - previous
  const segmentEarned = Math.max(0, rep - previous)

  return {
    mode: 'milestone',
    lifetimeRep: rep,
    segmentStart: previous,
    segmentEnd: next,
    segmentSize,
    remaining: next - rep,
    progress: segmentEarned / segmentSize,
    thresholdMet: false,
    nextRank: null,
    label: `${formatNumber(next)} Rep milestone`,
    detail: 'Officer rank is by appointment. Rep continues recording contribution independently.',
  }
}

export function repProgress(member) {
  const lifetimeRep = Number(member?.contribution?.rep) || 0
  const isOfficer = Boolean(member?.rankMeta?.isOfficer)
  const progression = isOfficer
    ? officerRepMilestone(lifetimeRep)
    : member?.repProgression || fallbackRepProgression(member?.rank || 'Recruit', lifetimeRep)

  const percent = Math.min(100, Math.max(0, (Number(progression.progress) || 0) * 100))
  const segmented = progression.mode === 'eligibility' || progression.mode === 'milestone'
  const current = segmented
    ? Math.min(Math.max(lifetimeRep - Number(progression.segmentStart || 0), 0), Number(progression.segmentSize || 0))
    : Math.min(lifetimeRep, Number(progression.segmentEnd || 42000))
  const max = Number(progression.segmentSize) || Number(progression.segmentEnd) || 42000

  let note = progression.detail
  let goal = progression.label
  if (member?.rank === 'Recruit') {
    note = `${formatNumber(progression.remaining)} Rep to the Corporal contribution breakpoint. Private is an onboarding promotion.`
    goal = 'Corporal breakpoint'
  } else if (progression.mode === 'eligibility' && progression.thresholdMet) {
    note = 'Rep floor met. Promotion still depends on trust, recommendation, qualification, and guild need.'
    goal = `${progression.nextRank || 'Next rank'} eligible`
  } else if (progression.mode === 'eligibility') {
    note = `${formatNumber(progression.remaining)} Rep to ${progression.nextRank || progression.label} eligibility.`
    goal = progression.nextRank ? `Toward ${progression.nextRank}` : progression.label
  } else if (progression.mode === 'milestone') {
    note = `${formatNumber(progression.remaining)} Rep to the next service milestone. Officer rank is by appointment.`
    goal = progression.label
  }

  return {
    progression,
    lifetimeRep,
    percent,
    current,
    max,
    goal,
    note,
    // The value the bar reads out: progress within this tier, or the total.
    readout: segmented
      ? `${formatNumber(current)} / ${formatNumber(progression.segmentSize)}`
      : `${formatNumber(lifetimeRep)} lifetime`,
    start: formatNumber(progression.segmentStart || 0),
    end: formatNumber(progression.segmentEnd || 42000),
  }
}
