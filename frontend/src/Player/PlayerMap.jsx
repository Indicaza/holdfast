import { useCallback, useEffect, useMemo, useState } from 'react'

import { disciplineLabel } from '../Intelligence/Farming/farmingModel.js'
import { navigate } from '../Navigation/navigation.js'
import AtlasModalHost from './Dungeons/AtlasModalHost.jsx'
import { entranceMarkers, withAtlasOpen } from './Dungeons/atlasModel.js'
import { readMapMark } from './Dungeons/questPlanModel.js'
import { useDungeonList } from './Dungeons/useAtlasData.js'
import { atlasZone } from './Map/atlas.js'
import ResourceMap from './Map/ResourceMap.jsx'
import { Icon } from './ui.jsx'

function readMapParams(queryString) {
  const params = new URLSearchParams(queryString)
  const zoneParam = params.get('zone') || ''
  const zone = zoneParam ? atlasZone(Number(zoneParam) || 0, zoneParam) : null
  return {
    zone: zone?.mapId || null,
    sources: (params.get('source') || '').split(',').map((value) => value.trim()).filter(Boolean),
    item: params.get('item') || '',
    discipline: params.get('discipline') || '',
    resource: params.get('resource') || '',
    // A spot to mark (?zone=1436&mark=0.5633,0.4752&label=Gryan Stoutmantle):
    // a quest giver, turn-in or entrance from the dungeon quest checklist.
    mark: zone ? readMapMark(params.get('mark')) : null,
    label: (params.get('label') || '').slice(0, 60),
  }
}

function replaceParam(name, value) {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(name, String(value))
  else url.searchParams.delete(name)
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

// The full resource map. Links can open it on a zone (?zone=1436 or a name),
// a source (?source=), a drop (?item=), a profession (?discipline=) or with a
// resource's details open (?resource=); the URL follows the zone being viewed
// and the details shown, so the view can be shared.
// The Dungeon Entrances layer: a toggle (kept in ?dungeons=1) and a pin
// for every dungeon whose entrance the atlas knows.
function useEntrancePins(queryString) {
  const [on, setOn] = useState(() => {
    const explicit = new URLSearchParams(queryString).get('dungeons')
    if (explicit === '1') return true
    if (explicit === '0') return false
    try { return globalThis.localStorage?.getItem('guildweaver:map:entrances') === '1' } catch { return false }
  })
  useEffect(() => {
    const explicit = new URLSearchParams(queryString).get('dungeons')
    if (explicit === '1' || explicit === '0') setOn(explicit === '1')
  }, [queryString])
  const list = useDungeonList()
  const all = useMemo(() => entranceMarkers(list.dungeons, (mapId) => atlasZone(mapId)), [list.dungeons])
  const toggle = useCallback(() => {
    replaceParam('dungeons', on ? '' : '1')
    try { globalThis.localStorage?.setItem('guildweaver:map:entrances', on ? '0' : '1') } catch { /* optional preference */ }
    setOn(!on)
  }, [on])
  return { on, pins: on ? all : [], toggle, known: all.length }
}

function MapView({ queryString, openRequest }) {
  const params = useMemo(() => readMapParams(queryString), [queryString])
  const filter = useMemo(() => ({ sources: params.sources, item: params.item, discipline: params.discipline }), [params])
  const filtered = Boolean(params.sources.length || params.item || params.discipline)
  const linked = useMemo(() => (params.resource ? { sourceKey: params.resource } : null), [params.resource])
  const request = openRequest || linked
  const clearFilters = useMemo(() => {
    const next = new URLSearchParams(queryString)
    for (const key of ['source', 'item', 'discipline']) next.delete(key)
    return '/map' + (next.size ? '?' + next.toString() : '')
  }, [queryString])

  const onFocusZone = useCallback((mapId) => replaceParam('zone', mapId), [])
  const onDetailsChange = useCallback((sourceKey) => replaceParam('resource', sourceKey), [])
  const entrances = useEntrancePins(queryString)
  const onPin = useCallback((pin) => {
    if (!pin.open && !pin.instanceId) return
    navigate(withAtlasOpen(`${window.location.pathname}${window.location.search}`, { open: pin.open ?? pin.instanceId }), { preserveScroll: true })
  }, [])
  // The marked spot, placed with the zone's own map rectangle (the game's map
  // id and 0–1 coordinates, as the plan's waypoints give them).
  const marked = useMemo(() => {
    const zone = params.mark && params.zone ? atlasZone(params.zone) : null
    if (!zone?.rect) return null
    const label = params.label || 'Marked spot'
    return { key: 'mark', kind: 'waypoint', icon: 'pin', label, ariaLabel: `${label} (marked spot)`,
      world: { x: zone.rect.x + params.mark.x * zone.rect.width, y: zone.rect.y + params.mark.y * zone.rect.height } }
  }, [params.zone, params.mark?.x, params.mark?.y, params.label])
  const focus = useMemo(() => (params.zone ? { mapId: params.zone, point: marked?.world || null } : null), [params.zone, marked?.world])
  const pins = useMemo(() => (marked ? [...entrances.pins, marked] : entrances.pins), [entrances.pins, marked])

  return (
    <div className="gw-mapview">
      {filtered ? (
        <div className="gw-mapview__filter" role="status">
          <Icon name="layers" size={14} />
          <span>
            Showing {params.sources.length ? `${params.sources.length} chosen source${params.sources.length === 1 ? '' : 's'}` : null}
            {params.discipline ? `${disciplineLabel(params.discipline)} only` : null}
            {params.item ? `${params.sources.length || params.discipline ? ', ' : ''}sources of one drop` : null}
          </span>
          <a href={clearFilters} className="gw-link">Clear resource filters</a>
        </div>
      ) : null}
      <ResourceMap
        variant="full"
        filter={filter}
        focus={focus}
        onFocusZone={onFocusZone}
        onDetailsChange={onDetailsChange}
        openRequest={request}
        entranceLayer={entrances}
        label="Resource map of Azeroth"
        pins={pins}
        onPin={onPin}
      />
    </div>
  )
}

// Map links and browser history update the live map, retaining its camera
// unless the requested destination changes.
export default function PlayerMap({ queryString = '', openRequest = null, server = '', characters = [] }) {
  return (
    <>
      <MapView queryString={queryString} openRequest={openRequest} />
      <AtlasModalHost server={server} queryString={queryString} characters={characters} showMapLink={false} />
    </>
  )
}
