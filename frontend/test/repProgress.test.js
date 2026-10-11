import assert from 'node:assert/strict'
import test from 'node:test'

import { repProgress } from '../src/Members/repProgress.js'

test('enlisted members fill toward the next rank floor reported by the server', () => {
  const rep = repProgress({
    rank: 'Sergeant',
    rankMeta: { isOfficer: false },
    contribution: { rep: 14800 },
    repProgression: { mode: 'eligibility', segmentStart: 9000, segmentEnd: 21000, segmentSize: 12000, progress: 0.4833, remaining: 6200, nextRank: 'Master Sergeant', label: 'Master Sergeant Rep floor', thresholdMet: false },
  })
  assert.equal(rep.current, 5800)
  assert.equal(rep.max, 12000)
  assert.equal(rep.readout, '5,800 / 12,000')
  assert.equal(rep.goal, 'Toward Master Sergeant')
  assert.match(rep.note, /6,200 Rep to Master Sergeant eligibility/)
  assert.equal(Math.round(rep.percent), 48)
})

test('officers fill toward service milestones, not a rank', () => {
  const rep = repProgress({ rank: 'Major', rankMeta: { isOfficer: true }, contribution: { rep: 12400 } })
  assert.equal(rep.progression.mode, 'milestone')
  assert.equal(rep.start, '9,000')
  assert.equal(rep.end, '21,000')
  assert.equal(rep.goal, '21,000 Rep milestone')
  assert.match(rep.note, /Officer rank is by appointment/)
})

test('recruits aim at the Corporal breakpoint and a met floor says promotion is still a decision', () => {
  const recruit = repProgress({ rank: 'Recruit', contribution: { rep: 150 } })
  assert.equal(recruit.goal, 'Corporal breakpoint')
  assert.match(recruit.note, /2,850 Rep to the Corporal contribution breakpoint/)

  const met = repProgress({ rank: 'Corporal', contribution: { rep: 9500 } })
  assert.equal(met.percent, 100)
  assert.equal(met.goal, 'Sergeant eligible')
  assert.match(met.note, /Promotion still depends on trust/)
})

test('a member with no Rep yet shows an empty bar, not an error', () => {
  const rep = repProgress({})
  assert.equal(rep.percent, 0)
  assert.equal(rep.lifetimeRep, 0)
})
