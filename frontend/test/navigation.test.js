import test from 'node:test'
import assert from 'node:assert/strict'

import {
  accountMenuLinks,
  guildNavigationLinks,
  isActiveLink,
  myGuildLink,
  platformNavigationLinks,
  signInNavigationLabel,
} from '../src/navigation.js'

const hrefs = (links) => links.map((link) => link.href)

test('the platform navbar finds guilds, items and the addon', () => {
  assert.deepEqual(
    platformNavigationLinks.map((link) => [link.label, link.href]),
    [['Find guilds', '/'], ['Item catalog', '/items'], ['Addon', '/guildweaver']],
  )
})

test('the account action is labeled as sign in rather than recruitment', () => {
  assert.equal(signInNavigationLabel, 'Sign In')
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

test('the account menu links the player profile in their own guild', () => {
  assert.deepEqual(accountMenuLinks({ slug: 'holdfast', name: 'Holdfast' }), [
    { label: 'My Profile', href: '/holdfast/members/me' },
    { label: 'Holdfast', href: '/holdfast' },
  ])
  assert.deepEqual(accountMenuLinks(null), [{ label: 'My Profile', href: '/holdfast/members/me' }])
})

test('section links stay lit on their sub-pages; home and the directory only on themselves', () => {
  const [home, , members] = guildNavigationLinks('holdfast', true)
  assert.equal(isActiveLink('/holdfast', home), true)
  assert.equal(isActiveLink('/holdfast/quests', home), false)
  assert.equal(isActiveLink('/holdfast/members/7', members), true)
  assert.equal(isActiveLink('/holdfast/members', members), true)
  const [directory, items] = platformNavigationLinks
  assert.equal(isActiveLink('/', directory), true)
  assert.equal(isActiveLink('/items', directory), false)
  assert.equal(isActiveLink('/items/2589', items), true)
})
