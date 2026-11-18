import { useCallback, useMemo, useState } from 'react'

import { disciplineLabel } from '../Intelligence/Farming/farmingModel.js'
import { navigate } from '../Navigation/navigation.js'
import AtlasModalHost from './Dungeons/AtlasModalHost.jsx'
import { entranceMarkers, withAtlasOpen } from './Dungeons/atlasModel.js'
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
  const [on, setOn] = useState(() => new URLSearchParams(queryString).get('dungeons') === '1')
  const list = useDungeonList()
  const all = useMemo(() => entranceMarkers(list.dungeons, (mapId) => atlasZone(mapId)), [list.dungeons])
  const toggle = useCallback(() => {
    replaceParam('dungeons', on ? '' : '1')
    setOn(!on)
  }, [on])
  return { on, pins: on ? all : [], toggle, known: all.length }
}

function MapView({ queryString, legendHost, railed, openRequest }) {
  const [initial] = useState(() => readMapParams(queryString))
  const filter = useMemo(() => ({ sources: initial.sources, item: initial.item, discipline: initial.discipline }), [initial])
  const focus = useMemo(() => (initial.zone ? { mapId: initial.zone } : null), [initial])
  const filtered = Boolean(initial.sources.length || initial.item || initial.discipline)
  const [linked] = useState(() => (initial.resource ? { sourceKey: initial.resource } : null))
  const request = openRequest || linked

  const onFocusZone = useCallback((mapId) => replaceParam('zone', mapId), [])
  const onDetailsChange = useCallback((sourceKey) => replaceParam('resource', sourceKey), [])
  const entrances = useEntrancePins(queryString)
  const onPin = useCallback((pin) => navigate(withAtlasOpen(`${window.location.pathname}${window.location.search}`, { open: pin.instanceId }), { preserveScroll: true }), [])

  return (
    <div className="gw-mapview">
      {filtered ? (
        <div className="gw-mapview__filter" role="status">
          <Icon name="layers" size={14} />
          <span>
            Showing {initial.sources.length ? `${initial.sources.length} chosen source${initial.sources.length === 1 ? '' : 's'}` : null}
            {initial.discipline ? `${disciplineLabel(initial.discipline)} only` : null}
            {initial.item ? `${initial.sources.length || initial.discipline ? ', ' : ''}sources of one drop` : null}
          </span>
          <a href="/map" className="gw-link">Show every resource</a>
        </div>
      ) : null}
      <div className="gw-mapview__layers">
        <button type="button" className={`gw-btn gw-btn--sm${entrances.on ? ' gw-btn--primary' : ''}`} aria-pressed={entrances.on} onClick={entrances.toggle}>
          <Icon name="dungeon" size={14} /> Dungeon entrances{entrances.on ? ` (${entrances.pins.length})` : ''}
        </button>
        {entrances.on && !entrances.known ? <span className="gw-muted" role="status">No dungeon entrance positions are known yet.</span> : null}
      </div>
      <ResourceMap
        variant="full"
        filter={filter}
        focus={focus}
        onFocusZone={onFocusZone}
        onDetailsChange={onDetailsChange}
        openRequest={request}
        legendHost={legendHost}
        legendRail={railed}
        label="Resource map of Azeroth"
        pins={entrances.pins}
        onPin={onPin}
      />
    </div>
  )
}

// A new filter in the URL (a link from elsewhere, or "Show every resource")
// starts the map afresh.
export default function PlayerMap({ queryString = '', legendHost = null, railed = false, openRequest = null, server = '', characters = [] }) {
  const params = new URLSearchParams(queryString)
  const key = ['source', 'item', 'discipline'].map((name) => params.get(name) || '').join('|')
  return (
    <>
      <MapView key={key} queryString={queryString} legendHost={legendHost} railed={railed} openRequest={openRequest} />
      <AtlasModalHost server={server} queryString={queryString} characters={characters} showMapLink={false} />
    </>
  )
}
