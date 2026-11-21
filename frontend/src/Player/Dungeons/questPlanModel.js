// The dungeon quest preparation plan (docs/dungeon-quest-planner.md), as the
// website shows it: the backend's plan (GET /loot/dungeons/:id/plan) turned
// into a numbered checklist with lettered substeps, the next action, the
// readiness summary and how fresh the character's quest data is.
//
// Nothing here decides a quest's state: every status, the next step and the
// readiness come from the plan, which takes them from the character's synced
// quest data. This file only groups and labels them. A location is shown only
// from a waypoint the plan built (a UiMap id and 0–1 coordinates); a step
// without one says so instead of guessing.

import { READINESS_COPY, unknownReason } from './atlasModel.js'

// The add-on's section titles (Systems/DungeonQuestPlan.lua), so the two read alike.
export const PLAN_SECTION_TITLES = Object.freeze({
  collect: 'Collect before you go',
  share: 'Or ask your group to share',
  enter: 'Enter',
  turnIn: 'After the run',
  unknown: 'Not known',
  optional: 'Optional quests',
  repeatable: 'Repeatable quests',
})

export const STEP_STATUS_COPY = Object.freeze({
  done: { label: 'Done', tone: 'ok', mark: '✓' },
  todo: { label: 'To do', tone: 'warn', mark: '' },
  blocked: { label: 'Waiting', tone: 'bad', mark: '' },
  unknown: { label: 'Not known', tone: 'quiet', mark: '?' },
  ineligible: { label: 'Not for this character', tone: 'quiet', mark: '–' },
})

// Numbered sections, in the add-on's order; share steps are "or" choices.
const NUMBERED = ['collect', 'enter', 'turnIn', 'unknown']
const SHOWN = ['collect', 'share', 'enter', 'turnIn', 'unknown']
// Past this many collect items, done ones fold away and only the next one opens.
export const LONG_PLAN = 6
// Quest data older than this may no longer match the game.
export const STALE_HOURS = 24

const isId = (value) => Number.isSafeInteger(value) && value > 0
const isFraction = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const letter = (index) => (index < 26 ? String.fromCharCode(97 + index) : String(index + 1))
const list = (value) => (Array.isArray(value) ? value : [])

// A waypoint the website can show: a UiMap id and 0–1 coordinates, as the
// plan builds them. Anything else is not a location.
export function planWaypoint(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.mapId) || !isFraction(raw.x) || !isFraction(raw.y)) return null
  return {
    id: String(raw.id || ''), mapId: raw.mapId, x: raw.x, y: raw.y,
    zoneName: typeof raw.zoneName === 'string' ? raw.zoneName : '',
    target: typeof raw.target === 'string' ? raw.target : '',
    targetType: raw.targetType || '', source: raw.source || '', verified: raw.verified === true,
  }
}

// "56.3, 47.5", the game's map coordinates.
export function coordsText(waypoint) {
  return waypoint ? `${(waypoint.x * 100).toFixed(1)}, ${(waypoint.y * 100).toFixed(1)}` : ''
}

// The world map on the waypoint's zone, with the spot marked.
export function waypointMapHref(waypoint) {
  if (!waypoint) return ''
  const params = new URLSearchParams()
  params.set('zone', String(waypoint.mapId))
  params.set('mark', `${waypoint.x.toFixed(4)},${waypoint.y.toFixed(4)}`)
  if (waypoint.target) params.set('label', waypoint.target.slice(0, 60))
  return `/map?${params.toString()}`
}

// ?mark=0.5633,0.4752 back into 0–1 coordinates, or null.
export function readMapMark(value) {
  const [x, y] = String(value || '').split(',').map(Number)
  return isFraction(x) && isFraction(y) ? { x, y } : null
}

// Where a waypoint's facts come from, in a few words (shown on hover).
export function waypointSourceText(waypoint) {
  if (!waypoint) return ''
  if (waypoint.source === 'editorial') return waypoint.verified ? 'Checked by the Guildweaver editors' : 'From the Guildweaver editors, not checked in game yet'
  if (waypoint.source === 'atlas') return 'From the dungeon atlas, not checked on Forever'
  return 'Classic reference data, not checked on Forever'
}

function stepOf(raw) {
  return {
    id: String(raw?.id || ''),
    kind: raw?.kind || '',
    questId: isId(raw?.questId) ? raw.questId : null,
    status: STEP_STATUS_COPY[raw?.status] ? raw.status : 'unknown',
    text: typeof raw?.text === 'string' ? raw.text : '',
    waypoint: typeof raw?.waypoint === 'string' ? raw.waypoint : null,
    verified: raw?.verified === true,
    source: raw?.source || '',
    optional: raw?.optional === true,
    location: raw?.location || null,
    reasons: list(raw?.reasons).filter((reason) => typeof reason === 'string'),
    children: list(raw?.children).map(stepOf),
  }
}

// The quest ids a step waits on ("prerequisite:155").
function waitsOn(step) {
  return step.reasons.map((reason) => /^prerequisite:(\d+)$/.exec(reason)).filter(Boolean).map((match) => Number(match[1]))
}

