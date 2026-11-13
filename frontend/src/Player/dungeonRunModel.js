// Formatting and URL state for the Dungeon runs page. Kept apart from the
// component so it can be tested without a browser.

export const DUNGEON_FILTER_KEYS = Object.freeze(['character', 'realm', 'dungeon', 'status', 'from', 'to'])
export const STATUS_FILTERS = Object.freeze([['', 'Any status'], ['completed', 'Completed'], ['incomplete', 'Incomplete']])

export function readDungeonQuery(queryString = '') {
  const params = new URLSearchParams(queryString)
  const filters = Object.fromEntries(DUNGEON_FILTER_KEYS.map((key) => [key, params.get(key) || '']))
  const run = Number(params.get('run'))
  return { filters, runId: Number.isSafeInteger(run) && run > 0 ? run : null }
}

// The page URL for filters and an open run, keeping the server choice.
export function dungeonHref({ filters = {}, runId = null, server = '' } = {}) {
  const params = new URLSearchParams()
  if (server) params.set('server', server)
  for (const key of DUNGEON_FILTER_KEYS) if (filters[key]) params.set(key, filters[key])
  if (runId) params.set('run', String(runId))
  const query = params.toString()
  return `/dashboard/dungeons${query ? `?${query}` : ''}`
}

// The API filters: dates become the start and end of that day in the
// viewer's own time zone, so a late-evening run stays on its day.
export function dungeonApiFilters(filters = {}) {
  const day = (value, end) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return ''
    const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  return { ...filters, from: day(filters.from, false), to: day(filters.to, true) }
}

export function formatRunDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const rest = total % 60
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

// Offsets on the timeline: 12:05 or 1:02:05.
export function formatOffset(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const rest = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

// Copper as gold, silver and copper with a sign. Unknown is a dash, never 0.
export function formatCopper(copper) {
  if (copper === null || copper === undefined || !Number.isFinite(Number(copper))) return '—'
  const value = Math.trunc(Number(copper))
  const sign = value < 0 ? '−' : value > 0 ? '+' : ''
  const abs = Math.abs(value)
  const gold = Math.floor(abs / 10000)
  const silver = Math.floor(abs / 100) % 100
  const rest = abs % 100
  const parts = []
  if (gold) parts.push(`${gold.toLocaleString('en-US')}g`)
  if (gold || silver) parts.push(`${silver}s`)
  parts.push(`${rest}c`)
  return `${sign}${parts.join(' ')}`
}

export function xpSummary(xp = {}) {
  if (xp.atLevelCap) return { value: 'Max level', perHour: null }
  if (!xp.available || xp.gained === null || xp.gained === undefined) return { value: '—', perHour: null }
  return {
    value: `+${Number(xp.gained).toLocaleString('en-US')}`,
    perHour: xp.perHour ? `${Number(xp.perHour).toLocaleString('en-US')}/h` : null,
  }
}

export const STATUS_LABELS = Object.freeze({
  open: 'In progress',
  completed: 'Completed',
  interrupted: 'Interrupted',
  abandoned: 'Left',
})

export function statusTone(status) {
  if (status === 'completed') return 'ok'
  if (status === 'open') return 'info'
  return 'quiet'
}

const END_REASONS = {
  all_bosses_defeated: 'every boss defeated',
  manual_finish: 'finished with /gw dungeon finish',
  left_instance: 'left and did not return within 10 minutes',
  logout_not_resumed: 'logged out and did not come back',
  entered_other_instance: 'entered another instance',
  too_many_open_runs: 'closed to keep storage bounded',
}

export function endReasonLabel(reason) {
  return reason ? END_REASONS[reason] || reason.replaceAll('_', ' ') : ''
}

export function bossLabel(bosses = {}) {
  const defeated = Number(bosses.defeated) || 0
  return bosses.total ? `${defeated}/${bosses.total}` : String(defeated)
}

const TIMELINE_LABELS = {
  enter: () => 'Entered',
  leave: () => 'Left the instance',
  reenter: () => 'Came back in',
  resume: () => 'Continued after reload or login',
  complete: () => 'Run complete',
  timer_start: () => 'Timer started',
  timer_stop: (event) => event.source === 'complete' ? 'Timer stopped on clear' : 'Timer paused',
  boss_kill: (entry) => `Defeated ${entry.name || 'a boss'}`,
  encounter_start: (entry) => `Pulled ${entry.name || 'a boss'}`,
  encounter_failed: (entry) => `Encounter reset: ${entry.name || 'boss'}`,
  death: () => 'You died',
  level_up: (entry) => (entry.level ? `Reached level ${entry.level}` : 'Level up'),
  manual_split: (entry) => `Split: ${entry.name || 'checkpoint'}`,
}

export function timelineLabel(entry = {}) {
  const label = TIMELINE_LABELS[entry.kind]
  return label ? label(entry) : String(entry.kind || '')
}

export function timelineTone(kind) {
  if (kind === 'boss_kill' || kind === 'complete') return 'ok'
  if (kind === 'death' || kind === 'encounter_failed') return 'warn'
  if (kind === 'manual_split' || kind === 'level_up') return 'info'
  return 'quiet'
}

export function characterLabel(character = {}) {
  const name = character.name || 'Unknown character'
  const from = character.levelAtEntry
  const to = character.levelAtExit
  if (!from) return name
  return `${name} · ${to && to !== from ? `${from}→${to}` : from}`
}

// Seconds as a signed pace: "18 s ahead", "1:05 behind", "even".
export function formatDelta(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return ''
  const value = Math.round(Number(seconds))
  if (value === 0) return 'even'
  const abs = Math.abs(value)
  const text = abs < 60 ? `${abs} s` : formatOffset(abs)
  return `${text} ${value < 0 ? 'ahead' : 'behind'}`
}

// A run-to-run change in time: "−4:10" faster, "+0:35" slower.
export function formatSignedDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return ''
  const value = Math.round(Number(seconds))
  if (value === 0) return '±0:00'
  return `${value < 0 ? '−' : '+'}${formatOffset(Math.abs(value))}`
}

