import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bossLabel,
  dungeonApiFilters,
  characterLabel,
  dungeonHref,
  formatCopper,
  formatOffset,
  formatRunDuration,
  readDungeonQuery,
  timelineLabel,
  xpSummary,
} from '../src/Player/dungeonRunModel.js'

test('dungeon page URLs keep filters, the open run and the server', () => {
  const href = dungeonHref({ filters: { character: 'c1', dungeon: 'The Deadmines', from: '2026-11-01' }, runId: 7, server: 'us:live realm' })
  assert.equal(href, '/dashboard/dungeons?server=us%3Alive+realm&character=c1&dungeon=The+Deadmines&from=2026-11-01&run=7')
  const read = readDungeonQuery(href.split('?')[1])
  assert.equal(read.runId, 7)
  assert.equal(read.filters.dungeon, 'The Deadmines')
  assert.equal(read.filters.realm, '')
  assert.equal(readDungeonQuery('run=abc').runId, null)
  assert.equal(dungeonHref(), '/dashboard/dungeons')
})

test('formats run time, wallet change and XP without inventing numbers', () => {
  assert.equal(formatRunDuration(1740), '29:00')
  assert.equal(formatRunDuration(4000), '1h 06m')
  assert.equal(formatOffset(65), '1:05')
  assert.equal(formatOffset(3725), '1:02:05')
  assert.equal(formatCopper(18450), '+1g 84s 50c')
  assert.equal(formatCopper(-250), '−2s 50c')
  assert.equal(formatCopper(0), '0c')
  assert.equal(formatCopper(null), '—', 'unknown money is not zero')
  assert.deepEqual(xpSummary({ available: true, atLevelCap: false, gained: 14250, perHour: 29483 }), { value: '+14,250', perHour: '29,483/h' })
  assert.deepEqual(xpSummary({ available: true, atLevelCap: true, gained: null }), { value: 'Max level', perHour: null })
  assert.deepEqual(xpSummary({ available: false }), { value: '—', perHour: null })
  assert.equal(bossLabel({ defeated: 2, total: 5 }), '2/5')
  assert.equal(bossLabel({ defeated: 3 }), '3')
  assert.equal(characterLabel({ name: 'Rook', levelAtEntry: 19, levelAtExit: 20 }), 'Rook · 19→20')
  assert.equal(characterLabel({ name: 'Rook', levelAtEntry: 60, levelAtExit: 60 }), 'Rook · 60')
})

test('timeline entries read as plain events', () => {
  assert.equal(timelineLabel({ kind: 'boss_kill', name: 'VanCleef' }), 'Defeated VanCleef')
  assert.equal(timelineLabel({ kind: 'death' }), 'You died')
  assert.equal(timelineLabel({ kind: 'encounter_failed', name: 'VanCleef' }), 'Encounter reset: VanCleef')
  assert.equal(timelineLabel({ kind: 'manual_split', name: 'Ship' }), 'Split: Ship')
  assert.equal(timelineLabel({ kind: 'level_up', level: 20 }), 'Reached level 20')
})

test('date filters cover the whole local day', () => {
  const api = dungeonApiFilters({ dungeon: 'x', from: '2026-11-10', to: '2026-11-10' })
  assert.equal(api.dungeon, 'x')
  assert.equal(new Date(api.from).getTime(), new Date('2026-11-10T00:00:00').getTime())
  assert.equal(new Date(api.to).getTime(), new Date('2026-11-10T23:59:59.999').getTime())
  assert.equal(dungeonApiFilters({ from: 'nope' }).from, '')
})

import {
  checkpointPace,
  contextLine,
  formatDelta,
  formatSignedDuration,
  performanceSummary,
  runMarkers,
  timelineTrack,
} from '../src/Player/dungeonRunModel.js'

const deadmines = { name: 'The Deadmines', instanceId: 36, difficultyId: 1, difficultyName: 'Normal', type: 'party' }

