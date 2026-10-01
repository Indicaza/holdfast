import test from 'node:test'
import assert from 'node:assert/strict'

import {
  footerNavigationLinks,
  primaryNavigationLinks,
  publicNavigationLinks,
} from '../src/navigation.js'

test('signed-out navigation keeps public information easy to reach', () => {
  assert.deepEqual(primaryNavigationLinks(false), publicNavigationLinks)
  assert.deepEqual(
    publicNavigationLinks.map((link) => link.href),
    ['/charter', '/ranks'],
  )
})

test('signed-in navigation adds member destinations before public pages', () => {
  assert.deepEqual(
    primaryNavigationLinks(true).map((link) => link.href),
    ['/quests', '/members', '/charter', '/ranks'],
  )
})

test('footer leads with joining and contains no developer destination', () => {
  assert.deepEqual(
    footerNavigationLinks.map((link) => link.href),
    ['/join', '/charter', '/ranks', '/privacy'],
  )
  assert.equal(
    footerNavigationLinks.some((link) => link.href.includes('github.com')),
    false,
  )
})
