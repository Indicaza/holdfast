import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizePathname, resolvePathname } from '../src/routing.js'

const knownPathnames = [
  '/',
  '/join',
  '/members',
  '/charter',
  '/ranks',
  '/privacy',
]

test('normalizes root and trailing slashes', () => {
  assert.equal(normalizePathname('/'), '/')
  assert.equal(normalizePathname('/charter///'), '/charter')
})

test('resolves known public routes', () => {
  assert.equal(resolvePathname('/join', knownPathnames), '/join')
  assert.equal(resolvePathname('/ranks/', knownPathnames), '/ranks')
  assert.equal(resolvePathname('/members/', knownPathnames), '/members')
})

test('allows dynamic member profile routes', () => {
  assert.equal(
    resolvePathname('/members/123456789', knownPathnames),
    '/members/123456789',
  )
})

test('preserves the legacy guildos redirect without treating it as a page', () => {
  assert.equal(resolvePathname('/guildos', knownPathnames), '/')
})

test('unknown and malformed routes resolve to not found', () => {
  assert.equal(resolvePathname('/not-a-real-page', knownPathnames), null)
  assert.equal(resolvePathname('/members/123/extra', knownPathnames), null)
})
