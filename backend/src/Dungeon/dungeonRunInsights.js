// What a set of a player's runs says: which runs can be trusted as clears,
// personal bests, typical values and change against the previous run.
// Pure functions over read-model runs (see runFromRow), so they are tested
// without a database.
//
// Rules:
// - Runs are only ever compared inside one group: the same dungeon, the
//   same difficulty and the same character. Two dungeons, two difficulties
//   or two characters are never compared.
// - The add-on's "completed" status alone does not make a clear. A clear is
//   verified when the boss evidence covers every boss (the lockout or the
//   encounter events); a manual finish counts only when it has at least as
//   many boss kills as the group's verified clears.
// - XP/hour is compared only for runs that measured XP for the whole run.

export const MIN_COMPARE_RUNS = 2;
// A run is "exceptional" when its XP/hour beats the group's median by this
// much, with at least this many rated runs behind the median.
export const EXCEPTIONAL_RATIO = 1.25;
export const EXCEPTIONAL_MIN_RUNS = 3;
// Shorter than this is a portal hop, never a clear.
export const MIN_CLEAR_SECONDS = 120;

export function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2);
}

// The group a run is compared in.
export function comparisonKey(run) {
  const dungeon = run.dungeon?.instanceId ? `i${run.dungeon.instanceId}` : `n${String(run.dungeon?.name || "").toLowerCase()}`;
  const difficulty = run.dungeon?.difficultyId ?? String(run.dungeon?.difficultyName || "").toLowerCase();
  const character = run.character?.id || run.character?.rawId || "";
  return `${dungeon}|${difficulty}|${character}`;
}

