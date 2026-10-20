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

test('registration drafts validate step by step and preview as a card', async () => {
  const { draftSlug, previewGuild, registrationDraft, stepErrors } = await import('../src/Guilds/guildDirectoryModel.js')
  const draft = registrationDraft()
  assert.deepEqual(Object.keys(stepErrors(draft, 0)).sort(), ['faction', 'name', 'realm', 'realmType'])
  const named = { ...draft, name: 'Les Chevaliers d’Élune', faction: 'alliance', realm: 'Sulfuron', realmType: 'pvp' }
  assert.deepEqual(stepErrors(named, 0), {})
  assert.equal(draftSlug(named.name), 'les-chevaliers-d-elune')
  assert.deepEqual(stepErrors(named, 1), { playStyles: 'guild_play_style_required' })
  assert.deepEqual(stepErrors({ ...named, playStyles: ['raiding'], raidStart: '20:00' }, 1), { raidStart: 'guild_raid_window_incomplete' })
  const preview = previewGuild(named)
  assert.equal(preview.slug, 'les-chevaliers-d-elune')
  assert.equal(preview.stats.verified, false)
  assert.equal(previewGuild(registrationDraft()).name, 'Your Guild')
  assert.equal(previewGuild({ ...named, discordInviteUrl: ' discord.gg/x ', voiceRequired: true }).discordInviteUrl, 'discord.gg/x')
})

test('the register rail measures required fields and refuses to skip an invalid step', async () => {
  const { firstInvalidStep, registrationDraft, registrationProgress } = await import('../src/Guilds/guildDirectoryModel.js')
  const draft = registrationDraft()
  assert.deepEqual(registrationProgress(draft), { done: 0, total: 5 })
  const identity = { ...draft, name: 'Ashen Vanguard', faction: 'horde', realm: 'Doomhowl', realmType: 'hardcore' }
  assert.deepEqual(registrationProgress(identity), { done: 4, total: 5 })
  assert.equal(firstInvalidStep(draft, 0, 2), 0)
  assert.equal(firstInvalidStep(identity, 0, 2), 1)
  assert.equal(firstInvalidStep({ ...identity, playStyles: ['raiding'] }, 0, 2), -1)
  assert.equal(firstInvalidStep(draft, 1, 1), -1)
})

test('the finder keeps the selected guild beside the filters and steps through results', async () => {
  const { finderHref, selectedGuildFromQuery, stepSelection, weekStrip, activityShare, emptyFilters } = await import('../src/Guilds/guildDirectoryModel.js')
  assert.equal(finderHref({ ...emptyFilters(), faction: ['horde'] }, 'ashen-vanguard'), '/?faction=horde&guild=ashen-vanguard')
  assert.equal(finderHref(emptyFilters()), '/')
  assert.equal(selectedGuildFromQuery('?faction=horde&guild=ashen-vanguard'), 'ashen-vanguard')
  assert.equal(selectedGuildFromQuery('?guild=<script>'), '')
  assert.equal(stepSelection(['a', 'b', 'c'], 'b', 1), 'c')
  assert.equal(stepSelection(['a', 'b', 'c'], 'c', 1), 'c')
  assert.equal(stepSelection(['a', 'b', 'c'], '', 1), 'a')
  assert.equal(stepSelection(['a', 'b', 'c'], '', -1), 'c')
  assert.equal(stepSelection([], 'a', 1), '')
  assert.deepEqual(weekStrip(['tue', 'sat']).filter((day) => day.active).map((day) => day.day), ['tue', 'sat'])
  assert.equal(activityShare({ memberCount: 40, activeCharacters: 10 }), 0.25)
  assert.equal(activityShare({ memberCount: 0, activeCharacters: 3 }), 0)
})
