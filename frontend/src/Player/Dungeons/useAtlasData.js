import { useEffect, useMemo, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { loadResource, peekResource } from '../../Api/resourceCache.js'
import { runAuthenticatedMutation } from '../../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../../Auth/returnTo.js'
import { useSession } from '../../Auth/sessionContext.js'
import { useLiveResource } from '../../Live/useLiveResource.js'
import { playerApiUrl } from '../playerModel.js'
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
  // `degraded`: what the server could not add (observed catalog, loot
  // slots); the static atlas is still there.
  const degraded = Array.isArray(resource.data?.degraded) ? resource.data.degraded : []
  return { status, dungeons, fixtures: Boolean(fixtures), error: resource.error, reload: resource.reload, degraded }
}

// instanceId: the game's instance ID, a dungeon key or a wing key.
export function useDungeonDetail(instanceId) {
  const resource = useLiveResource(instanceId ? `/api/player/loot/dungeons/${encodeURIComponent(instanceId)}` : '', { topics: TOPICS, enabled: Boolean(instanceId) })
  const fixtures = useAtlasFixtures()
  const fixture = fixtures?.FIXTURE_DETAILS?.[instanceId] || null
  const data = useMemo(() => {
    if (!fixture) return resource.data
    if (!resource.data) return fixture
    return resource.data.atlas ? resource.data : { ...resource.data, atlas: fixture.atlas }
  }, [resource.data, fixture])
  const status = fixture && resource.status !== 'loading' ? 'ready' : resource.status
  return { status, data, error: resource.error, reload: resource.reload }
}

// Several dungeons' details at once (for the explore cards' gear counts),
// through the same cache the modal reads, so opening one is instant.
// instanceId → detail; dungeons still loading or failed are absent.
export function useDungeonDetails(instanceIds = []) {
  const key = instanceIds.join(',')
  const fixtures = useAtlasFixtures()
  const [loaded, setLoaded] = useState(() => new Map())
  useEffect(() => {
    if (!key) return undefined
    let active = true
    // Instance IDs and wing keys (a wing key has no comma).
    const ids = key.split(',').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    Promise.all(ids.map((id) => {
      const url = `/api/player/loot/dungeons/${encodeURIComponent(id)}`
      const cached = peekResource(url)?.payload
      return (cached !== undefined ? Promise.resolve(cached) : loadResource(url, TOPICS)).then((data) => [id, data], () => [id, null])
    })).then((entries) => {
      if (active) setLoaded(new Map(entries.filter(([, data]) => data)))
    })
    return () => { active = false }
  }, [key])
  return useMemo(() => {
    if (!fixtures) return loaded
    const merged = new Map(loaded)
    for (const [id, fixture] of Object.entries(fixtures.FIXTURE_DETAILS || {})) {
      const real = merged.get(Number(id))
      merged.set(Number(id), real?.atlas ? real : { ...(real || fixture), atlas: fixture.atlas })
    }
    return merged
  }, [loaded, fixtures])
}

// The player's own runs, narrowed to a dungeon (by name) and character.
export function useDungeonRuns({ server = '', dungeon = '', character = '', enabled = true } = {}) {
  const url = enabled ? playerApiUrl('dungeon-runs', server, { dungeon, character }) : ''
  return useLiveResource(url, { topics: TOPICS, enabled: Boolean(url) })
}

// The selected character's quest readiness for a dungeon or wing, from the
// quest state the add-on last synced. A new upload publishes the player
// topic, which refreshes it.
export function useDungeonReadiness(instanceId, characterId) {
  const url = instanceId && characterId
    ? `/api/player/loot/dungeons/${encodeURIComponent(instanceId)}/readiness?character=${encodeURIComponent(characterId)}` : ''
  return useLiveResource(url, { topics: TOPICS, enabled: Boolean(url) })
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
