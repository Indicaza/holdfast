import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GUILD_SECTIONS,
  RESERVED_TOP_LEVEL_SEGMENTS,
  guildHref,
  guildNameFromSlug,
  guildSlugFromPathname,
  isGuildSlug,
  legacyRedirectPathname,
  matchRoute,
  normalizePathname,
} from '../src/routing.js'

test('normalizes root and trailing slashes', () => {
  assert.equal(normalizePathname('/'), '/')
  assert.equal(normalizePathname('/holdfast/charter///'), '/holdfast/charter')
})

test('the guild directory is the front page and platform pages stay top level', () => {
  assert.deepEqual(matchRoute('/'), { name: 'directory' })
  assert.deepEqual(matchRoute('/register'), { name: 'register' })
  assert.deepEqual(matchRoute('/register/'), { name: 'register' })
  assert.deepEqual(matchRoute('/items'), { name: 'items', itemId: null })
  assert.deepEqual(matchRoute('/items/2589'), { name: 'items', itemId: '2589' })
  assert.deepEqual(matchRoute('/guildweaver'), { name: 'guildweaver' })
  assert.deepEqual(matchRoute('/guildweaver/connect'), { name: 'guildweaver-connect' })
  assert.deepEqual(matchRoute('/privacy'), { name: 'privacy' })
  assert.deepEqual(matchRoute('/admin'), { name: 'admin' })
  assert.deepEqual(matchRoute('/admin/guildweaver'), { name: 'admin-guildweaver' })
  assert.deepEqual(matchRoute('/join'), { name: 'join' })
})

test('a guild drills down from its slug', () => {
  assert.deepEqual(matchRoute('/holdfast'), { name: 'guild', slug: 'holdfast', section: 'home' })
  assert.deepEqual(matchRoute('/iron-vanguard/'), { name: 'guild', slug: 'iron-vanguard', section: 'home' })
  for (const section of ['quests', 'members', 'charter', 'ranks', 'intelligence', 'about']) {
    assert.deepEqual(matchRoute(`/holdfast/${section}`), { name: 'guild', slug: 'holdfast', section })
  }
  assert.deepEqual(matchRoute('/holdfast/members/123456789'), { name: 'guild', slug: 'holdfast', section: 'member', memberId: '123456789' })
  assert.deepEqual(matchRoute('/holdfast/members/me'), { name: 'guild', slug: 'holdfast', section: 'member', memberId: 'me' })
  assert.deepEqual(matchRoute('/holdfast/members/a%20b'), { name: 'guild', slug: 'holdfast', section: 'member', memberId: 'a b' })
})

test('unknown and malformed routes resolve to not found', () => {
  assert.equal(matchRoute('/holdfast/not-a-page'), null)
  assert.equal(matchRoute('/holdfast/members/123/extra'), null)
  assert.equal(matchRoute('/holdfast/quests/1'), null)
  assert.equal(matchRoute('/Holdfast'), null)
  assert.equal(matchRoute('/x'), null)
  assert.equal(matchRoute('/items/not-a-number'), null)
  assert.equal(matchRoute('/admin/other'), null)
})

test('reserved segments are never read as guild slugs', () => {
  for (const segment of RESERVED_TOP_LEVEL_SEGMENTS) {
    assert.equal(isGuildSlug(segment), false, segment)
  }
  for (const section of GUILD_SECTIONS) {
    assert.ok(RESERVED_TOP_LEVEL_SEGMENTS.includes(section), section)
  }
  assert.equal(matchRoute('/guilds'), null)
  assert.equal(matchRoute('/wow-art'), null)
  assert.equal(isGuildSlug('holdfast'), true)
})

test('old single-guild paths move under Holdfast and old directory paths to the top', () => {
  assert.equal(legacyRedirectPathname('/quests'), '/holdfast/quests')
  assert.equal(legacyRedirectPathname('/quests/'), '/holdfast/quests')
  assert.equal(legacyRedirectPathname('/charter'), '/holdfast/charter')
  assert.equal(legacyRedirectPathname('/members'), '/holdfast/members')
  assert.equal(legacyRedirectPathname('/members/me'), '/holdfast/members/me')
  assert.equal(legacyRedirectPathname('/members/123456789'), '/holdfast/members/123456789')
  assert.equal(legacyRedirectPathname('/ranks'), '/holdfast/ranks')
  assert.equal(legacyRedirectPathname('/intelligence'), '/holdfast/intelligence')
  assert.equal(legacyRedirectPathname('/guilds'), '/')
  assert.equal(legacyRedirectPathname('/guilds/iron-vanguard'), '/iron-vanguard')
  assert.equal(legacyRedirectPathname('/guilds/register'), '/register')
  assert.equal(legacyRedirectPathname('/guildos'), '/')
})

test('current paths and non-pages are not redirected', () => {
  for (const pathname of ['/', '/holdfast', '/holdfast/quests', '/register', '/items', '/members/1/extra', '/quests/1', '/guilds/a/b']) {
    assert.equal(legacyRedirectPathname(pathname), null, pathname)
  }
})

test('guild paths and the guild a path is in', () => {
  assert.equal(guildHref('holdfast'), '/holdfast')
  assert.equal(guildHref('iron-vanguard', '/quests'), '/iron-vanguard/quests')
  assert.equal(guildHref(null, '/charter'), '/holdfast/charter')
  assert.equal(guildSlugFromPathname('/iron-vanguard/members/7'), 'iron-vanguard')
  assert.equal(guildSlugFromPathname('/items'), null)
  assert.equal(guildSlugFromPathname('/'), null)
  assert.equal(guildNameFromSlug('iron-vanguard'), 'Iron Vanguard')
  assert.equal(guildNameFromSlug('holdfast'), 'Holdfast')
})

test('directory cards link to the guild home at its slug', async () => {
  const { guildPath } = await import('../src/Guilds/guildDirectoryModel.js')
  assert.equal(guildPath('iron-vanguard'), '/iron-vanguard')
})
