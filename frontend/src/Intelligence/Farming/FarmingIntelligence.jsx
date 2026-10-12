import { useEffect, useRef, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { useLiveRefresh } from '../../Live/liveUpdatesContext.js'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import EmptyTelemetry from '../EmptyTelemetry.jsx'
import { GameTooltipHover } from '../GameTooltip.jsx'
import FarmingSourceModal, { ConfidencePips } from './FarmingSourceModal.jsx'
import {
  FARMING_SORTS,
  disciplineLabel,
  formatCount,
  formatRate,
  groupSourcesByDiscipline,
  observationLabel,
  rateRangeText,
  sourcesUrl,
} from './farmingModel.js'
import './FarmingIntelligence.css'
import './FarmingUx.css'

function readBrowserStateFromLocation() {
  const params = new URLSearchParams(window.location.search)
  return {
    query: params.get('q') || '',
    discipline: params.get('discipline') || '',
    zone: params.get('zone') || '',
    sort: FARMING_SORTS.some((entry) => entry.id === params.get('sort')) ? params.get('sort') : 'observations',
  }
}

// The open source lives in the URL (?source=), like the open character.
function readSourceFromLocation() {
  return new URLSearchParams(window.location.search).get('source') || ''
}

function useSourceParam() {
  const [sourceKey, setSourceKey] = useState(readSourceFromLocation)

  useEffect(() => {
    const sync = () => setSourceKey(readSourceFromLocation())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  function open(nextKey) {
    setSourceKey(nextKey)
    const url = new URL(window.location.href)
    if (nextKey) url.searchParams.set('source', nextKey)
    else url.searchParams.delete('source')
    if (url.href !== window.location.href) window.history.pushState(null, '', url)
  }

  return [sourceKey, open]
}

function FarmItem({ item, size = 20, strong = false }) {
  const body = (
    <span className="farm-item-hover">
      <WowIcon iconFileId={item.iconFileDataId} itemId={item.itemId} label={item.name} quality={item.qualityId} size={size} />
      {strong ? (
        <strong className={`farm-item farm-item--q${item.qualityId ?? 1}`}>{item.name}</strong>
      ) : (
        <span className={`farm-item farm-item--q${item.qualityId ?? 1}`}>{item.name}</span>
      )}
    </span>
  )
  return <GameTooltipHover item={item.item || item}>{body}</GameTooltipHover>
}

// What a source is worth gathering for, beyond the output it is named for:
// the item searched for when there is a search, otherwise its other drops.
function CardDrops({ source }) {
  const matches = source.matches || []
  const searched = matches.length > 0
  const drops = (searched ? matches : source.drops) || []
  if (!drops.length) return null

  return (
    <div className={`farm-card__drop-wrap${searched ? ' farm-card__drop-wrap--match' : ''}`}>
      {searched ? <span className="farm-card__match-label">Matched drop</span> : null}
      <ul className={`farm-card__drops${searched ? ' farm-card__drops--match' : ''}`}>
        {drops.slice(0, 3).map((drop) => (
          <li key={drop.itemKey} title={rateRangeText(drop)}>
            <FarmItem item={drop} />
            <b className={`farm-rate farm-rate--${drop.confidence}`}>{formatRate(drop.rate)}</b>
            <ConfidencePips confidence={drop.confidence} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CardZone({ source }) {
  const zone = String(source.primaryZone || '').trim()
  const extraZones = Math.max(0, Number(source.zones || 0) - (zone ? 1 : 0))
  const label = zone || 'Zone unknown'

  return (
    <span className={`farm-card__zone${zone ? '' : ' farm-card__zone--unknown'}`} title={extraZones ? `${label} + ${extraZones} more zone${extraZones === 1 ? '' : 's'}` : label}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>
      <span>{label}</span>
      {extraZones ? <em>+{extraZones}</em> : null}
    </span>
  )
}

function SourceCard({ source, onOpen }) {
  const match = source.matches?.[0]
  return (
    <li>
      <button
        type="button"
        className={`farm-card farm-card--${source.discipline}`}
        onClick={() => onOpen(source.sourceKey, match?.itemKey || '')}
      >
        <span className="farm-card__head">
          <WowIcon iconFileId={source.icon?.iconFileDataId} itemId={source.icon?.itemId} label={source.name} quality={source.icon?.qualityId} size={40} />
          <span className="farm-card__identity">
            <strong>{source.name}</strong>
            <CardZone source={source} />
            <small>{formatCount(source.observations)} {observationLabel(source.discipline, source.observations)}</small>
          </span>
          <span className="farm-card__open" aria-hidden="true">›</span>
        </span>
        <CardDrops source={source} />
      </button>
    </li>
  )
}

// One searchable browser of everything the guild has gathered from. Search a
// source to find it, or an item to find every source that produced it.
export default function FarmingIntelligence({ input, onInputChange }) {
  const initialBrowser = useRef(readBrowserStateFromLocation()).current
  const [query, setQuery] = useState(() => input.trim() || initialBrowser.query.trim())
  const [discipline, setDiscipline] = useState(initialBrowser.discipline)
  const [zone, setZone] = useState(initialBrowser.zone)
  const [sort, setSort] = useState(initialBrowser.sort)
  const [state, setState] = useState({ status: 'loading', data: null })
  const [sourceKey, openSource] = useSourceParam()
  const [initialItemKey, setInitialItemKey] = useState('')
  const seededQuery = useRef(false)

  useEffect(() => {
    if (seededQuery.current) return
    seededQuery.current = true
    if (!input && initialBrowser.query) onInputChange(initialBrowser.query)
  }, [initialBrowser.query, input, onInputChange])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [input])

  useEffect(() => {
    const sync = () => {
      const next = readBrowserStateFromLocation()
      setDiscipline(next.discipline)
      setZone(next.zone)
      setSort(next.sort)
      if (next.query !== input) onInputChange(next.query)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [input, onInputChange])

  useEffect(() => {
    const url = new URL(window.location.href)
    const setOrDelete = (key, value, defaultValue = '') => {
      if (value && value !== defaultValue) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    setOrDelete('q', query)
    setOrDelete('discipline', discipline)
    setOrDelete('zone', zone)
    setOrDelete('sort', sort, 'observations')
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [query, discipline, zone, sort])

  // New gathers arriving from Guildweaver refresh the list in place.
  const [version, setVersion] = useState(0)
  useLiveRefresh(['farming'], () => setVersion((current) => current + 1), { debounceMs: 1000 })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    apiJson(sourcesUrl({ query, discipline, zone, sort }), { signal: controller.signal })
      .then((data) => { if (active) setState({ status: 'ready', data }) })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return
        setState((current) => ({ ...current, status: 'error' }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [query, discipline, zone, sort, version])

  const data = state.data
  const sources = data?.sources || []
  const disciplines = data?.disciplines || []
  const zones = data?.zones || []

  function open(nextKey, itemKey = '') {
    setInitialItemKey(itemKey)
    openSource(nextKey)
  }

  return (
    <section className="farming">
      <div className="farming__toolbar">
        <div className="farming__finder-row">
          <label className="farming__search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
            <input type="search" aria-label="Search items or sources" value={input} onChange={(event) => onInputChange(event.target.value)} placeholder="What do you want to farm?" />
          </label>
          <label className="farming__select">
            <span>Zone</span>
            <select value={zone} onChange={(event) => setZone(event.target.value)}>
              <option value="">All zones</option>
              {zone && !zones.some((entry) => entry.zone === zone) ? <option value={zone}>{zone}</option> : null}
              {zones.map((entry) => <option key={entry.zone} value={entry.zone}>{entry.zone} ({formatCount(entry.sources)})</option>)}
            </select>
          </label>
          <label className="farming__select farming__select--sort">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {FARMING_SORTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
        </div>
        {disciplines.length ? (
          <div className="farming__disciplines" role="group" aria-label="Discipline">
            <button type="button" aria-pressed={!discipline} onClick={() => setDiscipline('')}>All</button>
            {disciplines.map((entry) => (
              <button key={entry.discipline} type="button" aria-pressed={discipline === entry.discipline} onClick={() => setDiscipline(entry.discipline)}>
                {disciplineLabel(entry.discipline)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {state.status === 'error' ? <p className="intel-error">Farming intelligence is unavailable right now.</p> : null}
      {state.status === 'loading' ? <p className="intel-muted">Reading gathering observations…</p> : null}
      {state.status === 'ready' && !sources.length ? (
        <EmptyTelemetry title={query || zone || discipline ? 'Nothing matches those filters.' : 'No gathering observations yet.'}>
          {query || zone || discipline ? 'Try another item, source, zone, or discipline.' : 'Sources appear once Guildweaver syncs gathering telemetry.'}
        </EmptyTelemetry>
      ) : null}
      {sources.length ? (
        groupSourcesByDiscipline(sources).map((group) => (
          <section key={group.discipline} className={`farming__group farming__group--${group.discipline}`} aria-label={group.label}>
            <h3>
              {group.label}
              <small>{group.sources.length} {group.sources.length === 1 ? 'source' : 'sources'}</small>
            </h3>
            <ul className="farming__grid">
              {group.sources.map((source) => <SourceCard key={source.sourceKey} source={source} onOpen={open} />)}
            </ul>
          </section>
        ))
      ) : null}

      {sourceKey ? (
        <FarmingSourceModal key={sourceKey} sourceKey={sourceKey} initialItemKey={initialItemKey} onClose={() => open('')} />
      ) : null}
    </section>
  )
}
