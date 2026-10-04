import test from 'node:test'
import assert from 'node:assert/strict'
import { joinHref, safeReturnTo } from '../src/Join/joinDestination.js'

test('recruitment preserves local paths, quest intent, and anchors', () => {
  const destination = '/?signupQuest=supply&signupObjective=linen&questAction=signup#quest-board'
  assert.equal(safeReturnTo(destination), destination)
  const url = new URL(joinHref(destination), 'https://holdfast.invalid')
  assert.equal(url.pathname, '/join')
  assert.equal(url.searchParams.get('returnTo'), destination)
  assert.equal(joinHref('/'), '/join')
  assert.equal(safeReturnTo('/ranks'), '/ranks')
})

test('unsafe and recursive recruitment destinations return home', () => {
  for (const value of [undefined, '', 'https://example.com', '//example.com', '/\\example.com', '/%5cexample.com', '/%2fexample.com', '/%09example.com', '/join', '/join/?auth=connected', '/%zz']) {
    assert.equal(safeReturnTo(value), '/', String(value))
  }
})
