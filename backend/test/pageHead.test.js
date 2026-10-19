import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { guildPageHead, withPageHead } from '../src/Production/pageHead.js'

const index = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8')
const guilds = { 'iron-pact': { title: 'Iron Pact | Guildweaver', description: 'Dwarven engineers.' } }
const read = (slug) => guilds[slug] || null

test('the directory and platform pages are served as built', () => {
  for (const pathname of ['/', '/register', '/items', '/items/2589', '/guildweaver', '/privacy', '/admin', '/join', '/assets/x.js']) {
    assert.equal(guildPageHead(pathname, read), null, pathname)
  }
  assert.match(index, /<title>Guildweaver \| Find a World of Warcraft Guild<\/title>/)
})

test('Holdfast pages keep Holdfast\'s title; other guilds use their listing', () => {
  assert.equal(guildPageHead('/holdfast', read).title, 'Holdfast | Alliance WoW Forever Guild')
  assert.equal(guildPageHead('/holdfast/quests', read).title, 'Holdfast | Alliance WoW Forever Guild')
  assert.deepEqual(guildPageHead('/iron-pact/charter', read), guilds['iron-pact'])
  assert.equal(guildPageHead('/no-such-guild', read), null)
  assert.equal(guildPageHead('/iron-pact', () => { throw new Error('database unavailable') }), null)
})

test('a guild head replaces the title, description and social tags', () => {
  const html = withPageHead(index, { title: 'Iron Pact | Guildweaver', description: 'Steel & "glory" <always>' })
  assert.match(html, /<title>Iron Pact \| Guildweaver<\/title>/)
  assert.doesNotMatch(html, /Find a World of Warcraft Guild/)
  for (const key of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    assert.match(html, new RegExp(`${key}\\s+content="Steel &amp; &quot;glory&quot; &lt;always&gt;"`), key)
  }
  for (const key of ['property="og:title"', 'name="twitter:title"']) {
    assert.match(html, new RegExp(`${key} content="Iron Pact \\| Guildweaver"`), key)
  }
})
