import test from 'node:test'
import assert from 'node:assert/strict'

import { runAuthenticatedMutation } from '../src/Auth/authenticatedMutation.js'

function authError() {
  const error = new Error('authentication_required')
  error.status = 401
  return error
}

test('authenticated mutation returns immediately when the request succeeds', async () => {
  let refreshes = 0
  let reauths = 0

  const result = await runAuthenticatedMutation({
    request: async () => ({ ok: true }),
    refresh: async () => {
      refreshes += 1
      return { status: 'ready', authenticated: true }
    },
    reauthenticate: () => {
      reauths += 1
    },
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(refreshes, 0)
  assert.equal(reauths, 0)
})

test('authenticated mutation refreshes and retries once after a stale 401', async () => {
  let requests = 0
  let reauths = 0

  const result = await runAuthenticatedMutation({
    request: async () => {
      requests += 1
      if (requests === 1) throw authError()
      return { recovered: true }
    },
    refresh: async () => ({
      status: 'ready',
      authenticated: true,
    }),
    reauthenticate: () => {
      reauths += 1
    },
  })

  assert.deepEqual(result, { recovered: true })
  assert.equal(requests, 2)
  assert.equal(reauths, 0)
})

test('authenticated mutation reauthenticates when the refreshed session is gone', async () => {
  let reauths = 0

  const result = await runAuthenticatedMutation({
    request: async () => {
      throw authError()
    },
    refresh: async () => ({
      status: 'ready',
      authenticated: false,
    }),
    reauthenticate: () => {
      reauths += 1
    },
  })

  assert.equal(result, null)
  assert.equal(reauths, 1)
})

test('authenticated mutation reauthenticates when the retry is still unauthorized', async () => {
  let requests = 0
  let reauths = 0

  const result = await runAuthenticatedMutation({
    request: async () => {
      requests += 1
      throw authError()
    },
    refresh: async () => ({
      status: 'ready',
      authenticated: true,
    }),
    reauthenticate: () => {
      reauths += 1
    },
  })

  assert.equal(result, null)
  assert.equal(requests, 2)
  assert.equal(reauths, 1)
})

test('authenticated mutation does not redirect to OAuth when session refresh itself fails', async () => {
  const original = authError()
  let reauths = 0

  await assert.rejects(
    () =>
      runAuthenticatedMutation({
        request: async () => {
          throw original
        },
        refresh: async () => ({
          status: 'error',
          authenticated: false,
        }),
        reauthenticate: () => {
          reauths += 1
        },
      }),
    original,
  )

  assert.equal(reauths, 0)
})
