import assert from 'node:assert/strict'
import test from 'node:test'

import { apiFetch, apiJson, ApiError } from '../src/Api/apiClient.js'

test('apiFetch applies credentials and no-store defaults', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  let receivedOptions
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/example')
    receivedOptions = options
    return new Response(null, { status: 204 })
  }

  const response = await apiFetch('/api/example')

  assert.equal(response.status, 204)
  assert.equal(receivedOptions.credentials, 'include')
  assert.equal(receivedOptions.cache, 'no-store')
  assert.ok(receivedOptions.signal instanceof AbortSignal)
});

test('apiFetch aborts a request that exceeds its timeout', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(options.signal.reason),
        { once: true },
      )
    })

  await assert.rejects(
    () => apiFetch('/api/slow', { attempts: 1, timeoutMs: 5 }),
    (error) => error?.name === 'TimeoutError',
  )
});

test('apiJson exposes structured API errors', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'permission_required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })

  await assert.rejects(
    () => apiJson('/api/protected'),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'permission_required',
  )
});