function run(id, fields = {}) {
  return {
    id, status: 'completed', startedAt: 1000 + id, durationSeconds: 1800, dungeon: deadmines, realm: 'Live Realm',
    character: { id: 'c1', name: 'Rook', levelAtEntry: 19, levelAtExit: 20 },
    xp: { available: true, perHour: 20000 }, bosses: { defeated: 2, total: 2 }, deaths: 0,
    marks: { clear: true, completion: 'verified' }, ...fields,
  }
}

test('status filter round-trips through the URL with the other filters', () => {
  const href = dungeonHref({ filters: { dungeon: 'The Deadmines', status: 'incomplete' }, server: '' })
  assert.equal(href, '/dashboard/dungeons?dungeon=The+Deadmines&status=incomplete')
  assert.equal(readDungeonQuery(href.split('?')[1]).filters.status, 'incomplete')
  assert.equal(dungeonApiFilters({ status: 'completed', from: '', to: '' }).status, 'completed')
})

test('pace deltas only for matching, trustworthy checkpoints', () => {
  const pace = checkpointPace({
    durationSeconds: 1500,
    marks: { clear: true },
    checkpoints: [
      { id: 'boss:1', kind: 'boss', at: 360, name: "Rhahk'Zor", source: 'encounter_end' },
      { id: 'split:ship', kind: 'split', at: 1300, name: 'Ship', source: 'manual' },
      { id: 'boss:3', kind: 'boss', at: 1350, name: 'Cookie', source: 'encounter_end' },
      { id: 'boss:2', kind: 'boss', at: 1440, name: 'Edwin VanCleef', source: 'encounter_end' },
    ],
    reference: {
      id: 9, durationSeconds: 1740,
      checkpoints: [
        { id: 'boss:1', kind: 'boss', at: 378, source: 'encounter_end' },
        { id: 'split:ship', kind: 'split', at: 1500, source: 'manual' },
        // Same boss id but typed by hand in the old run: not comparable.
        { id: 'boss:2', kind: 'boss', at: 1700, source: 'manual' },
      ],
    },
  })
  assert.deepEqual(pace.rows.map((row) => row.delta), [-18, -200, null, null])
  assert.deepEqual(pace.rows.map((row) => row.reason), [null, null, 'not_in_reference', 'not_comparable'])
  assert.deepEqual(pace.rows.map((row) => row.split), [360, 940, 50, 90], 'splits are time since the previous checkpoint')
  assert.equal(pace.compared, 2)
  assert.equal(pace.finalDelta, -240)
  assert.equal(formatDelta(-18), '18 s ahead')
  assert.equal(formatDelta(65), '1:05 behind')
  assert.equal(formatDelta(0), 'even')
  assert.equal(formatDelta(null), '')
  assert.equal(formatSignedDuration(-250), '−4:10')
  assert.equal(formatSignedDuration(35), '+0:35')

  const alone = checkpointPace({ checkpoints: [{ id: 'boss:1', kind: 'boss', at: 10, source: 'encounter_end' }], reference: null, marks: { clear: true }, durationSeconds: 100 })
  assert.equal(alone.rows[0].delta, null)
  assert.equal(alone.rows[0].reason, 'no_reference')
  assert.equal(alone.finalDelta, null, 'no fabricated finish delta without a reference')
  assert.equal(checkpointPace({}).rows.length, 0)
})

test('timeline track keeps order, scales to the run and shades time outside', () => {
  const track = timelineTrack({
    durationSeconds: 1000,
    timeline: [
      { at: 0, kind: 'enter' },
      { at: 500, kind: 'leave' },
      { at: 300, kind: 'death' },
      { at: 600, kind: 'reenter' },
      { at: 300, kind: 'level_up', level: 20 },
      { at: 1000, kind: 'complete' },
    ],
  })
  assert.deepEqual(track.markers.map((marker) => marker.kind), ['enter', 'death', 'level_up', 'leave', 'reenter', 'complete'], 'same-second events keep recorded order')
  assert.deepEqual(track.markers.map((marker) => marker.pct), [0, 30, 30, 50, 60, 100])
  assert.deepEqual(track.outside, [{ from: 50, to: 60 }])
  assert.equal(track.markers[5].label, 'Run complete')
  assert.equal(timelineTrack({ timeline: [] }).markers.length, 0)
})

