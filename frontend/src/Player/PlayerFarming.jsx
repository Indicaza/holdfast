import { useEffect, useMemo, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { disciplineLabel, formatCount, observationLabel, sourcesUrl } from '../Intelligence/Farming/farmingModel.js'
import { useLiveRefresh } from '../Live/liveUpdatesContext.js'
import { navigate } from '../Navigation/navigation.js'
import { rateScale, sortSources, sourceHref } from './exploreModel.js'
import { relativeTime } from './playerModel.js'
import { atlasZone } from './Map/atlas.js'
import ResourceMap from './Map/ResourceMap.jsx'
import SourcePage from './SourcePage.jsx'
import { Confidence, DisciplineTag, EmptyState, ErrorState, Icon, ItemLabel, Panel, RateBar, SkeletonRows, Zone } from './ui.jsx'

const COLUMNS = [
  { key: 'name', label: 'Source', defaultDirection: 'asc' },
  { key: 'zone', label: 'Zone', defaultDirection: 'asc', className: 'gw-hide-md' },
  { key: 'observations', label: 'Samples', defaultDirection: 'desc', className: 'gw-col-num' },
  { key: 'chance', label: 'Notable drops', defaultDirection: 'desc', className: 'gw-col-drops' },
  { key: 'recent', label: 'Last seen', defaultDirection: 'desc', className: 'gw-col-num gw-hide-md' },
]

function readBrowserState(queryString) {
  const params = new URLSearchParams(queryString)
  const sort = COLUMNS.some((column) => column.key === params.get('sort')) ? params.get('sort') : 'observations'
  const column = COLUMNS.find((entry) => entry.key === sort)
  return {
    sortChosen: params.has('sort'),
    query: params.get('q') || '',
    discipline: params.get('discipline') || '',
    zone: params.get('zone') || '',
    sort,
    direction: params.get('dir') === 'asc' || params.get('dir') === 'desc' ? params.get('dir') : column.defaultDirection,
  }
}

function SortHeader({ column, sort, direction, onSort }) {
  const active = sort === column.key
  return (
    <th scope="col" className={column.className} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`gw-th-sort${active ? ' is-active' : ''}`} onClick={() => onSort(column)}>
        {column.label}
        <Icon name={active ? (direction === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} size={12} />
      </button>
    </th>
  )
}

function NotableDrops({ source, max }) {
  const searched = Boolean(source.matches?.length)
  const drops = (searched ? source.matches : source.drops) || []
  if (!drops.length) return <span className="gw-muted">Only {source.name}</span>
  return (
    <ul className={`gw-drops-cell${searched ? ' gw-drops-cell--match' : ''}`}>
      {drops.slice(0, 2).map((drop) => (
        <li key={drop.itemKey}>
          <ItemLabel item={drop} size={18} />
          <RateBar entry={drop} max={max} compact />
          <Confidence confidence={drop.confidence} />
        </li>
      ))}
      {drops.length > 2 ? <li className="gw-muted gw-drops-cell__more">+{drops.length - 2} more</li> : null}
    </ul>
  )
}

const MAP_OPEN_KEY = 'guildweaver:drop-rates-map'

function readMapOpen() {
  try {
    return globalThis.localStorage?.getItem(MAP_OPEN_KEY) !== 'closed'
  } catch {
    return true
  }
}

// The resource map for the table's filters: the profession, the sources a
// search matched, and the zone.
function BrowserMap({ discipline, zone, query, sources, status }) {
  const [open, setOpen] = useState(readMapOpen)
  const matchKeys = query ? sources.map((source) => source.sourceKey).slice(0, 50).join(',') : ''
  const filter = useMemo(() => ({ discipline, sources: matchKeys ? matchKeys.split(',') : [] }), [discipline, matchKeys])
  const zoneId = zone ? atlasZone(0, zone)?.mapId || null : null
  const focus = useMemo(() => (zoneId ? { mapId: zoneId } : 'world'), [zoneId])
  const params = new URLSearchParams()
  if (discipline) params.set('discipline', discipline)
  if (matchKeys) params.set('source', matchKeys)
  if (zoneId) params.set('zone', String(zoneId))
  const fullHref = `/map${params.size ? `?${params}` : ''}`

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      globalThis.localStorage?.setItem(MAP_OPEN_KEY, next ? 'open' : 'closed')
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  }

  const empty = query && status === 'ready' && !sources.length
  return (
    <Panel
      id="gw-browser-map"
      eyebrow="Where to find it"
      title="Resource map"
      description={open ? (query ? `Where the sources matching “${query}” are gathered.` : 'Every gather on a zoomable map of Azeroth. Click a zone to dive in.') : null}
      actions={(
        <>
          <a className="gw-link" href={fullHref}>Full map <Icon name="chevron" size={14} /></a>
          <button type="button" className="gw-btn gw-btn--ghost gw-btn--sm" onClick={toggle} aria-expanded={open} aria-controls="gw-browser-map-body">
            {open ? 'Hide' : 'Show map'}
          </button>
        </>
      )}
      flush
    >
      {open && !empty ? (
        <div id="gw-browser-map-body">
          <ResourceMap variant="card" filter={filter} focus={focus} fullHref={fullHref} label="Resource map for these filters" />
        </div>
      ) : null}
    </Panel>
  )
}