export function formatNumber(value) {
  return Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('en-US') : '—'
}

const CHECKPOINT_TRUSTED_SOURCES = new Set(['encounter_end', 'boss_kill'])

// Splits of a run against its personal-best reference. A checkpoint is
// compared only when the reference has a checkpoint with the same identity
// (a boss by encounter id or name, a manual split by name) and both runs
// recorded it the same way; anything else shows its own time only. Never a
// made-up boss or time.
export function checkpointPace(run = {}) {
  const checkpoints = Array.isArray(run.checkpoints) ? run.checkpoints : []
  const reference = run.reference && Array.isArray(run.reference.checkpoints) ? run.reference : null
  const byId = new Map((reference?.checkpoints || []).map((entry) => [entry.id, entry]))
  let previousAt = 0
  let compared = 0
  const rows = checkpoints.map((entry) => {
    const at = entry.timerAt ?? entry.at
    const split = Math.max(0, at - previousAt)
    previousAt = at
    const match = byId.get(entry.id) || null
    const trusted = entry.kind === 'boss'
      ? CHECKPOINT_TRUSTED_SOURCES.has(entry.source) && CHECKPOINT_TRUSTED_SOURCES.has(match?.source)
      : entry.kind === 'split' && match?.kind === 'split'
    const delta = match && trusted ? at - (match.timerAt ?? match.at) : null
    if (delta !== null) compared += 1
    return {
      id: entry.id,
      kind: entry.kind,
      name: entry.name || (entry.kind === 'boss' ? 'Unnamed boss' : 'Split'),
      at,
      split,
      manual: entry.kind === 'split' || entry.source === 'manual',
      referenceAt: match ? (match.timerAt ?? match.at) : null,
      delta,
      reason: !reference ? 'no_reference' : !match ? 'not_in_reference' : !trusted ? 'not_comparable' : null,
    }
  })
  const finalDelta = reference && run.marks?.clear && Number.isFinite(run.durationSeconds) ? (run.timer?.seconds ?? run.durationSeconds) - (reference.timer?.seconds ?? reference.durationSeconds) : null
  return { rows, compared, reference, finalDelta }
}

