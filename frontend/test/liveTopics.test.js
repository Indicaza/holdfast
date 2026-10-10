import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesLiveTopics } from '../src/Live/liveTopics.js'

test('wildcard reconnects and topic intersections invalidate a view', () => {
  assert.equal(matchesLiveTopics(['*'], ['quests']), true)
  assert.equal(matchesLiveTopics(['members', 'notifications'], ['members']), true)
  assert.equal(matchesLiveTopics(['notifications'], ['members']), false)
  assert.equal(matchesLiveTopics([], ['members']), false)
})
