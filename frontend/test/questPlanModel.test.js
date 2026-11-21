import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEADMINES_PLAN_PARTIAL,
  DEADMINES_PLAN_PROGRESS,
  DEADMINES_PLAN_PUBLISHED,
  DEADMINES_PLAN_READY,
  DEADMINES_PLAN_START,
  DEADMINES_PLAN_UNSYNCED,
  PLAN_CAPTURED_AT,
  THANES_PLAN,
  THANES_PLAN_EDITED,
  ULDAMAN_PLAN,
} from '../src/Player/Dungeons/__fixtures__/questPlans.js'
import { planFreshness, planWaypoint, questPlanModel, readMapMark, waypointMapHref } from '../src/Player/Dungeons/questPlanModel.js'

const NOW = Date.parse(PLAN_CAPTURED_AT) + 2 * 3600 * 1000
const model = (plan, now = NOW) => questPlanModel(plan, { now })
const group = (m, key) => m.groups.find((entry) => entry.key === key)
const item = (m, questId) => m.groups.flatMap((entry) => entry.items).find((entry) => entry.step.questId === questId && entry.label !== 'or')

test('Deadmines from scratch: numbered quests, the chain lettered under the quest that needs it', () => {
  const m = model(DEADMINES_PLAN_START)
  assert.equal(m.readiness.key, 'missing')
  assert.equal(m.readiness.line, '0 of 5 collected · 3 to pick up · 2 waiting on an earlier quest')
  const collect = group(m, 'collect')
  assert.deepEqual(collect.items.map((entry) => entry.label), ['1', '2', '3', '4', '5'])
  // The Defias Brotherhood chain (six quests, all named alike) sits under step 4, first link first.
  const defias = item(m, 166)
  assert.equal(defias.label, '4')
  assert.deepEqual(defias.chain.map((entry) => `${entry.label}:${entry.step.questId}`), ['a:65', 'b:132', 'c:135', 'd:141', 'e:142', 'f:155'])
  assert.deepEqual(defias.children.map((entry) => entry.label), ['g', 'h'])
  assert.equal(defias.status, 'todo', 'its chain has a step to do now')
  // Red Silk Bandanas waits on the same chain: it points at it, not a copy of it.
  const bandanas = item(m, 214)
  assert.deepEqual(bandanas.chain, [])
  assert.deepEqual(bandanas.shared, [155])
  assert.equal(m.explain(bandanas.step), 'Waits on step 4f.')
  // Numbering runs on through Enter; share steps are "or" choices.
  assert.deepEqual(group(m, 'enter').items.map((entry) => entry.label), ['6', '7', '8'])
  assert.ok(group(m, 'share').items.every((entry) => entry.label === 'or'))
})

test('the next action is the plan\'s own next step, with where to go', () => {
  const m = model(DEADMINES_PLAN_START)
  assert.equal(m.next.step.id, DEADMINES_PLAN_START.next)
  assert.equal(`${m.next.label}${m.next.sublabel}`, '1a')
  assert.equal(m.next.waypoint.mapId, 1453)
  assert.equal(m.next.waypoint.target, 'Wilder Thistlenettle')
  assert.equal(m.next.waypoint.verified, false, 'catalog giver spots are not checked on Forever')
  const later = model(DEADMINES_PLAN_PROGRESS)
  assert.equal(later.next.step.id, 'collect:q132:travel')
  assert.equal(`${later.next.label}${later.next.sublabel}`, '4a', 'inside the chain of step 4')
  assert.ok(item(later, 166).containsNext)
})

test('accepted and completed quests are done only when the synced data says so', () => {
  const m = model(DEADMINES_PLAN_PROGRESS)
  assert.equal(item(m, 168).status, 'done')
  assert.match(item(m, 168).step.text, /in your quest log$/)
  assert.equal(item(m, 2040).status, 'done')
  assert.match(item(m, 2040).step.text, /completed$/)
  assert.equal(item(m, 167).status, 'todo')
  // The quest whose objectives the log says are done: turn it in after the run.
  const turnIn = group(m, 'turnIn').items.find((entry) => entry.step.questId === 168)
  assert.equal(turnIn.step.kind, 'turn-in')
  // Nothing synced: no step is done, nothing is next, and that is said.
  const unsynced = model(DEADMINES_PLAN_UNSYNCED)
  assert.equal(unsynced.freshness.synced, false)
  assert.equal(unsynced.next, null)
  assert.equal(unsynced.readiness.key, 'unknown')
  assert.ok(unsynced.groups.flatMap((entry) => entry.items).every((entry) => entry.status !== 'done'))
})