// The collect section as numbered items: each dungeon quest with the
// prerequisite chain it waits on (found through the plan's own "waits on"
// reasons, so a chain listed elsewhere in the order still lands under its
// quest). A prerequisite two quests share sits under the first; the second
// points at it. A prerequisite no quest claims is an item of its own.
function collectItems(steps) {
  const prerequisites = new Map(steps.filter((step) => step.kind === 'prerequisite' && step.questId).map((step) => [step.questId, step]))
  const claimed = new Set()
  const items = []
  for (const step of steps) {
    if (step.kind === 'prerequisite') continue
    const chain = []
    const shared = []
    const seen = new Set()
    const visit = (questId) => {
      if (seen.has(questId)) return
      seen.add(questId)
      const prerequisite = prerequisites.get(questId)
      if (!prerequisite) return
      // Under an earlier quest already: point at it, not at its whole chain.
      if (claimed.has(questId)) { shared.push(questId); return }
      for (const earlier of waitsOn(prerequisite)) visit(earlier)
      claimed.add(questId)
      chain.push(prerequisite)
    }
    for (const questId of waitsOn(step)) visit(questId)
    items.push({ step, chain, shared })
  }
  // Unclaimed prerequisites (for example the first link of a chain whose
  // quest is not blocked by it in the data) keep the plan's order, before
  // the quest that comes after them.
  const loose = steps.filter((step) => step.kind === 'prerequisite' && !claimed.has(step.questId))
  if (!loose.length) return items
  const ordered = []
  for (const step of steps) {
    if (step.kind === 'prerequisite') {
      if (!claimed.has(step.questId)) ordered.push({ step, chain: [], shared: [] })
      continue
    }
    ordered.push(items.find((item) => item.step === step))
  }
  return ordered
}

// The worst status of an item and its chain: anything to do makes it to do.
function itemStatus(item) {
  const all = [item.step, ...item.chain]
  if (all.every((step) => step.status === 'done')) return 'done'
  if (all.some((step) => step.status === 'todo')) return 'todo'
  if (all.some((step) => step.status === 'blocked')) return 'blocked'
  return item.step.status
}

// The character's quest data: synced or not, how old, and what the game did
// not report. A quest is never "done" from a missing record: the plan says
// unknown, and this says why.
export function planFreshness(character, { now = Date.now() } = {}) {
  if (!character || typeof character !== 'object') return { synced: false, capturedAt: null, receivedAt: null, stale: false, missing: [], partial: false }
  const capturedAt = character.capturedAt || character.receivedAt || null
  const time = capturedAt ? Date.parse(capturedAt) : NaN
  const ageHours = Number.isFinite(time) ? (now - time) / 3600000 : null
  const missing = []
  if (character.completedCoverage === 'none') missing.push('which quests were completed')
  if (character.questLogCoverage === 'none') missing.push('the quest log')
  return {
    synced: true,
    capturedAt,
    receivedAt: character.receivedAt || null,
    ageHours,
    stale: ageHours !== null && ageHours > STALE_HOURS,
    missing,
    partial: missing.length > 0 || character.completedCoverage === 'checked',
  }
}

// One line for the summary: "2 of 5 collected · 1 to pick up · 2 waiting on an earlier quest".
export function planReadinessLine(readiness, questList = 'curated') {
  const counts = readiness?.counts || {}
  const required = Number(readiness?.required) || 0
  if (!required) return questList === 'unknown' ? 'No source lists this dungeon\'s quests yet. That does not mean it has none.' : 'No dungeon quests apply to this character.'
  const collected = (counts.completed || 0) + (counts.accepted || 0)
  return [
    `${collected} of ${required} collected`,
    counts.accepted ? `${counts.accepted} in the quest log` : null,
    counts.available ? `${counts.available} to pick up` : null,
    counts.prerequisites ? `${counts.prerequisites} waiting on an earlier quest` : null,
    counts.unknown ? `${counts.unknown} not known` : null,
  ].filter(Boolean).join(' · ')
}

