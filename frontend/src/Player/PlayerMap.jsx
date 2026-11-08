import { useCallback, useMemo, useState } from 'react'

import { disciplineLabel } from '../Intelligence/Farming/farmingModel.js'
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
function MapView({ queryString, legendHost, railed, openRequest }) {
  const [initial] = useState(() => readMapParams(queryString))
  const filter = useMemo(() => ({ sources: initial.sources, item: initial.item, discipline: initial.discipline }), [initial])
  const focus = useMemo(() => (initial.zone ? { mapId: initial.zone } : null), [initial])
  const filtered = Boolean(initial.sources.length || initial.item || initial.discipline)
  const [linked] = useState(() => (initial.resource ? { sourceKey: initial.resource } : null))
  const request = openRequest || linked

  const onFocusZone = useCallback((mapId) => replaceParam('zone', mapId), [])
  const onDetailsChange = useCallback((sourceKey) => replaceParam('resource', sourceKey), [])

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
      />
    </div>
  )
}

// A new filter in the URL (a link from elsewhere, or "Show every resource")
// starts the map afresh.
export default function PlayerMap({ queryString = '', legendHost = null, railed = false, openRequest = null }) {
  const params = new URLSearchParams(queryString)
  const key = ['source', 'item', 'discipline'].map((name) => params.get(name) || '').join('|')
  return <MapView key={key} queryString={queryString} legendHost={legendHost} railed={railed} openRequest={openRequest} />
}
