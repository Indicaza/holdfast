import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogLink } from '../src/Items/catalogLinks.js'

test('item and recipe links preserve game build and language', () => {
  const scope = { gameBuild: '70338', locale: 'en_US' }
  assert.equal(catalogLink(2589, scope), '/items/2589?build=70338&locale=en_US')
  const url = new URL(catalogLink(null, scope, { q: 'Stone & Cloth', after: 2589 }), 'https://holdfast.example')
  assert.equal(url.searchParams.get('q'), 'Stone & Cloth')
  assert.equal(url.searchParams.get('after'), '2589')
  assert.equal(url.searchParams.get('build'), '70338')
})
