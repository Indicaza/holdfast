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
