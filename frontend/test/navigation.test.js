import test from 'node:test'
import assert from 'node:assert/strict'

import {
  footerNavigationLinks,
  primaryNavigationLinks,
  publicNavigationLinks,
  signInNavigationLabel,
} from '../src/navigation.js'

test('signed-out navigation keeps public information easy to reach', () => {
  assert.deepEqual(primaryNavigationLinks(false), publicNavigationLinks)
  assert.deepEqual(
    publicNavigationLinks.map((link) => link.href),
    ['/guilds', '/charter', '/ranks', '/items', '/guildweaver'],
  )
})

test('the account action is labeled as sign in rather than recruitment', () => {
  assert.equal(signInNavigationLabel, 'Sign In')
})

test('signed-in primary navigation stays focused and leaves GuildOS in the account menu', () => {
  assert.deepEqual(
    primaryNavigationLinks(true).map((link) => link.href),
    ['/quests', '/members', '/guilds', '/charter', '/ranks', '/items', '/guildweaver'],
  )
  assert.equal(primaryNavigationLinks(true).some((link) => link.href === '/intelligence'), false)
})

test('footer leads with joining and exposes Guildweaver plus the public source repository', () => {
  assert.deepEqual(
    footerNavigationLinks.map((link) => link.href),
    [
      '/join',
      '/guilds',
      '/charter',
      '/ranks',
      '/items',
      '/guildweaver',
      '/privacy',
      'https://github.com/Indicaza/holdfast',
    ],
  )

  const source = footerNavigationLinks.find((link) => link.label === 'Source')
  assert.deepEqual(source, {
    label: 'Source',
    href: 'https://github.com/Indicaza/holdfast',
    external: true,
  })
})
