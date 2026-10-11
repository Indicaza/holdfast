import { useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import EmptyTelemetry from '../EmptyTelemetry.jsx'
import FarmingSourceModal, { ConfidenceTag } from './FarmingSourceModal.jsx'
import { disciplineLabel, formatCount, formatRate, rateRangeText, sourceKindLabel, sourcesUrl } from './farmingModel.js'
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

function SourceRow({ source, onOpen }) {
  return (
    <li>
      <button type="button" className="farm-source" onClick={() => onOpen(source.sourceKey, source.matches[0]?.itemKey || '')}>
        <WowIcon iconFileId={source.icon?.iconFileDataId} itemId={source.icon?.itemId} label={source.name} quality={source.icon?.qualityId} size={36} />
        <span className="farm-source__identity">
          <strong>{source.name}</strong>
          <small>{disciplineLabel(source.discipline)}{source.kind ? ` · ${sourceKindLabel(source.kind)}` : ''}</small>
        </span>
        {source.matches.length ? (
          <span className="farm-source__matches">
            {source.matches.map((match) => (
              <span key={match.itemKey} className="farm-source__match" title={rateRangeText(match)}>
                <span className={`farm-item farm-item--q${match.qualityId ?? 1}`}>{match.name}</span>
                <b className={`farm-rate farm-rate--${match.confidence}`}>{formatRate(match.rate)}</b>
                <ConfidenceTag confidence={match.confidence} />
              </span>
            ))}
          </span>
        ) : (
          <span className="farm-source__meta">
            {formatCount(source.characters)} {source.characters === 1 ? 'character' : 'characters'} · {formatCount(source.zones)} {source.zones === 1 ? 'zone' : 'zones'}
          </span>
        )}
        <span className="farm-source__count">
          <strong>{formatCount(source.observations)}</strong>
          <small>observations</small>
        </span>
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
  }, [query, discipline])

  const data = state.data
  const sources = data?.sources || []
  const disciplines = data?.disciplines || []

  function open(nextKey, itemKey = '') {
    setInitialItemKey(itemKey)
    openSource(nextKey)
  }

  return (
    <section className="farming">
      <h2 className="farming__title">Farming Intelligence</h2>
      <label className="farming__search">
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

      {state.status === 'error' ? <p className="intel-error">Farming intelligence is unavailable right now.</p> : null}
      {state.status === 'loading' ? <p className="intel-muted">Reading gathering observations…</p> : null}
      {state.status === 'ready' && !sources.length ? (
        <EmptyTelemetry title={query ? 'Nothing matches that search.' : 'No gathering observations yet.'}>
          {query ? 'Try another item or source name.' : 'Sources appear once Guildweaver syncs gathering telemetry.'}
        </EmptyTelemetry>
      ) : null}
      {sources.length ? (
        <div className="farming__sources">
          <h3>Sources{query ? <small> producing or named “{query}”</small> : null}</h3>
          <ul>
            {sources.map((source) => <SourceRow key={source.sourceKey} source={source} onOpen={open} />)}
          </ul>
        </div>
      ) : null}

      {sourceKey ? (
        <FarmingSourceModal key={sourceKey} sourceKey={sourceKey} initialItemKey={initialItemKey} onClose={() => open('')} />
      ) : null}
    </section>
  )
}
