import test from 'node:test'
import assert from 'node:assert/strict'

import { publicJoinAction } from '../src/PublicJoinCallout/publicJoinAction.js'

test('public page callouts invite visitors to join', () => {
  assert.deepEqual(publicJoinAction(false), {
    eyebrow: 'Join Holdfast',
    label: 'Join Holdfast',
    href: '/join',
  })
})

test('public page callouts send existing members to quests', () => {
  assert.deepEqual(publicJoinAction(true), {
    eyebrow: 'Member quests',
    label: 'View Quests',
    href: '/quests',
  })
})
