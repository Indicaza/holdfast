import { useEffect, useMemo, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { runAuthenticatedMutation } from '../../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../../Auth/returnTo.js'
import { useSession } from '../../Auth/sessionContext.js'
import { useLiveResource } from '../../Live/useLiveResource.js'
import { listWithAtlasDungeons } from './atlasModel.js'

const TOPICS = ['player']

// Development only: ?atlasFixtures=1 merges fixture atlas data into the
// real responses so the explorer can be built before the backend sends
// `atlas`. In a production build `import.meta.env.DEV` is false and the
// fixtures are never loaded.
// The ternary folds to null in production, so the fixture chunk is not
// even emitted.
const loadFixtures = import.meta.env.DEV ? () => import('./__fixtures__/atlas.js') : null

function wantsFixtures() {
  return Boolean(loadFixtures) && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('atlasFixtures')
}

export function useAtlasFixtures() {
  const [fixtures, setFixtures] = useState(null)
  useEffect(() => {
    if (!wantsFixtures()) return undefined
    let active = true
    loadFixtures().then((module) => { if (active) setFixtures(module) })
    return () => { active = false }
  }, [])
  return fixtures
}

// The dungeon list, with fixture atlases merged in dev fixture mode.
export function useDungeonList() {
  const resource = useLiveResource('/api/player/loot/dungeons', { topics: TOPICS })
  const fixtures = useAtlasFixtures()
  const dungeons = useMemo(() => {
    const real = listWithAtlasDungeons(resource.data)
    if (!fixtures) return real
    const byId = new Map(fixtures.FIXTURE_DUNGEON_LIST.map((entry) => [entry.instanceId, entry]))
    const merged = real.map((entry) => (entry.atlas || !byId.get(entry.instanceId)?.atlas ? entry : { ...entry, atlas: byId.get(entry.instanceId).atlas }))
    const have = new Set(real.map((entry) => entry.instanceId))
    return [...merged, ...fixtures.FIXTURE_DUNGEON_LIST.filter((entry) => !have.has(entry.instanceId))]
  }, [resource.data, fixtures])
  const status = fixtures && resource.status !== 'loading' ? 'ready' : resource.status
  return { status, dungeons, fixtures: Boolean(fixtures) }
}

export function useDungeonDetail(instanceId) {
  const resource = useLiveResource(instanceId ? `/api/player/loot/dungeons/${instanceId}` : '', { topics: TOPICS, enabled: Boolean(instanceId) })
  const fixtures = useAtlasFixtures()
  const fixture = fixtures?.FIXTURE_DETAILS?.[instanceId] || null
  const data = useMemo(() => {
    if (!fixture) return resource.data
    if (!resource.data) return fixture
    return resource.data.atlas ? resource.data : { ...resource.data, atlas: fixture.atlas }
  }, [resource.data, fixture])
  const status = fixture && resource.status !== 'loading' ? 'ready' : resource.status
  return { status, data }
}

export function useWishlist(characterId) {
  return useLiveResource(characterId ? `/api/player/wishlists/${encodeURIComponent(characterId)}` : '', { topics: TOPICS, enabled: Boolean(characterId) })
}

// The existing wishlist mutations (PUT / PATCH / DELETE), with the same
// sign-in refresh the loot view uses.
export function useWishlistMutation() {
  const session = useSession()
  return (path, method, body) => runAuthenticatedMutation({
    request: () => apiJson(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }),
    refresh: session.refresh,
    reauthenticate: () => session.signIn(signInReturnTo()),
  })
}