// The plan for the page, or null when the response is not a plan.
export function questPlanModel(data, { now = Date.now() } = {}) {
  const readinessKey = data?.readiness?.readiness
  if (!data || typeof data !== 'object' || !Array.isArray(data.sections) || !READINESS_COPY[readinessKey]) return null
  const waypoints = new Map(list(data.waypoints).map(planWaypoint).filter(Boolean).map((waypoint) => [waypoint.id, waypoint]))
  const sectionOf = (key) => {
    const raw = data.sections.find((section) => section?.key === key)
    return { steps: list(raw?.steps).map(stepOf), notes: list(raw?.notes).filter((note) => note && typeof note.text === 'string') }
  }
  const nextId = typeof data.next === 'string' ? data.next : null

  // Labels: "4", "4b"; for "waits on step 4b".
  const labels = new Map()
  let number = 0
  const groups = []
  for (const key of SHOWN) {
    const { steps, notes } = sectionOf(key)
    if (!steps.length && !notes.length) continue
    const raw = key === 'collect' ? collectItems(steps) : steps.map((step) => ({ step, chain: [], shared: [] }))
    const items = raw.map((item) => {
      const label = NUMBERED.includes(key) ? String(++number) : 'or'
      const chain = item.chain.map((step, index) => ({ label: letter(index), step }))
      const children = item.step.children.map((step, index) => ({ label: letter(chain.length + index), step }))
      const ids = [item.step, ...item.chain, ...item.step.children, ...item.chain.flatMap((step) => step.children)].map((step) => step.id)
      if (label !== 'or') {
        if (item.step.questId) labels.set(item.step.questId, label)
        for (const entry of chain) if (entry.step.questId) labels.set(entry.step.questId, `${label}${entry.label}`)
      }
      const status = itemStatus(item)
      return {
        key: item.step.id, label, step: item.step, chain, children, shared: item.shared, status,
        isNext: item.step.id === nextId, containsNext: Boolean(nextId) && ids.includes(nextId),
        waypoint: waypoints.get(item.step.waypoint) || null,
      }
    })
    groups.push({ key, title: PLAN_SECTION_TITLES[key], notes, items, done: items.filter((item) => item.status === 'done').length })
  }

  // Why a step waits or is not known, in words, pointing at steps by label.
  const explain = (step) => {
    if (step.status === 'blocked') {
      const ids = waitsOn(step)
      if (!ids.length) return 'Waits on an earlier step.'
      return `Waits on ${ids.map((id) => (labels.has(id) ? `step ${labels.get(id)}` : `quest ${id}`)).join(' and ')}.`
    }
    if (step.status === 'unknown') {
      if (step.reasons.includes('prerequisite-cycle')) return 'Its quest chain loops in our data, so the order is not known.'
      if (step.reasons.includes('relevance-not-known')) return 'A source lists it for this dungeon, but no quest record says more.'
      if (step.kind === 'turn-in' && !step.reasons.length) return 'The synced quest log did not say whether its objectives are done.'
      if (step.location === 'not-in-our-data') return step.kind === 'turn-in' || step.kind === 'finish-objectives' ? 'Where to turn it in is not in our data.' : 'Where to go is not in our data.'
      const why = unknownReason({ reasons: step.reasons })
      if (why) return `Not known: ${why}.`
      return step.questId ? 'Not known from the synced quest data.' : 'Depends on dungeon quests whose state is not known yet.'
    }
    if (step.status === 'ineligible') return 'Not for this character (faction, race, class or level).'
    return ''
  }

  // The next action: the plan's `next` leaf, with what it belongs to.
  let next = null
  if (nextId) {
    for (const group of groups) {
      for (const item of group.items) {
        if (!item.containsNext) continue
        const found = [item.step, ...item.chain.map((entry) => entry.step)].flatMap((step) => [step, ...step.children]).find((step) => step.id === nextId)
        if (!found) continue
        const owner = [item.step, ...item.chain.map((entry) => entry.step)].find((step) => step === found || step.children.includes(found))
        next = {
          step: found, group: group.key, item, label: item.label,
          sublabel: owner === item.step ? (item.children.find((entry) => entry.step === found)?.label || '') : (item.chain.find((entry) => entry.step === owner)?.label || ''),
          owner, waypoint: waypoints.get(found.waypoint) || waypoints.get(owner.waypoint) || null,
        }
      }
    }
  }

  const extras = ['optional', 'repeatable'].map((key) => ({ key, title: PLAN_SECTION_TITLES[key], steps: sectionOf(key).steps })).filter((group) => group.steps.length)
  return {
    readiness: { key: readinessKey, ...READINESS_COPY[readinessKey], required: Number(data.readiness.required) || 0, counts: data.readiness.counts || {},
      line: planReadinessLine(data.readiness, data.questList) },
    next,
    groups,
    extras,
    waypoints,
    explain,
    labelOf: (questId) => labels.get(questId) || '',
    freshness: planFreshness(data.character, { now }),
    hiddenIneligible: Number(data.hidden?.ineligible) || 0,
    editorial: data.editorial?.used ? { revision: data.editorial.revision ?? null } : null,
    questList: data.questList === 'unknown' ? 'unknown' : 'curated',
    long: (groups.find((group) => group.key === 'collect')?.items.length || 0) > LONG_PLAN,
  }
}

// Dungeon quests the character cannot take yet only because of its level
// (readiness: state "ineligible", reason "level-below-minimum"), soonest
// first: the plan leaves them out, the page lists them as coming later.
export function laterQuests(readiness) {
  const quests = [...list(readiness?.quests), ...list(readiness?.optional)]
  return quests
    .filter((quest) => quest?.state === 'ineligible' && list(quest.reasons).includes('level-below-minimum') && Number.isFinite(Number(quest.minLevel)))
    .map((quest) => ({ questId: quest.questId, name: quest.name || `Quest ${quest.questId}`, minLevel: Number(quest.minLevel), relevance: quest.relevance || 'dungeon',
      giver: quest.giver?.name || '' }))
    .sort((a, b) => a.minLevel - b.minLevel || String(a.name).localeCompare(String(b.name)))
}
