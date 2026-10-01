import test from 'node:test'
import assert from 'node:assert/strict'

import { foundingCalloutContent } from '../src/Home/FoundingCallout/foundingCalloutContent.js'

test('visitors receive the recruitment call to action', () => {
  assert.deepEqual(foundingCalloutContent(false), {
    eyebrow: 'Join Holdfast',
    title: 'Come play with us.',
    description:
      'No application gauntlet. Meet the guild, find your place, and get into the game.',
    action: 'Join Holdfast',
    href: null,
  })
})

test('members are sent to current guild work instead of a home-page loop', () => {
  const content = foundingCalloutContent(true)

  assert.equal(content.action, 'View Quests')
  assert.equal(content.href, '/quests')
  assert.equal(content.href.includes('guildos'), false)
})