// Checkpoints: what the add-on sent (schema 2), or the boss kills and manual
// splits of the timeline (schema 1). Boss checkpoints are identified by
// encounter id when the client gave one, otherwise by name; manual splits by
// their name and how many of that name came before.
export function deriveCheckpoints(timeline = []) {
  const seen = new Map();
  const out = [];
  for (const entry of timeline) {
    if (entry.kind !== "boss_kill" && entry.kind !== "manual_split") continue;
    const kind = entry.kind === "boss_kill" ? "boss" : "split";
    const base = kind === "boss"
      ? (entry.encounterId ? `boss:${entry.encounterId}` : `boss:name:${slug(entry.name)}`)
      : `split:${slug(entry.name) || "split"}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    if (kind === "boss" && count > 1) continue; // a boss dies once per run
    out.push({ id: count > 1 ? `${base}:${count}` : base, kind, at: entry.at, name: entry.name || null,
      encounterId: entry.encounterId || null, source: entry.source || (kind === "split" ? "manual" : null) });
  }
  return out;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// How far a run's "completed" can be trusted.
// verified: boss evidence covers every boss in the instance.
// manual: finished by hand, or completed without a boss total to check.
// incomplete: the run did not end as completed.
export function completionQuality(run) {
  const reasons = [];
  const bosses = run.bosses || {};
  const total = Number(bosses.total) || 0;
  const defeated = Number(bosses.defeated) || 0;
  if (run.status === "open") return { completion: "open", reasons: ["Still in progress when WoW last saved."] };
  if (run.status !== "completed") return { completion: "incomplete", reasons: [`Ended as ${run.status}.`] };
  if (total && defeated >= total) {
    return { completion: "verified", reasons: [run.completionBasis === "lockout" ? "Every boss in the lockout is down." : `${defeated}/${total} bosses defeated.`] };
  }
  if (total && defeated < total) reasons.push(`Only ${defeated}/${total} bosses recorded.`);
  if (run.endReason === "manual_finish") reasons.push("Finished with /gw dungeon finish.");
  if (!total) reasons.push("The instance reported no boss total.");
  if (!bosses.encounterEvents) reasons.push("No boss events from the client; splits are manual.");
  return { completion: "manual", reasons };
}

function clearEligible(run, quality, groupVerifiedBosses) {
  if (run.durationSeconds < MIN_CLEAR_SECONDS) return false;
  if (quality.completion === "verified") return true;
  // A hand-finished run counts when its kills match the group's real clears.
  return quality.completion === "manual" && groupVerifiedBosses > 0 && (Number(run.bosses?.defeated) || 0) >= groupVerifiedBosses;
}

// XP/hour is compared between completed runs only: a run cut short after
// the first, densest pulls would read as a record.
function xpComparable(run) {
  return run.status === "completed" && Number.isFinite(run.xp?.perHour) && run.xp.perHour > 0 && !run.xp.partial;
}

// Groups, personal bests and per-run marks. `runs` are every run of the
// player in scope; the result is keyed by run id and by group.
export function buildComparisons(runs = []) {
  const groups = new Map();
  for (const run of runs) {
    const key = comparisonKey(run);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const marks = new Map();
  const summaries = [];
  for (const [key, list] of groups) {
    const ordered = [...list].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id);
    const qualities = new Map(ordered.map((run) => [run.id, completionQuality(run)]));
    const verifiedBosses = Math.max(0, ...ordered.filter((run) => qualities.get(run.id).completion === "verified").map((run) => Number(run.bosses?.defeated) || 0));
    const clears = ordered.filter((run) => clearEligible(run, qualities.get(run.id), verifiedBosses));
    const rated = ordered.filter(xpComparable);
    const fastest = clears.reduce((best, run) => (!best || run.durationSeconds < best.durationSeconds ? run : best), null);
    const bestXp = rated.reduce((best, run) => (!best || run.xp.perHour > best.xp.perHour ? run : best), null);
    const medianDuration = median(clears.map((run) => run.durationSeconds));
    const medianXp = median(rated.map((run) => run.xp.perHour));
    const latest = ordered[ordered.length - 1];
    summaries.push({
      key,
      dungeon: { name: latest.dungeon.name, instanceId: latest.dungeon.instanceId ?? null, difficultyId: latest.dungeon.difficultyId ?? null,
        difficultyName: latest.dungeon.difficultyName || null, type: latest.dungeon.type },
      character: { id: latest.character.id, name: latest.character.name, classToken: latest.character.classToken },
      runs: ordered.length,
      clears: clears.length,
      verifiedClears: clears.filter((run) => qualities.get(run.id).completion === "verified").length,
      fastest: fastest ? { id: fastest.id, durationSeconds: fastest.durationSeconds, startedAt: fastest.startedAt } : null,
      bestXpPerHour: bestXp ? { id: bestXp.id, value: bestXp.xp.perHour, startedAt: bestXp.startedAt } : null,
      medianDurationSeconds: clears.length >= MIN_COMPARE_RUNS ? medianDuration : null,
      medianXpPerHour: rated.length >= MIN_COMPARE_RUNS ? medianXp : null,
      lastStartedAt: latest.startedAt,
      enough: clears.length >= MIN_COMPARE_RUNS || rated.length >= MIN_COMPARE_RUNS,
    });
    let previousClear = null;
    let previousRated = null;
    for (const run of ordered) {
      const quality = qualities.get(run.id);
      const clear = clears.includes(run);
      const ratedRun = rated.includes(run);
      marks.set(run.id, {
        group: key,
        completion: quality.completion,
        completionReasons: quality.reasons,
        clear,
        pb: Boolean(clear && fastest && fastest.id === run.id && clears.length >= MIN_COMPARE_RUNS),
        bestXp: Boolean(ratedRun && bestXp && bestXp.id === run.id && rated.length >= MIN_COMPARE_RUNS),
        exceptional: Boolean(ratedRun && rated.length >= EXCEPTIONAL_MIN_RUNS && medianXp && run.xp.perHour >= medianXp * EXCEPTIONAL_RATIO),
        // Change against the previous comparable run of the same group:
        // seconds (negative is faster) and XP/hour.
        vsPrevious: {
          durationSeconds: clear && previousClear ? run.durationSeconds - previousClear.durationSeconds : null,
          previousClearId: clear && previousClear ? previousClear.id : null,
          xpPerHour: ratedRun && previousRated ? run.xp.perHour - previousRated.xp.perHour : null,
        },
      });
      if (clear) previousClear = run;
      if (ratedRun) previousRated = run;
    }
  }
  summaries.sort((a, b) => b.lastStartedAt - a.lastStartedAt);
  return { marks, groups: summaries };
}

// The personal-best clear to pace a run against: the fastest trustworthy
// clear in the same group other than the run itself.
export function referenceClear(run, runs = []) {
  const key = comparisonKey(run);
  const group = runs.filter((entry) => comparisonKey(entry) === key);
  const { marks } = buildComparisons(group);
  return group.filter((entry) => entry.id !== run.id && marks.get(entry.id)?.clear)
    .reduce((best, entry) => (!best || entry.durationSeconds < best.durationSeconds ? entry : best), null);
}
