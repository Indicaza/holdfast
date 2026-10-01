import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const sourceDirectory = join(testDirectory, '..', 'src')
const internalFiles = new Set(['routing.js'])

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return sourceFiles(path)
    }

    if (!['.js', '.jsx'].includes(extname(entry.name))) {
      return []
    }

    return internalFiles.has(entry.name) ? [] : [path]
  })
}

test('player-facing source does not use internal product branding', () => {
  const violations = sourceFiles(sourceDirectory)
    .filter((path) => /GuildOS/i.test(readFileSync(path, 'utf8')))
    .map((path) => relative(sourceDirectory, path))

  assert.deepEqual(violations, [])
})
