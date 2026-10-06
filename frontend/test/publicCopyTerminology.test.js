import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const sourceDirectory = join(testDirectory, '..', 'src')

function source(path) {
  return readFileSync(join(sourceDirectory, path), 'utf8')
}

test('member-facing operations surface is consistently branded GuildOS', () => {
  const app = source('App.jsx')
  const navbar = source('Home/Navbar/Navbar.jsx')
  const shell = source('Intelligence/IntelligenceAppShell.jsx')

  assert.match(app, /title: 'GuildOS \| Holdfast'/)
  assert.match(navbar, />GuildOS<\/a>/)
  assert.match(shell, /<strong>GuildOS<\/strong>/)
  assert.match(shell, /<span>GuildOS<\/span>/)

  assert.doesNotMatch(navbar, />Guild Intelligence<\/a>/)
  assert.doesNotMatch(navbar, />Audit Log<\/a>/)
  assert.doesNotMatch(navbar, />Guildweaver Sync<\/a>/)
})
