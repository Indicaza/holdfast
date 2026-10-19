import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activeFilterCount,
  classMixSegments,
  emptyFilters,
  filtersFromQuery,
  guildInitials,
  lastActiveLabel,
  queryFromFilters,
  scheduleSummary,
  sizeLabel,
  toggleValue,
} from '../src/Guilds/guildDirectoryModel.js'

test('filters round-trip through the query string so searches can be shared', () => {
  const filters = { ...emptyFilters(), faction: ['horde'], realmType: ['pvp', 'hardcore'], style: ['raiding'], class: 'priest', recruiting: true, q: 'doom' }
  const query = queryFromFilters(filters)
  assert.equal(query, '?faction=horde&realmType=pvp%2Chardcore&style=raiding&q=doom&class=priest&recruiting=1')
  assert.deepEqual(filtersFromQuery(query), filters)
  assert.equal(queryFromFilters(emptyFilters()), '', 'the default sort stays out of the URL')
  assert.equal(queryFromFilters({ ...emptyFilters(), sort: 'newest' }), '?sort=newest')
  assert.equal(activeFilterCount(filters), 7)
  assert.deepEqual(toggleValue(['pvp'], 'pvp'), [])
  assert.deepEqual(toggleValue(['pvp'], 'rp'), ['pvp', 'rp'])
})

test('schedules read like a recruitment post, in week order', () => {
  assert.equal(scheduleSummary({ raidDays: ['thu', 'tue'], raidStart: '20:00', raidEnd: '23:30' }, 'America/New_York'), 'Tue · Thu 8pm–11:30pm New York')
  assert.equal(scheduleSummary({ raidDays: [] }), 'Flexible schedule')
  assert.equal(scheduleSummary({ raidDays: ['sat'] }), 'Sat')
})

test('roster facts format for cards', () => {
  assert.equal(sizeLabel({ memberCount: 1 }), '1 member')
  assert.equal(sizeLabel({ memberCount: 1200 }), '1,200 members')
  const segments = classMixSegments({ mage: 2, priest: 6, warrior: 2 })
  assert.deepEqual(segments.map((segment) => segment.token), ['priest', 'mage', 'warrior'])
  assert.equal(segments[0].share, 0.6)
  assert.equal(segments[0].color, '#ffffff')
  assert.deepEqual(classMixSegments({}), [])
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(lastActiveLabel('2026-10-19T11:30:00Z', now), 'Active now')
  assert.equal(lastActiveLabel('2026-10-19T07:00:00Z', now), 'Active 5h ago')
  assert.equal(lastActiveLabel('2026-10-16T12:00:00Z', now), 'Active 3d ago')
  assert.equal(guildInitials('Ashen Vanguard'), 'AV')
  assert.equal(guildInitials('Holdfast'), 'HO')
})
