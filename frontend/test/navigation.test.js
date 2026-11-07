import test from 'node:test'
import assert from 'node:assert/strict'

import {
  accountMenuLinks,
  guildNavigationLinks,
  isActiveLink,
  myGuildLink,
  platformNavigationLinks,
  playerDisplayName,
  primaryNavigationLinks,
  signInNavigationLabel,
  soloNavigationLinks,
} from '../src/navigation.js'
import { matchRoute } from '../src/routing.js'

const hrefs = (links) => links.map((link) => link.href)

test('the solo navbar is the dashboard, the map and the download, nothing about guilds', () => {
  assert.deepEqual(soloNavigationLinks.map((link) => [link.label, link.href]), [['Dashboard', '/dashboard'], ['Map', '/map'], ['Download', '/download']])
  assert.equal(primaryNavigationLinks(false), soloNavigationLinks)
})

test('with guild features on, the platform navbar finds guilds, items and the addon', () => {
  assert.deepEqual(
    platformNavigationLinks.map((link) => [link.label, link.href]),
    [['Download', '/download'], ['Dashboard', '/dashboard'], ['Map', '/map'], ['Find guilds', '/'], ['Item catalog', '/items']],
  )
  assert.equal(primaryNavigationLinks(true), platformNavigationLinks)
})

test('the account action says how the player signs in', () => {
  assert.equal(signInNavigationLabel, 'Sign in with Discord')
})

test('the avatar menu links real views of the player\'s own data', () => {
  assert.deepEqual(accountMenuLinks(null).map((link) => [link.label, link.href]), [
    ['My Overview', '/dashboard'],
    ['My Characters', '/dashboard/characters'],
    ['My Devices & Sync', '/dashboard/sync'],
    ['Account & Privacy', '/account'],
  ])
  for (const link of accountMenuLinks(null)) assert.ok(matchRoute(link.href), link.href)
})

test('the avatar menu never offers guild pages while guild features are off', () => {
  const holdfast = { slug: 'holdfast', name: 'Holdfast' }
  assert.equal(accountMenuLinks(holdfast).some((link) => link.href.startsWith('/holdfast')), false)
  assert.deepEqual(hrefs(accountMenuLinks(holdfast, { guildFeatures: true })).slice(-2), ['/holdfast/members/me', '/holdfast'])
})

test('administrative tools appear only for administrators, after the player\'s links', () => {
  assert.equal(accountMenuLinks(null).some((link) => link.href.startsWith('/admin')), false)
  const admin = accountMenuLinks(null, { admin: true })
  assert.equal(admin.at(-1).href, '/admin/guildweaver')
})

test('players go by their Discord name, not a guild nickname', () => {
  const user = { username: 'rook', globalName: 'Rook', guildNickname: 'Officer Rook' }
  assert.equal(playerDisplayName(user), 'Rook')
  assert.equal(playerDisplayName({ username: 'rook' }), 'rook')
  assert.equal(playerDisplayName(user, { guildFeatures: true }), 'Officer Rook')
  assert.equal(playerDisplayName(null), 'Player')
})

test('signed-in guild navigation covers every guild page under its slug', () => {
  assert.deepEqual(guildNavigationLinks('holdfast', true).map((link) => link.label), ['Home', 'Quests', 'Members', 'Charter', 'Ranks', 'Intelligence'])
  assert.deepEqual(hrefs(guildNavigationLinks('iron-vanguard', true)), [
    '/iron-vanguard',
    '/iron-vanguard/quests',
    '/iron-vanguard/members',
    '/iron-vanguard/charter',
    '/iron-vanguard/ranks',
    '/iron-vanguard/intelligence',
  ])
})

test('signed-out guild navigation keeps to the public guild pages', () => {
  assert.deepEqual(hrefs(guildNavigationLinks('holdfast', false)), ['/holdfast', '/holdfast/charter', '/holdfast/ranks'])
})

test('My guild appears only for a player in a guild', () => {
  assert.deepEqual(myGuildLink({ slug: 'iron-vanguard', name: 'Iron Vanguard' }), { label: 'My guild', href: '/iron-vanguard' })
  assert.equal(myGuildLink(null), null)
})

test('section links stay lit on their sub-pages; home, the directory and My Overview only on themselves', () => {
  const [home, , members] = guildNavigationLinks('holdfast', true)
  assert.equal(isActiveLink('/holdfast', home), true)
  assert.equal(isActiveLink('/holdfast/quests', home), false)
  assert.equal(isActiveLink('/holdfast/members/7', members), true)
  assert.equal(isActiveLink('/holdfast/members', members), true)
  const [, , , directory, items] = platformNavigationLinks
  assert.equal(isActiveLink('/', directory), true)
  assert.equal(isActiveLink('/items', directory), false)
  assert.equal(isActiveLink('/items/2589', items), true)
  const [dashboard, map] = soloNavigationLinks
  assert.equal(isActiveLink('/dashboard/characters', dashboard), true)
  assert.equal(isActiveLink('/map', dashboard), false, 'the map is its own navbar entry')
  assert.equal(isActiveLink('/map', map), true)
  const [overview, characters] = accountMenuLinks(null)
  assert.equal(isActiveLink('/dashboard/characters', overview), false)
  assert.equal(isActiveLink('/dashboard/characters', characters), true)
})
