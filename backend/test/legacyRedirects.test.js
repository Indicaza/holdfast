import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'

import { legacyRedirectPathname } from '../src/Production/legacyRedirects.js'
import { validSlug } from '../src/Guild/Directory/guildDirectoryModel.js'
import {
  RESERVED_TOP_LEVEL_SEGMENTS,
  legacyRedirectPathname as frontendLegacyRedirectPathname,
} from '../../frontend/src/routing.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

const LEGACY_PATHS = {
  '/quests': '/holdfast/quests',
  '/charter': '/holdfast/charter',
  '/members': '/holdfast/members',
  '/members/me': '/holdfast/members/me',
  '/members/123456789': '/holdfast/members/123456789',
  '/ranks': '/holdfast/ranks',
  '/intelligence': '/holdfast/intelligence',
  '/guilds': '/',
  '/guilds/': '/',
  '/guilds/iron-vanguard': '/iron-vanguard',
  '/guilds/register': '/register',
  '/guildos': '/',
}

const CURRENT_PATHS = ['/', '/holdfast', '/holdfast/quests', '/register', '/items', '/items/2589', '/guildweaver', '/privacy', '/members/1/extra', '/quests/1', '/guilds/a/b']

test('old single-guild paths map to their multi-guild home', () => {
  for (const [from, to] of Object.entries(LEGACY_PATHS)) assert.equal(legacyRedirectPathname(from), to, from)
  for (const pathname of CURRENT_PATHS) assert.equal(legacyRedirectPathname(pathname), null, pathname)
})

test('the server and the app redirect the same old paths', () => {
  for (const pathname of [...Object.keys(LEGACY_PATHS), ...CURRENT_PATHS]) {
    assert.equal(legacyRedirectPathname(pathname), frontendLegacyRedirectPathname(pathname), pathname)
  }
})

test('no guild can take a slug the site uses as a top-level path', () => {
  const publicFolders = readdirSync(new URL('../../frontend/public/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  for (const segment of [...RESERVED_TOP_LEVEL_SEGMENTS, ...publicFolders]) {
    assert.equal(validSlug(segment), false, segment)
  }
  assert.equal(validSlug('holdfast'), true)
})

test('old paths answer with a permanent redirect that keeps the query string', async () => {
  await withHttpApp(async ({ request }) => {
    for (const [from, to] of Object.entries(LEGACY_PATHS)) {
      const response = await request(from)
      assert.equal(response.status, 301, from)
      assert.equal(response.headers.get('location'), to, from)
    }

    const quests = await request('/quests?q=linen&view=board')
    assert.equal(quests.status, 301)
    assert.equal(quests.headers.get('location'), '/holdfast/quests?q=linen&view=board')

    const guild = await request('/guilds/iron-vanguard?apply=1')
    assert.equal(guild.headers.get('location'), '/iron-vanguard?apply=1')

    const head = await request('/charter', { method: 'HEAD' })
    assert.equal(head.status, 301)
  })
})

test('new paths are served by the app and APIs are never redirected', async () => {
  await withHttpApp(async ({ request }) => {
    for (const pathname of ['/', '/register', '/iron-vanguard']) {
      const response = await request(pathname, { headers: { Accept: 'text/html' } })
      assert.equal(response.status, 200, pathname)
      assert.match(response.text, /<title>HTTP test frontend<\/title>/, pathname)
    }
    for (const pathname of ['/holdfast', '/holdfast/quests', '/holdfast/members/me']) {
      const response = await request(pathname, { headers: { Accept: 'text/html' } })
      assert.equal(response.status, 200, pathname)
      assert.match(response.text, /<title>Holdfast \| Alliance WoW Forever Guild<\/title>/, pathname)
      assert.equal(response.headers.get('cache-control'), 'no-cache', pathname)
    }

    const api = await request('/api/guilds/holdfast')
    assert.equal(api.status, 200)
    assert.equal(api.json.guild.slug, 'holdfast')

    const post = await request('/quests', { method: 'POST', body: {} })
    assert.notEqual(post.status, 301)
  })
})
