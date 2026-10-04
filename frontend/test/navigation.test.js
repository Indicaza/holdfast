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
    ['/charter', '/ranks'],
  )
})

test('the account action is labeled as sign in rather than recruitment', () => {
  assert.equal(signInNavigationLabel, 'Sign In')
})

test('signed-in navigation adds member destinations before public pages', () => {
  assert.deepEqual(
    primaryNavigationLinks(true).map((link) => link.href),
    ['/quests', '/members', '/charter', '/ranks'],
  )
})

test('footer leads with joining and exposes the public source repository', () => {
  assert.deepEqual(
    footerNavigationLinks.map((link) => link.href),
    [
      '/join',
      '/charter',
      '/ranks',
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