test('ready: every quest collected, the next step is the way to the entrance', () => {
  const m = model(DEADMINES_PLAN_READY)
  assert.equal(m.readiness.key, 'ready')
  assert.equal(group(m, 'collect').done, group(m, 'collect').items.length)
  assert.equal(m.next.step.id, 'enter:travel')
  assert.equal(m.next.waypoint.targetType, 'entrance')
  assert.equal(m.next.waypoint.mapId, 1436)
})

test('stale or incomplete quest data says so', () => {
  assert.equal(model(DEADMINES_PLAN_START).freshness.stale, false)
  assert.equal(model(DEADMINES_PLAN_START, Date.parse(PLAN_CAPTURED_AT) + 30 * 3600 * 1000).freshness.stale, true)
  const partial = model(DEADMINES_PLAN_PARTIAL)
  assert.deepEqual(partial.freshness.missing, ['which quests were completed'])
  assert.equal(partial.freshness.partial, true)
  assert.equal(partial.readiness.key, 'unknown', 'a missing record never counts as done')
  assert.deepEqual(planFreshness(null), { synced: false, capturedAt: null, receivedAt: null, stale: false, missing: [], partial: false })
})

test('published editorial edits: turn-in spot, instructions, shareability', () => {
  const m = model(DEADMINES_PLAN_PUBLISHED)
  assert.deepEqual(m.editorial, { revision: '7' })
  const turnIn = group(m, 'turnIn').items.find((entry) => entry.step.questId === 168)
  assert.equal(turnIn.waypoint.source, 'editorial')
  assert.equal(turnIn.waypoint.verified, true)
  assert.equal(turnIn.waypoint.target, 'Synthetic turn-in NPC')
  assert.equal(group(m, 'enter').notes[0].text, 'Synthetic: meet your group at the Moonbrook entrance.')
  assert.ok(!group(m, 'share')?.items.some((entry) => entry.step.questId === 214), 'the edit says 214 cannot be shared')
})

test('The Hall of Thanes: unknown chains and givers stay unknown until the editors supply them', () => {
  const m = model(THANES_PLAN)
  assert.equal(m.readiness.key, 'unknown')
  assert.equal(m.next, null)
  // No giver spot is invented: the only waypoint is the atlas entrance.
  assert.deepEqual([...m.waypoints.values()].map((entry) => entry.targetType), ['entrance'])
  for (const entry of group(m, 'collect').items) assert.equal(m.explain(entry.step), 'Not known: its quest chain is not known.')
  // Published edits: a chain that makes 96394 a follow-up, a giver spot.
  const edited = model(THANES_PLAN_EDITED)
  assert.ok(!group(edited, 'collect').items.some((entry) => entry.step.questId === 96394))
  assert.equal(group(edited, 'turnIn').items.find((entry) => entry.step.questId === 96394).step.kind, 'follow-up')
})

test('a long plan (Uldaman) is folded: labels stay unique and every "waits on" points at a step', () => {
  const m = model(ULDAMAN_PLAN)
  assert.equal(m.long, true)
  const labels = m.groups.flatMap((entry) => entry.items).filter((entry) => entry.label !== 'or')
    .flatMap((entry) => [entry.label, ...entry.chain.map((link) => `${entry.label}${link.label}`)])
  assert.equal(new Set(labels).size, labels.length)
  for (const entry of m.groups.flatMap((g) => g.items)) {
    for (const step of [entry.step, ...entry.chain.map((link) => link.step)]) {
      const why = m.explain(step)
      for (const [, label] of why.matchAll(/step (\w+)/g)) assert.ok(labels.includes(label), `${step.id}: ${why}`)
    }
  }
  assert.deepEqual(m.extras.map((entry) => entry.key), ['optional', 'repeatable'])
  // Exactly one item holds the next step.
  assert.equal(m.groups.flatMap((entry) => entry.items).filter((entry) => entry.containsNext).length, 1)
})

test('waypoints: only real map ids and 0–1 coordinates; the map link keeps them', () => {
  assert.equal(planWaypoint({ id: 'x', mapId: 0, x: 0.5, y: 0.5 }), null)
  assert.equal(planWaypoint({ id: 'x', mapId: 1436, x: 1.2, y: 0.5 }), null)
  const waypoint = planWaypoint({ id: 'wp', mapId: 1436, x: 0.56331, y: 0.47519, zoneName: 'Westfall', target: 'Gryan Stoutmantle', source: 'catalog' })
  const href = waypointMapHref(waypoint)
  assert.equal(href, '/map?zone=1436&mark=0.5633%2C0.4752&label=Gryan+Stoutmantle')
  assert.deepEqual(readMapMark(new URL(href, 'https://x').searchParams.get('mark')), { x: 0.5633, y: 0.4752 })
  assert.equal(readMapMark('1.5,0.2'), null)
  assert.equal(readMapMark('garbage'), null)
  assert.equal(questPlanModel({ sections: [] }), null, 'not a plan')
})
