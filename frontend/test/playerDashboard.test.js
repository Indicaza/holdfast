import test from 'node:test'
import assert from 'node:assert/strict'

import { authResultMessage } from '../src/Auth/authResult.js'
import { signInReturnTo } from '../src/Auth/returnTo.js'
import { readGuildFeatures } from '../src/Features/guildFeatures.js'
import {
  DASHBOARD_VIEWS,
  characterServerKey,
  charactersByServer,
  dashboardHref,
  onServerKey,
  playerApiUrl,
  resolveServer,
  serverLabel,
  setupSteps,
  storeServer,
  storedServer,
  syncStatusCopy,
  withServer,
} from '../src/Player/playerModel.js'
import { matchRoute } from '../src/routing.js'

const servers = [
  { key: 'us:doomhowl', realm: 'Doomhowl', region: 'US', label: 'Doomhowl', characterCount: 2 },
  { key: 'us:shadowmoon', realm: 'Shadowmoon', region: 'US', label: 'Shadowmoon', characterCount: 1 },
]

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('signing in from the front or download page lands on My Overview; elsewhere returns there', () => {
  assert.equal(signInReturnTo({ href: 'https://guildweaver.gg/' }), '/dashboard')
  assert.equal(signInReturnTo({ href: 'https://guildweaver.gg/download?auth=cancelled' }), '/dashboard')
  assert.equal(signInReturnTo({ href: 'https://guildweaver.gg/dashboard/farming?server=us%3Adoomhowl' }), '/dashboard/farming?server=us%3Adoomhowl')
  // The bridge's pairing page keeps its code through sign-in.
  assert.equal(signInReturnTo({ href: 'https://guildweaver.gg/guildweaver/connect?code=ABCD-EFGH&auth=failed' }), '/guildweaver/connect?code=ABCD-EFGH')
  assert.equal(signInReturnTo({ href: 'https://guildweaver.gg/items/2589#sources' }), '/items/2589#sources')
})

test('sign-in problems say what happened without guild jargon', () => {
  for (const code of ['cancelled', 'failed', 'invalid-state', 'missing-code', 'connected']) {
    const message = authResultMessage(code)
    assert.ok(message.title && message.intro && message.retry, code)
    assert.doesNotMatch(`${message.title} ${message.intro}`, /holdfast|member|guild|rank|permission/i, code)
  }
  assert.match(authResultMessage('invalid-state').title, /expired/)
  assert.match(authResultMessage('connected', 'error').title, /could not reach/i)
})

test('guild features are off unless the server says otherwise', () => {
  assert.equal(readGuildFeatures(null), false)
  assert.equal(readGuildFeatures({ querySelector: () => null }), false)
  assert.equal(readGuildFeatures({ querySelector: () => ({ getAttribute: () => 'on' }) }), true)
  assert.equal(readGuildFeatures({ querySelector: () => ({ getAttribute: () => 'off' }) }), false)
})

test('every dashboard view has a real route and keeps the chosen server', () => {
  assert.deepEqual(DASHBOARD_VIEWS.map((view) => view.label), ['Overview', 'Characters', 'Professions', 'Farming', 'Sync'])
  for (const view of DASHBOARD_VIEWS) {
    assert.deepEqual(matchRoute(dashboardHref(view.id)), { name: 'dashboard', section: view.id })
  }
  assert.equal(dashboardHref('farming', 'us:doomhowl'), '/dashboard/farming?server=us%3Adoomhowl')
  assert.equal(withServer('/dashboard/characters?character=x#top', 'us:shadowmoon'), '/dashboard/characters?character=x&server=us%3Ashadowmoon#top')
  assert.equal(withServer('/dashboard?server=us%3Adoomhowl', ''), '/dashboard')
  assert.equal(playerApiUrl('craft-finder', 'us:doomhowl', { q: 'potion', empty: '' }), '/api/player/craft-finder?server=us%3Adoomhowl&q=potion')
  assert.equal(playerApiUrl('farming'), '/api/player/farming')
})

test('the server shown is the link\'s, then the remembered one, and never one the player lacks', () => {
  assert.equal(resolveServer({ requested: 'us:shadowmoon', stored: 'us:doomhowl', servers }), 'us:shadowmoon')
  assert.equal(resolveServer({ requested: '', stored: 'us:doomhowl', servers }), 'us:doomhowl')
  assert.equal(resolveServer({ requested: 'us:someone-elses', stored: 'us:doomhowl', servers }), 'us:doomhowl')
  assert.equal(resolveServer({ requested: 'us:someone-elses', stored: '', servers }), '')
  assert.equal(resolveServer({ requested: '', stored: 'us:gone', servers }), '')
  assert.equal(serverLabel(servers, ''), 'All servers')
  assert.equal(serverLabel(servers, 'us:doomhowl'), 'Doomhowl')
})

test('the remembered server belongs to one account on one browser', () => {
  const storage = memoryStorage()
  storeServer('ash', 'us:doomhowl', storage)
  assert.equal(storedServer('ash', storage), 'us:doomhowl')
  assert.equal(storedServer('bram', storage), '')
  storeServer('ash', '', storage)
  assert.equal(storedServer('ash', storage), '')
  assert.equal(storedServer('', storage), '')
})

test('characters group by server identity, never by name', () => {
  const characters = [
    { id: 'a', name: 'Rook', realm: 'Doomhowl', region: 'US' },
    { id: 'b', name: 'Rook', realm: 'Shadowmoon', region: 'US' },
    { id: 'c', name: 'Fern', realm: 'doomhowl', region: 'us' },
  ]
  assert.equal(characterServerKey(characters[0]), 'us:doomhowl')
  assert.equal(characterServerKey({ realm: '' }), 'unknown')
  const groups = charactersByServer(characters, servers)
  assert.deepEqual(groups.map((group) => [group.server.key, group.characters.map((character) => character.id)]), [
    ['us:doomhowl', ['a', 'c']],
    ['us:shadowmoon', ['b']],
  ])
  assert.deepEqual(characters.filter((character) => onServerKey(character, 'us:shadowmoon')).map((character) => character.id), ['b'])
  assert.equal(characters.filter((character) => onServerKey(character, '')).length, 3)
})

test('first-run steps and sync messages follow what the website received', () => {
  assert.deepEqual(setupSteps({ state: 'no_device', connectedDevices: 0 }).map((step) => step.done), [false, false, false])
  assert.deepEqual(setupSteps({ state: 'waiting_for_data', connectedDevices: 1 }).map((step) => step.done), [true, true, false])
  assert.deepEqual(setupSteps({ state: 'synced', connectedDevices: 1, lastUploadAt: 'x' }).map((step) => step.done), [true, true, true])

  assert.equal(syncStatusCopy({ state: 'no_device' }).action.href, '/download')
  assert.match(syncStatusCopy({ state: 'no_device', disconnectedDevices: 1 }).title, /No computer is connected/)
  const waiting = syncStatusCopy({ state: 'waiting_for_data' })
  assert.match(waiting.body, /\/reload or log out/)
  assert.doesNotMatch(waiting.body, /instant|live while|real time/i)
  assert.equal(syncStatusCopy({ state: 'processing' }).title, 'Upload received.')
  assert.equal(syncStatusCopy({ state: 'stale', connectedDevices: 1 }).action.href, '/dashboard/sync')
  assert.equal(syncStatusCopy({ state: 'stale', connectedDevices: 0 }).action.href, '/download')
  assert.equal(syncStatusCopy({ state: 'synced' }).tone, 'ok')
})