function SourcesBrowser({ queryString }) {
  const [initial] = useState(() => readBrowserState(queryString))
  const [input, setInput] = useState(initial.query)
  const [query, setQuery] = useState(initial.query)
  const [discipline, setDiscipline] = useState(initial.discipline)
  const [zone, setZone] = useState(initial.zone)
  const [sortChosen, setSortChosen] = useState(initial.sortChosen)
  const [chosenSort, setSort] = useState(initial.sort)
  const [chosenDirection, setDirection] = useState(initial.direction)
  // Searching an item ranks its sources by drop chance until a column is
  // picked by hand.
  const bySearch = Boolean(query) && !sortChosen
  const sort = bySearch ? 'chance' : chosenSort
  const direction = bySearch ? 'desc' : chosenDirection
  const [state, setState] = useState({ status: 'loading', data: null })
  const [version, setVersion] = useState(0)
  useLiveRefresh(['farming'], () => setVersion((current) => current + 1), { debounceMs: 1000 })

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [input])

  // The filters live in the URL, so a filtered table is a link you can share.
  useEffect(() => {
    const url = new URL(window.location.href)
    const put = (key, value, fallback = '') => {
      if (value && value !== fallback) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    put('q', query)
    put('discipline', discipline)
    put('zone', zone)
    put('sort', sortChosen ? sort : '', 'observations')
    put('dir', sortChosen ? direction : '', COLUMNS.find((column) => column.key === sort)?.defaultDirection)
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
  }, [query, discipline, zone, sort, direction, sortChosen])

  useEffect(() => {
    const controller = new AbortController()
    apiJson(sourcesUrl({ query, discipline, zone }), { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ status: 'ready', data }) })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setState((current) => ({ ...current, status: 'error' }))
      })
    return () => controller.abort()
  }, [query, discipline, zone, version])

  const data = state.data
  const disciplines = data?.disciplines || []
  const zones = data?.zones || []
  const sources = useMemo(() => sortSources(data?.sources || [], { key: sort, direction }), [data, sort, direction])
  const max = rateScale(sources.flatMap((source) => ((source.matches?.length ? source.matches : source.drops) || []).slice(0, 2)))
  const filtered = Boolean(query || discipline || zone)
  const totalSamples = sources.reduce((sum, source) => sum + (Number(source.observations) || 0), 0)

  function onSort(column) {
    setSortChosen(true)
    if (sort === column.key) {
      setSort(column.key)
      setDirection(direction === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(column.key)
      setDirection(column.defaultDirection)
    }
  }

  function clear() {
    setInput('')
    setQuery('')
    setDiscipline('')
    setZone('')
  }

  return (
    <div className="gw-stack">
      <div className="gw-toolbar">
        <label className="gw-input gw-input--search">
          <Icon name="search" size={16} />
          <input type="search" aria-label="Search items or sources" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search an item or source — e.g. Frilled Lichen" />
        </label>
        <div className="gw-seg" role="group" aria-label="Profession">
          <button type="button" aria-pressed={!discipline} onClick={() => setDiscipline('')}>All</button>
          {disciplines.map((entry) => (
            <button key={entry.discipline} type="button" aria-pressed={discipline === entry.discipline} onClick={() => setDiscipline(entry.discipline)}>
              <DisciplineTag discipline={entry.discipline} compact />
              {disciplineLabel(entry.discipline)}
            </button>
          ))}
        </div>
        <label className="gw-select">
          <span>Zone</span>
          <select value={zone} onChange={(event) => setZone(event.target.value)}>
            <option value="">All zones</option>
            {zone && !zones.some((entry) => entry.zone === zone) ? <option value={zone}>{zone}</option> : null}
            {zones.map((entry) => <option key={entry.zone} value={entry.zone}>{entry.zone} ({formatCount(entry.sources)})</option>)}
          </select>
        </label>
      </div>

      <BrowserMap discipline={discipline} zone={zone} query={query} sources={state.data?.sources || []} status={state.status} />

      <Panel
        id="gw-sources"
        title={query ? `Sources for “${query}”` : 'Every source'}
        description={state.status === 'ready'
          ? `${formatCount(sources.length)} source${sources.length === 1 ? '' : 's'} · ${formatCount(totalSamples)} samples${query && sources.some((source) => source.matches?.length) ? ' · rates shown for the item you searched' : ''}`
          : 'Pooled from every Guildweaver player, without names or accounts.'}
        actions={filtered ? <button type="button" className="gw-btn gw-btn--ghost gw-btn--sm" onClick={clear}>Clear filters</button> : null}
        flush
      >
        {state.status === 'loading' ? <SkeletonRows rows={8} label="Loading sources" /> : null}
        {state.status === 'error' ? <div className="gw-pad"><ErrorState onRetry={() => setVersion((current) => current + 1)}>Drop rates are unavailable right now.</ErrorState></div> : null}
        {state.status === 'ready' && !sources.length ? (
          <EmptyState title={filtered ? 'Nothing matches those filters.' : 'No gathering observations yet.'} icon="search" action={filtered ? <button type="button" className="gw-btn" onClick={clear}>Clear filters</button> : null}>
            {filtered ? 'Try another item, source, zone or profession.' : 'Sources appear once Guildweaver syncs gathering telemetry.'}
          </EmptyState>
        ) : null}
        {sources.length ? (
          <div className="gw-table-wrap">
            <table className="gw-table gw-table--sources" aria-label="Sources">
              <thead>
                <tr>{COLUMNS.map((column) => <SortHeader key={column.key} column={column} sort={sort} direction={direction} onSort={onSort} />)}</tr>
              </thead>
              <tbody>
                {sources.map((source) => {
                  const href = sourceHref(source.sourceKey, { item: source.matches?.[0]?.itemKey || '' })
                  return (
                    <tr
                      key={source.sourceKey}
                      className={`is-link gw-row--${source.discipline}`}
                      onClick={(event) => {
                        if (event.target.closest('a, button')) return
                        navigate(href)
                      }}
                    >
                      <td>
                        <a className="gw-source-cell" href={href}>
                          <ItemLabel item={{ ...source.icon, name: source.name }} size={32} tooltip={false} />
                          <span className="gw-source-cell__meta">
                            <DisciplineTag discipline={source.discipline} />
                            <span className="gw-show-md"><Zone name={source.primaryZone} extra={Math.max(0, (source.zones || 0) - 1)} /></span>
                          </span>
                        </a>
                      </td>
                      <td className="gw-hide-md"><Zone name={source.primaryZone} extra={Math.max(0, (source.zones || 0) - 1)} /></td>
                      <td className="gw-col-num">
                        <strong>{formatCount(source.observations)}</strong>
                        <small className="gw-cell-sub">{observationLabel(source.discipline, source.observations)}</small>
                      </td>
                      <td className="gw-col-drops"><NotableDrops source={source} max={max} /></td>
                      <td className="gw-col-num gw-hide-md gw-muted">{relativeTime(source.lastObservedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

// Community drop rates: the table of every source, or one source's page when
// the URL names it (?source=).
export default function PlayerFarming({ server, queryString = '' }) {
  const params = new URLSearchParams(queryString)
  const sourceKey = params.get('source') || ''
  if (sourceKey) {
    return <SourcePage key={sourceKey} sourceKey={sourceKey} initialItemKey={params.get('item') || ''} initialZone={params.get('zone') || ''} server={server} />
  }
  return <SourcesBrowser queryString={queryString} />
}