test('summary never mixes dungeons or difficulties', () => {
  const stockade = { ...deadmines, name: 'The Stockade', instanceId: 34 }
  const heroic = { ...deadmines, difficultyId: 2, difficultyName: 'Heroic' }
  const runs = [
    run(1, { durationSeconds: 1700, xp: { available: true, perHour: 21000 } }),
    run(2, { durationSeconds: 1500, xp: { available: true, perHour: 25000 } }),
    run(3, { durationSeconds: 900, dungeon: stockade, xp: { available: true, perHour: 90000 } }),
    run(4, { durationSeconds: 600, dungeon: heroic }),
    run(5, { durationSeconds: 400, status: 'abandoned', marks: { clear: false, completion: 'incomplete' }, deaths: 3, xp: { available: true, perHour: 99000 } }),
  ]
  const all = performanceSummary(runs, {})
  assert.equal(all.completed, 4)
  assert.equal(all.deaths, 3)
  // Several dungeons: the newest run's dungeon and difficulty only, never a
  // PB or XP/hour across them.
  assert.equal(all.focus.chosen, 'latest')
  assert.equal(all.focus.name, 'The Deadmines')
  assert.equal(all.focus.difficultyId, 1)
  assert.equal(all.focus.pb.durationSeconds, 1500, 'not the Stockade 900 s or the heroic 600 s')
  assert.equal(all.focus.bestXpPerHour.value, 25000, 'not the Stockade 90k')
  assert.equal(performanceSummary([], {}).focus, null)
  const picked = performanceSummary(runs.filter((entry) => entry.dungeon.name === 'The Deadmines'), { dungeon: 'The Deadmines' })
  assert.equal(picked.focus.difficultyId, 1, 'the most recent run picks the difficulty')
  assert.equal(picked.focus.chosen, 'filter')
  assert.equal(picked.focus.pb.durationSeconds, 1500, 'heroic 600 s and the abandoned 400 s are not the PB')
  assert.equal(picked.focus.bestXpPerHour.value, 25000)
  assert.equal(picked.focus.typicalXpPerHour, 23000, 'median of the two completed normal runs; the abandoned 99k is not rated')
  assert.deepEqual(picked.focus.otherDifficulties, ['Heroic'])
  const single = performanceSummary([run(1)], {})
  assert.equal(single.focus.typicalXpPerHour, null, 'one run is too few for a typical value')
  assert.equal(single.focus.pb.durationSeconds, 1800)
})

test('row markers and header context', () => {
  assert.deepEqual(runMarkers(run(1, { marks: { pb: true, bestXp: true, completion: 'verified' } })).map((marker) => marker.key), ['pb', 'xp'])
  assert.deepEqual(runMarkers(run(1, { marks: { exceptional: true, completion: 'manual', completionReasons: ['Finished by hand.'] } })).map((marker) => marker.key), ['hot', 'unverified'])
  assert.deepEqual(runMarkers(run(1, { status: 'abandoned', marks: { completion: 'incomplete' } })), [])
  const options = { characters: [{ id: 'c1', name: 'Rook' }, { id: 'c2', name: 'Alt' }] }
  assert.equal(contextLine({ runs: [run(1)], filters: { character: 'c1' }, options }), 'Rook · level 20 · Live Realm')
  assert.equal(contextLine({ runs: [run(1), run(2, { character: { id: 'c2', name: 'Alt' }, realm: 'Other' })], filters: {}, options }), '2 characters · 2 realms')
})
