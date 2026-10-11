import { useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { useLiveRefresh } from '../../Live/liveUpdatesContext.js'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import EmptyTelemetry from '../EmptyTelemetry.jsx'
import FarmingSourceModal, { ConfidencePips } from './FarmingSourceModal.jsx'
import { disciplineLabel, formatCount, formatRate, groupSourcesByDiscipline, rateRangeText, sourcesUrl } from './farmingModel.js'
import './FarmingIntelligence.css'

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

// What a source is worth gathering for, beyond the output it is named for:
// the item searched for when there is a search, otherwise its other drops.
function CardDrops({ source }) {
  const matches = source.matches || []
  const searched = matches.length > 0
  const drops = (searched ? matches : source.drops) || []
  if (!drops.length) return <span className="farm-card__none">No other drops seen yet</span>

  return (
    <ul className={`farm-card__drops${searched ? ' farm-card__drops--match' : ''}`}>
      {drops.slice(0, 3).map((drop) => (
        <li key={drop.itemKey} title={rateRangeText(drop)}>
          <WowIcon iconFileId={drop.iconFileDataId} itemId={drop.itemId} label={drop.name} quality={drop.qualityId} size={20} />
          <span className={`farm-item farm-item--q${drop.qualityId ?? 1}`}>{drop.name}</span>
          <b className={`farm-rate farm-rate--${drop.confidence}`}>{formatRate(drop.rate)}</b>
          <ConfidencePips confidence={drop.confidence} />
        </li>
      ))}
    </ul>
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
            <small>{formatCount(source.observations)} {source.observations === 1 ? 'gather' : 'gathers'}</small>
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
  const [query, setQuery] = useState(() => input.trim())
  const [discipline, setDiscipline] = useState('')
  const [state, setState] = useState({ status: 'loading', data: null })
  const [sourceKey, openSource] = useSourceParam()
  const [initialItemKey, setInitialItemKey] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [input])

  // New gathers arriving from Guildweaver refresh the list in place.
  const [version, setVersion] = useState(0)
  useLiveRefresh(['farming'], () => setVersion((current) => current + 1), { debounceMs: 1000 })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    apiJson(sourcesUrl({ query, discipline }), { signal: controller.signal })
      .then((data) => { if (active) setState({ status: 'ready', data }) })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return
        setState((current) => ({ ...current, status: 'error' }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [query, discipline, version])

  const data = state.data
  const sources = data?.sources || []
  const disciplines = data?.disciplines || []

  function open(nextKey, itemKey = '') {
    setInitialItemKey(itemKey)
    openSource(nextKey)
  }

  return (
    <section className="farming">
      <div className="farming__toolbar">
        <label className="farming__search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
          <input type="search" aria-label="Search items or sources" value={input} onChange={(event) => onInputChange(event.target.value)} placeholder="Search items or sources…" />
        </label>
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
        <EmptyTelemetry title={query ? 'Nothing matches that search.' : 'No gathering observations yet.'}>
          {query ? 'Try another item or source name.' : 'Sources appear once Guildweaver syncs gathering telemetry.'}
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
