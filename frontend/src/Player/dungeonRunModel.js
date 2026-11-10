// Formatting and URL state for the Dungeon runs page. Kept apart from the
// component so it can be tested without a browser.

export const DUNGEON_FILTER_KEYS = Object.freeze(['character', 'realm', 'dungeon', 'from', 'to'])

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
  if (kind === 'boss_kill') return 'ok'
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