// The run's events placed on a track from entry (0%) to its end (100%),
// in order. Events at the same second keep their recorded order.
export function timelineTrack(run = {}) {
  const timeline = Array.isArray(run.timeline) ? run.timeline : []
  const end = Math.max(1, Number(run.durationSeconds) || 0, ...timeline.map((entry) => Number(entry.at) || 0))
  const markers = timeline
    .map((entry, index) => ({ ...entry, index, at: Number(entry.at) || 0 }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => ({ ...entry, pct: Math.min(100, Math.max(0, (entry.at / end) * 100)), tone: timelineTone(entry.kind), label: timelineLabel(entry) }))
  // Time outside the instance, between a leave and the next re-entry.
  const outside = []
  let leftAt = null
  for (const marker of markers) {
    if (marker.kind === 'leave') leftAt = marker.at
    if ((marker.kind === 'reenter' || marker.kind === 'resume') && leftAt !== null) {
      outside.push({ from: (leftAt / end) * 100, to: (marker.at / end) * 100 })
      leftAt = null
    }
  }
  return { end, markers, outside }
}

function sameFocus(run, focus) {
  return run.dungeon?.name === focus.name && (run.dungeon?.difficultyId ?? null) === focus.difficultyId
}

// The headline numbers for the runs in view. Counts cover every run shown;
// the personal best and XP/hour cover one dungeon at one difficulty only:
// the selected dungeon, or the only one in view. Never across dungeons.
export function performanceSummary(runs = [], filters = {}) {
  const completed = runs.filter((run) => run.status === 'completed')
  const base = {
    runs: runs.length,
    completed: completed.length,
    verified: completed.filter((run) => run.marks?.completion === 'verified').length,
    bosses: runs.reduce((sum, run) => sum + (Number(run.bosses?.defeated) || 0), 0),
    deaths: runs.reduce((sum, run) => sum + (Number(run.deaths) || 0), 0),
    focus: null,
    focusReason: null,
  }
  const dungeons = new Set(runs.map((run) => `${run.dungeon?.name}|${run.dungeon?.difficultyId ?? ''}`))
  // The selected dungeon, else the one of the newest run (said so).
  const anchor = filters.dungeon ? runs.find((run) => run.dungeon?.name === filters.dungeon) || null : runs[0] || null
  if (!anchor) return base
  const focus = { name: anchor.dungeon.name, difficultyId: anchor.dungeon.difficultyId ?? null, difficultyName: anchor.dungeon.difficultyName || null,
    chosen: filters.dungeon ? 'filter' : dungeons.size === 1 ? 'only' : 'latest' }
  const inFocus = runs.filter((run) => sameFocus(run, focus))
  const clears = inFocus.filter((run) => run.marks?.clear && run.character?.id === anchor.character?.id && run.marks?.group === anchor.marks?.group)
  // Completed runs only: a run cut short reads as a record XP/hour.
  const rated = inFocus.filter((run) => run.status === 'completed' && Number.isFinite(run.xp?.perHour) && run.xp.perHour > 0)
  const fastest = clears.reduce((best, run) => (!best || (run.timer?.seconds ?? run.durationSeconds) < (best.timer?.seconds ?? best.durationSeconds) ? run : best), null)
  const best = rated.reduce((top, run) => (!top || run.xp.perHour > top.xp.perHour ? run : top), null)
  const sorted = rated.map((run) => run.xp.perHour).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const typical = sorted.length ? (sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)) : null
  base.focus = {
    ...focus,
    runs: inFocus.length,
    clears: clears.length,
    otherDifficulties: [...new Set(runs.filter((run) => run.dungeon?.name === focus.name && !sameFocus(run, focus)).map((run) => run.dungeon?.difficultyName || 'Other'))],
    pb: fastest ? { id: fastest.id, durationSeconds: fastest.timer?.seconds ?? fastest.durationSeconds, character: fastest.character } : null,
    bestXpPerHour: best ? { id: best.id, value: best.xp.perHour } : null,
    typicalXpPerHour: rated.length >= 2 ? typical : null,
    ratedRuns: rated.length,
  }
  return base
}

export const COMPLETION_LABELS = Object.freeze({
  verified: 'Verified clear',
  manual: 'Unverified clear',
  incomplete: 'Incomplete',
  open: 'In progress',
})

// Short markers for a row: PB, best XP/hour, exceptional, unverified.
export function runMarkers(run = {}) {
  const marks = run.marks || {}
  const out = []
  if (marks.pb) out.push({ key: 'pb', label: 'PB', title: 'Personal best: fastest verified clear for this character, dungeon and difficulty' })
  if (marks.bestXp) out.push({ key: 'xp', label: 'Best XP/h', title: 'Highest XP/hour for this character, dungeon and difficulty' })
  if (marks.exceptional && !marks.bestXp) out.push({ key: 'hot', label: '▲ XP/h', title: 'XP/hour at least 25% above this character\'s median here' })
  if (run.status === 'completed' && marks.completion === 'manual') out.push({ key: 'unverified', label: 'Unverified', title: (marks.completionReasons || []).join(' ') || 'Boss evidence does not cover every boss' })
  return out
}

// What the header says about whose runs these are.
export function contextLine({ runs = [], filters = {}, options = {} } = {}) {
  const character = filters.character ? options.characters?.find((entry) => entry.id === filters.character) : null
  const latest = runs.find((run) => !filters.character || run.character?.id === filters.character) || null
  const names = new Set(runs.map((run) => run.character?.id))
  const who = character ? (character.name || 'Unknown character') : names.size === 1 && latest ? (latest.character.name || 'Unknown character') : `${options.characters?.length || names.size} characters`
  const level = (character || names.size === 1) && latest ? latest.character.levelAtExit || latest.character.levelAtEntry : null
  const realms = filters.realm ? [filters.realm] : [...new Set(runs.map((run) => run.realm).filter(Boolean))]
  return [who, level ? `level ${level}` : null, realms.length === 1 ? realms[0] : realms.length ? `${realms.length} realms` : null].filter(Boolean).join(' · ')
}
