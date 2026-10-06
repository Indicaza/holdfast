import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesLiveTopics, routeTopics } from '../src/Live/liveRouteTopics.js'

test('live routes subscribe only to relevant domains', () => {
  assert.deepEqual(routeTopics('/quests', ''), ['quests'])
  assert.deepEqual(routeTopics('/members', ''), ['members', 'ranks', 'authority'])
  assert.deepEqual(routeTopics('/armory/character-1', ''), ['armory', 'intelligence'])
  assert.deepEqual(routeTopics('/intelligence', '#audit'), ['audit'])
  assert.deepEqual(routeTopics('/intelligence', '#guildweaver'), ['guildweaver'])
  assert.ok(routeTopics('/intelligence', '#roster').includes('intelligence'))
  assert.deepEqual(routeTopics('/privacy', ''), [])
})

test('wildcard reconnects and topic intersections invalidate active routes', () => {
  assert.equal(matchesLiveTopics(['*'], ['quests']), true)
  assert.equal(matchesLiveTopics(['members', 'notifications'], ['members']), true)
  assert.equal(matchesLiveTopics(['notifications'], ['members']), false)
  assert.equal(matchesLiveTopics([], ['members']), false)
})
