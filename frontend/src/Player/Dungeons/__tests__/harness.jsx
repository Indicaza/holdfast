// Component-test harness: a fake API (fetch routed by method and path), a
// session, and a router that follows the app's navigate() like the real
// page does. Fixture data only.
import { cleanup, render } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { vi } from 'vitest'

import { clearResources } from '../../../Api/resourceCache.js'
import { SessionContext } from '../../../Auth/sessionContext.js'

const session = { refresh: async () => true, signIn: () => {}, user: { id: 'e2e' } }

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// routes: [{ method?, path: string | RegExp, reply: (request) => body | { status, body } }]
// Returns the list of requests made, newest last.
export function mockApi(routes) {
  const calls = []
  globalThis.fetch = vi.fn(async (input, options = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const method = String(options.method || 'GET').toUpperCase()
    const request = { method, path: url.pathname, search: url.search, query: url.searchParams, body: options.body ? JSON.parse(options.body) : undefined }
    calls.push(request)
    const route = routes.find((entry) => (entry.method || 'GET') === method && (typeof entry.path === 'string' ? entry.path === url.pathname : entry.path.test(url.pathname)))
    if (!route) return reply({ error: 'not_found' }, 404)
    const result = await route.reply(request)
    if (result && typeof result === 'object' && 'status' in result && 'body' in result) return reply(result.body, result.status)
    return reply(result)
  })
  return calls
}

export function resetHarness(search = '') {
  cleanup()
  clearResources()
  window.history.replaceState(null, '', `/dashboard/dungeons${search}`)
  document.body.style.overflow = ''
}

// Re-renders children with the current query string after every navigate().
export function Routed({ children }) {
  const [query, setQuery] = useState(() => window.location.search.slice(1))
  useEffect(() => {
    const follow = () => setQuery(window.location.search.slice(1))
    window.addEventListener('popstate', follow)
    return () => window.removeEventListener('popstate', follow)
  }, [])
  return children(query)
}

export function renderWithSession(ui) {
  return render(<SessionContext.Provider value={session}>{ui}</SessionContext.Provider>)
}

export const ROOK = Object.freeze({ id: 'char-1', name: 'Rook', level: 20, className: 'Rogue', realm: 'Fixture', region: 'us' })
export const BRICK = Object.freeze({ id: 'char-2', name: 'Brick', level: 60, className: 'Warrior', realm: 'Fixture', region: 'us' })
